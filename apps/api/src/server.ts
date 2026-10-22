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
import { verifySessionToken, COOKIE_NAME, SessionPayload, buildSessionCookie } from '@/lib/auth/session';
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
  const fastify = Fastify({
    logger: false,
    trustProxy: true,
  });

  // 1. CORS Configuration (Permits Vercel frontend, custom domains, and local preview)
  fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowedOrigins = [
        'https://collaborate.aitathastu.com',
        'https://collaborate-umber.vercel.app',
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:4000',
      ];
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith('.vercel.app') ||
        origin.endsWith('.aitathastu.com')
      ) {
        return cb(null, true);
      }
      return cb(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Last-Event-ID', 'X-Requested-With'],
    exposedHeaders: ['Set-Cookie'],
  });

  // 2. Cookie Support
  fastify.register(cookie, {
    secret: process.env.SESSION_SECRET || 'collaborate_session_cookie_secret_2026',
    parseOptions: {},
  });

  // Retain raw request body Buffer for webhook HMAC-SHA256 signature verification
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      (req as any).rawBody = body;
      const json = JSON.parse(body.toString('utf8'));
      done(null, json);
    } catch (err: any) {
      done(err, undefined);
    }
  });


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

    req.user = payload;
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
    reply.clearCookie(COOKIE_NAME, { path: '/' });
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
    const { id, email, viewerId: queryViewerId } = req.query;
    const viewerId = req.user?.userId || queryViewerId || '';

    if (id) {
      const member = durableDb.getMemberById(id);
      if (!member) return reply.status(404).send({ error: 'Profile not found' });

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
      const member = durableDb.getMemberByEmail(email);
      if (!member) return reply.status(404).send({ error: 'Profile not found' });
      return reply.send({ member });
    }

    const members = durableDb.getAllMembers().filter((m) => !m.deactivated);
    return reply.send(members);
  });

  fastify.put('/api/profiles', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const body = req.body || {};
    const updates = body.updates || body;
    const targetUserId = body.id || updates.id || req.user!.userId;

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
    const { q, tag, skill, viewerId: queryViewerId } = req.query;
    const currentUserId = req.user?.userId || queryViewerId || '';

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

  fastify.post('/api/verification/review', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    if (req.user?.role !== 'admin') {
      return reply.status(403).send({ error: 'ADMIN_ONLY', message: 'Admin role required' });
    }
    const { requestId, action, notes } = req.body || {};
    const decision: 'approved' | 'rejected' = action === 'approved' ? 'approved' : 'rejected';
    const updated = durableDb.reviewVerification(requestId, req.user.userId, decision, notes || '');
    return reply.send({ success: true, request: updated });
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
  fastify.get('/api/notifications', async (req: FastifyRequest<{ Querystring: { userId?: string } }>, reply) => {
    await optionalAuth(req);
    const userId = req.user?.userId || req.query.userId;
    if (!userId) {
      return reply.send({ notifications: [], unreadCount: 0 });
    }
    const notifications = durableDb.getNotificationsForUser(userId);
    const unreadCount = notifications.filter((n) => !n.isRead).length;
    return reply.send({ notifications, unreadCount });
  });

  fastify.post('/api/notifications', async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { notifId } = req.body || {};
    if (notifId) {
      durableDb.markNotificationRead(notifId);
    }
    return reply.send({ success: true });
  });

  // ============================================================================
  // BILLING & SUBSCRIPTIONS
  // ============================================================================
  const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'collaborate_webhook_secret_sandbox_sig_2026';

  fastify.get('/api/billing', async (req: FastifyRequest<{ Querystring: { userId?: string } }>, reply) => {
    await optionalAuth(req);
    const targetUserId = req.user?.userId || req.query.userId || 'usr_rahul';
    const member = durableDb.getMemberById(targetUserId);
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
    await optionalAuth(req);
    const body = req.body || {};
    const { action, userId, webhookSignature } = body;

    // 1. Verified Webhook Handler
    if (webhookSignature) {
      const computedSig = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(JSON.stringify(body.payload || {}))
        .digest('hex');

      const sigBuf = Buffer.from(String(webhookSignature));
      const compBuf = Buffer.from(computedSig);

      if (sigBuf.length !== compBuf.length || !crypto.timingSafeEqual(sigBuf, compBuf)) {
        return reply.status(401).send({ error: 'Invalid cryptographic webhook signature' });
      }

      const targetMemberId = body.payload?.memberId || userId;
      const member = durableDb.getMemberById(targetMemberId);
      if (!member) return reply.status(404).send({ error: 'Member not found' });

      member.plan = 'premium';
      member.planExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await durableDb.saveMemberAsync(member);

      return reply.send({ success: true, verified: true, plan: member.plan });
    }

    if (!req.user) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    const currentUserId = req.user.userId;
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

  // 1. Initiate AI Tathastu SSO Authorization Flow (OAuth 2.0 PKCE + State)
  const handleTathastuStart = async (
    req: FastifyRequest<{
      Querystring: { redirectUri?: string; format?: string; prompt?: string; reconsent?: string };
    }>,
    reply: FastifyReply
  ) => {
    const promptParam = req.query.prompt || (req.query.reconsent === 'true' ? 'consent' : undefined);
    const { authUrl, state, codeVerifier, codeChallenge, redirectUri } = TathastuSsoService.initiateLogin({
      redirectUri: req.query.redirectUri,
      prompt: promptParam,
    });

    // Store state & PKCE codeVerifier in secure, HttpOnly flow cookie (10 min TTL)
    const flowData = JSON.stringify({ state, codeVerifier, redirectUri, createdAt: Date.now() });
    reply.setCookie('tathastu_oauth_flow', flowData, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
    });

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
      const { code, state, error, error_description } = req.query;

      if (error) {
        const errorMsg = error_description || error;
        return reply.redirect(`/?auth_error=${encodeURIComponent(errorMsg)}`);
      }

      if (!code) {
        return reply.redirect(`/?auth_error=${encodeURIComponent('Missing authorization code from AI Tathastu')}`);
      }

      // Retrieve and validate state & codeVerifier from flow cookie
      const flowCookieRaw = req.cookies['tathastu_oauth_flow'];
      let expectedState = '';
      let codeVerifier = 'default_pkce_verifier';
      let redirectUri: string | undefined = undefined;

      if (flowCookieRaw) {
        try {
          const flow = JSON.parse(flowCookieRaw);
          expectedState = flow.state;
          codeVerifier = flow.codeVerifier;
          redirectUri = flow.redirectUri;
        } catch {
          // Fallback
        }
      }

      reply.clearCookie('tathastu_oauth_flow', { path: '/' });

      try {
        const { token } = await TathastuSsoService.processCallback({
          code,
          codeVerifier,
          state: state || '',
          expectedState: expectedState || undefined,
          redirectUri,
        });

        reply.header('Set-Cookie', buildSessionCookie(token));
        return reply.redirect('/?auth_success=true');
      } catch (err: any) {
        return reply.redirect(`/?auth_error=${encodeURIComponent(err.message || 'Authentication failed')}`);
      }
    }
  );

  // 3. API/POST Callback for Programmatic Token Exchange & Linking Confirmation
  fastify.post('/api/auth/tathastu/callback', async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { code, codeVerifier, state, expectedState, linkConfirmationPassword, claimsOverride, redirectUri } =
      req.body || {};
    try {
      const { member, token, isNewUser } = await TathastuSsoService.processCallback({
        code: code || 'mock_code',
        codeVerifier: codeVerifier || 'mock_verifier',
        state: state || 'mock_state',
        expectedState,
        linkConfirmationPassword,
        claimsOverride,
        redirectUri,
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

  fastify.get('/api/auth/oidc/callback', async (req: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>, reply) => {
    const { code, state, error } = req.query;
    if (error) {
      return reply.redirect(`/?auth_error=${encodeURIComponent(error)}`);
    }
    if (!code) {
      return reply.status(400).send({ error: 'Missing authorization code' });
    }
    try {
      const { token } = await IdentityService.processOidcCallback(code, 'pkce_verifier_from_cookie', state || '');
      reply.header('Set-Cookie', buildSessionCookie(token));
      return reply.redirect('/');
    } catch (err: any) {
      return reply.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
    }
  });

  fastify.post('/api/auth/oidc/callback', async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
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
  fastify.post('/api/eora', async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    await optionalAuth(req);
    const { prompt, userId } = req.body || {};
    const targetId = req.user?.userId || userId || 'usr_rahul';
    const member = durableDb.getMemberById(targetId);
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
  fastify.get('/api/federation', async (req: FastifyRequest<{ Querystring: { action?: string; sourcePersonId?: string; userId?: string } }>, reply) => {
    await optionalAuth(req);
    const { action, sourcePersonId } = req.query;
    const userId = req.user?.userId || req.query.userId || 'usr_rahul';

    if (action === 'get_projection') {
      const personId = sourcePersonId || 'core_person_rahul';
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

  fastify.post('/api/federation', async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    await optionalAuth(req);
    const { action, syncSettings, sourcePersonId, eventType, payload } = req.body || {};
    const userId = req.user?.userId || req.body?.userId || 'usr_rahul';

    if (action === 'simulate_sync_event') {
      const report = await TathastuSyncSimulator.simulateEvent(
        eventType || 'profile_updated',
        sourcePersonId || 'core_person_rahul',
        payload
      );
      return reply.send({ success: true, report });
    }

    const member = durableDb.getMemberById(userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });

    if (action === 'one_click_import') {
      const personId = sourcePersonId || 'core_person_rahul';
      const projection = await FederationService.fetchApprovedProjection(personId);
      const updated = await FederationService.syncProjectionToMember(userId, projection, syncSettings);
      return reply.send({
        success: true,
        message: 'Successfully generated profile draft from AI Tathastu Core',
        member: updated,
      });
    }

    if (action === 'sync_profile') {
      const mapping = durableDb.getMappingByMemberId('aitathastu_oidc', userId);
      const personId = sourcePersonId || mapping?.externalSubjectId || 'core_person_rahul';
      const projection = await FederationService.fetchApprovedProjection(personId);
      const updated = await FederationService.syncProjectionToMember(userId, projection, syncSettings);
      return reply.send({
        success: true,
        message: 'Profile refreshed from AI Tathastu successfully',
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
