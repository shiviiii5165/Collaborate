/**
 * Collaborate <-> AI Tathastu SSO client hardening regression suite.
 *
 * Exercises the REAL browser callback path (GET /api/auth/tathastu/callback) through
 * Fastify inject against an in-process fake AI Tathastu provider (token, JWKS and
 * profile endpoints stubbed via globalThis.fetch). No network, no production systems.
 *
 * Run: npx tsx tests/tathastu_sso_client_hardening.test.mjs
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

// ---------------------------------------------------------------------------
// Environment: live SSO enabled with test-only values; test harness OFF so the
// production code path is what gets exercised.
// ---------------------------------------------------------------------------
const ISSUER = 'https://www.aitathastu.com';
const CLIENT_ID = 'collaborate';
const CLIENT_SECRET = 'test_only_client_secret_value_7731';
const REDIRECT_URI = 'https://collaborate.aitathastu.com/api/auth/tathastu/callback';
const TOKEN_URL = `${ISSUER}/api/integrations/sso/token`;
const JWKS_URL = `${ISSUER}/api/integrations/jwks`;
const PROFILE_URL = `${ISSUER}/api/integrations/v1/profile`;

function setLiveEnv() {
  process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
  delete process.env.COLLABORATE_ENABLE_FIXTURES;
  process.env.TATHASTU_INTEGRATION_MODE = 'live';
  process.env.AIT_ISSUER = ISSUER;
  process.env.AIT_CLIENT_ID = CLIENT_ID;
  process.env.AIT_CLIENT_SECRET = CLIENT_SECRET;
  process.env.AIT_REDIRECT_URI = REDIRECT_URI;
  for (const k of ['AIT_TOKEN_URL', 'AIT_JWKS_URL', 'AIT_PROFILE_URL', 'AIT_AUTHORIZE_URL', 'AI_TATHASTU_JWKS_URL', 'AI_TATHASTU_PROFILE_URL']) {
    delete process.env[k];
  }
}
setLiveEnv();

const { buildServer } = await import('../apps/api/src/server.ts');
const { TathastuClient } = await import('../src/integrations/tathastu/client.ts');
const { TathastuSsoService } = await import('../src/modules/identity/tathastu-sso.ts');
const { IdentityService } = await import('../src/modules/identity/service.ts');
const { durableDb } = await import('../src/lib/db/index.ts');
const { signPendingLinkToken } = await import('../src/lib/auth/session.ts');
const { formatStartupDiagnostics, getConfigDiagnostics } = await import('../src/integrations/tathastu/config.ts');
const { getSsoErrorMessage } = await import('../src/lib/auth/sso-errors.ts');

// ---------------------------------------------------------------------------
// Fake AI Tathastu provider
// ---------------------------------------------------------------------------
const providerKeys = await generateKeyPair('ES256', { extractable: true });
const attackerKeys = await generateKeyPair('ES256', { extractable: true });
const providerJwk = { ...(await exportJWK(providerKeys.publicKey)), kid: 'ait-test-1', alg: 'ES256', use: 'sig' };

/** code -> { challenge, redirectUri, identity, used } */
const issuedCodes = new Map();
const provider = {
  tokenIssuer: ISSUER,
  tokenAudience: CLIENT_ID,
  signingKey: providerKeys.privateKey,
  profile: null, // projection returned by the profile API (null -> 404)
  tokenRequests: [],
};

