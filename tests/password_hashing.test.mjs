/**
 * Password hashing and the password-bearing settings routes.
 *  - scrypt runs off the main thread (other requests are served while a hash is computed);
 *  - existing hashes (same parameters, hex format) still verify;
 *  - password change enforces the registration minimum; deletion with no password is a 401, not a 500.
 * In-process Fastify inject; isolated store; no network.
 *
 * Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/password_hashing.test.mjs
 */
import assert from 'node:assert';
import crypto from 'node:crypto';

process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
delete process.env.COLLABORATE_ENABLE_FIXTURES;

const { buildServer } = await import('../apps/api/src/server.ts');
const { hashPassword, verifyPassword } = await import('../src/lib/auth/password.ts');

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

await test('hash/verify round-trips; wrong, empty and malformed inputs are false, never a throw', async () => {
  const { hash, salt } = await hashPassword('correct horse battery');
  assert.strictEqual(await verifyPassword('correct horse battery', hash, salt), true);
  assert.strictEqual(await verifyPassword('wrong', hash, salt), false);
  assert.strictEqual(await verifyPassword('correct horse battery', '', salt), false);
  assert.strictEqual(await verifyPassword('correct horse battery', 'zz-not-hex', salt), false);
});

await test('hashes made the old (synchronous) way still verify: no migration needed', async () => {
  const salt = crypto.randomBytes(16).toString('hex');
  const legacy = crypto.scryptSync('legacy-password-1', salt, 64).toString('hex');
  assert.strictEqual(await verifyPassword('legacy-password-1', legacy, salt), true);
});

await test('hashing does not block the event loop', async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  await Promise.all(Array.from({ length: 8 }, (_, i) => hashPassword(`p-${i}-xxxxxxxx`)));
  clearInterval(timer);
  assert.ok(ticks >= 5, `the event loop should keep running while hashing (ticks=${ticks})`);
});

const email = `pw_${crypto.randomBytes(4).toString('hex')}@example.invalid`;
const reg = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email, password: 'original-pass-1', fullName: 'Pass Word' }) });
const cookie = String(reg.headers['set-cookie']).split(';')[0];

await test('registration and login work with the async hashing', async () => {
  assert.strictEqual(reg.statusCode, 201, reg.body);
  const ok = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email, password: 'original-pass-1' }) });
  assert.strictEqual(ok.statusCode, 200, ok.body);
  const bad = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email, password: 'nope-nope-1' }) });
  assert.strictEqual(bad.statusCode, 401);
});

await test('password change refuses a new password shorter than 8 characters', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/settings', headers: { 'content-type': 'application/json', cookie }, payload: JSON.stringify({ action: 'update_password', currentPassword: 'original-pass-1', newPassword: '1' }) });
  assert.strictEqual(res.statusCode, 400, res.body);
  const still = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email, password: 'original-pass-1' }) });
  assert.strictEqual(still.statusCode, 200, 'the old password must still work after a refused change');
});

await test('password change with a valid new password works', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/settings', headers: { 'content-type': 'application/json', cookie }, payload: JSON.stringify({ action: 'update_password', currentPassword: 'original-pass-1', newPassword: 'brand-new-pass-2' }) });
  assert.strictEqual(res.statusCode, 200, res.body);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email, password: 'brand-new-pass-2' }) });
  assert.strictEqual(login.statusCode, 200);
});

await test('account deletion without a password is a 401, not a server error', async () => {
  const res = await app.inject({ method: 'DELETE', url: '/api/settings', headers: { 'content-type': 'application/json', cookie }, payload: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }) });
  assert.strictEqual(res.statusCode, 401, res.body);
});

console.log(`=== ${passed}/${total} passed ===`);
await app.close();
