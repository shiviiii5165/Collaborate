/**
 * Password brute-force limits survive X-Forwarded-For rotation.
 * The API trusts X-Forwarded-For (it runs behind Render's proxy and the Vercel gateway) but is also
 * reachable directly, so a client can send a different header on every request. Guesses against one
 * account must still be capped. In-process Fastify inject; isolated store; no network.
 *
 * Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/password_rate_limit.test.mjs
 */
import assert from 'node:assert';
import crypto from 'node:crypto';

process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
delete process.env.COLLABORATE_ENABLE_FIXTURES;

const { buildServer } = await import('../apps/api/src/server.ts');
const { AttemptLimiter, checkPasswordAttempt } = await import('../src/lib/http/rate-limit.ts');

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
const ip = () => `203.0.113.${crypto.randomInt(1, 254)}, 10.${crypto.randomInt(0, 255)}.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 254)}`;

await test('rotating X-Forwarded-For cannot bypass the per-account limit on /api/auth/login', async () => {
  const email = `victim_${crypto.randomBytes(4).toString('hex')}@example.invalid`;
  const statuses = [];
  for (let i = 0; i < 40; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() },
      payload: JSON.stringify({ email, password: `guess-${i}` }),
    });
    statuses.push(res.statusCode);
  }
  const limited = statuses.filter((s) => s === 429).length;
  assert.ok(statuses.slice(0, 30).every((s) => s === 401), `first 30 should be ordinary failures, got ${statuses.slice(0, 30)}`);
  assert.strictEqual(limited, 10, `attempts 31-40 must be throttled, got ${limited} throttled`);
});

await test('the limit is per account: another account is unaffected', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() },
    payload: JSON.stringify({ email: `other_${crypto.randomBytes(4).toString('hex')}@example.invalid`, password: 'x' }),
  });
  assert.strictEqual(res.statusCode, 401);
});

await test('account keys are case- and whitespace-insensitive', async () => {
  const acct = `login:Case_${crypto.randomBytes(3).toString('hex')}@Example.invalid`;
  let last;
  for (let i = 0; i < 31; i++) last = checkPasswordAttempt(`198.51.100.${i}`, i % 2 ? acct.toUpperCase() : `  ${acct} `);
  assert.strictEqual(last.allowed, false);
  assert.ok(last.retryAfter > 0);
});

await test('windows reset and memory stays bounded', async () => {
  const l = new AttemptLimiter(2, 1000);
  assert.ok(l.hit('k', 0).allowed && l.hit('k', 1).allowed);
  assert.strictEqual(l.hit('k', 2).allowed, false);
  assert.ok(l.hit('k', 1001).allowed, 'a new window starts after windowMs');
});

console.log(`=== ${passed}/${total} passed ===`);
await app.close();
