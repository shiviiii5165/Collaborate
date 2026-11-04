/**
 * Collaborate API authorization hardening regression suite.
 *
 * In-process Fastify inject; isolated fixtures created per run (no demo credentials,
 * no network, no production systems).
 *
 * Run: npx tsx tests/api_authorization_hardening.test.mjs
 */

import assert from 'node:assert';
import crypto from 'node:crypto';

process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
delete process.env.COLLABORATE_ENABLE_FIXTURES; // harness OFF: production code paths
delete process.env.PAYMENT_WEBHOOK_SECRET;

const { buildServer } = await import('../apps/api/src/server.ts');
const { IdentityService } = await import('../src/modules/identity/service.ts');
const { durableDb } = await import('../src/lib/db/index.ts');
const { signSessionToken } = await import('../src/lib/auth/session.ts');
const { resolveServerSecret, assertProductionSecrets } = await import('../src/lib/auth/secrets.ts');
const { signPaymentWebhook } = await import('../src/modules/billing/payment-webhook.ts');

const app = buildServer();
const runId = `${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;

// ---------------------------------------------------------------------------
// Isolated fixtures
// ---------------------------------------------------------------------------
async function makeUser(label, extra = {}) {
  const { member, token } = await IdentityService.registerStandalone(
    `${label}_${runId}@fixtures.collaborate.test`,
    `Fixture-${label}-Pass1!`,
    `Fixture ${label}`
  );
  if (Object.keys(extra).length) {
    await durableDb.saveMemberAsync({ ...durableDb.getMemberById(member.id), ...extra });
  }
  return { member: durableDb.getMemberById(member.id), token, auth: { authorization: `Bearer ${token}` } };
}

const alice = await makeUser('alice');
const bob = await makeUser('bob', { profileVisibility: 'private' });
const carol = await makeUser('carol', { profileVisibility: 'connections_only' });
// Isolated admin fixture: role set on the stored record, then a normal password login.
const adminFx = await makeUser('admin', { role: 'admin' });
const adminLogin = await IdentityService.loginWithPassword(adminFx.member.email, 'Fixture-admin-Pass1!');
const admin = { ...adminFx, auth: { authorization: `Bearer ${adminLogin.token}` } };

let passed = 0;
let total = 0;
async function test(title, fn) {
  total++;
  process.stdout.write(`  [TEST ${total}] ${title}... `);
  try {
    await fn();
    passed++;
    console.log('PASSED');
  } catch (err) {
    console.log('FAILED');
    console.error(err);
    process.exitCode = 1;
  }
}
const inject = (opts) => app.inject(opts);
const body = (res) => JSON.parse(res.body || '{}');

console.log('\n=== API authorization hardening suite ===\n');

// ---------------------------------------------------------------------------
// Unauthenticated requests -> 401
// ---------------------------------------------------------------------------
await test('Unauthenticated user-specific routes return 401 (no usr_rahul fallback)', async () => {
  const cases = [
    ['GET', '/api/billing'],
    ['GET', '/api/billing?userId=usr_rahul'],
    ['POST', '/api/billing', { action: 'upgrade_premium', userId: alice.member.id }],
    ['POST', '/api/eora', { prompt: 'hello', userId: alice.member.id }],
    ['GET', '/api/notifications?userId=' + alice.member.id],
    ['POST', '/api/notifications', { notifId: 'x' }],
    ['GET', '/api/federation'],
    ['GET', '/api/federation?action=get_projection&sourcePersonId=core_person_rahul'],
    ['POST', '/api/federation', { action: 'revoke_link', userId: alice.member.id }],
    ['POST', '/api/federation', { action: 'simulate_sync_event' }],
    ['POST', '/api/federation', { action: 'update_sync_settings', userId: alice.member.id, syncSettings: {} }],
    ['GET', '/api/messages'],
    ['GET', '/api/connections'],
    ['GET', '/api/saved'],
    ['GET', '/api/settings'],
    ['PUT', '/api/profiles', { id: alice.member.id, updates: { headline: 'x' } }],
    ['POST', '/api/verification/review', { requestId: 'x', action: 'approved' }],
  ];
  for (const [method, url, payload] of cases) {
    const res = await inject({ method, url, payload });
    assert.strictEqual(res.statusCode, 401, `${method} ${url} -> ${res.statusCode} ${res.body}`);
  }
});

await test('Unauthenticated federation revoke cannot unlink another member', async () => {
  const victim = await makeUser('victim', { isLinkedWithTathastu: true, tathastuSyncStatus: 'synced' });
  const res = await inject({ method: 'POST', url: '/api/federation', payload: { action: 'revoke_link', userId: victim.member.id } });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(durableDb.getMemberById(victim.member.id).isLinkedWithTathastu, true);
});

await test('Tokens for deactivated or deleted accounts are rejected', async () => {
  const gone = await makeUser('gone');
  await durableDb.saveMemberAsync({ ...gone.member, deactivated: true });
  assert.strictEqual((await inject({ method: 'GET', url: '/api/auth/me', headers: gone.auth })).statusCode, 401);
  const ghost = await signSessionToken({ userId: `usr_missing_${runId}`, email: 'g@x.y', role: 'admin', plan: 'premium' });
  assert.strictEqual((await inject({ method: 'GET', url: '/api/billing', headers: { authorization: `Bearer ${ghost}` } })).statusCode, 401);
});

// ---------------------------------------------------------------------------
// Forged userId / viewerId
// ---------------------------------------------------------------------------
await test('Forged ?userId= on billing/notifications/federation is ignored (own data only)', async () => {
  durableDb.addNotification(bob.member.id, 'system', `Bob secret ${runId}`, 'private body', adminFx.member.id);
  const n = await inject({ method: 'GET', url: `/api/notifications?userId=${bob.member.id}`, headers: alice.auth });
  assert.strictEqual(n.statusCode, 200);
  assert.ok(!n.body.includes(`Bob secret ${runId}`), 'must not leak Bob notifications');

  await durableDb.saveMemberAsync({ ...durableDb.getMemberById(bob.member.id), plan: 'premium' });
  const b = await inject({ method: 'GET', url: `/api/billing?userId=${bob.member.id}`, headers: alice.auth });
  assert.strictEqual(b.statusCode, 200);
  assert.strictEqual(body(b).plan, durableDb.getMemberById(alice.member.id).plan);
  assert.strictEqual(body(b).plan, 'free');

  const f = await inject({ method: 'POST', url: '/api/federation', headers: alice.auth, payload: { action: 'update_sync_settings', userId: bob.member.id, syncSettings: { autoSyncSkills: true } } });
  assert.strictEqual(f.statusCode, 200);
  assert.deepStrictEqual(durableDb.getMemberById(alice.member.id).tathastuSyncSettings, { autoSyncSkills: true });
  assert.notDeepStrictEqual(durableDb.getMemberById(bob.member.id).tathastuSyncSettings, { autoSyncSkills: true });
});

await test('Forged body.userId on EORA answers for the session user only', async () => {
  const res = await inject({ method: 'POST', url: '/api/eora', headers: alice.auth, payload: { prompt: 'hi', userId: bob.member.id } });
  assert.strictEqual(res.statusCode, 200);
  assert.ok(body(res).reply.includes('Fixture'), 'greets session user');
  assert.ok(!body(res).reply.includes('bob'));
});

await test('Forged ?viewerId= cannot unlock private or connections-only profiles', async () => {
  // Make carol connected to bob, then try to view carol as a guest claiming to be bob.
  const conn = await durableDb.sendConnectionRequestAsync(bob.member.id, carol.member.id, 'hi');
  await durableDb.respondToConnectionAsync(conn.id, carol.member.id, 'accept');
  const guest = await inject({ method: 'GET', url: `/api/profiles?id=${carol.member.id}&viewerId=${bob.member.id}` });
  assert.strictEqual(guest.statusCode, 401);
  const asAlice = await inject({ method: 'GET', url: `/api/profiles?id=${carol.member.id}&viewerId=${bob.member.id}`, headers: alice.auth });
  assert.strictEqual(asAlice.statusCode, 403);
  const priv = await inject({ method: 'GET', url: `/api/profiles?id=${bob.member.id}&viewerId=${bob.member.id}`, headers: alice.auth });
  assert.strictEqual(priv.statusCode, 403);
  // Legitimate: bob (accepted connection) sees carol.
  const legit = await inject({ method: 'GET', url: `/api/profiles?id=${carol.member.id}`, headers: bob.auth });
  assert.strictEqual(legit.statusCode, 200);
});

await test('Public directory listing excludes private/connections-only profiles; email lookup is owner/admin only', async () => {
  const list = body(await inject({ method: 'GET', url: '/api/profiles' }));
  assert.ok(!list.some((m) => m.id === bob.member.id || m.id === carol.member.id));
  assert.strictEqual((await inject({ method: 'GET', url: `/api/profiles?email=${encodeURIComponent(bob.member.email)}` })).statusCode, 401);
  assert.strictEqual((await inject({ method: 'GET', url: `/api/profiles?email=${encodeURIComponent(bob.member.email)}`, headers: alice.auth })).statusCode, 404);
  assert.strictEqual((await inject({ method: 'GET', url: `/api/profiles?email=${encodeURIComponent(bob.member.email)}`, headers: bob.auth })).statusCode, 200);
});

// ---------------------------------------------------------------------------
// Cross-user resource access
// ---------------------------------------------------------------------------
await test('Cannot read a conversation you are not part of', async () => {
  const msg = await durableDb.sendMessageAsync(bob.member.id, carol.member.id, `private ${runId}`);
  const res = await inject({ method: 'GET', url: `/api/messages?conversationId=${msg.conversationId}`, headers: alice.auth });
  assert.strictEqual(res.statusCode, 404);
  assert.ok(!res.body.includes(`private ${runId}`));
  const own = await inject({ method: 'GET', url: `/api/messages?conversationId=${msg.conversationId}`, headers: bob.auth });
  assert.strictEqual(own.statusCode, 200);
  assert.ok(own.body.includes(`private ${runId}`));
});

await test("Cannot mark another member's notification as read", async () => {
  durableDb.addNotification(bob.member.id, 'system', `mark ${runId}`, 'b', adminFx.member.id);
  const notif = durableDb.getNotificationsForUser(bob.member.id).find((x) => x.title === `mark ${runId}`);
  const res = await inject({ method: 'POST', url: '/api/notifications', headers: alice.auth, payload: { notifId: notif.id } });
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(durableDb.getNotificationsForUser(bob.member.id).find((x) => x.id === notif.id).isRead, false);
  const ok = await inject({ method: 'POST', url: '/api/notifications', headers: bob.auth, payload: { notifId: notif.id } });
  assert.strictEqual(ok.statusCode, 200);
});

await test("Cannot edit another member's profile; cannot accept a connection addressed to someone else", async () => {
  const edit = await inject({ method: 'PUT', url: '/api/profiles', headers: alice.auth, payload: { id: bob.member.id, updates: { headline: 'hacked' } } });
  assert.strictEqual(edit.statusCode, 403);
  const req = await durableDb.sendConnectionRequestAsync(adminFx.member.id, bob.member.id, 'x');
  const accept = await inject({ method: 'POST', url: '/api/connections', headers: alice.auth, payload: { action: 'accept', connectionId: req.id } });
  assert.notStrictEqual(accept.statusCode, 200);
});

await test('Federation import/projection is restricted to your own linked AI Tathastu person', async () => {
  const g = await inject({ method: 'GET', url: '/api/federation?action=get_projection&sourcePersonId=core_person_rahul', headers: alice.auth });
  assert.strictEqual(g.statusCode, 404);
  const p = await inject({ method: 'POST', url: '/api/federation', headers: alice.auth, payload: { action: 'one_click_import', sourcePersonId: 'core_person_rahul' } });
  assert.strictEqual(p.statusCode, 404);
  const sim = await inject({ method: 'POST', url: '/api/federation', headers: alice.auth, payload: { action: 'simulate_sync_event' } });
  assert.strictEqual(sim.statusCode, 404);
});

// ---------------------------------------------------------------------------
// Admin authorization
// ---------------------------------------------------------------------------
await test('Profile edits cannot grant admin, premium, verification or SSO identity', async () => {
  const res = await inject({
    method: 'PUT', url: '/api/profiles', headers: alice.auth,
    payload: { updates: { headline: 'Legit headline', role: 'admin', plan: 'premium', isVerified: true, tathastu_user_id: 'urn:x', email: 'evil@x.y' } },
  });
  assert.strictEqual(res.statusCode, 200);
  const m = durableDb.getMemberById(alice.member.id);
  assert.strictEqual(m.headline, 'Legit headline');
  assert.strictEqual(m.role, 'member');
  assert.strictEqual(m.plan, 'free');
  assert.strictEqual(m.isVerified, false);
  assert.strictEqual(m.tathastu_user_id, undefined);
  assert.strictEqual(m.email, alice.member.email);
  // And a fresh login still yields a member session.
  const relog = await IdentityService.loginWithPassword(alice.member.email, 'Fixture-alice-Pass1!');
  const review = await inject({ method: 'POST', url: '/api/verification/review', headers: { authorization: `Bearer ${relog.token}` }, payload: { requestId: 'x', action: 'approved' } });
  assert.strictEqual(review.statusCode, 403);
});

await test('Non-admin cannot review verification (even with role params in body/query)', async () => {
  const reqId = durableDb.submitVerificationRequest(bob.member.id, 'identity', 'evidence').id;
  const res = await inject({ method: 'POST', url: '/api/verification/review?role=admin', headers: alice.auth, payload: { requestId: reqId, action: 'approved', role: 'admin' } });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(durableDb.getMemberById(bob.member.id).isVerified, false);
});

await test('Forged admin JWT for a non-admin member record is rejected', async () => {
  const forged = await signSessionToken({ userId: alice.member.id, email: alice.member.email, role: 'admin', plan: 'free' });
  const reqId = durableDb.submitVerificationRequest(bob.member.id, 'identity', 'evidence').id;
  const res = await inject({ method: 'POST', url: '/api/verification/review', headers: { authorization: `Bearer ${forged}` }, payload: { requestId: reqId, action: 'approved' } });
  assert.strictEqual(res.statusCode, 403);
});

await test('Legitimate admin (isolated fixture) can review verification', async () => {
  const reqId = durableDb.submitVerificationRequest(carol.member.id, 'identity', 'evidence').id;
  const res = await inject({ method: 'POST', url: '/api/verification/review', headers: admin.auth, payload: { requestId: reqId, action: 'approved' } });
  assert.strictEqual(res.statusCode, 200, res.body);
});

// ---------------------------------------------------------------------------
// Legitimate authenticated access
// ---------------------------------------------------------------------------
await test('Authenticated users can use their own billing, notifications, EORA, federation and messages', async () => {
  for (const [method, url, payload] of [
    ['GET', '/api/billing'],
    ['GET', '/api/notifications'],
    ['POST', '/api/eora', { prompt: 'improve my profile' }],
    ['GET', '/api/federation'],
    ['GET', '/api/messages'],
    ['GET', '/api/auth/me'],
  ]) {
    const res = await inject({ method, url, payload, headers: alice.auth });
    assert.strictEqual(res.statusCode, 200, `${method} ${url} -> ${res.statusCode} ${res.body}`);
  }
  const revoke = await inject({ method: 'POST', url: '/api/federation', headers: alice.auth, payload: { action: 'revoke_link' } });
  assert.strictEqual(revoke.statusCode, 200);
});

// ---------------------------------------------------------------------------
// Service-to-service (webhooks)
// ---------------------------------------------------------------------------
await test('Payment webhook: rejected without configured secret, forged signature, accepted when signed', async () => {
  const target = await makeUser('payer');
  const raw = JSON.stringify({ id: `evt_authz_${runId}`, type: 'payment.succeeded', data: { memberId: target.member.id }, userId: alice.member.id });
  const now = Math.floor(Date.now() / 1000);
  const send = (secret, url = '/api/billing') => inject({
    method: 'POST', url,
    headers: { 'content-type': 'application/json', 'x-payment-signature': signPaymentWebhook(raw, secret, now) },
    payload: raw,
  });

  // No secret configured (and the old public fallback no longer exists) -> fail closed.
  assert.strictEqual((await send('collaborate_webhook_secret_sandbox_sig_2026')).statusCode, 503);
  assert.strictEqual(durableDb.getMemberById(target.member.id).plan, 'free');

  process.env.PAYMENT_WEBHOOK_SECRET = `test_payment_secret_${runId}`;
  try {
    assert.strictEqual((await send('wrong')).statusCode, 401);
    // Legacy body-signature format (no signed timestamp) is refused.
    const legacy = await inject({ method: 'POST', url: '/api/billing', payload: { webhookSignature: 'x', payload: { memberId: target.member.id } } });
    assert.strictEqual(legacy.statusCode, 400);
    // A top-level userId cannot redirect the upgrade to another account.
    const ok = await send(process.env.PAYMENT_WEBHOOK_SECRET);
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.strictEqual(durableDb.getMemberById(target.member.id).plan, 'premium');
    assert.strictEqual(durableDb.getMemberById(alice.member.id).plan, 'free');
  } finally {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
  }
});

await test('AI Tathastu webhook: unsigned rejected, HMAC-signed accepted without a user session', async () => {
  process.env.AIT_WEBHOOK_SECRET = `test_ait_whsec_${runId}`;
  try {
    const raw = JSON.stringify({ id: `evt_${runId}`, type: 'profile.updated', data: { userId: 'urn:unknown' } });
    const unsigned = await inject({ method: 'POST', url: '/api/webhooks/tathastu', headers: { 'content-type': 'application/json' }, payload: raw });
    assert.strictEqual(unsigned.statusCode, 401);
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac('sha256', process.env.AIT_WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');
    const signed = await inject({ method: 'POST', url: '/api/webhooks/tathastu', headers: { 'content-type': 'application/json', 'x-ait-signature': `t=${t},v1=${v1}` }, payload: raw });
    assert.strictEqual(signed.statusCode, 200, signed.body);
  } finally {
    delete process.env.AIT_WEBHOOK_SECRET;
  }
});

// ---------------------------------------------------------------------------
// Secrets fail safely
// ---------------------------------------------------------------------------
await test('Production: missing/short AUTH_SECRET or SESSION_SECRET fails closed; no public fallback', async () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, AUTH_SECRET: process.env.AUTH_SECRET, SESSION_SECRET: process.env.SESSION_SECRET };
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_SECRET;
    delete process.env.SESSION_SECRET;
    assert.throws(() => resolveServerSecret('AUTH_SECRET'), /SECRET_NOT_CONFIGURED: AUTH_SECRET/);
    assert.throws(() => assertProductionSecrets(), /SECRET_NOT_CONFIGURED/);
    assert.throws(() => buildServer(), /SECRET_NOT_CONFIGURED/);
    await assert.rejects(signSessionToken({ userId: 'u', email: 'e', role: 'member', plan: 'free' }), /SECRET_NOT_CONFIGURED/);

    process.env.AUTH_SECRET = 'too-short';
    assert.throws(() => resolveServerSecret('AUTH_SECRET'), /at least 32/);

    // The former hardcoded default does not verify sessions any more.
    process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    assert.doesNotThrow(() => assertProductionSecrets());
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

await test('Development without secrets uses a random per-process value (not the old public default)', async () => {
  const s = resolveServerSecret('AUTH_SECRET');
  assert.ok(s.length >= 32);
  assert.notStrictEqual(s, 'collaborate_production_secret_key_2026_at_least_32_bytes_long');
  const { SignJWT } = await import('jose');
  const forged = await new SignJWT({ userId: alice.member.id, email: alice.member.email, role: 'admin', plan: 'premium' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode('collaborate_production_secret_key_2026_at_least_32_bytes_long'));
  const res = await inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${forged}` } });
  assert.strictEqual(res.statusCode, 401);
});

await test('CORS: unknown origins get no credentialed access; first-party origin does', async () => {
  const evil = await inject({ method: 'OPTIONS', url: '/api/auth/me', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
  assert.notStrictEqual(evil.headers['access-control-allow-origin'], 'https://evil.example');
  const good = await inject({ method: 'OPTIONS', url: '/api/auth/me', headers: { origin: 'https://collaborate.aitathastu.com', 'access-control-request-method': 'GET' } });
  assert.strictEqual(good.headers['access-control-allow-origin'], 'https://collaborate.aitathastu.com');
});

console.log(`\n=== ${passed}/${total} passed ===\n`);
if (passed !== total) process.exitCode = 1;
