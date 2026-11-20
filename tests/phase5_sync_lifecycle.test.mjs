/**
 * Phase 5: sync lifecycle with AI Tathastu. Machine-readable outcomes, account deletion erasing
 * unadopted automatic profiles, existing-account conflicts, shell reclaim, replay protection.
 * Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/phase5_sync_lifecycle.test.mjs
 */
import assert from 'node:assert';
import crypto from 'node:crypto';

process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
process.env.COLLABORATE_ENABLE_FIXTURES = 'true';
process.env.TATHASTU_INTEGRATION_MODE = 'live';
process.env.AIT_CLIENT_SECRET = 'test_only_client_secret_not_real';
process.env.AIT_REDIRECT_URI = 'https://collaborate.aitathastu.com/api/auth/tathastu/callback';
process.env.AI_TATHASTU_CLIENT_ID = 'collaborate';
process.env.AI_TATHASTU_BASE_URL = 'https://www.aitathastu.com';
const SECRET = 'phase5_webhook_secret';
process.env.AI_TATHASTU_WEBHOOK_SECRET = SECRET;

const { buildServer } = await import('../apps/api/src/server.ts');
const { durableDb } = await import('../src/lib/db/index.ts');
const { IdentityService } = await import('../src/modules/identity/service.ts');
const { projectionV1 } = await import('./helpers/projection-v1.mjs');

const app = buildServer();
const run = crypto.randomBytes(3).toString('hex');
let passed = 0, total = 0;
async function test(name, fn) {
  total++;
  try { await fn(); passed++; console.log(`  [PASS] ${name}`); }
  catch (e) { console.log(`  [FAIL] ${name}\n         ${e.stack?.split('\n').slice(0, 3).join('\n         ')}`); }
}
const sign = (raw, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex')}`;
async function deliverRaw(body, signature) {
  const raw = JSON.stringify(body);
  const res = await app.inject({ method: 'POST', url: '/api/webhooks/tathastu', headers: { 'content-type': 'application/json', 'x-ait-signature': signature ?? sign(raw) }, payload: raw });
  return { status: res.statusCode, json: JSON.parse(res.body) };
}
const provision = (sub, email, reason = 'auto_provision') => ({
  id: `d_${crypto.randomUUID()}`, type: 'profile.updated', createdAt: new Date().toISOString(),
  data: { userId: sub, reason, profile: projectionV1({ sub, email, name: 'Sync Person', skills: [{ name: 'Rust' }] }) },
});
const revoke = (sub, reason) => ({ id: `d_${crypto.randomUUID()}`, type: 'integration.revoked', createdAt: new Date().toISOString(), data: { userId: sub, reason } });
const subFor = (k) => `ait_${k}_${run}`;
const emailFor = (k) => `${k}_${run}@synthetic.invalid`;

console.log('\n=== Phase 5: sync lifecycle (outcomes, deletion, conflicts) ===\n');

let erasedId;
await test('auto_provision reports outcome "created" (not just HTTP 200)', async () => {
  const r = await deliverRaw(provision(subFor('a'), emailFor('a')));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.result.outcome, 'created', JSON.stringify(r.json));
  erasedId = r.json.result.memberId;
});

await test('A second provision for the same subject updates the same profile (no duplicate)', async () => {
  const before = durableDb.getAllMembers().filter((m) => m.email === emailFor('a')).length;
  const r = await deliverRaw(provision(subFor('a'), emailFor('a')));
  assert.strictEqual(r.json.result.outcome, 'updated', JSON.stringify(r.json));
  assert.strictEqual(r.json.result.memberId, erasedId);
  assert.strictEqual(durableDb.getAllMembers().filter((m) => m.email === emailFor('a')).length, before);
});

await test('An ordinary update reports "updated"', async () => {
  const r = await deliverRaw(provision(subFor('a'), emailFor('a'), 'profile_recomputed'));
  assert.strictEqual(r.json.result.outcome, 'updated', JSON.stringify(r.json));
});

await test('account_deleted ERASES an unadopted automatic profile: member, mapping, connections, messages', async () => {
  const { member: other } = await IdentityService.registerStandalone(`peer_${run}@x.test`, 'password-1234', 'Peer');
  durableDb.sendConnectionRequest(other.id, erasedId, 'hi');
  const r = await deliverRaw(revoke(subFor('a'), 'account_deleted'));
  assert.strictEqual(r.json.result.outcome, 'deleted', JSON.stringify(r.json));
  assert.strictEqual(durableDb.getMemberById(erasedId), null, 'member erased');
  assert.strictEqual(durableDb.getMappingByExternalSub('aitathastu_oidc', subFor('a')), null, 'mapping erased');
  assert.strictEqual(durableDb.getMemberByEmail(emailFor('a')), null, 'email no longer held');
  assert.ok(!durableDb.getAllConnections().some((c) => c.requesterId === erasedId || c.recipientId === erasedId), 'connections erased');
  assert.ok(durableDb.getMemberById(other.id), 'the other member is untouched');
});

