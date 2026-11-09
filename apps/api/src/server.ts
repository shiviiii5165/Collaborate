/**
 * Collaborate. by AI Tathastu — Dedicated Render Backend Service
 * Framework: Fastify (High-Performance Modular Monolith)
 *
 * Authoritative home of Collaborate-owned business logic, real-time SSE messaging,
 * and database persistence. Connects directly to Neon / Supabase PostgreSQL.
 */

import crypto from 'crypto';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { durableDb, getKolkataDateKey, ConcurrentModificationError } from '@/lib/db/index';
import { toPublicMember, toSelfMember, isVisibleInDiscovery } from '@/modules/profile/public-member';
import { applyLocalProfileEdit, releaseIdentityFills } from '@/modules/profile/ownership';
import { ProfileEditError, sanitizeProfileUpdates } from '@/modules/profile/profile-edit';
import { isNeonConfigured } from '@/lib/db/neon';
import { IdentityService } from '@/modules/identity/service';
import { TathastuSsoService } from '@/modules/identity/tathastu-sso';
import { TathastuClient } from '@/integrations/tathastu/client';
import {
  verifySessionToken,
  COOKIE_NAME,
  SessionPayload,
  buildSessionCookie,
  PENDING_LINK_COOKIE_NAME,
  signPendingLinkToken,
  verifyPendingLinkToken,
} from '@/lib/auth/session';
import { classifySsoError, getSsoErrorMessage, SsoErrorCode } from '@/lib/auth/sso-errors';
import { getConfigDiagnostics, isSsoEnabled, isTestHarnessEnabled } from '@/integrations/tathastu/config';
import { assertProductionSecrets, resolveServerSecret } from '@/lib/auth/secrets';
import {
  getPaymentWebhookSecret,
  verifyPaymentWebhookSignature,
  PAYMENT_WEBHOOK_PROVIDER,
} from '@/modules/billing/payment-webhook';
import { isOriginAllowed } from '@/lib/http/cors-policy';
import { checkPasswordAttempt } from '@/lib/http/rate-limit';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { canInitiateContact } from '@collaborate/domain';
import type { MemberProfile } from '@collaborate/contracts';
import { getRecommendationsForMember, getProjectCollaborators } from '@/lib/recommendations';
import { MATCH_CATEGORIES, type MatchCategory } from '@/modules/intelligence/matching';
import { getProfileIntelligence } from '@/modules/intelligence/profile-intelligence';
import { FederationService, ReauthorizationRequiredError } from '@/modules/federation/client';
import { TathastuSyncSimulator } from '@/integrations/tathastu/sync/simulator';

// Extend FastifyRequest with authenticated user and rawBody
declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionPayload;
    rawBody?: Buffer;
  }
}

