/**
 * The live AI Tathastu adapter must never transmit credentials. AI Tathastu has no service-level read
 * API; an older adapter sent the OAuth client secret as a Bearer token to invented endpoints on a host
 * that doesn't exist. This suite stubs fetch and proves no call is made, and that live mode still
 * answers members with "sign in again" (the real path) rather than an error.
 *
 * Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/live_adapter_no_credentials.test.mjs
 */
import assert from 'node:assert';

process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
delete process.env.COLLABORATE_ENABLE_FIXTURES;
process.env.TATHASTU_INTEGRATION_MODE = 'live';
process.env.AI_TATHASTU_CLIENT_SECRET = 'must-never-leave-the-server';
process.env.TATHASTU_CORE_SERVICE_TOKEN = 'must-never-leave-either';

const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), auth: init?.headers?.Authorization ?? init?.headers?.authorization ?? null });
  throw new Error('network disabled in this test');
};

const { LiveTathastuAdapter, LiveCoreApiUnsupportedError } = await import('../src/integrations/tathastu/live/adapter.ts');
const { resetTathastuAdapter, getTathastuAdapter } = await import('../src/integrations/tathastu/index.ts');
const { FederationService, ReauthorizationRequiredError } = await import('../src/modules/federation/client.ts');

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

await test('every live adapter operation refuses without any network call', async () => {
  const a = new LiveTathastuAdapter();
  await assert.rejects(a.fetchProjection('core_person_x'), LiveCoreApiUnsupportedError);
  await assert.rejects(a.getEligibleDiscoveryMembers(), LiveCoreApiUnsupportedError);
  await assert.rejects(a.processSyncEvent({ eventId: 'e1', eventType: 'profile_updated', sourcePersonId: 'p', timestamp: new Date().toISOString() }), LiveCoreApiUnsupportedError);
  assert.deepStrictEqual(calls, [], `no request may be sent, got ${JSON.stringify(calls)}`);
});

await test('live mode: a member refresh asks for a fresh sign-in, and still sends nothing', async () => {
  resetTathastuAdapter();
  assert.strictEqual(getTathastuAdapter().mode, 'live');
  await assert.rejects(FederationService.fetchApprovedProjection('core_person_x'), ReauthorizationRequiredError);
  assert.deepStrictEqual(calls, []);
});

console.log(`=== ${passed}/${total} passed ===`);
globalThis.fetch = realFetch;
