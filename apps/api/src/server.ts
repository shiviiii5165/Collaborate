/**
 * Collaborate. by AI Tathastu — Dedicated Render Backend Service
 * Framework: Fastify (High-Performance Modular Monolith)
 *
 * Authoritative home of Collaborate-owned business logic, real-time SSE messaging,
 * and database persistence. Connects directly to Neon / Supabase PostgreSQL.
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { durableDb, getKolkataDateKey } from '@/lib/db/index';
import { isNeonConfigured } from '@/lib/db/neon';
import { IdentityService } from '@/modules/identity/service';
import { verifySessionToken, COOKIE_NAME, SessionPayload, buildSessionCookie } from '@/lib/auth/session';
import { canInitiateContact } from '@collaborate/domain';
import type { MemberProfile } from '@collaborate/contracts';

// Extend FastifyRequest with authenticated user
declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionPayload;
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
  fastify.get('/api/profiles', async (req: FastifyRequest<{ Querystring: { id?: string; email?: string } }>, reply) => {
    await optionalAuth(req);
    const { id, email } = req.query;

    if (id) {
      const member = durableDb.getMemberById(id);
      if (!member) return reply.status(404).send({ error: 'Profile not found' });
      return reply.send(member);
    }

    if (email) {
      const member = durableDb.getMemberByEmail(email);
      if (!member) return reply.status(404).send({ error: 'Profile not found' });
      return reply.send(member);
    }

    const members = durableDb.getAllMembers().filter((m) => !m.deactivated);
    return reply.send(members);
  });

  fastify.put('/api/profiles', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const updates = req.body || {};
    const targetUserId = updates.id || req.user!.userId;

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
    return reply.send({ success: true, profile: updatedMember });
  });

  fastify.get('/api/discover', async (req: FastifyRequest<{ Querystring: { q?: string; tag?: string; skill?: string } }>, reply) => {
    await optionalAuth(req);
    const { q, tag, skill } = req.query;
    const currentUserId = req.user?.userId;

    let members = durableDb.getAllMembers().filter((m) => {
      if (m.deactivated || m.isRestricted) return false;
      if (m.profileVisibility === 'private' && m.id !== currentUserId) return false;
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

    return reply.send({ count: members.length, members });
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
  fastify.get('/api/messages', { preHandler: authenticate }, async (req: FastifyRequest<{ Querystring: { conversationWith?: string; conversationId?: string } }>, reply) => {
    const userId = req.user!.userId;
    const { conversationWith, conversationId } = req.query;

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
    return reply.send({ count: saved.length, savedMembers: saved });
  });

  fastify.post('/api/saved', { preHandler: authenticate }, async (req: FastifyRequest<{ Body: Record<string, any> }>, reply) => {
    const { targetMemberId, action } = req.body || {};
    if (!targetMemberId) return reply.status(400).send({ error: 'targetMemberId required' });

    const userId = req.user!.userId;
    if (action === 'remove' || action === 'delete') {
      const success = durableDb.removeMemberBookmark(userId, targetMemberId);
      return reply.send({ success, isSaved: false });
    }

    const success = durableDb.saveMemberBookmark(userId, targetMemberId);
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