function resetProvider() {
  provider.tokenIssuer = ISSUER;
  provider.tokenAudience = CLIENT_ID;
  provider.signingKey = providerKeys.privateKey;
  provider.profile = null;
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  if (url === JWKS_URL) return json(200, { keys: [providerJwk] });

  if (url === TOKEN_URL) {
    const form = new URLSearchParams(String(init.body || ''));
    const auth = String(init.headers?.Authorization || init.headers?.authorization || '');
    provider.tokenRequests.push({ grant_type: form.get('grant_type'), hasAuth: auth.startsWith('Basic ') });

    const expectedAuth = `Basic ${Buffer.from(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`).toString('base64')}`;
    if (auth !== expectedAuth) return json(401, { error: 'invalid_client', error_description: 'bad client auth' });

    const entry = issuedCodes.get(form.get('code'));
    if (!entry || entry.used) return json(400, { error: 'invalid_grant', error_description: 'unknown or used code' });
    entry.used = true;
    if (form.get('redirect_uri') !== entry.redirectUri) return json(400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    const challenge = crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
    if (challenge !== entry.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });

    const accessToken = await new SignJWT({ email: entry.identity.email, name: entry.identity.name })
      .setProtectedHeader({ alg: 'ES256', kid: 'ait-test-1' })
      .setSubject(entry.identity.sub)
      .setIssuer(provider.tokenIssuer)
      .setAudience(provider.tokenAudience)
      .setIssuedAt()
      .setExpirationTime(entry.identity.expired ? '-60s' : '10m')
      .sign(provider.signingKey);
    return json(200, { access_token: accessToken, token_type: 'Bearer', expires_in: 600 });
  }

  if (url === PROFILE_URL) {
    return provider.profile ? json(200, provider.profile) : json(404, { error: 'not_found' });
  }

  return realFetch(input, init);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const app = buildServer();
const runId = `${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;

function cookiesFrom(res) {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}
function cookieValue(res, name) {
  const c = cookiesFrom(res).find((s) => s.startsWith(`${name}=`));
  return c ? c.split(';')[0].substring(name.length + 1) : null;
}
function authErrorOf(res) {
  const loc = res.headers.location || '';
  return new URL(loc, 'https://collaborate.test').searchParams.get('auth_error');
}

/** Runs /start, has the fake provider issue a code for `identity`, returns callback inputs. */
async function startFlow(identity) {
  const res = await app.inject({ method: 'GET', url: '/api/auth/tathastu/start?format=json' });
  assert.strictEqual(res.statusCode, 200, `start failed: ${res.body}`);
  const data = JSON.parse(res.body);
  const flowCookie = cookieValue(res, 'tathastu_oauth_flow');
  assert.ok(flowCookie, 'flow cookie must be set');
  const code = `ait_code_${crypto.randomBytes(12).toString('hex')}`;
  issuedCodes.set(code, { challenge: data.codeChallenge, redirectUri: data.redirectUri, identity, used: false });
  return { code, state: data.state, flowCookie, startRes: res };
}

async function callback({ code, state, flowCookie }) {
  const qs = new URLSearchParams();
  if (code) qs.set('code', code);
  if (state) qs.set('state', state);
  return app.inject({
    method: 'GET',
    url: `/api/auth/tathastu/callback?${qs}`,
    headers: flowCookie ? { cookie: `tathastu_oauth_flow=${flowCookie}` } : {},
  });
}

function newIdentity(label) {
  return { sub: `urn:tathastu:person:${label}_${runId}`, email: `${label}_${runId}@aitathastu.test`, name: `SSO ${label}` };
}

let passed = 0;
let total = 0;
async function test(title, fn) {
  total++;
  process.stdout.write(`  [TEST ${total}] ${title}... `);
  setLiveEnv();
  resetProvider();
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

console.log('\n=== AI Tathastu SSO client hardening suite ===\n');

// ---------------------------------------------------------------------------
// Mode / configuration
// ---------------------------------------------------------------------------
await test('Mock mode: /start never redirects to AI Tathastu and shows sso_unavailable', async () => {
  delete process.env.TATHASTU_INTEGRATION_MODE;
  const res = await app.inject({ method: 'GET', url: '/api/auth/tathastu/start' });
  assert.strictEqual(res.statusCode, 302);
  assert.strictEqual(res.headers.location, '/?auth_error=sso_unavailable');
  assert.strictEqual(cookieValue(res, 'tathastu_oauth_flow'), null);
});

await test('Live mode with missing AIT_CLIENT_SECRET fails closed and diagnostics list the NAME only', async () => {
  delete process.env.AIT_CLIENT_SECRET;
  const res = await app.inject({ method: 'GET', url: '/api/auth/tathastu/start' });
  assert.strictEqual(res.headers.location, '/?auth_error=sso_unavailable');
  const d = getConfigDiagnostics();
  assert.strictEqual(d.ssoEnabled, false);
  assert.deepStrictEqual(d.missingSsoVariables, ['AIT_CLIENT_SECRET']);
});

await test('Startup diagnostics never print configured secret values', async () => {
  process.env.AIT_WEBHOOK_SECRET = 'whsec_value_must_not_leak_123';
  const out = formatStartupDiagnostics().join('\n');
  assert.ok(!out.includes(CLIENT_SECRET));
  assert.ok(!out.includes('whsec_value_must_not_leak_123'));
  assert.ok(out.includes('LIVE'));
  delete process.env.AIT_WEBHOOK_SECRET;
});

await test('GET /api/auth/tathastu/status exposes only enabled + mode', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/tathastu/status' });
  assert.deepStrictEqual(JSON.parse(res.body), { enabled: true, mode: 'live' });
});

await test('/start ignores a caller-supplied redirectUri and uses the configured callback', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/tathastu/start?redirectUri=https%3A%2F%2Fevil.example%2Fcb' });
  assert.strictEqual(res.statusCode, 302);
  const loc = new URL(res.headers.location);
  assert.strictEqual(loc.origin + loc.pathname, `${ISSUER}/integrations/authorize`);
  assert.strictEqual(loc.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.strictEqual(loc.searchParams.get('client_id'), CLIENT_ID);
  assert.strictEqual(loc.searchParams.get('code_challenge_method'), 'S256');
});

await test('Flow cookie is HttpOnly, SameSite=Lax, 10-minute Max-Age (and Secure in production)', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/tathastu/start?format=json' });
  const c = cookiesFrom(res).find((s) => s.startsWith('tathastu_oauth_flow='));
  assert.match(c, /HttpOnly/i);
  assert.match(c, /SameSite=Lax/i);
  assert.match(c, /Max-Age=600/);
  const src = readFileSync(new URL('../apps/api/src/server.ts', import.meta.url), 'utf8');
  assert.ok(/secure:\s*isProd/.test(src), 'flow cookie Secure flag must follow NODE_ENV=production');
});