export function buildServer(): FastifyInstance {
  // Fail safe: refuse to start in production without real AUTH_SECRET / SESSION_SECRET.
  assertProductionSecrets();

  const fastify = Fastify({
    logger: false,
    trustProxy: true,
  });

  // 0. Shared durable storage (Postgres mode). Every request first pulls documents changed by
  //    other instances; every response is sent only after this request's changes are durably
  //    written. A write conflict with another instance returns 409 and writes nothing.
  //    No-ops for the local JSON store used in development and tests.
  const LIVENESS_PATHS = new Set(['/', '/health']);
  fastify.addHook('onRequest', async (req, reply) => {
    if (LIVENESS_PATHS.has(req.url)) return;
    try {
      await durableDb.syncFromStore();
    } catch (err: any) {
      console.error('[Storage] Sync failed:', err?.message || err);
      return reply.status(503).send({ error: 'STORAGE_UNAVAILABLE', message: 'Storage is temporarily unavailable.' });
    }
  });
  fastify.addHook('onSend', async (req, reply, payload) => {
    if (!durableDb.usesSharedStore || LIVENESS_PATHS.has(req.url)) return payload;
    try {
      await durableDb.flush(req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS');
      return payload;
    } catch (err: any) {
      reply.header('content-type', 'application/json; charset=utf-8');
      reply.removeHeader('set-cookie');
      if (err instanceof ConcurrentModificationError) {
        reply.code(409);
        return JSON.stringify({ error: 'CONCURRENT_MODIFICATION', message: 'This change conflicted with another update. Please retry.' });
      }
      console.error('[Storage] Flush failed:', err?.message || err);
      reply.code(503);
      return JSON.stringify({ error: 'STORAGE_UNAVAILABLE', message: 'Your change could not be saved. Please retry.' });
    }
  });

  // 1. CORS: exact origins only (see src/lib/http/cors-policy.ts). No wildcards.
  //    Requests without an Origin header (server-to-server, webhooks) are unaffected.
  fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      return cb(null, isOriginAllowed(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Last-Event-ID', 'X-Requested-With'],
    exposedHeaders: ['Set-Cookie'],
  });

  // 1b. CSRF defence-in-depth: a browser request carrying a disallowed Origin may not
  //     change state, even though CORS would already hide the response from it.
  fastify.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    if (!isOriginAllowed(origin)) {
      return reply.status(403).send({ error: 'ORIGIN_NOT_ALLOWED' });
    }
  });

  // 2. Cookie Support
  fastify.register(cookie, {
    secret: resolveServerSecret('SESSION_SECRET'),
    parseOptions: {},
  });

  // Retain raw request body Buffer for webhook HMAC-SHA256 signature verification
  fastify.addContentTypeParser(
    ['application/json', 'application/x-www-form-urlencoded', 'text/plain'],
    { parseAs: 'buffer' },
    (req, body, done) => {
      try {
        (req as any).rawBody = body;
        if (!body || body.length === 0) {
          return done(null, {});
        }
        const str = body.toString('utf8');
        try {
          const json = JSON.parse(str);
          done(null, json);
        } catch {
          done(null, {});
        }
      } catch {
        done(null, {});
      }
    }
  );


  // 2a. Size limits for user-written text that is stored and held in memory by every instance.
  const MAX_MESSAGE_CHARS = 4000;
  const MAX_INTRO_CHARS = 500;

  // 2b. Brute-force protection for password-bearing endpoints.
  const limitPasswordAttempt = (req: FastifyRequest, reply: FastifyReply, account: string): boolean => {
    const r = checkPasswordAttempt(req.ip || 'unknown', account || 'unknown');
    if (r.allowed) return true;
    reply.header('Retry-After', String(r.retryAfter));
    reply.status(429).send({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts. Please wait and try again.', retryAfter: r.retryAfter });
    return false;
  };

  // 3. Auth Helpers
  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    let token = req.cookies[COOKIE_NAME];
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
      }
    }

    if (!token) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    const payload = await verifySessionToken(token);
    if (!payload) {
      return reply.status(401).send({ error: 'INVALID_SESSION', message: 'Session expired or invalid' });
    }

    // The account behind a still-valid token must exist and be active.
    const member = durableDb.getMemberById(payload.userId);
    if (!member || member.deactivated) {
      return reply.status(401).send({ error: 'INVALID_SESSION', message: 'Session expired or invalid' });
    }

    req.user = payload;
  };

  /**
   * Admin = verified session AND the stored member record is admin. Role is never read
   * from request parameters, and a demoted admin's older token stops working.
   */
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    await authenticate(req, reply);
    if (reply.sent) return;
    const member = durableDb.getMemberById(req.user!.userId);
    if (req.user!.role !== 'admin' || member?.role !== 'admin') {
      return reply.status(403).send({ error: 'ADMIN_ONLY', message: 'Admin role required' });
    }
  };

  const optionalAuth = async (req: FastifyRequest) => {
    let token = req.cookies[COOKIE_NAME];
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
      }
    }
    if (token) {
      const payload = await verifySessionToken(token);
      if (payload) req.user = payload;
    }
  };

  // ============================================================================
  // HEALTH & SERVICE ROOT
  // ============================================================================
  fastify.get('/', async () => ({
    status: 'ok',
    service: 'collaborate-backend',
    runtime: 'Render Node.js',
    documentation: 'Collaborate by AI Tathastu Authoritative API Service',
    database: isNeonConfigured() ? 'postgresql_configured' : 'local_storage',
    timestamp: new Date().toISOString(),
  }));

  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'collaborate-backend',
    runtime: 'Render Node.js',
    database: isNeonConfigured() ? 'postgresql_configured' : 'local_storage',
    timestamp: new Date().toISOString(),
  }));

  fastify.get('/api/health', async () => ({
    status: 'ok',
    service: 'collaborate-backend',
    runtime: 'Render Node.js',
    database: isNeonConfigured() ? 'postgresql_configured' : 'local_storage',
    timestamp: new Date().toISOString(),
  }));

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================
  fastify.post('/api/auth/register', async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { email, password, fullName, isUnder18 } = req.body || {};
    if (!email || !password || !fullName) {
      return reply.status(400).send({ error: 'Missing required registration fields' });
    }
    if (!limitPasswordAttempt(req, reply, `register:${email}`)) return reply;

    try {
      const { member, token } = await IdentityService.registerStandalone(
        email,
        password,
        fullName,
        Boolean(isUnder18)
      );

      reply.header('Set-Cookie', buildSessionCookie(token));
      return reply.status(201).send({ success: true, message: 'Registration successful', member: toSelfMember(member) });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Registration failed' });
    }
  });

  fastify.post('/api/auth/login', async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return reply.status(400).send({ error: 'Missing email or password' });
    }
    if (!limitPasswordAttempt(req, reply, `login:${email}`)) return reply;

    try {
      const { member, token } = await IdentityService.loginWithPassword(email, password);
      reply.header('Set-Cookie', buildSessionCookie(token));
      return reply.send({ success: true, message: 'Logged in successfully', member: toSelfMember(member) });
    } catch (err: any) {
      return reply.status(401).send({ error: err.message || 'Login failed' });
    }
  });

  fastify.post('/api/auth/logout', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    reply.clearCookie(PENDING_LINK_COOKIE_NAME, { path: '/' });
    reply.clearCookie('tathastu_oauth_flow', { path: '/' });
    return reply.send({ success: true, message: 'Logged out' });
  });

  fastify.get('/api/auth/me', { preHandler: authenticate }, async (req: FastifyRequest, reply) => {
    const member = durableDb.getMemberById(req.user!.userId);
    if (!member) {
      return reply.status(404).send({ error: 'Member not found' });
    }
    const self = toSelfMember(member);
    return reply.send({ authenticated: true, member: self, user: self, session: req.user });
  });

  // ============================================================================
  // PROFILES & DISCOVERY
  // ============================================================================
  fastify.get('/api/profiles', async (req: FastifyRequest<{ Querystring: { id?: string; email?: string; viewerId?: string } }>, reply) => {
    await optionalAuth(req);
    // Viewer identity comes ONLY from the verified session; ?viewerId= is ignored.
    const { id, email } = req.query;
    const viewerId = req.user?.userId || '';

    if (id) {
      const member = durableDb.getMemberById(id);
      if (!member || (member.deactivated && viewerId !== id && req.user?.role !== 'admin')) {
        return reply.status(404).send({ error: 'Profile not found' });
      }

      // Guests may only see public profiles.
      if (!viewerId && member.profileVisibility !== 'public') {
        return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Sign in to view this profile' });
      }

      // If viewing another member's profile
      if (viewerId && viewerId !== id) {
        if (durableDb.isBlocked(viewerId, id)) {
          return reply.status(403).send({ error: 'Profile not available' });
        }

        if (member.profileVisibility === 'private' && req.user?.role !== 'admin') {
          return reply.status(403).send({ error: 'This profile is private' });
        }

        if (member.profileVisibility === 'connections_only' && req.user?.role !== 'admin') {
          const conn = durableDb.getConnectionState(viewerId, id);
          if (!conn || conn.status !== 'accepted') {
            return reply.status(403).send({ error: 'Profile visible to accepted connections only' });
          }
        }

        // Daily 3-view quota enforcement
        const quotaResult = durableDb.recordProfileView(viewerId, id);
        if (!quotaResult.allowed) {
          return reply.status(402).send({
            error: 'QUOTA_EXCEEDED',
            message: 'You have reached your daily Free plan quota of 3 distinct full-profile views. Upgrade to Collaborate Premium for unlimited access.',
            dateKey: getKolkataDateKey(),
            remaining: 0,
          });
        }

        const conn = durableDb.getConnectionState(viewerId, id);
        return reply.send({
          member: toPublicMember(member, {
            viewerId,
            isConnected: conn?.status === 'accepted',
            isAdmin: req.user?.role === 'admin',
          }),
          quota: {
            remaining: quotaResult.remaining,
            alreadyViewedToday: quotaResult.alreadyViewedToday,
            dateKey: getKolkataDateKey(),
          },
          connectionStatus: conn ? conn.status : 'not_connected',
          connectionId: conn ? conn.id : null,
        });
      }

      // Viewing self or guest viewing
      const connStatus = viewerId === id ? 'self' : 'not_connected';
      return reply.send({
        member: viewerId === id ? toSelfMember(member) : toPublicMember(member, {}),
        quota: { remaining: 3, alreadyViewedToday: true, dateKey: getKolkataDateKey() },
        connectionStatus: connStatus,
      });
    }

    if (email) {
      // Email lookup is for the account owner or admins only (prevents enumeration).
      if (!req.user) return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' });
      const member = durableDb.getMemberByEmail(email);
      if (!member || (member.id !== req.user.userId && req.user.role !== 'admin')) {
        return reply.status(404).send({ error: 'Profile not found' });
      }
      return reply.send({ member: toSelfMember(member) });
    }

    // Directory listing: only members who chose to be discoverable with a public profile.
    const members = durableDb
      .getAllMembers()
      .filter((m) => m.profileVisibility === 'public' && isVisibleInDiscovery(m, viewerId ? durableDb.getMemberById(viewerId) : null, false))
      .map((m) => toPublicMember(m, { viewerId }));
    return reply.send(members);
  });

  /** Fields a member can never set through profile edits (identity, role, billing, trust). */
  const PROTECTED_PROFILE_FIELDS = [
    'id', 'email', 'role', 'plan', 'planExpiresAt', 'isVerified', 'verifiedCategory', 'verifiedAt',
    'tathastu_user_id', 'isLinkedWithTathastu', 'tathastuSyncStatus', 'tathastuProfile', 'tathastuLastSyncedAt',
    'isRestricted', 'deactivated', 'safeguardingApproved', 'isUnder18', 'statusBadges',
    // Ownership bookkeeping: changed only through the import pipeline or applyLocalProfileEdit.
    'importedProfile', 'localProfile', 'importedIdentity', 'tathastuLinkedAt', 'discoveryChoiceMade',
    // Validated through POST /api/recommendations/preferences only.
    'recommendationPreferences',
    'autoProvisioned', 'unlinkedTathastuSubjects',
  ];

  fastify.put('/api/profiles', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const body = req.body || {};
    const rawUpdates = (body.updates || body) as Record<string, any>;
    const targetUserId = body.id || rawUpdates.id || req.user!.userId;

    if (targetUserId !== req.user!.userId && req.user!.role !== 'admin') {
      return reply.status(403).send({ error: 'Unauthorized to edit this profile' });
    }

    const existing = durableDb.getMemberById(targetUserId);
    if (!existing) return reply.status(404).send({ error: 'Member not found' });

    // Allow-list: only known fields, each type- and size-checked; everything else is ignored
    // (see src/modules/profile/profile-edit.ts). Profile sections go through the ownership model:
    // edits become local data, hides or overrides of imported entries, never the imported copy.
    let updates: Record<string, any>;
    let sectionUpdates: Record<string, any>;
    try {
      ({ plain: updates, sections: sectionUpdates } = sanitizeProfileUpdates(rawUpdates, existing));
    } catch (err) {
      if (err instanceof ProfileEditError) return reply.status(400).send({ error: err.message });
      throw err;
    }
    for (const field of PROTECTED_PROFILE_FIELDS) delete updates[field]; // belt and braces
    const updatedMember: MemberProfile = { ...existing, ...updates };
    if ('discoverable' in updates) {
      // An automatically created profile starts private; turning discovery on is the member's
      // opt-in, so it also makes the profile page visible (unless they choose a visibility too).
      if (updates.discoverable === true && existing.autoProvisioned && !existing.discoveryChoiceMade && !('profileVisibility' in updates)) {
        updatedMember.profileVisibility = 'public';
      }
      updatedMember.discoveryChoiceMade = true;
    }
    releaseIdentityFills(updatedMember, Object.keys(updates));
    applyLocalProfileEdit(updatedMember, sectionUpdates);

    await durableDb.saveMemberAsync(updatedMember);
    const self = toSelfMember(updatedMember);
    return reply.send({ success: true, member: self, profile: self });
  });

  fastify.get('/api/discover', async (req: FastifyRequest<{ Querystring: { q?: string; tag?: string; skill?: string; viewerId?: string; page?: string; pageSize?: string } }>, reply) => {
    await optionalAuth(req);
    const { q, tag, skill } = req.query;
    const currentUserId = req.user?.userId || ''; // never from ?viewerId=

    const viewer = currentUserId ? durableDb.getMemberById(currentUserId) : null;
    const isConnected = (otherId: string) =>
      Boolean(currentUserId) && durableDb.getConnectionState(currentUserId, otherId)?.status === 'accepted';

    const recommendations = currentUserId
      ? getRecommendationsForMember(currentUserId, 10).map((r) => ({
          ...r,
          member: toPublicMember(r.member, { viewerId: currentUserId, isConnected: isConnected(r.member.id) }),
        }))
      : [];

    // Same gate as recommendations: discoverable, visibility, safeguarding, blocks (both ways).
    let members = durableDb.getAllMembers().filter((m) => {
      if (m.id === currentUserId) return false;
      if (currentUserId && durableDb.isBlocked(currentUserId, m.id)) return false;
      return isVisibleInDiscovery(m, viewer, isConnected(m.id));
    });

    if (q) {
      const lower = q.toLowerCase();
      members = members.filter(
        (m) =>
          m.fullName.toLowerCase().includes(lower) ||
          m.headline.toLowerCase().includes(lower) ||
          m.skills.some((s) => s.toLowerCase().includes(lower))
      );
    }

    if (tag) {
      members = members.filter((m) => m.contextTags?.includes(tag));
    }

    if (skill) {
      members = members.filter((m) => m.skills?.includes(skill));
    }

    // One directory, one stable order, no duplicates:
    //   1. recommended  strongest matches (explainable), in rank order
    //   2. other        every other eligible member, pending requests included, by name then id
    //   3. connected    accepted connections last (already in your network)
    // Everyone eligible is listed; a low match score never hides anyone.
    const recommendedRank = new Map(recommendations.map((r, i) => [r.member.id, i]));
    const sectionOf = (status: string | undefined, id: string) =>
      status === 'accepted' ? 'connected' : recommendedRank.has(id) ? 'recommended' : status === 'request_sent' ? 'pending' : 'other';
    const SECTION_ORDER: Record<string, number> = { recommended: 0, pending: 1, other: 1, connected: 2 };

    const ordered = members
      .map((m) => {
        const conn = currentUserId ? durableDb.getConnectionState(currentUserId, m.id) : null;
        return { m, conn, section: sectionOf(conn?.status, m.id) };
      })
      .sort(
        (a, b) =>
          SECTION_ORDER[a.section] - SECTION_ORDER[b.section] ||
          (recommendedRank.get(a.m.id) ?? 0) - (recommendedRank.get(b.m.id) ?? 0) ||
          a.m.fullName.localeCompare(b.m.fullName) ||
          a.m.id.localeCompare(b.m.id)
      );

    // Pagination is opt-in (?page / ?pageSize); without them the full ordered list is returned,
    // which is what the current UI expects.
    const paged = req.query.page !== undefined || req.query.pageSize !== undefined;
    const pageSize = paged ? Math.max(1, Math.min(Number(req.query.pageSize) || 20, 50)) : Math.max(1, ordered.length);
    const page = paged ? Math.max(1, Math.floor(Number(req.query.page) || 1)) : 1;
    const slice = ordered.slice((page - 1) * pageSize, page * pageSize);

    const results = slice.map(({ m, conn, section }) => ({
      ...toPublicMember(m, { viewerId: currentUserId, isConnected: conn?.status === 'accepted' }),
      connectionStatus: conn ? conn.status : 'not_connected',
      connectionId: conn ? conn.id : null,
      // Pending is split by direction so the UI can show "respond" vs "sent".
      pendingDirection: conn?.status === 'request_sent' ? (conn.requesterId === currentUserId ? 'outgoing' : 'incoming') : null,
      section,
    }));

    return reply.send({
      count: ordered.length,
      total: ordered.length,
      page,
      pageSize,
      hasMore: page * pageSize < ordered.length,
      sections: {
        recommended: ordered.filter((o) => o.section === 'recommended').length,
        pending: ordered.filter((o) => o.section === 'pending').length,
        other: ordered.filter((o) => o.section === 'other').length,
        connected: ordered.filter((o) => o.section === 'connected').length,
      },
      members: results,
      results,
      recommendations: page === 1 ? recommendations : [],
      viewerPlan: currentUserId ? durableDb.getMemberById(currentUserId)?.plan || 'free' : 'free',
    });
  });

  // ============================================================================
  // PROFILE INTELLIGENCE & EXPLAINABLE RECOMMENDATIONS
  // ============================================================================
  // Own structured profile understanding (skills with provenance and evidence, derived
  // domains, completeness). Only ever for the session member.
  fastify.get('/api/intelligence/me', { preHandler: authenticate }, async (req: FastifyRequest, reply) => {
    const member = durableDb.getMemberById(req.user!.userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });
    reply.header('Cache-Control', 'no-store');
    return reply.send({ intelligence: getProfileIntelligence(member) });
  });

  fastify.get('/api/recommendations', { preHandler: authenticate }, async (req: FastifyRequest<{ Querystring: { category?: string; limit?: string } }>, reply) => {
    const userId = req.user!.userId;
    const category = (req.query.category || 'all') as MatchCategory;
    if (!MATCH_CATEGORIES.includes(category)) {
      return reply.status(400).send({ error: 'INVALID_CATEGORY', categories: MATCH_CATEGORIES });
    }
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 6, 20));
    const recommendations = getRecommendationsForMember(userId, limit, category).map((r) => ({
      ...r,
      member: toPublicMember(r.member, { viewerId: userId, isConnected: false }),
    }));
    return reply.send({ category, count: recommendations.length, recommendations });
  });

  // Who could contribute to one of MY projects. Another member's project id returns 404.
  fastify.get('/api/projects/collaborators', { preHandler: authenticate }, async (req: FastifyRequest<{ Querystring: { projectId?: string } }>, reply) => {
    const userId = req.user!.userId;
    const projectId = req.query.projectId || '';
    const result = projectId ? getProjectCollaborators(userId, projectId) : null;
    if (!result) return reply.status(404).send({ error: 'PROJECT_NOT_FOUND', message: 'Project not found in your profile' });
    return reply.send({
      ...result,
      candidates: result.candidates.map((c) => ({
        ...c,
        member: toPublicMember(c.member, {
          viewerId: userId,
          isConnected: durableDb.getConnectionState(userId, c.member.id)?.status === 'accepted',
        }),
      })),
    });
  });

  fastify.post('/api/recommendations/preferences', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const member = durableDb.getMemberById(req.user!.userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });
    const { hideFromRecommendations, dismissMemberId, undismissMemberId } = req.body || {};
    const prefs = { ...(member.recommendationPreferences || {}) };
    if (hideFromRecommendations !== undefined) {
      if (typeof hideFromRecommendations !== 'boolean') return reply.status(400).send({ error: 'hideFromRecommendations must be boolean' });
      prefs.hideFromRecommendations = hideFromRecommendations;
    }
    const dismissed = new Set(prefs.dismissedMemberIds || []);
    if (typeof dismissMemberId === 'string' && dismissMemberId && dismissMemberId !== member.id) dismissed.add(dismissMemberId);
    if (typeof undismissMemberId === 'string') dismissed.delete(undismissMemberId);
    prefs.dismissedMemberIds = [...dismissed].slice(-500);
    await durableDb.saveMemberAsync({ ...member, recommendationPreferences: prefs });
    return reply.send({ success: true, recommendationPreferences: prefs });
  });

  // ============================================================================
  // CONNECTIONS
  // ============================================================================
  fastify.get('/api/connections', { preHandler: authenticate }, async (req: FastifyRequest, reply) => {
    const userId = req.user!.userId;
    const all = durableDb.getAllConnections();
    const connections = all.filter((c) => c.requesterId === userId || c.recipientId === userId);
    // Additive, for the Connections view: each list carries the other member in the public shape.
    // `connections` (raw records) is unchanged for existing callers.
    const withMember = (c: (typeof connections)[number]) => {
      const otherId = c.requesterId === userId ? c.recipientId : c.requesterId;
      const other = durableDb.getMemberById(otherId);
      if (!other || other.deactivated) return [];
      return [{ ...c, connectionId: c.id, member: toPublicMember(other, { viewerId: userId, isConnected: c.status === 'accepted' }) }];
    };
    return reply.send({
      connections,
      accepted: connections.filter((c) => c.status === 'accepted').flatMap(withMember),
      pendingReceived: connections.filter((c) => c.status === 'request_sent' && c.recipientId === userId).flatMap(withMember),
      pendingSent: connections.filter((c) => c.status === 'request_sent' && c.requesterId === userId).flatMap(withMember),
    });
  });

  fastify.post('/api/connections', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { action, targetUserId, toId, targetMemberId, recipientId, connectionId, introMessage } = req.body || {};
    const userId = req.user!.userId;
    const targetId = targetUserId || toId || targetMemberId || recipientId;

    // Store rule violations become 4xx with a stable code, never a 500.
    const STORE_ERRORS: [RegExp, number, string][] = [
      [/yourself/i, 409, 'CONNECTION_CONFLICT'],
      [/not found/i, 404, 'NOT_FOUND'],
      [/unauthorized responder|only sender/i, 403, 'FORBIDDEN'],
      [/blocked|cannot connect/i, 403, 'CONNECTION_NOT_ALLOWED'],
      [/already|pending|yourself/i, 409, 'CONNECTION_CONFLICT'],
    ];
    const storeError = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const hit = STORE_ERRORS.find(([re]) => re.test(message));
      if (!hit) throw err;
      return reply.status(hit[1]).send({ error: hit[2], message });
    };

    if (action === 'send' || action === 'request' || action === 'send_request') {
      if (!targetId) return reply.status(400).send({ error: 'targetUserId or toId required' });

      const target = durableDb.getMemberById(targetId);
      if (!target || target.deactivated) return reply.status(404).send({ error: 'Target member not found' });

      const sender = durableDb.getMemberById(userId);
      const contactGate = canInitiateContact(
        { id: userId, isUnder18: sender?.isUnder18 },
        { id: targetId, isUnder18: target.isUnder18 }
      );
      if (!contactGate.allowed) {
        return reply.status(403).send({ error: 'SAFEGUARDING_RESTRICTION', message: contactGate.reason });
      }

      try {
        if (introMessage !== undefined && introMessage !== null && (typeof introMessage !== 'string' || introMessage.length > MAX_INTRO_CHARS)) {
          return reply.status(400).send({ error: `The note can be at most ${MAX_INTRO_CHARS} characters` });
        }
        const conn = await durableDb.sendConnectionRequestAsync(userId, targetId, introMessage ? introMessage.trim() : undefined);
        return reply.status(201).send({ success: true, connection: conn });
      } catch (err) {
        return storeError(err);
      }
    }

    if (action === 'accept' || action === 'decline' || action === 'reject' || action === 'withdraw') {
      if (!connectionId) return reply.status(400).send({ error: 'connectionId required' });
      const status = action === 'accept' ? 'accept' : action === 'withdraw' ? 'withdraw' : 'reject';
      try {
        const updated = await durableDb.respondToConnectionAsync(connectionId, userId, status);
        return reply.send({ success: true, connection: updated });
      } catch (err) {
        return storeError(err);
      }
    }

    // Disconnect: either side of an accepted connection may end it.
    if (action === 'remove' || action === 'disconnect') {
      if (!targetId) return reply.status(400).send({ error: 'targetUserId required' });
      const conn = durableDb.getConnectionState(userId, targetId);
      if (!conn || conn.status !== 'accepted') return reply.status(404).send({ error: 'NOT_CONNECTED' });
      durableDb.removeConnection(userId, targetId);
      return reply.send({ success: true, removed: true });
    }

    if (action === 'block') {
      if (!targetId) return reply.status(400).send({ error: 'targetMemberId or targetUserId required' });
      await durableDb.blockMemberAsync(userId, targetId);
      return reply.send({ success: true, blocked: true });
    }

    if (action === 'unblock') {
      if (!targetId) return reply.status(400).send({ error: 'targetMemberId or targetUserId required' });
      durableDb.unblockMember(userId, targetId);
      return reply.send({ success: true, unblocked: true });
    }

    return reply.status(400).send({ error: 'Invalid action' });
  });

  // ============================================================================
  // DIRECT MESSAGING & REAL-TIME SSE STREAM
  // ============================================================================
  fastify.get('/api/messages', { preHandler: authenticate }, async (req: FastifyRequest<{ Querystring: { conversationWith?: string; conversationId?: string; peerId?: string } }>, reply) => {
    const userId = req.user!.userId;
    const conversationWith = req.query.conversationWith || req.query.peerId;
    const { conversationId } = req.query;

    if (conversationWith) {
      if (durableDb.isBlocked(userId, conversationWith)) {
        return reply.status(403).send({ error: 'MESSAGING_FORBIDDEN_BLOCKED', message: 'User is blocked' });
      }
      const allConvs = durableDb.getAllConversations();
      const conv = allConvs.find(
        (c) => c.participantIds.includes(userId) && c.participantIds.includes(conversationWith)
      );
      if (!conv) return reply.send({ messages: [] });
      const messages = durableDb.getMessagesForConversation(conv.id);
      return reply.send({ messages, conversation: conv });
    }

    if (conversationId) {
      const conv = durableDb.getConversationById(conversationId);
      if (!conv || !conv.participantIds.includes(userId)) {
        return reply.status(404).send({ error: 'Conversation not found' });
      }
      const messages = durableDb.getMessagesForConversation(conversationId);
      return reply.send({ messages });
    }

    // The chat list needs the other participant, the last message and the unread count. Without them
    // the Messages view crashed for anyone with a conversation. The other member goes out through
    // the same public allow-list as everywhere else (no email or internal fields).
    const conversations = durableDb
      .getAllConversations()
      .filter((c) => c.participantIds.includes(userId))
      .flatMap((c) => {
        const otherId = c.participantIds.find((id) => id !== userId) ?? '';
        const other = durableDb.getMemberById(otherId);
        if (!other || durableDb.isBlocked(userId, otherId)) return [];
        const messages = durableDb.getMessagesForConversation(c.id);
        const lastMessage = messages[messages.length - 1] ?? null;
        const unreadCount = messages.filter((m) => m.recipientId === userId && m.status !== 'read').length;
        const isConnected = durableDb.getConnectionState(userId, otherId)?.status === 'accepted';
        return [{ ...c, otherMember: toPublicMember(other, { viewerId: userId, isConnected }), lastMessage, unreadCount }];
      })
      .sort((a, b) => (b.lastMessage?.timestamp ?? '').localeCompare(a.lastMessage?.timestamp ?? ''));
    return reply.send({ conversations });
  });

  fastify.post('/api/messages', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const userId = req.user!.userId;
    const { recipientId } = req.body || {};
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';

    if (typeof recipientId !== 'string' || !recipientId || !content) {
      return reply.status(400).send({ error: 'recipientId and content required' });
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      return reply.status(400).send({ error: `Messages can be at most ${MAX_MESSAGE_CHARS} characters` });
    }

    if (durableDb.isBlocked(userId, recipientId) || durableDb.isBlocked(recipientId, userId)) {
      return reply.status(403).send({ error: 'MESSAGING_FORBIDDEN_BLOCKED', message: 'Messaging blocked' });
    }

    const conn = durableDb.getConnectionState(userId, recipientId);
    if (!conn || conn.status !== 'accepted') {
      return reply.status(403).send({ error: 'MESSAGING_NOT_CONNECTED', message: 'Messaging only allowed between accepted connections' });
    }

    const msg = await durableDb.sendMessageAsync(userId, recipientId, content);
    return reply.status(201).send({ success: true, message: msg });
  });

  // Persistent Server-Sent Events (SSE) stream on Render
  fastify.get('/api/messages/stream', { preHandler: authenticate }, async (req: FastifyRequest, reply) => {
    const userId = req.user!.userId;
    const lastEventId = (req.headers['last-event-id'] as string) || (req.query as any)?.sinceId;

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');

    // Send connected handshake
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ userId, status: 'ready', time: new Date().toISOString() })}\n\n`);

    // Replay any missed messages if requested
    if (lastEventId) {
      const convs = durableDb.getAllConversations().filter((c) => c.participantIds.includes(userId));
      for (const conv of convs) {
        const msgs = durableDb.getMessagesForConversation(conv.id);
        const missed = msgs.filter((m) => m.recipientId === userId && m.id > lastEventId);
        for (const m of missed) {
          reply.raw.write(`id: ${m.id}\nevent: message\ndata: ${JSON.stringify(m)}\n\n`);
        }
      }
    }

    // Keepalive heartbeat ping every 15 seconds
    const heartbeat = setInterval(() => {
      reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);
    }, 15000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
    });
  });

  // ============================================================================
  // SAVED BOOKMARKS & STATS
  // ============================================================================
  fastify.get('/api/saved', { preHandler: authenticate }, async (req: FastifyRequest, reply) => {
    const userId = req.user!.userId;
    const saved = durableDb.getSavedMembers(userId).map((m) =>
      toPublicMember(m, { viewerId: userId, isConnected: durableDb.getConnectionState(userId, m.id)?.status === 'accepted' })
    );
    return reply.send({ count: saved.length, savedMembers: saved, savedProfiles: saved });
  });

  fastify.post('/api/saved', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { targetMemberId, targetUserId, action } = req.body || {};
    const targetId = targetMemberId || targetUserId;
    if (!targetId) return reply.status(400).send({ error: 'targetMemberId required' });

    const userId = req.user!.userId;
    if (action === 'remove' || action === 'delete') {
      const success = durableDb.removeMemberBookmark(userId, targetId);
      return reply.send({ success, isSaved: false });
    }

    const success = durableDb.saveMemberBookmark(userId, targetId);
    return reply.send({ success, isSaved: true });
  });

  fastify.get('/api/stats', { preHandler: authenticate }, async (req: FastifyRequest, reply) => {
    const stats = durableDb.getProfileStats(req.user!.userId);
    return reply.send(stats);
  });

  // ============================================================================
  // SETTINGS, EXPORT & SAFE DELETION
  // ============================================================================
  fastify.get('/api/settings', { preHandler: authenticate }, async (req: FastifyRequest, reply) => {
    const member = durableDb.getMemberById(req.user!.userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });
    return reply.send({
      email: member.email,
      fullName: member.fullName,
      plan: member.plan,
      profileVisibility: member.profileVisibility,
      notificationPreferences: member.notificationPreferences,
      isRestricted: member.isRestricted,
    });
  });

  /** Shared by POST (action update_password) and PUT (action change_password) so the rules can't drift. */
  const changePassword = async (req: FastifyRequest, reply: FastifyReply, currentPassword: unknown, newPassword: unknown) => {
    const userId = req.user!.userId;
    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ error: 'Missing current or new password' });
    }
    if (!limitPasswordAttempt(req, reply, `pwchange:${userId}`)) return reply;
    const member = durableDb.getMemberById(userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });
    const cred = durableDb.getCredential(userId);
    if (!cred) return reply.status(401).send({ error: 'Credentials not found' });

    const valid = await verifyPassword(String(currentPassword), cred.passwordHash, cred.salt);
    if (!valid) return reply.status(401).send({ error: 'Current password incorrect' });
    // Same rule as registration: a change must not weaken the account below it.
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return reply.status(400).send({ error: 'New password must be at least 8 characters' });
    }

    const { hash: newHash, salt: newSalt } = await hashPassword(newPassword);
    durableDb.setCredential(userId, newHash, newSalt);
    return reply.send({ success: true, message: 'Password updated' });
  };

  const buildExport = (userId: string, member: MemberProfile) => ({
    profile: toSelfMember(member),
    connections: durableDb.getAllConnections().filter((c) => c.requesterId === userId || c.recipientId === userId),
    exportedAt: new Date().toISOString(),
    platform: 'Collaborate by AI Tathastu',
  });

  const PROFILE_VISIBILITIES = ['public', 'connections_only', 'private'] as const;
  const CONTACT_VISIBILITIES = ['connections_only', 'hidden'] as const;
  const NOTIFICATION_KEYS = ['connections', 'messages', 'verifications', 'recommendations', 'securityAlerts'] as const;
  const SYNC_KEYS = ['autoSyncProjects', 'autoSyncSkills', 'autoSyncAchievements'] as const;

  /**
   * PUT /api/settings — the contract the Settings screen actually uses (src/components/SettingsView.tsx).
   * Previously only GET/POST/DELETE existed, so every Settings action answered 404 in production.
   * Each action validates its input; unknown keys are ignored, never stored.
   */
  fastify.put('/api/settings', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const body = req.body || {};
    const userId = req.user!.userId;

    if (body.action === 'change_password') {
      const pc = body.passwordChange && typeof body.passwordChange === 'object' ? body.passwordChange : {};
      return changePassword(req, reply, pc.currentPassword, pc.newPassword);
    }

    const member = durableDb.getMemberById(userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });

    switch (body.action) {
      case 'update_privacy': {
        const p = body.privacy && typeof body.privacy === 'object' ? body.privacy : null;
        if (!p) return reply.status(400).send({ error: 'privacy settings are required' });
        if (p.discoverable !== undefined && typeof p.discoverable !== 'boolean') return reply.status(400).send({ error: 'discoverable must be true or false' });
        if (p.profileVisibility !== undefined && !PROFILE_VISIBILITIES.includes(p.profileVisibility)) return reply.status(400).send({ error: 'Invalid profile visibility' });
        if (p.contactVisibility !== undefined && !CONTACT_VISIBILITIES.includes(p.contactVisibility)) return reply.status(400).send({ error: 'Invalid contact visibility' });
        const next: MemberProfile = { ...member };
        if (p.discoverable !== undefined) {
          next.discoverable = p.discoverable;
          next.discoveryChoiceMade = true;
        }
        if (p.profileVisibility !== undefined) next.profileVisibility = p.profileVisibility;
        if (p.contactVisibility !== undefined) next.contactVisibility = p.contactVisibility;
        await durableDb.saveMemberAsync(next);
        return reply.send({ success: true, member: toSelfMember(next) });
      }
      case 'update_notifications': {
        const n = body.notificationPreferences && typeof body.notificationPreferences === 'object' ? body.notificationPreferences : null;
        if (!n) return reply.status(400).send({ error: 'notificationPreferences are required' });
        const prefs = { ...(member.notificationPreferences || {}) } as Record<string, boolean>;
        for (const k of NOTIFICATION_KEYS) {
          if (n[k] === undefined) continue;
          if (typeof n[k] !== 'boolean') return reply.status(400).send({ error: `${k} must be true or false` });
          prefs[k] = n[k];
        }
        await durableDb.saveMemberAsync({ ...member, notificationPreferences: prefs as unknown as MemberProfile['notificationPreferences'] });
        return reply.send({ success: true });
      }
      case 'update_federation_sync': {
        const s = body.tathastuSyncSettings && typeof body.tathastuSyncSettings === 'object' ? body.tathastuSyncSettings : null;
        if (!s) return reply.status(400).send({ error: 'tathastuSyncSettings are required' });
        const settings = { ...(member.tathastuSyncSettings || {}) } as Record<string, boolean>;
        for (const k of SYNC_KEYS) {
          if (s[k] === undefined) continue;
          if (typeof s[k] !== 'boolean') return reply.status(400).send({ error: `${k} must be true or false` });
          settings[k] = s[k];
        }
        await durableDb.saveMemberAsync({ ...member, tathastuSyncSettings: settings as unknown as MemberProfile['tathastuSyncSettings'] });
        return reply.send({ success: true });
      }
      case 'restrict_account': {
        if (typeof body.isRestricted !== 'boolean') return reply.status(400).send({ error: 'isRestricted must be true or false' });
        // Restricting also makes the profile private; lifting the restriction leaves visibility as the member set it.
        const next: MemberProfile = body.isRestricted ? { ...member, isRestricted: true, profileVisibility: 'private' } : { ...member, isRestricted: false };
        await durableDb.saveMemberAsync(next);
        return reply.send({ success: true, restricted: next.isRestricted, message: next.isRestricted ? 'Account restricted: your profile is now private.' : 'Restriction lifted.' });
      }
      case 'export_data': {
        reply.header('Cache-Control', 'no-store');
        return reply.send({ success: true, export: buildExport(userId, member) });
      }
      default:
        return reply.status(400).send({ error: 'Invalid settings action' });
    }
  });

  fastify.post('/api/settings', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { action, currentPassword, newPassword } = req.body || {};
    const userId = req.user!.userId;

    if (action === 'update_password') return changePassword(req, reply, currentPassword, newPassword);

    if (action === 'restrict_account') {
      const member = durableDb.getMemberById(userId);
      if (member) {
        durableDb.saveMember({ ...member, isRestricted: true, profileVisibility: 'private' });
      }
      return reply.send({ success: true, restricted: true });
    }

    if (action === 'deactivate') {
      const member = durableDb.getMemberById(userId);
      if (member) {
        durableDb.saveMember({ ...member, deactivated: true });
      }
      reply.clearCookie(COOKIE_NAME, { path: '/' });
      return reply.send({ success: true, deactivated: true });
    }

    return reply.status(400).send({ error: 'Invalid settings action' });
  });

  fastify.delete('/api/settings', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { password, confirmation } = req.body || {};
    const userId = req.user!.userId;

    if (confirmation !== 'DELETE MY ACCOUNT') {
      return reply.status(400).send({ error: 'Confirmation phrase must be DELETE MY ACCOUNT' });
    }
    if (!limitPasswordAttempt(req, reply, `delete:${userId}`)) return reply;

    const member = durableDb.getMemberById(userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });

    const cred = durableDb.getCredential(userId);
    if (!cred) return reply.status(401).send({ error: 'Credentials not found' });

    // A missing or non-string password is simply wrong (401), never a 500.
    const valid = typeof password === 'string' && (await verifyPassword(password, cred.passwordHash, cred.salt));
    if (!valid) return reply.status(401).send({ error: 'Invalid password for account deletion' });

    // Anonymize and deactivate
    durableDb.saveMember({
      ...member,
      fullName: 'Former Member',
      headline: 'Account Deleted',
      deactivated: true,
      profileVisibility: 'private',
      discoverable: false,
    });
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.send({ success: true, deleted: true });
  });

  fastify.get('/api/settings/export', { preHandler: authenticate }, async (req: FastifyRequest, reply) => {
    const userId = req.user!.userId;
    const member = durableDb.getMemberById(userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });

    reply.header('Cache-Control', 'no-store');
    return reply.send(buildExport(userId, member));
  });

  // ============================================================================
  // VERIFICATION & ABUSE REPORTS
  // ============================================================================
  fastify.post('/api/verification', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { category, evidenceSummary } = req.body || {};
    const member = durableDb.getMemberById(req.user!.userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });

    // Validated and bounded: requests are stored and held in memory, and reviewed by admins.
    if (!['identity', 'institution', 'organization'].includes(category)) {
      return reply.status(400).send({ error: 'Choose identity, institution or organization verification' });
    }
    const evidence = typeof evidenceSummary === 'string' ? evidenceSummary.trim() : '';
    if (!evidence || evidence.length > 2000) {
      return reply.status(400).send({ error: 'Describe your evidence in 1 to 2000 characters' });
    }
    const pending = durableDb.getAllVerificationRequests().some((r) => r.memberId === member.id && r.status === 'pending');
    if (pending) return reply.status(409).send({ error: 'You already have a verification request under review' });

    const created = durableDb.submitVerificationRequest(member.id, category, evidence);
    return reply.send({ success: true, requestId: created.id });
  });

  fastify.post('/api/verification/review', { preHandler: requireAdmin }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { requestId, action, notes } = req.body || {};
    const decision: 'approved' | 'rejected' = action === 'approved' ? 'approved' : 'rejected';
    try {
      const updated = durableDb.reviewVerification(requestId, req.user!.userId, decision, notes || '');
      return reply.send({ success: true, request: updated });
    } catch {
      return reply.status(404).send({ error: 'Verification request not found' });
    }
  });

  fastify.post('/api/reports', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { reportedMemberId, reason, details } = req.body || {};
    if (typeof reportedMemberId !== 'string' || typeof reason !== 'string' || !reason.trim()) {
      return reply.status(400).send({ error: 'Missing reportedMemberId or reason' });
    }
    if (reason.length > 100 || (details !== undefined && (typeof details !== 'string' || details.length > 2000))) {
      return reply.status(400).send({ error: 'Reason must be at most 100 characters and details at most 2000' });
    }
    if (reportedMemberId === req.user!.userId || !durableDb.getMemberById(reportedMemberId)) {
      return reply.status(404).send({ error: 'Member not found' });
    }

    const repId = durableDb.submitAbuseReport(req.user!.userId, reportedMemberId, reason.trim(), (details || '').trim());
    return reply.send({ success: true, reportId: repId });
  });

  // ============================================================================
  // NOTIFICATIONS
  // ============================================================================
  // Session user only; ?userId= is ignored.
  fastify.get('/api/notifications', { preHandler: authenticate }, async (req: FastifyRequest, reply) => {
    const notifications = durableDb.getNotificationsForUser(req.user!.userId);
    const unreadCount = notifications.filter((n) => !n.isRead).length;
    return reply.send({ notifications, unreadCount });
  });

  fastify.post('/api/notifications', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { notifId } = req.body || {};
    if (notifId) {
      const owned = durableDb.getNotificationsForUser(req.user!.userId).some((n) => n.id === notifId);
      if (!owned) return reply.status(404).send({ error: 'Notification not found' });
      durableDb.markNotificationRead(notifId);
    }
    return reply.send({ success: true });
  });

  // ============================================================================
  // BILLING & SUBSCRIPTIONS
  // ============================================================================
  /**
   * Payment webhook (contract: src/modules/billing/payment-webhook.ts).
   * Order: config -> signature+timestamp over raw body -> payload validation ->
   * atomic event-id claim -> effect. Fails closed at every step.
   */
  const handlePaymentWebhook = async (req: FastifyRequest, reply: FastifyReply) => {
    const secret = getPaymentWebhookSecret();
    if (!secret) return reply.status(503).send({ error: 'PAYMENT_WEBHOOK_NOT_CONFIGURED' });

    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!rawBody || rawBody.length === 0) return reply.status(400).send({ error: 'EMPTY_BODY' });

    const sig = verifyPaymentWebhookSignature(rawBody, req.headers['x-payment-signature'] as string | undefined, secret);
    if (!sig.valid) return reply.status(401).send({ error: sig.error });

    let event: any;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return reply.status(400).send({ error: 'INVALID_JSON' });
    }
    const eventId = typeof event?.id === 'string' ? event.id.trim() : '';
    const memberId = event?.data?.memberId;
    if (!eventId || eventId.length > 255 || event?.type !== 'payment.succeeded' || typeof memberId !== 'string') {
      return reply.status(400).send({ error: 'INVALID_EVENT' });
    }
    const member = durableDb.getMemberById(memberId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });

    // Delivery ledger: the event counts as processed only after the upgrade is durably saved.
    // A failed save leaves it retryable (503), so the provider's retry can still apply it.
    let claim: 'claimed' | 'processed' | 'in_progress';
    try {
      claim = await durableDb.beginWebhookDelivery(PAYMENT_WEBHOOK_PROVIDER, eventId, event.type);
    } catch {
      return reply.status(503).send({ error: 'WEBHOOK_STORE_UNAVAILABLE' });
    }
    if (claim === 'processed') return reply.status(409).send({ error: 'REPLAYED_EVENT', eventId });
    if (claim === 'in_progress') return reply.status(409).send({ error: 'EVENT_IN_PROGRESS', eventId });

    const upgraded = {
      ...member,
      plan: 'premium' as const,
      planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    try {
      await durableDb.saveMemberAsync(upgraded);
      await durableDb.completeWebhookDelivery(PAYMENT_WEBHOOK_PROVIDER, eventId);
    } catch (err: any) {
      await durableDb.failWebhookDelivery(PAYMENT_WEBHOOK_PROVIDER, eventId, err?.message || 'save failed').catch(() => undefined);
      return reply.status(503).send({ error: 'PAYMENT_NOT_APPLIED_RETRY', eventId });
    }
    return reply.send({ success: true, verified: true, eventId, plan: upgraded.plan });
  };

  fastify.post('/api/webhooks/payments', handlePaymentWebhook);

  // Session user only; ?userId= is ignored.
  fastify.get('/api/billing', { preHandler: authenticate }, async (req: FastifyRequest, reply) => {
    const member = durableDb.getMemberById(req.user!.userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });

    return reply.send({
      plan: member.plan,
      planExpiresAt: member.planExpiresAt || null,
      pricing: {
        currency: 'INR',
        monthlyPrice: 799,
        formattedPrice: '₹799/month',
        features: [
          'Unlimited eligible full-profile views (no 3/day quota)',
          'Advanced professional filter dimensions (GPU stacks, tech stack synergy)',
          'Detailed AI matching reasoning & career path correlation',
          'Direct connection request intros up to 300 characters',
          'Priority recommendation placement in search results',
        ],
      },
      paymentGatewayStatus: 'SANDBOX_READY',
    });
  });

  fastify.post('/api/billing', async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const body = req.body || {};
    const { action } = body; // body.userId is never trusted

    // 1. Signed payment webhook (service-to-service; HMAC + timestamp + replay protection)
    if (req.headers['x-payment-signature']) {
      return handlePaymentWebhook(req, reply);
    }
    // Legacy body-signature format had no signed timestamp/event id -> rejected.
    if (body.webhookSignature) {
      return reply.status(400).send({
        error: 'UNSUPPORTED_WEBHOOK_FORMAT',
        message: 'Send X-Payment-Signature: t=<unix>,v1=<hmac> to /api/webhooks/payments.',
      });
    }

    // User-initiated billing actions need a full, active session.
    await authenticate(req, reply);
    if (reply.sent) return reply;

    const currentUserId = req.user!.userId;
    const member = durableDb.getMemberById(currentUserId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });

    if (action === 'upgrade_premium') {
      const isSandboxPermitted = process.env.ENABLE_BILLING_SANDBOX === 'true' || process.env.NODE_ENV !== 'production';
      if (!isSandboxPermitted) {
        return reply.status(403).send({
          error: 'Direct client-side upgrades strictly disabled in production. Webhook signature from authorized payment gateway required.',
        });
      }

      member.plan = 'premium';
      member.planExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await durableDb.saveMemberAsync(member);

      durableDb.addNotification(
        member.id,
        'system',
        'Collaborate Premium Activated',
        'You have unlocked unlimited full-profile views and advanced filters.',
        'usr_admin'
      );

      return reply.send({
        success: true,
        message: 'Collaborate Premium sandbox entitlement activated.',
        plan: member.plan,
        planExpiresAt: member.planExpiresAt,
      });
    }

    if (action === 'downgrade_free') {
      member.plan = 'free';
      member.planExpiresAt = undefined;
      await durableDb.saveMemberAsync(member);

      return reply.send({ success: true, message: 'Reverted to Free tier.', plan: member.plan });
    }

    return reply.status(400).send({ error: 'Invalid billing action' });
  });

  // ============================================================================
  // PRODUCTION AI TATHASTU INTEGRATION & SSO FEDERATION
  // ============================================================================

  // ============================================================================
  // PRODUCTION AI TATHASTU INTEGRATION & SSO FEDERATION
  // ============================================================================
  const OAUTH_FLOW_COOKIE = 'tathastu_oauth_flow';
  const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
  const isProd = process.env.NODE_ENV === 'production';
  const ssoCookieOptions = {
    path: '/',
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const, // must survive the top-level redirect back from AI Tathastu
  };

  const redirectWithAuthError = (reply: FastifyReply, code: SsoErrorCode) =>
    reply.redirect(`/?auth_error=${encodeURIComponent(code)}`);

  /** Server-side log only. Never includes codes, verifiers, tokens or secrets. */
  const logSsoFailure = (stage: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Tathastu SSO] ${stage} failed: ${msg.split(':')[0]} (${classifySsoError(err)})`);
  };

  // 0. Public, value-free status for the login page
  fastify.get('/api/auth/tathastu/status', async (_req, reply) => {
    const d = getConfigDiagnostics();
    reply.header('Cache-Control', 'no-store');
    return reply.send({ enabled: d.ssoEnabled, mode: d.mode });
  });

  // 1. Initiate AI Tathastu SSO Authorization Flow (OAuth 2.0 PKCE + State)
  const handleTathastuStart = async (
    req: FastifyRequest<{
      Querystring: { format?: string; prompt?: string; reconsent?: string };
    }>,
    reply: FastifyReply
  ) => {
    reply.header('Cache-Control', 'no-store');

    // Fail closed and visibly: mock mode or incomplete configuration never redirects
    // the user to AI Tathastu (and never pretends to authenticate them).
    if (!isSsoEnabled()) {
      if (req.query.format === 'json') {
        return reply.status(503).send({ error: 'sso_unavailable', message: getSsoErrorMessage('sso_unavailable') });
      }
      return redirectWithAuthError(reply, 'sso_unavailable');
    }

    const promptParam =
      req.query.prompt === 'consent' || req.query.reconsent === 'true' ? 'consent' : undefined;
    // redirect_uri is always the configured callback; it is never taken from the request.
    const { authUrl, state, codeVerifier, codeChallenge, redirectUri } = TathastuSsoService.initiateLogin({
      prompt: promptParam,
    });

    // Store state & PKCE code_verifier in an HttpOnly flow cookie (10 min TTL)
    const flowData = JSON.stringify({ state, codeVerifier, redirectUri, createdAt: Date.now() });
    reply.setCookie(OAUTH_FLOW_COOKIE, flowData, { ...ssoCookieOptions, maxAge: OAUTH_FLOW_TTL_MS / 1000 });

    if (req.query.format === 'json') {
      return reply.send({ authUrl, state, codeChallenge, redirectUri });
    }

    return reply.redirect(authUrl);
  };

  // Both /start and /authorize supported
  fastify.get('/api/auth/tathastu/start', handleTathastuStart);
  fastify.get('/api/auth/tathastu/authorize', handleTathastuStart);

  // 2. Browser Redirect Callback from AI Tathastu Central System
  fastify.get(
    '/api/auth/tathastu/callback',
    async (
      req: FastifyRequest<{
        Querystring: { code?: string; state?: string; error?: string; error_description?: string };
      }>,
      reply
    ) => {
      const { code, state, error } = req.query;
      reply.header('Cache-Control', 'no-store');

      // The flow cookie is single-use: clear it on every outcome.
      const flowCookieRaw = req.cookies[OAUTH_FLOW_COOKIE];
      reply.clearCookie(OAUTH_FLOW_COOKIE, { path: '/' });

      if (error) {
        // Provider-supplied text (error_description) is never reflected to the user.
        logSsoFailure('authorize', new Error(`PROVIDER_ERROR: ${String(error).slice(0, 64)}`));
        return redirectWithAuthError(reply, error === 'access_denied' ? 'access_denied' : 'sso_failed');
      }

      if (!code) {
        return redirectWithAuthError(reply, 'missing_code');
      }

      if (!isSsoEnabled()) {
        return redirectWithAuthError(reply, 'sso_unavailable');
      }

      // State + PKCE verifier MUST come from the flow cookie set by /start.
      let flow: { state?: string; codeVerifier?: string; redirectUri?: string; createdAt?: number } | null = null;
      if (flowCookieRaw) {
        try {
          flow = JSON.parse(flowCookieRaw);
        } catch {
          flow = null;
        }
      }
      if (!flow || typeof flow.state !== 'string' || typeof flow.codeVerifier !== 'string') {
        logSsoFailure('callback', new Error('OAUTH_FLOW_MISSING'));
        return redirectWithAuthError(reply, 'flow_expired');
      }
      if (typeof flow.createdAt !== 'number' || Date.now() - flow.createdAt > OAUTH_FLOW_TTL_MS) {
        logSsoFailure('callback', new Error('OAUTH_FLOW_EXPIRED'));
        return redirectWithAuthError(reply, 'flow_expired');
      }

      try {
        const { token } = await TathastuSsoService.processCallback({
          code,
          codeVerifier: flow.codeVerifier,
          state: state || '',
          expectedState: flow.state,
          redirectUri: TathastuClient.getRedirectUri(),
        });

        reply.header('Set-Cookie', buildSessionCookie(token));
        return reply.redirect('/?auth_success=true');
      } catch (err: any) {
        const safeCode = classifySsoError(err);
        logSsoFailure('callback', err);

        // Existing password account: hold the VERIFIED identity in a short-lived signed
        // cookie and ask for the Collaborate password. Never merge on email alone.
        if (safeCode === 'account_link_required' && err?.pendingLink) {
          const pendingToken = await signPendingLinkToken(err.pendingLink);
          reply.setCookie(PENDING_LINK_COOKIE_NAME, pendingToken, { ...ssoCookieOptions, maxAge: 600 });
        }
        return redirectWithAuthError(reply, safeCode);
      }
    }
  );

  // 3. Programmatic callback. Simulated claims are accepted ONLY by the explicit
  //    non-production test harness; otherwise this route is disabled.
  fastify.post('/api/auth/tathastu/callback', async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    if (!isTestHarnessEnabled()) {
      return reply.status(404).send({ error: 'NOT_FOUND' });
    }
    const { code, codeVerifier, state, expectedState, linkConfirmationPassword, claimsOverride } = req.body || {};
    try {
      const { member, token, isNewUser } = await TathastuSsoService.processCallback({
        code: code || 'mock_code',
        codeVerifier: codeVerifier || 'mock_verifier',
        state: state || 'mock_state',
        expectedState,
        linkConfirmationPassword,
        claimsOverride,
      });

      reply.header('Set-Cookie', buildSessionCookie(token));
      return reply.send({
        success: true,
        member: toSelfMember(member),
        isNewUser,
        message: isNewUser
          ? 'Account successfully generated from AI Tathastu Single Sign-On.'
          : 'Logged in with AI Tathastu Single Sign-On.',
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Tathastu SSO callback failed' });
    }
  });

  // 3b. Confirm existing Collaborate password to finish a paused AI Tathastu link
  fastify.post('/api/auth/tathastu/link', async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    reply.header('Cache-Control', 'no-store');
    const raw = req.cookies[PENDING_LINK_COOKIE_NAME];
    const pending = raw ? await verifyPendingLinkToken(raw) : null;
    if (!pending) {
      reply.clearCookie(PENDING_LINK_COOKIE_NAME, { path: '/' });
      return reply.status(400).send({ error: 'link_expired', message: getSsoErrorMessage('link_expired') });
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!limitPasswordAttempt(req, reply, `link:${pending.email}`)) return reply;
    try {
      const { member, token } = await TathastuSsoService.completePendingLink({ ...pending, password });
      reply.clearCookie(PENDING_LINK_COOKIE_NAME, { path: '/' });
      reply.header('Set-Cookie', buildSessionCookie(token));
      return reply.send({ success: true, member: toSelfMember(member) });
    } catch (err) {
      const safeCode = classifySsoError(err);
      logSsoFailure('link', err);
      if (safeCode !== 'link_password_invalid' && safeCode !== 'account_link_required') {
        reply.clearCookie(PENDING_LINK_COOKIE_NAME, { path: '/' });
      }
      return reply.status(safeCode === 'link_password_invalid' ? 401 : 400).send({
        error: safeCode,
        message: getSsoErrorMessage(safeCode),
      });
    }
  });

  // 4. Webhook receiver (AI Tathastu contract: X-AIT-Signature t=<unix>,v1=<HMAC-SHA256(secret, "t.body")>).
  //    Verified over the exact raw request bytes; replay window 5 minutes; delivery id taken
  //    from the signed body; processed exactly once across instances via the delivery ledger.
  fastify.post('/api/webhooks/tathastu', async (req: FastifyRequest, reply) => {
    const sigHeader = req.headers['x-ait-signature'] as string | undefined;
    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      return reply.status(400).send({ error: 'MISSING_RAW_BODY', message: 'Webhook body must be sent as application/json.' });
    }

    const sigResult = TathastuClient.verifyWebhookSignature(rawBody, sigHeader, undefined, undefined, { requireContractFormat: true });
    if (!sigResult.valid) {
      return reply.status(401).send({ error: 'INVALID_SIGNATURE', message: sigResult.error });
    }

    let event: unknown;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return reply.status(400).send({ error: 'INVALID_JSON' });
    }

    const result = await TathastuSsoService.processWebhook(event, {
      'x-ait-delivery': req.headers['x-ait-delivery'] as string | undefined,
      'x-ait-event': req.headers['x-ait-event'] as string | undefined,
    });
    return reply.status(result.status).send({ success: result.status === 200, result });
  });

  // Backward-compatible OIDC Aliases
  fastify.get('/api/auth/oidc/authorize', async (_req, reply) => {
    const oidcData = IdentityService.createOidcAuthUrl();
    return reply.send({
      authUrl: oidcData.authUrl,
      state: oidcData.state,
      codeChallenge: oidcData.codeChallenge,
    });
  });

  // Legacy simulated OIDC callback: it never verified a real identity, so it is retired.
  // Real browser callbacks use /api/auth/tathastu/callback.
  fastify.get('/api/auth/oidc/callback', async (_req, reply) => {
    return redirectWithAuthError(reply, 'sso_unavailable');
  });

  fastify.post('/api/auth/oidc/callback', async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    if (!isTestHarnessEnabled()) {
      return reply.status(404).send({ error: 'NOT_FOUND' });
    }
    const { code, codeVerifier, state, linkConfirmationPassword, mockClaims } = req.body || {};
    try {
      const { member, token, isNewUser } = await TathastuSsoService.processCallback({
        code: code || 'mock_code_tathastu_99',
        codeVerifier: codeVerifier || 'mock_verifier_tathastu',
        state: state || 'mock_state',
        linkConfirmationPassword,
        claimsOverride: mockClaims,
      });

      reply.header('Set-Cookie', buildSessionCookie(token));
      return reply.send({
        success: true,
        member: toSelfMember(member),
        isNewUser,
        message: isNewUser
          ? 'Account successfully generated from AI Tathastu SSO.'
          : 'Logged in with AI Tathastu Single Sign-On.',
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'OIDC callback failed' });
    }
  });


  // ============================================================================
  // EORA AI ASSISTANT
  // ============================================================================
  fastify.post('/api/eora', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { prompt } = req.body || {}; // body.userId is ignored
    const member = durableDb.getMemberById(req.user!.userId);
    if (!member) return reply.status(404).send({ error: 'User not found' });

    const cleanPrompt = (prompt || '').toLowerCase().trim();
    let responseText = '';
    let quickActions: string[] = [];

    // Answers are built only from this member's own data and the explainable matching engine.
    // No invented statistics, people, levels or claims.
    const intel = getProfileIntelligence(member);
    const firstName = member.fullName.split(' ')[0];
    if (cleanPrompt.includes('collaborator') || cleanPrompt.includes('project')) {
      const recs = getRecommendationsForMember(member.id, 2);
      if (recs.length === 0) {
        responseText = 'I could not find a well-supported match yet. Adding skills, projects and collaboration interests gives me real evidence to match on.';
      } else {
        responseText = recs.map((r) => `${r.member.fullName}: ${r.reason}`).join(' ');
      }
      quickActions = ['Discover people', 'Edit my projects'];
    } else if (cleanPrompt.includes('github') || cleanPrompt.includes('profile')) {
      const missing = intel.completeness.missing;
      responseText = missing.length
        ? `Your profile is missing: ${missing.join(', ')}. Filling these in improves how accurately you are matched.`
        : 'Your profile covers every section I use for matching.';
      const verified = intel.skills.filter((s) => s.provenance === 'ai_tathastu_verified').length;
      if (verified) responseText += ` ${verified} of your skills are verified on AI Tathastu.`;
      quickActions = ['Edit profile', 'Sync with Tathastu'];
    } else if (cleanPrompt.includes('internship') || cleanPrompt.includes('opportunity') || cleanPrompt.includes('mentor')) {
      const mentors = getRecommendationsForMember(member.id, 3, 'mentors');
      responseText = mentors.length
        ? `Members who say they mentor and fit your interests: ${mentors.map((r) => r.member.fullName).join(', ')}.`
        : 'No members who state they mentor match your stated interests yet. Adding "mentorship" to your collaboration interests helps.';
      quickActions = ['Discover people'];
    } else if (cleanPrompt.includes('roadmap') || cleanPrompt.includes('skill')) {
      const domains = intel.domains.slice(0, 2).map((d) => `${d.domain} (based on ${d.evidence.slice(0, 3).join(', ')})`);
      responseText = domains.length
        ? `From your listed skills and projects, your strongest areas are ${domains.join(' and ')}. This is derived from your profile, not an assessment.`
        : 'Add skills or projects so I can describe your focus areas.';
      quickActions = ['Explore skills'];
    } else {
      responseText = `Hi ${firstName}! I can suggest collaborators, review what your profile is missing, or summarize your focus areas from your own profile data.`;
      quickActions = ['Find collaborators', 'Improve my profile', 'Review my focus areas'];
    }

    return reply.send({
      reply: responseText,
      quickActions,
      timestamp: new Date().toISOString(),
    });
  });

  // ============================================================================
  // TATHASTU CORE FEDERATION (Mock Adapter)
  // ============================================================================
  /**
   * The AI Tathastu person whose projection the session user may read/import: their own
   * verified mapping. Any other sourcePersonId is accepted only by the explicit
   * non-production test harness.
   */
  const resolveOwnPersonId = (userId: string, requested?: string): string | null => {
    const mapping = durableDb.getMappingByMemberId('aitathastu_oidc', userId);
    const own = mapping?.externalSubjectId || durableDb.getMemberById(userId)?.tathastu_user_id || null;
    if (requested && requested !== own) {
      return isTestHarnessEnabled() ? requested : null;
    }
    return own || (isTestHarnessEnabled() ? requested || null : null);
  };

  // Session user only; ?userId= is ignored.
  fastify.get('/api/federation', { preHandler: authenticate }, async (req: FastifyRequest<{ Querystring: { action?: string; sourcePersonId?: string } }>, reply) => {
    const { action, sourcePersonId } = req.query;
    const userId = req.user!.userId;

    if (action === 'get_projection') {
      const personId = resolveOwnPersonId(userId, sourcePersonId);
      if (!personId) return reply.status(404).send({ error: 'NOT_LINKED', message: 'No linked AI Tathastu profile for this account' });
      try {
        const projection = await FederationService.fetchApprovedProjection(personId);
        return reply.send(projection);
      } catch (err) {
        if (err instanceof ReauthorizationRequiredError) {
          return reply.status(409).send({ error: 'REAUTHORIZE_REQUIRED', message: err.message, startUrl: '/api/auth/tathastu/start' });
        }
        throw err;
      }
    }

    const member = durableDb.getMemberById(userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });

    return reply.send({
      isLinked: member.isLinkedWithTathastu,
      syncStatus: member.tathastuSyncStatus,
      syncSettings: member.tathastuSyncSettings,
    });
  });

  // Session user only; body.userId is ignored.
  fastify.post('/api/federation', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { action, syncSettings, sourcePersonId, eventType, payload } = req.body || {};
    const userId = req.user!.userId;

    if (action === 'simulate_sync_event') {
      // Simulates upstream events for arbitrary people: test harness only.
      if (!isTestHarnessEnabled()) return reply.status(404).send({ error: 'NOT_FOUND' });
      const report = await TathastuSyncSimulator.simulateEvent(
        eventType || 'profile_updated',
        sourcePersonId || 'core_person_rahul',
        payload
      );
      return reply.send({ success: true, report });
    }

    const member = durableDb.getMemberById(userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });

    if (action === 'one_click_import' || action === 'sync_profile') {
      const personId = resolveOwnPersonId(userId, sourcePersonId);
      if (!personId) return reply.status(404).send({ error: 'NOT_LINKED', message: 'Link your AI Tathastu account first' });
      try {
        const projection = await FederationService.fetchApprovedProjection(personId);
        const updated = await FederationService.syncProjectionToMember(userId, projection, syncSettings);
        return reply.send({
          success: true,
          message:
            action === 'sync_profile'
              ? 'Profile refreshed from AI Tathastu successfully'
              : 'Successfully generated profile draft from AI Tathastu Core',
          member: toSelfMember(updated),
        });
      } catch (err: any) {
        if (err instanceof ReauthorizationRequiredError) {
          return reply.status(409).send({ error: 'REAUTHORIZE_REQUIRED', message: err.message, startUrl: '/api/auth/tathastu/start?prompt=consent' });
        }
        if (err?.name === 'ProjectionContractError' || String(err?.message).startsWith('PROJECTION_SUBJECT_MISMATCH')) {
          return reply.status(422).send({ error: 'INVALID_PROJECTION', message: 'AI Tathastu returned a profile Collaborate cannot accept.' });
        }
        throw err;
      }
    }

    if (action === 'update_sync_settings') {
      member.tathastuSyncSettings = syncSettings;
      await durableDb.saveMemberAsync(member);
      return reply.send({ success: true, syncSettings: member.tathastuSyncSettings });
    }

    if (action === 'revoke_link') {
      await IdentityService.unlinkAccount(userId);
      return reply.send({
        success: true,
        message: 'Tathastu Core link revoked. Collaborate account remains active independently.',
      });
    }

    return reply.status(400).send({ error: 'Unknown federation action' });
  });

  return fastify;
}

// Self-starting server when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = buildServer();
  const port = Number(process.env.PORT) || 4000;
  const host = '0.0.0.0';

  server.listen({ port, host }, (err, address) => {
    if (err) {
      console.error('Fatal error starting Render Fastify server:', err);
      process.exit(1);
    }
    console.log(`[Collaborate Render API Service] Live on ${address}`);
    console.log(`[Database Authority] Authoritative store: ${isNeonConfigured() ? 'PostgreSQL' : 'Local Store'}`);
  });
}
