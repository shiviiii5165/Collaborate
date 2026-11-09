/**
 * PUT /api/settings (the contract SettingsView uses; it used to 404 in production) and the
 * PUT /api/profiles allow-list (it used to accept any non-denied field with any type and size).
 * In-process Fastify inject; isolated store; no network.
 *
 * Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/settings_and_profile_edit.test.mjs
 */
import assert from 'node:assert';
import crypto from 'node:crypto';

process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
delete process.env.COLLABORATE_ENABLE_FIXTURES;

const { buildServer } = await import('../apps/api/src/server.ts');
const { durableDb } = await import('../src/lib/db/index.ts');

const app = buildServer();
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

const email = `set_${crypto.randomBytes(4).toString('hex')}@example.invalid`;
const reg = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email, password: 'settings-pass-1', fullName: 'Set Tings' }) });
const cookie = String(reg.headers['set-cookie']).split(';')[0];
const memberId = JSON.parse(reg.body).member.id;
const put = (url, payload) => app.inject({ method: 'PUT', url, headers: { 'content-type': 'application/json', cookie }, payload: JSON.stringify(payload) });
const member = () => durableDb.getMemberById(memberId);

await test('settings: update_privacy saves visibility and the discovery choice', async () => {
  const r = await put('/api/settings', { action: 'update_privacy', privacy: { discoverable: true, profileVisibility: 'connections_only', contactVisibility: 'hidden' } });
  assert.strictEqual(r.statusCode, 200, r.body);
  assert.strictEqual(JSON.parse(r.body).success, true);
  assert.strictEqual(member().profileVisibility, 'connections_only');
  assert.strictEqual(member().contactVisibility, 'hidden');
  assert.strictEqual(member().discoverable, true);
  assert.strictEqual(member().discoveryChoiceMade, true);
});

await test('settings: invalid privacy values are refused and nothing changes', async () => {
  const r = await put('/api/settings', { action: 'update_privacy', privacy: { profileVisibility: 'everyone' } });
  assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(member().profileVisibility, 'connections_only');
});

await test('settings: notifications and auto-sync accept booleans only, unknown keys ignored', async () => {
  let r = await put('/api/settings', { action: 'update_notifications', notificationPreferences: { messages: false, securityAlerts: true, injected: 'x' } });
  assert.strictEqual(r.statusCode, 200, r.body);
  assert.strictEqual(member().notificationPreferences.messages, false);
  assert.strictEqual(member().notificationPreferences.injected, undefined);
  r = await put('/api/settings', { action: 'update_notifications', notificationPreferences: { messages: 'no' } });
  assert.strictEqual(r.statusCode, 400);
  r = await put('/api/settings', { action: 'update_federation_sync', tathastuSyncSettings: { autoSyncSkills: false } });
  assert.strictEqual(r.statusCode, 200, r.body);
  assert.strictEqual(member().tathastuSyncSettings.autoSyncSkills, false);
});

await test('settings: change_password (as the screen sends it) works and enforces 8 characters', async () => {
  let r = await put('/api/settings', { action: 'change_password', passwordChange: { currentPassword: 'settings-pass-1', newPassword: 'short' } });
  assert.strictEqual(r.statusCode, 400);
  r = await put('/api/settings', { action: 'change_password', passwordChange: { currentPassword: 'wrong-pass-123', newPassword: 'long-enough-2' } });
  assert.strictEqual(r.statusCode, 401);
  r = await put('/api/settings', { action: 'change_password', passwordChange: { currentPassword: 'settings-pass-1', newPassword: 'long-enough-2' } });
  assert.strictEqual(r.statusCode, 200, r.body);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email, password: 'long-enough-2' }) });
  assert.strictEqual(login.statusCode, 200);
});

await test('settings: restrict_account toggles both ways; restricting makes the profile private', async () => {
  let r = await put('/api/settings', { action: 'restrict_account', isRestricted: true });
  assert.strictEqual(r.statusCode, 200, r.body);
  assert.ok(JSON.parse(r.body).message);
  assert.strictEqual(member().isRestricted, true);
  assert.strictEqual(member().profileVisibility, 'private');
  r = await put('/api/settings', { action: 'restrict_account', isRestricted: false });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(member().isRestricted, false);
});

await test('settings: export_data returns the member\'s own data only', async () => {
  const r = await put('/api/settings', { action: 'export_data' });
  assert.strictEqual(r.statusCode, 200, r.body);
  const data = JSON.parse(r.body);
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.export.profile.id, memberId);
  assert.ok(Array.isArray(data.export.connections));
  assert.strictEqual(r.headers['cache-control'], 'no-store');
});

await test('settings: requires a session; unknown actions are 400', async () => {
  const anon = await app.inject({ method: 'PUT', url: '/api/settings', headers: { 'content-type': 'application/json' }, payload: '{"action":"export_data"}' });
  assert.strictEqual(anon.statusCode, 401);
  assert.strictEqual((await put('/api/settings', { action: 'make_me_admin' })).statusCode, 400);
});

await test('profile edit: allowed fields save; forged server-owned fields are ignored', async () => {
  const forgedActivity = [{ id: 'a1', type: 'verified', text: 'Verified by AI Tathastu', sourceOrigin: 'tathastu_core', timestamp: new Date().toISOString() }];
  const r = await put('/api/profiles', { updates: { headline: 'Builder', about: 'Hi', socialLinks: { github: 'https://github.com/me' }, recentActivity: forgedActivity, institutionDomain: 'iit.ac.in', isDemo: true, role: 'admin', plan: 'premium' } });
  assert.strictEqual(r.statusCode, 200, r.body);
  const m = member();
  assert.strictEqual(m.headline, 'Builder');
  assert.strictEqual(m.socialLinks.github, 'https://github.com/me');
  assert.ok(!(m.recentActivity || []).some((a) => a.id === 'a1'), 'recentActivity must not be client-writable');
  assert.strictEqual(m.institutionDomain, undefined);
  assert.ok(!m.isDemo);
  assert.notStrictEqual(m.role, 'admin');
  assert.notStrictEqual(m.plan, 'premium');
});