await test('Re-registration after deletion (new AI Tathastu id, same email) creates a fresh profile', async () => {
  const r = await deliverRaw(provision(subFor('a2'), emailFor('a')));
  assert.strictEqual(r.json.result.outcome, 'created', JSON.stringify(r.json));
  assert.notStrictEqual(r.json.result.memberId, erasedId);
});

await test('A late revocation for the erased subject is harmless ("ignored")', async () => {
  const r = await deliverRaw(revoke(subFor('a'), 'account_deleted'));
  assert.strictEqual(r.json.result.outcome, 'ignored', JSON.stringify(r.json));
});

await test('account_deleted keeps an ADOPTED automatic profile (has a password) but removes imports and link', async () => {
  const r = await deliverRaw(provision(subFor('b'), emailFor('b')));
  const id = r.json.result.memberId;
  durableDb.setCredential(id, 'hash', 'salt');
  const d = await deliverRaw(revoke(subFor('b'), 'account_deleted'));
  assert.strictEqual(d.json.result.outcome, 'unlinked', JSON.stringify(d.json));
  const m = durableDb.getMemberById(id);
  assert.ok(m, 'kept: the person owns it on Collaborate');
  assert.strictEqual(m.tathastu_user_id, undefined);
  assert.strictEqual(m.importedProfile, null);
});

await test('A leftover UNUSED shell (user disconnected earlier) is reclaimed instead of blocking provisioning', async () => {
  const r = await deliverRaw(provision(subFor('c'), emailFor('c')));
  const shellId = r.json.result.memberId;
  await deliverRaw(revoke(subFor('c'), 'user_disconnected'));
  assert.ok(durableDb.getMemberById(shellId), 'disconnect keeps the shell');
  const again = await deliverRaw(provision(subFor('c2'), emailFor('c')));
  assert.strictEqual(again.json.result.outcome, 'created', JSON.stringify(again.json));
  assert.strictEqual(durableDb.getMemberById(shellId), null, 'unused shell erased');
  assert.strictEqual(durableDb.getAllMembers().filter((m) => m.email === emailFor('c')).length, 1, 'exactly one profile');
});

await test('A shell WITH activity and no password is a "conflict" for review (never erased, never merged)', async () => {
  const r = await deliverRaw(provision(subFor('d'), emailFor('d')));
  const shellId = r.json.result.memberId;
  await deliverRaw(revoke(subFor('d'), 'user_disconnected'));
  const { member: friend } = await IdentityService.registerStandalone(`friend_${run}@x.test`, 'password-1234', 'Friend');
  durableDb.sendConnectionRequest(friend.id, shellId, 'hello');
  const again = await deliverRaw(provision(subFor('d2'), emailFor('d')));
  assert.strictEqual(again.json.result.outcome, 'conflict', JSON.stringify(again.json));
  assert.strictEqual(again.json.result.action, 'CONFLICT_NEEDS_REVIEW');
  assert.ok(durableDb.getMemberById(shellId), 'kept');
  assert.strictEqual(durableDb.getMappingByExternalSub('aitathastu_oidc', subFor('d2')), null, 'not linked by email');
});

await test('A native Collaborate account with this email is a "conflict" the owner can self-link; its data is untouched', async () => {
  const { member: native } = await IdentityService.registerStandalone(emailFor('e'), 'password-1234', 'Native Person');
  const before = JSON.stringify(durableDb.getMemberById(native.id));
  const r = await deliverRaw(provision(subFor('e'), emailFor('e')));
  assert.strictEqual(r.json.result.outcome, 'conflict', JSON.stringify(r.json));
  assert.strictEqual(r.json.result.action, 'CONFLICT_EXISTING_ACCOUNT');
  assert.strictEqual(JSON.stringify(durableDb.getMemberById(native.id)), before, 'native account unchanged');
  assert.strictEqual(durableDb.getAllMembers().filter((m) => m.email === emailFor('e')).length, 1, 'no duplicate');
});

await test('An ordinary update for an unknown subject is "ignored" (never creates a profile)', async () => {
  const r = await deliverRaw(provision(subFor('f'), emailFor('f'), 'profile_recomputed'));
  assert.strictEqual(r.json.result.outcome, 'ignored', JSON.stringify(r.json));
  assert.strictEqual(durableDb.getMemberByEmail(emailFor('f')), null);
});

await test('Replay: a signature older than 5 minutes is rejected', async () => {
  const body = provision(subFor('g'), emailFor('g'));
  const r = await deliverRaw(body, sign(JSON.stringify(body), Math.floor(Date.now() / 1000) - 600));
  assert.strictEqual(r.status, 401);
  assert.strictEqual(durableDb.getMemberByEmail(emailFor('g')), null);
});

await test('A bad signature is rejected', async () => {
  const r = await deliverRaw(provision(subFor('h'), emailFor('h')), 't=1,v1=deadbeef');
  assert.strictEqual(r.status, 401);
});