// ---------------------------------------------------------------------------
// Callback happy path
// ---------------------------------------------------------------------------
await test('Valid flow: code exchange with client auth + PKCE, ES256 verify via JWKS, session issued', async () => {
  const id = newIdentity('happy');
  const flow = await startFlow(id);
  const before = provider.tokenRequests.length;
  const res = await callback(flow);
  assert.strictEqual(res.statusCode, 302, res.body);
  assert.strictEqual(res.headers.location, '/?auth_success=true');
  const req = provider.tokenRequests[before];
  assert.strictEqual(req.grant_type, 'authorization_code');
  assert.strictEqual(req.hasAuth, true);

  const session = cookieValue(res, 'collaborate_session');
  assert.ok(session, 'session cookie must be set');
  const sessionCookie = cookiesFrom(res).find((s) => s.startsWith('collaborate_session='));
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /SameSite=Lax/i);

  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `collaborate_session=${session}` } });
  assert.strictEqual(me.statusCode, 200);
  assert.strictEqual(JSON.parse(me.body).member.email, id.email);
  assert.ok(durableDb.getMappingByExternalSub('aitathastu_oidc', id.sub));

  // Flow cookie is single-use and cleared.
  const cleared = cookiesFrom(res).find((s) => s.startsWith('tathastu_oauth_flow='));
  assert.ok(cleared && (/Max-Age=0/i.test(cleared) || /Expires=Thu, 01 Jan 1970/i.test(cleared)));
});