await test('profile edit: javascript:/data: links and bad types are refused', async () => {
  for (const updates of [
    { socialLinks: { portfolio: 'javascript:alert(document.cookie)' } },
    { socialLinks: { linkedin: 'data:text/html,<script>alert(1)</script>' } },
    { avatarUrl: 'javascript:alert(1)' },
    { avatarUrl: '//evil.example/x.png' },
    { headline: { not: 'text' } },
    { profileVisibility: 'everyone' },
    { discoverable: 'yes' },
  ]) {
    const r = await put('/api/profiles', { updates });
    assert.strictEqual(r.statusCode, 400, `${JSON.stringify(updates)} -> ${r.statusCode} ${r.body}`);
  }
  assert.strictEqual(member().socialLinks.portfolio, undefined);
});

await test('profile edit: oversized values are refused (no unbounded data in the member record)', async () => {
  assert.strictEqual((await put('/api/profiles', { updates: { about: 'x'.repeat(5000) } })).statusCode, 400);
  assert.strictEqual((await put('/api/profiles', { updates: { collaborationInterests: Array.from({ length: 50 }, (_, i) => `t${i}`) } })).statusCode, 400);
  assert.strictEqual((await put('/api/profiles', { updates: { projects: Array.from({ length: 101 }, (_, i) => ({ title: `p${i}` })) } })).statusCode, 400);
});

await test('profile edit: the default site-relative avatar path is still accepted', async () => {
  const r = await put('/api/profiles', { updates: { avatarUrl: '/images/rahul_avatar.jpg', bannerUrl: '/images/campus_banner.jpg' } });
  assert.strictEqual(r.statusCode, 200, r.body);
  assert.strictEqual(member().avatarUrl, '/images/rahul_avatar.jpg');
});

await test('verification requests: validated, bounded, one pending at a time, no data echoed', async () => {
  const post = (payload) => app.inject({ method: 'POST', url: '/api/verification', headers: { 'content-type': 'application/json', cookie }, payload: JSON.stringify(payload) });
  assert.strictEqual((await post({ category: 'superuser', evidenceSummary: 'x' })).statusCode, 400);
  assert.strictEqual((await post({ category: 'identity', evidenceSummary: '' })).statusCode, 400);
  assert.strictEqual((await post({ category: 'identity', evidenceSummary: 'y'.repeat(2001) })).statusCode, 400);
  const ok = await post({ category: 'institution', evidenceSummary: 'Student ID from LPU' });
  assert.strictEqual(ok.statusCode, 200, ok.body);
  const body = JSON.parse(ok.body);
  assert.strictEqual(typeof body.requestId, 'string');
  assert.ok(!ok.body.includes(email), 'the response must not echo the member email');
  assert.strictEqual((await post({ category: 'identity', evidenceSummary: 'again' })).statusCode, 409);
});

await test('messages, connection notes and abuse reports are type- and size-checked', async () => {
  const email2 = `peer_${crypto.randomBytes(4).toString('hex')}@example.invalid`;
  const reg2 = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email: email2, password: 'peer-pass-123', fullName: 'Pe Er' }) });
  const cookie2 = String(reg2.headers['set-cookie']).split(';')[0];
  const peerId = JSON.parse(reg2.body).member.id;
  const as = (c) => (url, payload) => app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', cookie: c }, payload: JSON.stringify(payload) });
  const me = as(cookie);
  const peer = as(cookie2);

  assert.strictEqual((await me('/api/connections', { action: 'send', targetUserId: peerId, introMessage: 'n'.repeat(501) })).statusCode, 400);
  const sent = await me('/api/connections', { action: 'send', targetUserId: peerId, introMessage: 'Hi, let us build something' });
  assert.ok([200, 201].includes(sent.statusCode), sent.body);
  const connectionId = JSON.parse(sent.body).connection?.id ?? JSON.parse(sent.body).id;
  const accepted = await peer('/api/connections', { action: 'accept', connectionId });
  assert.strictEqual(accepted.statusCode, 200, accepted.body);

  assert.strictEqual((await me('/api/messages', { recipientId: peerId, content: 'm'.repeat(4001) })).statusCode, 400);
  assert.strictEqual((await me('/api/messages', { recipientId: peerId, content: { html: '<b>x</b>' } })).statusCode, 400);
  assert.strictEqual((await me('/api/messages', { recipientId: peerId, content: '   ' })).statusCode, 400);
  assert.strictEqual((await me('/api/messages', { recipientId: peerId, content: 'Hello!' })).statusCode, 201);

  assert.strictEqual((await me('/api/reports', { reportedMemberId: peerId, reason: 'r'.repeat(101) })).statusCode, 400);
  assert.strictEqual((await me('/api/reports', { reportedMemberId: peerId, reason: 'spam', details: 'd'.repeat(2001) })).statusCode, 400);
  assert.strictEqual((await me('/api/reports', { reportedMemberId: 'usr_does_not_exist', reason: 'spam' })).statusCode, 404);
  assert.strictEqual((await me('/api/reports', { reportedMemberId: memberId, reason: 'spam' })).statusCode, 404, 'self-reports are refused');
  assert.strictEqual((await me('/api/reports', { reportedMemberId: peerId, reason: 'spam', details: 'Repeated unwanted messages' })).statusCode, 200);
});

console.log(`=== ${passed}/${total} passed ===`);
await app.close();
