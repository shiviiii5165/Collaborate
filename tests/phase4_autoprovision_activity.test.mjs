/**
 * Phase 4: automatic private profiles from AI Tathastu, imported GitHub activity, and activity as
 * intelligence evidence. Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/phase4_autoprovision_activity.test.mjs
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
const SECRET = 'phase4_webhook_secret';
process.env.AI_TATHASTU_WEBHOOK_SECRET = SECRET;

const { buildServer } = await import('../apps/api/src/server.ts');
const { durableDb } = await import('../src/lib/db/index.ts');
const { TathastuSsoService } = await import('../src/modules/identity/tathastu-sso.ts');
const { IdentityService } = await import('../src/modules/identity/service.ts');
const { getProfileIntelligence } = await import('../src/modules/intelligence/profile-intelligence.ts');
const { projectionV1 } = await import('./helpers/projection-v1.mjs');

const app = buildServer();
const run = crypto.randomBytes(3).toString('hex');
let passed = 0, total = 0;
async function test(name, fn) {
  total++;
  try { await fn(); passed++; console.log(`  [PASS] ${name}`); }
  catch (e) { console.log(`  [FAIL] ${name}\n         ${e.stack?.split('\n').slice(0, 3).join('\n         ')}`); }
}
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
async function deliver(body) {
  const raw = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const res = await app.inject({ method: 'POST', url: '/api/webhooks/tathastu', headers: { 'content-type': 'application/json', 'x-ait-signature': `t=${t},v1=${crypto.createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex')}` }, payload: raw });
  return { status: res.statusCode, json: JSON.parse(res.body) };
}
const event = (sub, email, args, reason = 'auto_provision') => ({
  id: `d_${crypto.randomUUID()}`, type: 'profile.updated', createdAt: new Date().toISOString(),
  data: { userId: sub, reason, profile: projectionV1({ sub, email, ...args }) },
});
const fullArgs = (name) => ({
  name,
  headline: 'ML engineer',
  skills: [{ name: 'TypeScript', verified: true }, { name: 'PyTorch' }],
  projects: [{ key: 'p1', title: 'Realtime Vision', technologies: ['PyTorch', 'CUDA'] }],
  activity: { repositories: 12, recent: [
    { name: 'vision-lab', url: 'https://github.com/x/vision-lab', languages: ['Python', 'CUDA'], lastCommitAt: daysAgo(3) },
    { name: 'web-dash', url: 'https://github.com/x/web-dash', languages: ['TypeScript'], lastCommitAt: daysAgo(20) },
    { name: 'old-thing', languages: ['Go'], lastCommitAt: daysAgo(400) },
  ] },
});

console.log('\n=== Phase 4: auto-provisioned private profiles + activity ===\n');

const sub = `urn:ait:auto_${run}`;
const email = `auto_${run}@synthetic.invalid`;
let memberId;

await test('auto_provision creates a PRIVATE, non-discoverable profile with the imported data', async () => {
  const r = await deliver(event(sub, email, fullArgs('Auto Person')));
  assert.strictEqual(r.json.result.action, 'AUTO_PROVISIONED_PRIVATE', JSON.stringify(r.json));
  memberId = r.json.result.memberId;
  const m = durableDb.getMemberById(memberId);
  assert.strictEqual(m.discoverable, false);
  assert.strictEqual(m.profileVisibility, 'private');
  assert.strictEqual(m.autoProvisioned, true);
  assert.strictEqual(m.isVerified, false);
  assert.ok(m.skills.includes('TypeScript') && m.projects.some((p) => p.title === 'Realtime Vision'));
  assert.ok(durableDb.getMappingByExternalSub('aitathastu_oidc', sub), 'identity mapping created');
});

await test('GitHub activity becomes recent activity (newest first, imported, fresh time labels)', async () => {
  const m = durableDb.getMemberById(memberId);
  const gh = m.recentActivity.filter((a) => a.sourceOrigin === 'tathastu_core');
  assert.strictEqual(gh.length, 3);
  // Repository-level update date: never worded as the member's own commit (2026-11 provenance fix).
  assert.ok(gh[0].title.startsWith('Repository vision-lab updated'));
  assert.ok(!/committed/i.test(gh[0].title));
  assert.ok(gh[0].timeAgo.includes('day'));
  assert.ok(gh[0].url === 'https://github.com/x/vision-lab');
});

await test('Activity is used as intelligence evidence (not a verified fact)', async () => {
  const intel = getProfileIntelligence(durableDb.getMemberById(memberId));
  assert.strictEqual(intel.activity.activeLast90Days, true);
  assert.ok(intel.activity.languages.includes('TypeScript'));
  assert.ok(!intel.activity.languages.includes('Go'), 'old repos are not "recent"');
  const ts = intel.skills.find((s) => s.canonical === 'typescript');
  assert.ok(ts.evidence.some((e) => e.includes('Recent GitHub work') && e.includes('web-dash')));
});

await test('A private auto profile is invisible in discovery, search, recommendations and by id', async () => {
  const { token } = await IdentityService.registerStandalone(`viewer_${run}@x.test`, 'password-1234', 'Viewer');
  const h = { authorization: `Bearer ${token}` };
  const d = await app.inject({ method: 'GET', url: `/api/discover?q=Auto`, headers: h });
  assert.ok(!d.body.includes(memberId));
  const rec = await app.inject({ method: 'GET', url: '/api/recommendations?limit=20', headers: h });
  assert.ok(!rec.body.includes(memberId));
  const byId = await app.inject({ method: 'GET', url: `/api/profiles?id=${memberId}`, headers: h });
  assert.strictEqual(byId.statusCode, 403);
});

await test('Signing in with AI Tathastu lands on the same profile (no duplicate)', async () => {
  const { member } = await TathastuSsoService.processCallback({ code: `c_${run}`, codeVerifier: 'v', state: 's', claimsOverride: { sub, email, fullName: 'Auto Person' } });
  assert.strictEqual(member.id, memberId);
});

await test('Turning discovery on publishes the profile (opt-in)', async () => {
  const s = await TathastuSsoService.processCallback({ code: `c2_${run}`, codeVerifier: 'v', state: 's', claimsOverride: { sub, email, fullName: 'Auto Person' } });
  const r = await app.inject({ method: 'PUT', url: '/api/profiles', headers: { authorization: `Bearer ${s.token}` }, payload: { discoverable: true } });
  assert.strictEqual(r.statusCode, 200);
  const m = durableDb.getMemberById(memberId);
  assert.strictEqual(m.discoverable, true);
  assert.strictEqual(m.profileVisibility, 'public');
});

await test('An ordinary update for an unknown subject never creates a profile', async () => {
  const other = `urn:ait:ordinary_${run}`;
  const r = await deliver(event(other, `ord_${run}@synthetic.invalid`, fullArgs('X'), 'profile_recomputed'));
  assert.strictEqual(r.json.result.action, 'IGNORED_UNKNOWN_USER');
  assert.strictEqual(durableDb.getMappingByExternalSub('aitathastu_oidc', other), null);
});

await test('Never merges with an existing account that uses the same email', async () => {
  const shared = `shared_${run}@synthetic.invalid`;
  const { member: existing } = await IdentityService.registerStandalone(shared, 'password-1234', 'Existing');
  const r = await deliver(event(`urn:ait:shared_${run}`, shared, fullArgs('Imposter')));
  assert.strictEqual(r.json.result.action, 'IGNORED_EMAIL_BELONGS_TO_EXISTING_ACCOUNT');
  assert.strictEqual(durableDb.getMemberById(existing.id).tathastu_user_id, undefined);
});

await test('After disconnecting in Collaborate, a (late) auto_provision cannot recreate the profile', async () => {
  const s = await TathastuSsoService.processCallback({ code: `c3_${run}`, codeVerifier: 'v', state: 's', claimsOverride: { sub, email, fullName: 'Auto Person' } });
  const res = await app.inject({ method: 'POST', url: '/api/federation', headers: { authorization: `Bearer ${s.token}` }, payload: { action: 'revoke_link' } });
  assert.strictEqual(res.statusCode, 200);
  const m = durableDb.getMemberById(memberId);
  assert.ok(!m.recentActivity.some((a) => a.sourceOrigin === 'tathastu_core'), 'imported activity removed on disconnect');
  const r = await deliver(event(sub, email, fullArgs('Auto Person')));
  assert.strictEqual(r.json.result.action, 'IGNORED_PREVIOUSLY_DISCONNECTED');
});

await test('Withdrawing the activity scope removes imported activity only', async () => {
  const s2 = `urn:ait:act_${run}`;
  const e2 = `act_${run}@synthetic.invalid`;
  const r = await deliver(event(s2, e2, fullArgs('Act Person')));
  const id = r.json.result.memberId;
  const m = durableDb.getMemberById(id);
  m.recentActivity.push({ id: 'local1', type: 'project', title: 'Local note', timeAgo: '' });
  await durableDb.saveMemberAsync(m);
  const upd = event(s2, e2, { name: 'Act Person', skills: [{ name: 'TypeScript' }] }, 'profile_recomputed');
  const r2 = await deliver(upd);
  assert.strictEqual(r2.json.result.action, 'PROFILE_UPDATED');
  const after = durableDb.getMemberById(id);
  assert.ok(!after.recentActivity.some((a) => a.sourceOrigin === 'tathastu_core'));
  assert.ok(after.recentActivity.some((a) => a.id === 'local1'), 'local activity kept');
});

console.log(`\n=== ${passed}/${total} passed ===`);
if (passed !== total) process.exit(1);