await test('Replay: the same authorization code cannot be redeemed twice', async () => {
  const id = newIdentity('replay');
  const flow = await startFlow(id);
  assert.strictEqual((await callback(flow)).headers.location, '/?auth_success=true');
  const again = await callback(flow);
  assert.strictEqual(authErrorOf(again), 'code_reused');
  assert.strictEqual(cookieValue(again, 'collaborate_session'), null);
});

// ---------------------------------------------------------------------------
// Callback rejections
// ---------------------------------------------------------------------------
await test('State mismatch is rejected', async () => {
  const flow = await startFlow(newIdentity('state'));
  const res = await callback({ ...flow, state: 'attacker_state_value' });
  assert.strictEqual(authErrorOf(res), 'invalid_state');
  assert.strictEqual(cookieValue(res, 'collaborate_session'), null);
});

await test('Missing state parameter is rejected', async () => {
  const flow = await startFlow(newIdentity('nostate'));
  const res = await callback({ ...flow, state: '' });
  assert.strictEqual(authErrorOf(res), 'invalid_state');
});

await test('Missing flow cookie (no stored state/PKCE) is rejected', async () => {
  const flow = await startFlow(newIdentity('nocookie'));
  const res = await callback({ ...flow, flowCookie: null });
  assert.strictEqual(authErrorOf(res), 'flow_expired');
  assert.strictEqual(cookieValue(res, 'collaborate_session'), null);
});

await test('Expired OAuth flow (older than 10 minutes) is rejected', async () => {
  const flow = await startFlow(newIdentity('expiredflow'));
  const parsed = JSON.parse(decodeURIComponent(flow.flowCookie));
  parsed.createdAt = Date.now() - 11 * 60 * 1000;
  const res = await callback({ ...flow, flowCookie: encodeURIComponent(JSON.stringify(parsed)) });
  assert.strictEqual(authErrorOf(res), 'flow_expired');
});

await test('PKCE verifier mismatch is rejected (provider invalid_grant)', async () => {
  const flow = await startFlow(newIdentity('pkce'));
  const parsed = JSON.parse(decodeURIComponent(flow.flowCookie));
  parsed.codeVerifier = crypto.randomBytes(48).toString('base64url');
  const res = await callback({ ...flow, flowCookie: encodeURIComponent(JSON.stringify(parsed)) });
  assert.strictEqual(authErrorOf(res), 'invalid_state');
  assert.strictEqual(cookieValue(res, 'collaborate_session'), null);
});

await test('Invalid JWT signature (not signed by JWKS key) is rejected', async () => {
  provider.signingKey = attackerKeys.privateKey;
  const res = await callback(await startFlow(newIdentity('badsig')));
  assert.strictEqual(authErrorOf(res), 'token_invalid');
  assert.strictEqual(cookieValue(res, 'collaborate_session'), null);
});

await test('Wrong issuer is rejected', async () => {
  provider.tokenIssuer = 'https://rogue-issuer.example';
  const res = await callback(await startFlow(newIdentity('iss')));
  assert.strictEqual(authErrorOf(res), 'token_invalid');
});

await test('Wrong audience is rejected', async () => {
  provider.tokenAudience = 'some-other-client';
  const res = await callback(await startFlow(newIdentity('aud')));
  assert.strictEqual(authErrorOf(res), 'token_invalid');
});

await test('Expired access token is rejected', async () => {
  const res = await callback(await startFlow({ ...newIdentity('exptoken'), expired: true }));
  assert.strictEqual(authErrorOf(res), 'token_invalid');
});

