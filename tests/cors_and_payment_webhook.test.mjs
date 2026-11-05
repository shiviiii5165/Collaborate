/**
 * CORS exact-origin policy + payment webhook timestamp/replay regression suite.
 * In-process Fastify inject; isolated fixtures; no network.
 *
 * Run: npx tsx tests/cors_and_payment_webhook.test.mjs
 */

import assert from 'node:assert';
import crypto from 'node:crypto';

process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
delete process.env.COLLABORATE_ENABLE_FIXTURES;
delete process.env.CORS_ALLOWED_ORIGINS;
delete process.env.NEXT_PUBLIC_APP_URL;

const { buildServer } = await import('../apps/api/src/server.ts');
const { IdentityService } = await import('../src/modules/identity/service.ts');
const { durableDb } = await import('../src/lib/db/index.ts');
const { isOriginAllowed, normalizeOrigin } = await import('../src/lib/http/cors-policy.ts');
const {
  signPaymentWebhook,
  verifyPaymentWebhookSignature,
  PAYMENT_WEBHOOK_TOLERANCE_SECONDS,
} = await import('../src/modules/billing/payment-webhook.ts');

const app = buildServer();
const runId = `${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
const SECRET = `test_payment_secret_${runId}`;

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
const preflight = (origin, url = '/api/auth/me') =>
  app.inject({ method: 'OPTIONS', url, headers: { origin, 'access-control-request-method': 'POST' } });

async function newMember(label) {
  const { member, token } = await IdentityService.registerStandalone(
    `${label}_${runId}@fixtures.collaborate.test`, `Fixture-${label}-Pass1!`, `Fixture ${label}`
  );
  return { member, token };
}

console.log('\n=== CORS + payment webhook suite ===\n');

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
await test('Production origins receive credentialed CORS headers', async () => {
  for (const origin of ['https://collaborate.aitathastu.com', 'https://collaborate-umber.vercel.app']) {
    const res = await preflight(origin);
    assert.strictEqual(res.headers['access-control-allow-origin'], origin);
    assert.strictEqual(res.headers['access-control-allow-credentials'], 'true');
  }
});

await test('Wildcard *.vercel.app and *.aitathastu.com lookalikes are rejected', async () => {
  for (const origin of [
    'https://attacker.vercel.app',
    'https://collaborate-umber-evil.vercel.app',
    'https://evil.aitathastu.com',
    'https://collaborate.aitathastu.com.evil.example',
    'http://collaborate.aitathastu.com',
    'https://collaborate.aitathastu.com:8443',
    'null',
    'https://evil.example',
  ]) {
    const res = await preflight(origin);
    assert.notStrictEqual(res.headers['access-control-allow-origin'], origin, origin);
    assert.ok(!res.headers['access-control-allow-origin'], `${origin} must get no ACAO header`);
    assert.strictEqual(isOriginAllowed(origin), false, origin);
  }
});

await test('Disallowed Origin cannot perform state-changing requests (403), even with a valid session', async () => {
  const { token } = await newMember('csrf');
  const res = await app.inject({
    method: 'POST', url: '/api/eora',
    headers: { origin: 'https://attacker.vercel.app', authorization: `Bearer ${token}` },
    payload: { prompt: 'hi' },
  });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(JSON.parse(res.body).error, 'ORIGIN_NOT_ALLOWED');
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: 'https://evil.example' }, payload: { email: 'a@b.c', password: 'x' } });
  assert.strictEqual(login.statusCode, 403);
});

await test('Allowed Origin and Origin-less server-to-server requests still work', async () => {
  const { token } = await newMember('legit');
  const viaFrontend = await app.inject({
    method: 'POST', url: '/api/eora',
    headers: { origin: 'https://collaborate.aitathastu.com', authorization: `Bearer ${token}` },
    payload: { prompt: 'hi' },
  });
  assert.strictEqual(viaFrontend.statusCode, 200);
  const serverToServer = await app.inject({ method: 'POST', url: '/api/eora', headers: { authorization: `Bearer ${token}` }, payload: { prompt: 'hi' } });
  assert.strictEqual(serverToServer.statusCode, 200);
  assert.strictEqual((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
});

await test('Explicitly approved preview origins (CORS_ALLOWED_ORIGINS) are allowed exactly', async () => {
  process.env.CORS_ALLOWED_ORIGINS = 'https://collaborate-git-feature-team.vercel.app, not a url, https://x.example/path';
  try {
    assert.strictEqual(isOriginAllowed('https://collaborate-git-feature-team.vercel.app'), true);
    assert.strictEqual(isOriginAllowed('https://x.example'), true, 'path is stripped to the exact origin');
    assert.strictEqual(isOriginAllowed('https://collaborate-git-other.vercel.app'), false);
    const res = await preflight('https://collaborate-git-feature-team.vercel.app');
    assert.strictEqual(res.headers['access-control-allow-origin'], 'https://collaborate-git-feature-team.vercel.app');
  } finally {
    delete process.env.CORS_ALLOWED_ORIGINS;
  }
});

await test('Production: localhost and http:// approved entries are not allowed', async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  process.env.CORS_ALLOWED_ORIGINS = 'http://preview.example';
  try {
    assert.strictEqual(isOriginAllowed('http://localhost:3000'), false);
    assert.strictEqual(isOriginAllowed('http://preview.example'), false);
    assert.strictEqual(normalizeOrigin('http://preview.example'), null);
    assert.strictEqual(isOriginAllowed('https://collaborate.aitathastu.com'), true);
  } finally {
    delete process.env.CORS_ALLOWED_ORIGINS;
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
  assert.strictEqual(isOriginAllowed('http://localhost:3000'), true, 'dev origins allowed outside production');
});

// ---------------------------------------------------------------------------
// Payment webhook
// ---------------------------------------------------------------------------
function eventBody(memberId, id = `evt_${crypto.randomBytes(8).toString('hex')}`) {
  return JSON.stringify({ id, type: 'payment.succeeded', data: { memberId } });
}
function deliver(raw, header, url = '/api/webhooks/payments') {
  const headers = { 'content-type': 'application/json' };
  if (header) headers['x-payment-signature'] = header;
  return app.inject({ method: 'POST', url, headers, payload: raw });
}
const now = () => Math.floor(Date.now() / 1000);

await test('Fails closed when PAYMENT_WEBHOOK_SECRET is missing', async () => {
  delete process.env.PAYMENT_WEBHOOK_SECRET;
  const { member } = await newMember('nocfg');
  const raw = eventBody(member.id);
  const res = await deliver(raw, signPaymentWebhook(raw, 'anything', now()));
  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(durableDb.getMemberById(member.id).plan, 'free');
});

process.env.PAYMENT_WEBHOOK_SECRET = SECRET;

await test('Valid signed, fresh event is processed (both /api/webhooks/payments and /api/billing)', async () => {
  const a = await newMember('pay_a');
  const raw = eventBody(a.member.id);
  const res = await deliver(raw, signPaymentWebhook(raw, SECRET, now()));
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.strictEqual(durableDb.getMemberById(a.member.id).plan, 'premium');

  const b = await newMember('pay_b');
  const rawB = eventBody(b.member.id);
  const resB = await deliver(rawB, signPaymentWebhook(rawB, SECRET, now()), '/api/billing');
  assert.strictEqual(resB.statusCode, 200, resB.body);
  assert.strictEqual(durableDb.getMemberById(b.member.id).plan, 'premium');
});

await test('Missing signature / missing timestamp / malformed header are rejected', async () => {
  const { member } = await newMember('fmt');
  const raw = eventBody(member.id);
  const v1 = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  const missing = await deliver(raw, undefined);
  assert.strictEqual(missing.statusCode, 401);
  assert.strictEqual(JSON.parse(missing.body).error, 'MISSING_SIGNATURE');
  for (const header of [`v1=${v1}`, `t=,v1=${v1}`, `t=abc,v1=${v1}`, `t=${now()}`, `t=${now()},v1=nothex`]) {
    const res = await deliver(raw, header);
    assert.strictEqual(res.statusCode, 401, header);
    assert.strictEqual(JSON.parse(res.body).error, 'INVALID_SIGNATURE_FORMAT', header);
  }
  assert.strictEqual(durableDb.getMemberById(member.id).plan, 'free');
});

await test(`Timestamps outside ±${PAYMENT_WEBHOOK_TOLERANCE_SECONDS}s are rejected; edges inside are accepted`, async () => {
  const { member } = await newMember('ts');
  for (const skew of [-(PAYMENT_WEBHOOK_TOLERANCE_SECONDS + 5), PAYMENT_WEBHOOK_TOLERANCE_SECONDS + 5, -86400]) {
    const raw = eventBody(member.id);
    const res = await deliver(raw, signPaymentWebhook(raw, SECRET, now() + skew));
    assert.strictEqual(res.statusCode, 401, `skew ${skew}`);
    assert.strictEqual(JSON.parse(res.body).error, 'STALE_TIMESTAMP');
  }
  assert.strictEqual(durableDb.getMemberById(member.id).plan, 'free');
  // Pure verifier edge checks (deterministic clock).
  const raw = eventBody(member.id);
  const t = 1_800_000_000;
  assert.strictEqual(verifyPaymentWebhookSignature(raw, signPaymentWebhook(raw, SECRET, t), SECRET, t + PAYMENT_WEBHOOK_TOLERANCE_SECONDS).valid, true);
  assert.strictEqual(verifyPaymentWebhookSignature(raw, signPaymentWebhook(raw, SECRET, t), SECRET, t + PAYMENT_WEBHOOK_TOLERANCE_SECONDS + 1).valid, false);
});

await test('Tampered timestamp or body invalidates the signature', async () => {
  const { member } = await newMember('tamper');
  const raw = eventBody(member.id);
  const t = now();
  const header = signPaymentWebhook(raw, SECRET, t);
  const shifted = header.replace(`t=${t}`, `t=${t - 1}`);
  assert.strictEqual(JSON.parse((await deliver(raw, shifted)).body).error, 'INVALID_SIGNATURE');
  const other = await newMember('tamper_target');
  const tamperedBody = raw.replace(member.id, other.member.id);
  assert.strictEqual(JSON.parse((await deliver(tamperedBody, header)).body).error, 'INVALID_SIGNATURE');
  assert.strictEqual(durableDb.getMemberById(other.member.id).plan, 'free');
});

await test('Replayed event id is rejected (409), including re-signed with a fresh timestamp', async () => {
  const { member } = await newMember('replay');
  const id = `evt_replay_${runId}`;
  const raw = eventBody(member.id, id);
  const first = await deliver(raw, signPaymentWebhook(raw, SECRET, now()));
  assert.strictEqual(first.statusCode, 200, first.body);
  const exact = await deliver(raw, signPaymentWebhook(raw, SECRET, now()));
  assert.strictEqual(exact.statusCode, 409);
  assert.strictEqual(JSON.parse(exact.body).error, 'REPLAYED_EVENT');
  // Same id delivered via the alternate route is still a replay.
  const alt = await deliver(raw, signPaymentWebhook(raw, SECRET, now() - 10), '/api/billing');
  assert.strictEqual(alt.statusCode, 409);
  assert.ok(durableDb.isWebhookProcessed('payments', id), 'event id recorded in durable store');
});

await test('Concurrent duplicate deliveries: exactly one is accepted', async () => {
  const { member } = await newMember('race');
  const raw = eventBody(member.id, `evt_race_${runId}`);
  const header = signPaymentWebhook(raw, SECRET, now());
  const results = await Promise.all(Array.from({ length: 8 }, () => deliver(raw, header)));
  const codes = results.map((r) => r.statusCode).sort();
  assert.strictEqual(codes.filter((c) => c === 200).length, 1, codes.join(','));
  assert.strictEqual(codes.filter((c) => c === 409).length, 7, codes.join(','));
});

await test('Invalid events are rejected before the event id is consumed', async () => {
  const id = `evt_unknown_member_${runId}`;
  const raw = JSON.stringify({ id, type: 'payment.succeeded', data: { memberId: `usr_missing_${runId}` } });
  assert.strictEqual((await deliver(raw, signPaymentWebhook(raw, SECRET, now()))).statusCode, 404);
  assert.strictEqual(durableDb.isWebhookProcessed('payments', id), false);
  const wrongType = JSON.stringify({ id: `evt_type_${runId}`, type: 'payment.refunded', data: { memberId: 'x' } });
  assert.strictEqual((await deliver(wrongType, signPaymentWebhook(wrongType, SECRET, now()))).statusCode, 400);
  const noId = JSON.stringify({ type: 'payment.succeeded', data: { memberId: 'x' } });
  assert.strictEqual((await deliver(noId, signPaymentWebhook(noId, SECRET, now()))).statusCode, 400);
});

await test('Durable store failure fails closed (503) and grants nothing', async () => {
  const { member } = await newMember('storefail');
  const original = durableDb.beginWebhookDelivery;
  durableDb.beginWebhookDelivery = async () => { throw new Error('db down'); };
  try {
    const raw = eventBody(member.id);
    const res = await deliver(raw, signPaymentWebhook(raw, SECRET, now()));
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(durableDb.getMemberById(member.id).plan, 'free');
  } finally {
    durableDb.beginWebhookDelivery = original;
  }
});

await test('Save failure after claim is retryable: the paid upgrade is applied on retry, not lost', async () => {
  const { member } = await newMember('savefail');
  const id = `evt_savefail_${runId}`;
  const raw = eventBody(member.id, id);
  const original = durableDb.saveMemberAsync;
  durableDb.saveMemberAsync = async () => { throw new Error('storage outage'); };
  let first;
  try {
    first = await deliver(raw, signPaymentWebhook(raw, SECRET, now()));
  } finally {
    durableDb.saveMemberAsync = original;
  }
  assert.strictEqual(first.statusCode, 503);
  assert.strictEqual(durableDb.getMemberById(member.id).plan, 'free');
  assert.strictEqual(durableDb.isWebhookProcessed('payments', id), false, 'not marked processed');
  const retry = await deliver(raw, signPaymentWebhook(raw, SECRET, now()));
  assert.strictEqual(retry.statusCode, 200, retry.body);
  assert.strictEqual(durableDb.getMemberById(member.id).plan, 'premium');
  const replay = await deliver(raw, signPaymentWebhook(raw, SECRET, now()));
  assert.strictEqual(replay.statusCode, 409);
});

delete process.env.PAYMENT_WEBHOOK_SECRET;
console.log(`\n=== ${passed}/${total} passed ===\n`);
if (passed !== total) process.exitCode = 1;