await test('The same delivery id twice is acknowledged once (duplicate protection)', async () => {
  const body = provision(subFor('i'), emailFor('i'));
  const first = await deliverRaw(body);
  const second = await deliverRaw(body);
  assert.strictEqual(first.json.result.outcome, 'created');
  assert.strictEqual(second.json.result.action, 'DUPLICATE_ACKNOWLEDGED');
  assert.strictEqual(durableDb.getAllMembers().filter((m) => m.email === emailFor('i')).length, 1);
});

// ── "Show me in Collaborate discovery" (privacy.scopes.discovery from AI Tathastu) ─────────────────────────
const withDiscovery = (sub, email, on, reason = 'auto_provision') => {
  const e = provision(sub, email, reason);
  e.data.profile.privacy.scopes.discovery = on;
  return e;
};
const { isVisibleInDiscovery } = await import('../src/modules/profile/public-member.ts');
const { member: viewer } = await IdentityService.registerStandalone(`viewer5_${run}@gmail.com`, 'password-1234', 'Viewer');

await test('discovery ON from AI Tathastu: new profile is discoverable and public, contact details stay hidden', async () => {
  const r = await deliverRaw(withDiscovery(subFor('dv1'), `dv1_${run}@gmail.com`, true));
  assert.strictEqual(r.json.result.outcome, 'created', JSON.stringify(r.json));
  const m = durableDb.getMemberById(r.json.result.memberId);
  assert.strictEqual(m.discoverable, true);
  assert.strictEqual(m.profileVisibility, 'public');
  assert.strictEqual(m.contactVisibility, 'connections_only');
  assert.strictEqual(m.discoverySetByTathastu, true);
  assert.strictEqual(isVisibleInDiscovery(m, viewer, false), true, 'appears to other members');
});

await test('discovery absent/OFF (existing users): profile stays private and hidden', async () => {
  const r = await deliverRaw(withDiscovery(subFor('dv2'), `dv2_${run}@gmail.com`, false));
  const m = durableDb.getMemberById(r.json.result.memberId);
  assert.strictEqual(m.discoverable, false);
  assert.strictEqual(m.profileVisibility, 'private');
  assert.strictEqual(isVisibleInDiscovery(m, viewer, false), false);
});

await test('turning discovery OFF on AI Tathastu later hides the profile again', async () => {
  const r = await deliverRaw(withDiscovery(subFor('dv1'), `dv1_${run}@gmail.com`, false, 'consent_changed'));
  assert.strictEqual(r.json.result.outcome, 'updated', JSON.stringify(r.json));
  const m = durableDb.getMemberById(r.json.result.memberId);
  assert.strictEqual(m.discoverable, false);
  assert.strictEqual(m.profileVisibility, 'private');
  assert.strictEqual(isVisibleInDiscovery(m, viewer, false), false);
});

await test('a privacy choice made in Collaborate wins over AI Tathastu from then on', async () => {
  const r = await deliverRaw(withDiscovery(subFor('dv3'), `dv3_${run}@gmail.com`, true));
  const id = r.json.result.memberId;
  // The member hides themselves in Collaborate.
  const m = durableDb.getMemberById(id);
  await durableDb.saveMemberAsync({ ...m, discoverable: false, profileVisibility: 'private', discoveryChoiceMade: true, privacyChoiceMade: true, discoverySetByTathastu: false });
  await deliverRaw(withDiscovery(subFor('dv3'), `dv3_${run}@gmail.com`, true, 'profile_recomputed'));
  const after = durableDb.getMemberById(id);
  assert.strictEqual(after.discoverable, false, 'their own choice is kept');
  assert.strictEqual(after.profileVisibility, 'private');
});

await test('unlinking withdraws discovery that only came from AI Tathastu', async () => {
  const r = await deliverRaw(withDiscovery(subFor('dv4'), `dv4_${run}@gmail.com`, true));
  const id = r.json.result.memberId;
  durableDb.setCredential(id, 'hash', 'salt'); // adopted, so revocation keeps the account
  await deliverRaw(revoke(subFor('dv4'), 'user_disconnected'));
  const m = durableDb.getMemberById(id);
  assert.strictEqual(m.discoverable, false);
  assert.strictEqual(m.profileVisibility, 'private');
});

await test('members cannot set the discovery bookkeeping fields through the profile API', async () => {
  const { token, member } = await IdentityService.registerStandalone(`self_${run}@gmail.com`, 'password-1234', 'Self');
  await app.inject({ method: 'PUT', url: '/api/profiles', headers: { authorization: `Bearer ${token}` }, payload: { discoverySetByTathastu: true, headline: 'x' } });
  assert.notStrictEqual(durableDb.getMemberById(member.id).discoverySetByTathastu, true);
});

console.log(`\n${passed}/${total} passed\n`);
process.exit(passed === total ? 0 : 1);