await test('Provider error text is never reflected; only a safe code is returned', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/api/auth/tathastu/callback?error=server_error&error_description=${encodeURIComponent('<script>alert(1)</script> internal trace')}`,
  });
  assert.strictEqual(res.headers.location, '/?auth_error=sso_failed');
  const denied = await app.inject({ method: 'GET', url: '/api/auth/tathastu/callback?error=access_denied' });
  assert.strictEqual(denied.headers.location, '/?auth_error=access_denied');
  // UI mapping: unknown/attacker text falls back to a generic message.
  assert.strictEqual(getSsoErrorMessage('<script>'), getSsoErrorMessage('sso_failed'));
  assert.ok(!getSsoErrorMessage('access_denied').includes('access_denied'));
});

// ---------------------------------------------------------------------------
// Account linking
// ---------------------------------------------------------------------------
await test('Existing local account requires its Collaborate password before linking', async () => {
  const id = newIdentity('linkme');
  const localPassword = 'LocalPassw0rd!';
  const { member: local } = await IdentityService.registerStandalone(id.email, localPassword, 'Local Owner');

  const res = await callback(await startFlow(id));
  assert.strictEqual(authErrorOf(res), 'account_link_required');
  assert.strictEqual(cookieValue(res, 'collaborate_session'), null, 'no session before password confirmation');
  const pending = cookieValue(res, 'tathastu_pending_link');
  assert.ok(pending, 'pending link cookie must be set');
  assert.strictEqual(durableDb.getMappingByExternalSub('aitathastu_oidc', id.sub), null, 'not linked yet');

  // Pending token can never act as a session.
  const asSession = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${decodeURIComponent(pending)}` } });
  assert.strictEqual(asSession.statusCode, 401);

  // Wrong password -> rejected, still unlinked.
  const wrong = await app.inject({
    method: 'POST', url: '/api/auth/tathastu/link',
    headers: { cookie: `tathastu_pending_link=${pending}` }, payload: { password: 'wrong-password' },
  });
  assert.strictEqual(wrong.statusCode, 401);
  assert.strictEqual(JSON.parse(wrong.body).error, 'link_password_invalid');
  assert.strictEqual(durableDb.getMappingByExternalSub('aitathastu_oidc', id.sub), null);

  // Correct password -> linked to the SAME member, session issued, password preserved.
  const ok = await app.inject({
    method: 'POST', url: '/api/auth/tathastu/link',
    headers: { cookie: `tathastu_pending_link=${pending}` }, payload: { password: localPassword },
  });
  assert.strictEqual(ok.statusCode, 200, ok.body);
  assert.strictEqual(JSON.parse(ok.body).member.id, local.id);
  assert.ok(cookieValue(ok, 'collaborate_session'));
  assert.strictEqual(durableDb.getMappingByExternalSub('aitathastu_oidc', id.sub).memberId, local.id);
  const relogin = await IdentityService.loginWithPassword(id.email, localPassword);
  assert.strictEqual(relogin.member.id, local.id);

  // Subsequent SSO logins resolve by stable subject, no prompt.
  const again = await callback(await startFlow(id));
  assert.strictEqual(again.headers.location, '/?auth_success=true');
});

await test('Link endpoint without a valid pending cookie is rejected', async () => {
  const forged = await app.inject({
    method: 'POST', url: '/api/auth/tathastu/link',
    headers: { cookie: 'tathastu_pending_link=not.a.token' }, payload: { password: 'x' },
  });
  assert.strictEqual(forged.statusCode, 400);
  assert.strictEqual(JSON.parse(forged.body).error, 'link_expired');
});

await test('Different external subjects cannot collide on one Collaborate account', async () => {
  const id = newIdentity('collide');
  const pw = 'CollidePassw0rd!';
  await IdentityService.registerStandalone(id.email, pw, 'Collision Owner');
  const first = await callback(await startFlow(id));
  const pending = cookieValue(first, 'tathastu_pending_link');
  const linked = await app.inject({ method: 'POST', url: '/api/auth/tathastu/link', headers: { cookie: `tathastu_pending_link=${pending}` }, payload: { password: pw } });
  assert.strictEqual(linked.statusCode, 200);

  // A different AI Tathastu subject presenting the same email.
  const intruder = { ...id, sub: `urn:tathastu:person:intruder_${runId}` };
  const res = await callback(await startFlow(intruder));
  assert.strictEqual(authErrorOf(res), 'identity_conflict');
  assert.strictEqual(cookieValue(res, 'collaborate_session'), null);
  // Even with the correct password via a forged pending token, the mapping cannot be stolen.
  const forgedPending = await signPendingLinkToken({ externalSubjectId: intruder.sub, email: intruder.email, fullName: 'x' });
  const steal = await app.inject({ method: 'POST', url: '/api/auth/tathastu/link', headers: { cookie: `tathastu_pending_link=${forgedPending}` }, payload: { password: pw } });
  assert.strictEqual(steal.statusCode, 400);
  assert.strictEqual(JSON.parse(steal.body).error, 'identity_conflict');
});

