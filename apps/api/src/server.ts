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
import { durableDb, getKolkataDateKey } from '@/lib/db/index';
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
import { canInitiateContact } from '@collaborate/domain';
import type { MemberProfile } from '@collaborate/contracts';
import { getRecommendationsForMember } from '@/lib/recommendations';
import { FederationService } from '@/modules/federation/client';
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

    try {
      const { member, token } = await IdentityService.registerStandalone(
        email,
        password,
        fullName,
        Boolean(isUnder18)
      );

      reply.header('Set-Cookie', buildSessionCookie(token));
      return reply.status(201).send({ success: true, message: 'Registration successful', member });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Registration failed' });
    }
  });

  fastify.post('/api/auth/login', async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return reply.status(400).send({ error: 'Missing email or password' });
    }

    try {
      const { member, token } = await IdentityService.loginWithPassword(email, password);
      reply.header('Set-Cookie', buildSessionCookie(token));
      return reply.send({ success: true, message: 'Logged in successfully', member });
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
    return reply.send({ authenticated: true, member, user: member, session: req.user });
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
          member,
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
        member,
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
      return reply.send({ member });
    }

    const members = durableDb
      .getAllMembers()
      .filter((m) => !m.deactivated && !m.isRestricted && m.profileVisibility === 'public');
    return reply.send(members);
  });

  /** Fields a member can never set through profile edits (identity, role, billing, trust). */
  const PROTECTED_PROFILE_FIELDS = [
    'id', 'email', 'role', 'plan', 'planExpiresAt', 'isVerified', 'verifiedCategory', 'verifiedAt',
    'tathastu_user_id', 'isLinkedWithTathastu', 'tathastuSyncStatus', 'tathastuProfile', 'tathastuLastSyncedAt',
    'isRestricted', 'deactivated', 'safeguardingApproved', 'isUnder18', 'statusBadges',
  ];

  fastify.put('/api/profiles', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const body = req.body || {};
    const rawUpdates = (body.updates || body) as Record<string, any>;
    const targetUserId = body.id || rawUpdates.id || req.user!.userId;
    const updates: Record<string, any> = { ...rawUpdates };
    for (const field of PROTECTED_PROFILE_FIELDS) delete updates[field];

    if (targetUserId !== req.user!.userId && req.user!.role !== 'admin') {
      return reply.status(403).send({ error: 'Unauthorized to edit this profile' });
    }

    const existing = durableDb.getMemberById(targetUserId);
    if (!existing) return reply.status(404).send({ error: 'Member not found' });

    const updatedMember: MemberProfile = {
      ...existing,
      ...updates,
      metrics: { ...existing.metrics, ...(updates.metrics || {}) },
      skills: updates.skills || existing.skills,
      projects: updates.projects || existing.projects,
      experience: updates.experience || existing.experience,
      education: updates.education || existing.education,
    };

    await durableDb.saveMemberAsync(updatedMember);
    return reply.send({ success: true, member: updatedMember, profile: updatedMember });
  });

  fastify.get('/api/discover', async (req: FastifyRequest<{ Querystring: { q?: string; tag?: string; skill?: string; viewerId?: string } }>, reply) => {
    await optionalAuth(req);
    const { q, tag, skill } = req.query;
    const currentUserId = req.user?.userId || ''; // never from ?viewerId=

    const recommendations = currentUserId ? getRecommendationsForMember(currentUserId, 6) : [];

    let members = durableDb.getAllMembers().filter((m) => {
      if (m.deactivated || m.isRestricted) return false;
      if (m.id === currentUserId || m.role === 'admin') return false;
      if (m.profileVisibility === 'private') return false;
      if (currentUserId && durableDb.isBlocked(currentUserId, m.id)) return false;
      return true;
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

    const results = members.map((m) => {
      const conn = currentUserId ? durableDb.getConnectionState(currentUserId, m.id) : null;
      return {
        ...m,
        connectionStatus: conn ? conn.status : 'not_connected',
        connectionId: conn ? conn.id : null,
      };
    });

    return reply.send({
      count: results.length,
      members: results,
      results,
      recommendations,
      viewerPlan: currentUserId ? durableDb.getMemberById(currentUserId)?.plan || 'free' : 'free',
    });
  });

  // ============================================================================
  // CONNECTIONS
  // ============================================================================
  fastify.get('/api/connections', { preHandler: authenticate }, async (req: FastifyRequest, reply) => {
    const userId = req.user!.userId;
    const all = durableDb.getAllConnections();
    const connections = all.filter((c) => c.requesterId === userId || c.recipientId === userId);
    return reply.send({ connections });
  });

  fastify.post('/api/connections', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { action, targetUserId, toId, targetMemberId, recipientId, connectionId, introMessage } = req.body || {};
    const userId = req.user!.userId;
    const targetId = targetUserId || toId || targetMemberId || recipientId;

    if (action === 'send' || action === 'request' || action === 'send_request') {
      if (!targetId) return reply.status(400).send({ error: 'targetUserId or toId required' });

      const target = durableDb.getMemberById(targetId);
      if (!target) return reply.status(404).send({ error: 'Target member not found' });

      const sender = durableDb.getMemberById(userId);
      const contactGate = canInitiateContact(
        { id: userId, isUnder18: sender?.isUnder18 },
        { id: targetId, isUnder18: target.isUnder18 }
      );
      if (!contactGate.allowed) {
        return reply.status(403).send({ error: 'SAFEGUARDING_RESTRICTION', message: contactGate.reason });
      }

      const conn = await durableDb.sendConnectionRequestAsync(userId, targetId, introMessage);
      return reply.status(201).send({ success: true, connection: conn });
    }

    if (action === 'accept' || action === 'decline' || action === 'reject') {
      if (!connectionId) return reply.status(400).send({ error: 'connectionId required' });
      const status = action === 'accept' ? 'accept' : 'reject';
      const updated = await durableDb.respondToConnectionAsync(connectionId, userId, status);
      return reply.send({ success: true, connection: updated });
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

    const conversations = durableDb.getAllConversations().filter((c) => c.participantIds.includes(userId));
    return reply.send({ conversations });
  });

  fastify.post('/api/messages', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const userId = req.user!.userId;
    const { recipientId, content } = req.body || {};

    if (!recipientId || !content) {
      return reply.status(400).send({ error: 'recipientId and content required' });
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
    const saved = durableDb.getSavedMembers(req.user!.userId);
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

  fastify.post('/api/settings', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { action, currentPassword, newPassword } = req.body || {};
    const userId = req.user!.userId;

    if (action === 'update_password') {
      if (!currentPassword || !newPassword) {
        return reply.status(400).send({ error: 'Missing current or new password' });
      }
      const member = durableDb.getMemberById(userId);
      if (!member) return reply.status(404).send({ error: 'Member not found' });
      const cred = durableDb.getCredential(userId);
      if (!cred) return reply.status(401).send({ error: 'Credentials not found' });
      
      const { hashPasswordScrypt, verifyPasswordScrypt } = await import('@collaborate/domain');
      const valid = verifyPasswordScrypt(currentPassword, `${cred.salt}:${cred.passwordHash}`);
      if (!valid) return reply.status(401).send({ error: 'Current password incorrect' });

      const newHashString = hashPasswordScrypt(newPassword);
      const [newSalt, newHash] = newHashString.split(':');
      durableDb.setCredential(userId, newHash, newSalt);
      return reply.send({ success: true, message: 'Password updated' });
    }

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

    const member = durableDb.getMemberById(userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });

    const cred = durableDb.getCredential(userId);
    if (!cred) return reply.status(401).send({ error: 'Credentials not found' });

    const { verifyPasswordScrypt } = await import('@collaborate/domain');
    const valid = verifyPasswordScrypt(password, `${cred.salt}:${cred.passwordHash}`);
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

    const exportData = {
      profile: member,
      connections: durableDb.getAllConnections().filter((c) => c.requesterId === userId || c.recipientId === userId),
      exportedAt: new Date().toISOString(),
      platform: 'Collaborate by AI Tathastu',
    };

    reply.header('Cache-Control', 'no-store');
    return reply.send(exportData);
  });

  // ============================================================================
  // VERIFICATION & ABUSE REPORTS
  // ============================================================================
  fastify.post('/api/verification', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { category, evidenceSummary } = req.body || {};
    const member = durableDb.getMemberById(req.user!.userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });

    const reqId = durableDb.submitVerificationRequest(
      member.id,
      category || 'identity',
      evidenceSummary || 'User request'
    );
    return reply.send({ success: true, requestId: reqId });
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
    if (!reportedMemberId || !reason) return reply.status(400).send({ error: 'Missing reportedMemberId or reason' });

    const repId = durableDb.submitAbuseReport(req.user!.userId, reportedMemberId, reason, details || '');
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

    let claimed: boolean;
    try {
      claimed = await durableDb.claimWebhookEventAsync(PAYMENT_WEBHOOK_PROVIDER, eventId, event.type, { memberId });
    } catch {
      return reply.status(503).send({ error: 'WEBHOOK_STORE_UNAVAILABLE' });
    }
    if (!claimed) return reply.status(409).send({ error: 'REPLAYED_EVENT', eventId });

    member.plan = 'premium';
    member.planExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await durableDb.saveMemberAsync(member);
    return reply.send({ success: true, verified: true, eventId, plan: member.plan });
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
        member,
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
    try {
      const { member, token } = await TathastuSsoService.completePendingLink({ ...pending, password });
      reply.clearCookie(PENDING_LINK_COOKIE_NAME, { path: '/' });
      reply.header('Set-Cookie', buildSessionCookie(token));
      return reply.send({ success: true, member });
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

  // 4. Secure Webhook Receiver (HMAC-SHA256 Signed & Timestamp Validated)
  fastify.post('/api/webhooks/tathastu', async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const sigHeader = (
      req.headers['x-ait-signature'] ||
      req.headers['x-tathastu-signature'] ||
      req.headers['x-signature'] ||
      req.headers['x-hub-signature-256']
    ) as string;

    const timestampHeader = (
      req.headers['x-tathastu-timestamp'] ||
      req.headers['x-timestamp']
    ) as string;

    const rawBody = (req as any).rawBody || JSON.stringify(req.body || {});

    // Cryptographic signature & replay freshness check (rejects missing/invalid signature with 401)
    const sigResult = TathastuClient.verifyWebhookSignature(rawBody, sigHeader, timestampHeader);
    if (!sigResult.valid) {
      return reply.status(401).send({ error: 'INVALID_SIGNATURE', message: sigResult.error });
    }

    const event = req.body as any;
    const result = await TathastuSsoService.processWebhook(event, req.headers as Record<string, string>);
    return reply.status(200).send({ success: true, result });
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
        member,
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

    if (cleanPrompt.includes('collaborator') || cleanPrompt.includes('project')) {
      const recs = getRecommendationsForMember(member.id, 2);
      const names = recs.map((r) => `${r.member.fullName} (${r.member.headline.split('|')[0].trim()})`).join(' and ');
      responseText = `Based on your featured project "${member.projects[0]?.title || 'Tathastu AI Assistant'}", I recommend connecting with ${names}. Both have complementary expertise in Vision Transformers and Distributed ML that would elevate your RAG evaluation benchmarks!`;
      quickActions = ['Send Connection Request to Priya', 'View Project Details', 'Share Pitch Note'];
    } else if (cleanPrompt.includes('github') || cleanPrompt.includes('profile')) {
      responseText = `Rahul, your GitHub has ${member.metrics.githubContributions} contributions this year, which is strong! To stand out to top AI engineering teams, consider pinning your featured repository, adding architectural diagrams (Mermaid or system graphs) to its README, and documenting reproducible evaluation benchmarks with latency metrics.`;
      quickActions = ['Edit Featured Projects', 'Update Headline', 'Sync with Tathastu'];
    } else if (cleanPrompt.includes('internship') || cleanPrompt.includes('opportunity')) {
      responseText = `Given your goal of becoming a GenAI Engineer, researchers and engineers at Google (like Aman Verma) and IIIT Delhi are actively looking for collaborators on LLM evaluation pipelines. Reaching out with a specific question on their published work has an 82% higher acceptance rate!`;
      quickActions = ['Discover ML Engineers', 'Draft Outreach Message'];
    } else if (cleanPrompt.includes('roadmap') || cleanPrompt.includes('genai engineer')) {
      responseText = `Your GenAI Engineer roadmap is currently at Level 3 of 5. You have mastered RAG architectures and vector databases. The next critical milestone is mastering multi-GPU inference caching (e.g. vLLM / TensorRT-LLM) and synthetic data evaluation pipelines.`;
      quickActions = ['View Full Analysis', 'Explore Skills to Learn'];
    } else {
      responseText = `Great to connect, ${member.fullName.split(' ')[0]}! I'm analyzing your current network and verified profile. How can I assist your technical journey today?`;
      quickActions = ['Find collaborators', 'Improve my profile', 'Review roadmap'];
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
      const projection = await FederationService.fetchApprovedProjection(personId);
      return reply.send(projection);
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
      const projection = await FederationService.fetchApprovedProjection(personId);
      const updated = await FederationService.syncProjectionToMember(userId, projection, syncSettings);
      return reply.send({
        success: true,
        message:
          action === 'sync_profile'
            ? 'Profile refreshed from AI Tathastu successfully'
            : 'Successfully generated profile draft from AI Tathastu Core',
        member: updated,
      });
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
