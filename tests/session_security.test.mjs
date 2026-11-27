/**
 * Session and account security regressions (in-process Fastify inject, isolated fixtures).
 *
 * - A password change ends every other session (a stolen token stops working); this device gets a new one.
 * - Role and plan come from the stored account, never the token (a demoted admin loses admin at once).
 * - Premium ends at planExpiresAt.
 * - Deleting an account ends its sessions, removes personal data and the password; AI Tathastu accounts can delete.
 *
 * Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/session_security.test.mjs
 */
import assert from 'node:assert';
import crypto from 'node:crypto';

process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
delete process.env.COLLABORATE_ENABLE_FIXTURES;

const { buildServer } = await import('../apps/api/src/server.ts');
const { IdentityService } = await import('../src/modules/identity/service.ts');
const { durableDb, isPremiumActive } = await import('../src/lib/db/index.ts');
const { signSessionToken } = await import('../src/lib/auth/session.ts');
const { passwordAttemptsPerAccount, passwordAttemptsPerAccountAnyIp, passwordAttemptsPerIp } = await import('../src/lib/http/rate-limit.ts');

const app = buildServer();
const runId = `${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
const PW = 'Fixture-Sess-Pass1!';
async function makeUser(label) {
  const { member, token } = await IdentityService.registerStandalone(`${label}_${runId}@fixtures.collaborate.test`, PW, `Fixture ${label}`);
  return { id: member.id, email: member.email, token, auth: { authorization: `Bearer ${token}` } };
}
const inject = (o) => app.inject(o);
const cookieToken = (res) => {
  const raw = [res.headers['set-cookie']].flat().find((c) => String(c).startsWith('collaborate_session='));
  return raw ? String(raw).split(';')[0].split('=')[1] : null;
};

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
const resetLimits = () => [passwordAttemptsPerAccount, passwordAttemptsPerAccountAnyIp, passwordAttemptsPerIp].forEach((l) => l['buckets'].clear());

console.log('\n=== Session & account security ===\n');

await test('Password change revokes other sessions; the changing device keeps a working new session', async () => {
  const u = await makeUser('pw');
  const stolen = u.auth; // e.g. a token copied from another device
  assert.strictEqual((await inject({ method: 'GET', url: '/api/auth/me', headers: stolen })).statusCode, 200);
  resetLimits();
  const res = await inject({ method: 'PUT', url: '/api/settings', headers: u.auth, payload: { action: 'change_password', passwordChange: { currentPassword: PW, newPassword: 'Brand-New-Pass-9!' } } });
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.strictEqual((await inject({ method: 'GET', url: '/api/auth/me', headers: stolen })).statusCode, 401, 'old token revoked');
  const fresh = cookieToken(res);
  assert.ok(fresh, 'new session cookie issued');
  assert.strictEqual((await inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${fresh}` } })).statusCode, 200);
  resetLimits();
  const login = await inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: 'Brand-New-Pass-9!' } });
  assert.strictEqual(login.statusCode, 200, 'a fresh login works with the current version');
});

await test('A token claiming admin for a non-admin account gets no admin power; a demoted admin loses it at once', async () => {
  const u = await makeUser('role');
  const forgedRole = await signSessionToken({ userId: u.id, email: u.email, role: 'admin', plan: 'premium', sv: 0 });
  const auth = { authorization: `Bearer ${forgedRole}` };
  assert.strictEqual((await inject({ method: 'GET', url: '/api/admin/reports', headers: auth })).statusCode, 403);
  const me = JSON.parse((await inject({ method: 'GET', url: '/api/auth/me', headers: auth })).body);
  assert.strictEqual(me.session.role, 'member');
  assert.strictEqual(me.session.plan, 'free');
  // The profile-edit and email-lookup admin paths use the same stored role.
  const other = await makeUser('role_other');
  assert.strictEqual((await inject({ method: 'PUT', url: '/api/profiles', headers: auth, payload: { id: other.id, headline: 'pwned' } })).statusCode, 403);
  assert.strictEqual((await inject({ method: 'GET', url: `/api/profiles?email=${encodeURIComponent(other.email)}`, headers: auth })).statusCode, 404);
});

await test('Premium ends at planExpiresAt', async () => {
  assert.strictEqual(isPremiumActive({ plan: 'premium', planExpiresAt: new Date(Date.now() + 60_000).toISOString() }), true);
  assert.strictEqual(isPremiumActive({ plan: 'premium', planExpiresAt: new Date(Date.now() - 60_000).toISOString() }), false);
  assert.strictEqual(isPremiumActive({ plan: 'premium', planExpiresAt: 'not-a-date' }), false);
  assert.strictEqual(isPremiumActive({ plan: 'free' }), false);
  const u = await makeUser('prem');
  await durableDb.saveMemberAsync({ ...durableDb.getMemberById(u.id), plan: 'premium', planExpiresAt: new Date(Date.now() - 1000).toISOString() });
  const me = JSON.parse((await inject({ method: 'GET', url: '/api/auth/me', headers: u.auth })).body);
  assert.strictEqual(me.session.plan, 'free');
});

await test('Deleting an account ends its sessions and removes personal data and the password', async () => {
  const u = await makeUser('del');
  resetLimits();
  const res = await inject({ method: 'DELETE', url: '/api/settings', headers: u.auth, payload: { confirmation: 'DELETE MY ACCOUNT', password: PW } });
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.strictEqual((await inject({ method: 'GET', url: '/api/auth/me', headers: u.auth })).statusCode, 401);
  const m = durableDb.getMemberById(u.id);
  assert.strictEqual(m.deactivated, true);
  assert.ok(!m.email.includes(u.email.split('@')[0]), 'email removed');
  assert.strictEqual(m.fullName, 'Former Member');
  assert.deepStrictEqual(m.skills, []);
  assert.strictEqual(durableDb.getCredential(u.id), null, 'password deleted');
  resetLimits();
  assert.strictEqual((await inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: PW } })).statusCode, 401);
});

await test('An AI Tathastu account without a password can delete with the confirmation phrase; a plain account cannot skip the password', async () => {
  const sso = await makeUser('del_sso');
  durableDb.deleteCredential(sso.id);
  await durableDb.saveMemberAsync({ ...durableDb.getMemberById(sso.id), isLinkedWithTathastu: true });
  const ok = await inject({ method: 'DELETE', url: '/api/settings', headers: sso.auth, payload: { confirmation: 'DELETE MY ACCOUNT' } });
  assert.strictEqual(ok.statusCode, 200, ok.body);
  const plain = await makeUser('del_plain');
  resetLimits();
  const no = await inject({ method: 'DELETE', url: '/api/settings', headers: plain.auth, payload: { confirmation: 'DELETE MY ACCOUNT' } });
  assert.strictEqual(no.statusCode, 401);
});

await test('Deactivation ends every session', async () => {
  const u = await makeUser('deact');
  const res = await inject({ method: 'POST', url: '/api/settings', headers: u.auth, payload: { action: 'deactivate' } });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual((await inject({ method: 'GET', url: '/api/auth/me', headers: u.auth })).statusCode, 401);
});

console.log(`\n${passed}/${total} passed\n`);
await app.close();