await test('Password-less existing account is never merged on matching email alone', async () => {
  const id = newIdentity('nopw');
  const seed = { ...durableDb.getAllMembers()[0] };
  durableDb.saveMember({ ...seed, id: `usr_nopw_${runId}`, email: id.email, tathastu_user_id: undefined });
  const res = await callback(await startFlow(id));
  assert.strictEqual(authErrorOf(res), 'identity_conflict');
  assert.strictEqual(durableDb.getMappingByExternalSub('aitathastu_oidc', id.sub), null);
});

// ---------------------------------------------------------------------------
// Profile sync
// ---------------------------------------------------------------------------
await test('Profile sync preserves local overrides and keeps private data out', async () => {
  const id = newIdentity('override');
  const first = await callback(await startFlow(id));
  assert.strictEqual(first.headers.location, '/?auth_success=true');
  const member = durableDb.getMemberByEmail(id.email);
  member.headline = 'My custom Collaborate headline';
  member.about = 'Written locally on Collaborate';
  await durableDb.saveMemberAsync(member);

  // Shape enforced by validateProfessionalProjection() on the live profile fetch.
  provider.profile = {
    schemaVersion: '1.0', source: 'ai-tathastu', sourcePersonId: id.sub, sourceVersion: '1.0',
    updatedAt: new Date().toISOString(),
    profile: {
      displayName: id.name, headline: 'Upstream headline', about: 'Upstream about',
      skills: [{ id: 'sk1', name: 'JAX', category: 'framework', confirmedByCore: true }],
    },
    permissions: { importApproved: true, discoverable: true, allowedFieldPaths: [], consentVersion: '1.0', consentGrantedAt: new Date().toISOString() },
    quarantinedPrivateData: [{ category: 'private_chat', reason: 'not shared' }],
  };
  const second = await callback(await startFlow(id));
  assert.strictEqual(second.headers.location, '/?auth_success=true', second.body);
  const synced = durableDb.getMemberByEmail(id.email);
  assert.strictEqual(synced.headline, 'My custom Collaborate headline');
  assert.strictEqual(synced.about, 'Written locally on Collaborate');
  assert.ok(synced.skills.includes('JAX'));
  // Quarantined private data is never copied into visible profile fields.
  assert.ok(!JSON.stringify({ ...synced, tathastuProfile: undefined }).includes('private_chat'));
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
await test('Logout clears the local session and SSO helper cookies', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
  assert.strictEqual(res.statusCode, 200);
  for (const name of ['collaborate_session', 'tathastu_pending_link', 'tathastu_oauth_flow']) {
    const c = cookiesFrom(res).find((s) => s.startsWith(`${name}=`));
    assert.ok(c && (/Max-Age=0/i.test(c) || /Expires=Thu, 01 Jan 1970/i.test(c)), `${name} must be cleared`);
  }
});

// ---------------------------------------------------------------------------
// Demo / simulated-auth bypasses
// ---------------------------------------------------------------------------
await test('Harness disabled: demo credentials and simulated claims cannot authenticate', async () => {
  for (const [email, pw] of [['rahulsharma@gmail.com', 'rahul1234'], ['admin@aitathastu.com', 'admin1234']]) {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: pw } });
    assert.strictEqual(r.statusCode, 401, `${email} demo bypass must fail`);
  }
  const sim = await app.inject({
    method: 'POST', url: '/api/auth/tathastu/callback',
    payload: { code: 'x', claimsOverride: { sub: 'attacker', email: 'admin@aitathastu.com' } },
  });
  assert.strictEqual(sim.statusCode, 404);
  assert.strictEqual(cookieValue(sim, 'collaborate_session'), null);
  const legacy = await app.inject({ method: 'POST', url: '/api/auth/oidc/callback', payload: { mockClaims: { sub: 'a', email: 'admin@aitathastu.com' } } });
  assert.strictEqual(legacy.statusCode, 404);
  const legacyGet = await app.inject({ method: 'GET', url: '/api/auth/oidc/callback?code=anything' });
  assert.strictEqual(legacyGet.headers.location, '/?auth_error=sso_unavailable');
  assert.strictEqual(cookieValue(legacyGet, 'collaborate_session'), null);
  await assert.rejects(
    TathastuSsoService.processCallback({ code: 'c', codeVerifier: 'v', state: 's', claimsOverride: { sub: 'x', email: 'x@y.z' } }),
    /TEST_HARNESS_DISABLED/
  );
  await assert.rejects(IdentityService.processOidcCallback('c', 'v', 's'), /SSO_NOT_CONFIGURED/);
});

