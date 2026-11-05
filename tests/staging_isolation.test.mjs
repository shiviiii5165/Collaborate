/**
 * Staging isolation guard (COLLABORATE_DEPLOY_ENV=staging): live SSO stays disabled unless every
 * AI Tathastu endpoint is explicit, https (or loopback) and not a production host.
 * Run: npx tsx tests/staging_isolation.test.mjs
 */
import assert from 'node:assert';

const { getConfigDiagnostics, getStagingViolations, formatStartupDiagnostics } = await import('../src/integrations/tathastu/config.ts');

const KEYS = ['COLLABORATE_DEPLOY_ENV', 'TATHASTU_INTEGRATION_MODE', 'AIT_ISSUER', 'AIT_CLIENT_ID', 'AIT_CLIENT_SECRET', 'AIT_REDIRECT_URI', 'AIT_WEBHOOK_SECRET',
  'AIT_AUTHORIZE_URL', 'AIT_TOKEN_URL', 'AIT_JWKS_URL', 'AIT_PROFILE_URL', 'AI_TATHASTU_AUTH_URL', 'AI_TATHASTU_TOKEN_URL', 'AI_TATHASTU_JWKS_URL', 'AI_TATHASTU_PROFILE_URL', 'AIT_PRODUCTION_HOSTS'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
function env(over) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, over);
}
const STAGING_OK = {
  COLLABORATE_DEPLOY_ENV: 'staging',
  TATHASTU_INTEGRATION_MODE: 'live',
  AIT_ISSUER: 'https://www.aitathastu.com',
  AIT_CLIENT_ID: 'collaborate',
  AIT_CLIENT_SECRET: 'staging-test-only',
  AIT_REDIRECT_URI: 'https://collaborate-staging.example.test/api/auth/tathastu/callback',
  AIT_WEBHOOK_SECRET: 'staging-test-only',
  AIT_AUTHORIZE_URL: 'https://ait-staging.example.test/integrations/authorize',
  AIT_TOKEN_URL: 'https://ait-staging.example.test/api/integrations/sso/token',
  AIT_JWKS_URL: 'https://ait-staging.example.test/api/integrations/jwks',
  AIT_PROFILE_URL: 'https://ait-staging.example.test/api/integrations/v1/profile',
};

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (e) {
    console.log(`  [FAIL] ${name}\n         ${e.message}`);
  }
}
console.log('\n=== Staging isolation guard ===\n');

test('Complete staging config with non-production endpoints enables SSO', () => {
  env(STAGING_OK);
  assert.deepStrictEqual(getStagingViolations(), []);
  assert.strictEqual(getConfigDiagnostics().ssoEnabled, true);
});

test('Any endpoint left unset (would derive from the production issuer) disables SSO', () => {
  for (const k of ['AIT_AUTHORIZE_URL', 'AIT_TOKEN_URL', 'AIT_JWKS_URL', 'AIT_PROFILE_URL']) {
    env({ ...STAGING_OK, [k]: '' });
    const d = getConfigDiagnostics();
    assert.strictEqual(d.ssoEnabled, false, k);
    assert.ok(d.stagingViolations.some((v) => v.startsWith(k)), k);
  }
});

test('An endpoint on a production AI Tathastu host disables SSO (incl. operator-listed hosts)', () => {
  env({ ...STAGING_OK, AIT_JWKS_URL: 'https://www.aitathastu.com/api/integrations/jwks' });
  assert.strictEqual(getConfigDiagnostics().ssoEnabled, false);
  env({ ...STAGING_OK, AIT_PRODUCTION_HOSTS: 'ait-staging.example.test' });
  assert.strictEqual(getConfigDiagnostics().ssoEnabled, false);
});

test('Plain http is refused except on loopback (local staging-equivalent runs)', () => {
  env({ ...STAGING_OK, AIT_TOKEN_URL: 'http://ait-staging.example.test/api/integrations/sso/token' });
  assert.ok(getStagingViolations().some((v) => v.includes('https')));
  env({ ...STAGING_OK, AIT_TOKEN_URL: 'http://127.0.0.1:4100/api/integrations/sso/token' });
  assert.deepStrictEqual(getStagingViolations(), []);
});

test('Missing webhook secret is a staging violation', () => {
  env({ ...STAGING_OK, AIT_WEBHOOK_SECRET: '' });
  assert.ok(getStagingViolations().includes('AIT_WEBHOOK_SECRET must be set in staging'));
});

test('Diagnostics name variables only, never values', () => {
  env({ ...STAGING_OK, AIT_JWKS_URL: 'https://www.aitathastu.com/secret-path', AIT_TOKEN_URL: '' });
  const text = formatStartupDiagnostics().join('\n') + JSON.stringify(getConfigDiagnostics());
  assert.ok(!text.includes('secret-path') && !text.includes('staging-test-only'));
});

test('Without COLLABORATE_DEPLOY_ENV=staging the guard is inactive (production behaviour unchanged)', () => {
  env({ ...STAGING_OK, COLLABORATE_DEPLOY_ENV: '', AIT_AUTHORIZE_URL: '' });
  assert.deepStrictEqual(getStagingViolations(), []);
  assert.strictEqual(getConfigDiagnostics().ssoEnabled, true);
});

const { isOriginAllowed } = await import('../src/lib/http/cors-policy.ts');
test('Staging API does not trust production frontend origins; production unchanged', () => {
  const prevApp = process.env.NEXT_PUBLIC_APP_URL;
  const prevNode = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_APP_URL = 'https://collaborate-staging.example.test';
    env({ COLLABORATE_DEPLOY_ENV: 'staging' });
    assert.strictEqual(isOriginAllowed('https://collaborate.aitathastu.com'), false);
    assert.strictEqual(isOriginAllowed('https://collaborate-umber.vercel.app'), false);
    assert.strictEqual(isOriginAllowed('https://collaborate-staging.example.test'), true);
    env({});
    assert.strictEqual(isOriginAllowed('https://collaborate.aitathastu.com'), true);
  } finally {
    if (prevApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevApp;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
  }
});

for (const [k, v] of Object.entries(saved)) {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}
console.log(`\n=== ${passed}/${total} passed ===`);
process.exit(passed === total ? 0 : 1);