await test('NODE_ENV=production: harness stays OFF even if COLLABORATE_ENABLE_FIXTURES=true', async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  process.env.COLLABORATE_ENABLE_FIXTURES = 'true';
  try {
    await assert.rejects(IdentityService.loginWithPassword('admin@aitathastu.com', 'admin1234'), /Invalid email or password/);
    await assert.rejects(IdentityService.loginWithPassword('rahulsharma@gmail.com', 'rahul1234'), /Invalid email or password/);
    await assert.rejects(
      TathastuSsoService.processCallback({ code: 'c2', codeVerifier: 'v', state: 's', claimsOverride: { sub: 'x', email: 'x@y.z' } }),
      /TEST_HARNESS_DISABLED/
    );
    const sim = await app.inject({ method: 'POST', url: '/api/auth/tathastu/callback', payload: { claimsOverride: { sub: 'a', email: 'b@c.d' } } });
    assert.strictEqual(sim.statusCode, 404);
  } finally {
    process.env.NODE_ENV = prev;
    if (prev === undefined) delete process.env.NODE_ENV;
  }
});

await test('Harness explicitly enabled in non-production: test personas still work for test fixtures', async () => {
  process.env.COLLABORATE_ENABLE_FIXTURES = 'true';
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@aitathastu.com', password: 'admin1234' } });
  assert.strictEqual(r.statusCode, 200);
});

// ---------------------------------------------------------------------------
// Local login + UI (source-level)
// ---------------------------------------------------------------------------
await test('Direct local email/password login still works', async () => {
  const email = `local_${runId}@collaborate.test`;
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'LocalOnly123!', fullName: 'Local Only' } });
  assert.strictEqual(reg.statusCode, 201);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'LocalOnly123!' } });
  assert.strictEqual(login.statusCode, 200);
  assert.ok(cookieValue(login, 'collaborate_session'));
});

await test('[source check] Unauthenticated login page renders "Continue with AI Tathastu" wired to /start', async () => {
  const src = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  const unauthStart = src.indexOf("authState === 'UNAUTHENTICATED' || !currentUser");
  const appShell = src.indexOf('className="app-shell"');
  const button = src.indexOf('Continue with AI Tathastu', unauthStart);
  assert.ok(unauthStart > 0 && button > unauthStart && button < appShell, 'button must be inside the unauthenticated portal');
  assert.ok(src.includes("window.location.assign('/api/auth/tathastu/start')"));
  assert.ok(src.includes('getSsoErrorMessage(authError)'), 'auth_error must be mapped to a safe message');
});

console.log(`\n=== ${passed}/${total} passed ===\n`);
if (passed !== total) process.exitCode = 1;
globalThis.fetch = realFetch;
TathastuClient.resetCaches();
