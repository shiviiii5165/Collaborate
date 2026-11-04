/**
 * Phase 3 regression suite: profile intelligence, explainable matching, discovery categories,
 * project collaborators, recommendation preferences, assistant honesty and password rate limits.
 * Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/phase3_intelligence_matching.test.mjs
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
process.env.AI_TATHASTU_WEBHOOK_SECRET = 'phase3_secret';

const { buildServer } = await import('../apps/api/src/server.ts');
const { durableDb } = await import('../src/lib/db/index.ts');
const { TathastuSsoService } = await import('../src/modules/identity/tathastu-sso.ts');
const { IdentityService } = await import('../src/modules/identity/service.ts');
const { getProfileIntelligence, buildProfileIntelligence } = await import('../src/modules/intelligence/profile-intelligence.ts');
const { normalizeSkill } = await import('../src/modules/intelligence/skills.ts');
const { recommend } = await import('../src/modules/intelligence/matching.ts');
const { matchContext } = await import('../src/lib/recommendations.ts');
const { projectionV1 } = await import('./helpers/projection-v1.mjs');

const app = buildServer();
const run = crypto.randomBytes(3).toString('hex');
let passed = 0;
let total = 0;
async function test(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.log(`  [FAIL] ${name}\n         ${err.stack?.split('\n').slice(0, 3).join('\n         ')}`);
  }
}
let seq = 0;
async function indie(label, extra = {}) {
  const { member, token } = await IdentityService.registerStandalone(`${label}_${run}_${++seq}@x.test`, 'password-1234', `Indie ${label}`);
  Object.assign(member, extra);
  const { applyLocalProfileEdit } = await import('../src/modules/profile/ownership.ts');
  if (extra.skills || extra.projects) applyLocalProfileEdit(member, { skills: extra.skills, projects: extra.projects });
  await durableDb.saveMemberAsync(member);
  return { member, token };
}
async function linked(label, args, extra = {}) {
  const sub = `urn:p3:${label}_${run}_${++seq}`;
  const email = `${label}_${run}_${seq}@l.test`;
  const { member, token } = await TathastuSsoService.processCallback({
    code: `c_${sub}`, codeVerifier: 'v', state: 's',
    claimsOverride: { sub, email, fullName: `Linked ${label}`, profile: projectionV1({ sub, email, ...args }) },
  });
  Object.assign(member, { discoverable: true, ...extra });
  await durableDb.saveMemberAsync(member);
  return { member, token, sub, email };
}
const get = async (url, token) => {
  const r = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  return { status: r.statusCode, json: JSON.parse(r.body), body: r.body };
};

console.log('\n=== Phase 3: intelligence, matching, discovery ===\n');

await test('Skill normalization maps aliases deterministically', () => {
  assert.strictEqual(normalizeSkill('React.js'), 'react');
  assert.strictEqual(normalizeSkill('Golang'), 'go');
  assert.strictEqual(normalizeSkill('  PostgreSQL '), 'postgres');
  assert.strictEqual(normalizeSkill('Machine Learning'), 'ml');
});

const verifiedDev = await linked('verified', {
  skills: [{ name: 'PyTorch', verified: true }, { name: 'Python' }],
  projects: [{ key: 'p1', title: 'Vision Lab', technologies: ['PyTorch', 'CUDA'] }],
}, { collaborationInterests: ['open source', 'mentorship'] });

await test('Intelligence keeps provenance and evidence for every skill, and derives domains only from evidence', () => {
  const intel = buildProfileIntelligence(durableDb.getMemberById(verifiedDev.member.id));
  const torch = intel.skills.find((s) => s.canonical === 'pytorch');
  assert.strictEqual(torch.provenance, 'ai_tathastu_verified');
  assert.ok(torch.evidence.includes('Verified on AI Tathastu'));
  assert.ok(torch.evidence.some((e) => e.includes('Vision Lab')));
  assert.strictEqual(torch.confidence, 'high');
  const py = intel.skills.find((s) => s.canonical === 'python');
  assert.strictEqual(py.provenance, 'ai_tathastu');
  const ai = intel.domains.find((d) => d.domain === 'AI / Machine Learning');
  assert.ok(ai && ai.provenance === 'derived' && ai.evidence.length >= 1);
  assert.ok(intel.completeness.missing.includes('experience'));
  for (const s of intel.skills) assert.ok(s.evidence.length > 0, 'every skill has evidence');
});

await test('Intelligence is cached by source hash and invalidated when imported data is revoked', async () => {
  const m = durableDb.getMemberById(verifiedDev.member.id);
  const a = getProfileIntelligence(m);
  assert.strictEqual(getProfileIntelligence(m), a, 'unchanged profile is not reprocessed');
  const copy = structuredClone(m);
  TathastuSsoService.unlinkAndPurge(copy);
  const b = getProfileIntelligence(copy);
  assert.notStrictEqual(b.sourceHash, a.sourceHash);
  assert.ok(!b.skills.some((s) => s.provenance.startsWith('ai_tathastu')), 'no insight survives revocation');
});

const viewer = await indie('viewer', {
  skills: ['Python', 'React'],
  projects: [{ title: 'Study Buddy', description: '', tags: ['Python', 'PyTorch', 'Postgres'] }],
  collaborationInterests: ['open source', 'mentorship'],
});
const dbPerson = await indie('dba', { skills: ['Postgres', 'SQL'], collaborationInterests: ['open source'] });
const unrelated = await indie('unrelated', { skills: ['Watercolor'] });
const sparse = await indie('sparse', { collaborationInterests: ['open source'] });

await test('Explanations cite only real evidence; complementary skills are found beyond shared keywords', () => {
  const recs = recommend(viewer.member.id, matchContext(), { limit: 50 });
  const v = recs.find((r) => r.member.id === verifiedDev.member.id);
  assert.ok(v, 'verified dev recommended');
  assert.ok(v.explanation.sharedSkills.includes('Python'));
  assert.ok(v.explanation.complementarySkills.includes('PyTorch'), 'PyTorch: used in viewer project, not in viewer skills');
  assert.ok(v.categories.includes('complementary_expertise') && v.categories.includes('project_collaborators'));
  for (const d of v.explanation.dimensions) for (const e of d.evidence) assert.ok(typeof e === 'string' && e.length > 0);
  assert.strictEqual(v.explanation.scoreMeaning, 'relative ranking within your results, not a probability');
  const d = recs.find((r) => r.member.id === dbPerson.member.id);
  assert.ok(d && d.explanation.complementarySkills.includes('Postgres'));
});

await test('Sparse/independent profiles are not penalized for missing data; uncertainty is reported instead', () => {
  const recs = recommend(viewer.member.id, matchContext(), { limit: 50 });
  const s = recs.find((r) => r.member.id === sparse.member.id);
  assert.ok(s, 'sparse profile with a shared interest still participates');
  assert.ok(s.score > 0);
  assert.ok(s.explanation.unknowns.some((u) => /skills/.test(u)));
  assert.strictEqual(s.explanation.confidence, 'low');
  assert.ok(!recs.some((r) => r.member.id === unrelated.member.id && r.score > 0), 'no fabricated relevance');
});

await test('Cold start: an empty profile gets honest general suggestions', async () => {
  const empty = await indie('empty');
  const recs = recommend(empty.member.id, matchContext(), { limit: 5 });
  assert.ok(recs.length > 0);
  for (const r of recs) {
    assert.strictEqual(r.explanation.confidence, 'low');
    assert.ok(r.explanation.unknowns.includes('Your own profile is empty'));
  }
});

await test('Categories are evidence-gated: mentors and co-founders only by explicit intent', async () => {
  const mentors = recommend(viewer.member.id, matchContext(), { category: 'mentors', limit: 20 }).map((r) => r.member.id);
  assert.ok(mentors.includes(verifiedDev.member.id), 'member stating mentorship');
  assert.ok(!mentors.includes(dbPerson.member.id));
  const cof = recommend(viewer.member.id, matchContext(), { category: 'cofounders', limit: 20 });
  assert.strictEqual(cof.length, 0, 'nobody stated co-founder intent');
});

await test('GET /api/recommendations: category validation, public serialization, explanation attached', async () => {
  assert.strictEqual((await get('/api/recommendations?category=bogus', viewer.token)).status, 400);
  const r = await get('/api/recommendations?category=complementary_expertise', viewer.token);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.recommendations.length > 0);
  for (const rec of r.json.recommendations) {
    assert.ok(!('email' in rec.member) && !('importedProfile' in rec.member) && !('localProfile' in rec.member));
    assert.ok(rec.explanation.summary && Array.isArray(rec.explanation.dimensions));
  }
  assert.ok(!r.body.includes('@l.test') && !r.body.includes('@x.test'));
});

await test('Privacy filters run before ranking: blocked, hidden and opted-out members are never recommended', async () => {
  durableDb.blockMember(dbPerson.member.id, viewer.member.id);
  const vd = durableDb.getMemberById(verifiedDev.member.id);
  vd.recommendationPreferences = { hideFromRecommendations: true };
  await durableDb.saveMemberAsync(vd);
  const ids = recommend(viewer.member.id, matchContext(), { limit: 50 }).map((r) => r.member.id);
  assert.ok(!ids.includes(dbPerson.member.id), 'blocked');
  assert.ok(!ids.includes(verifiedDev.member.id), 'opted out');
  vd.recommendationPreferences = {};
  await durableDb.saveMemberAsync(vd);
  durableDb.unblockMember(dbPerson.member.id, viewer.member.id);
});

await test('Preferences endpoint: dismiss a member, validate input', async () => {
  const bad = await app.inject({ method: 'POST', url: '/api/recommendations/preferences', headers: { authorization: `Bearer ${viewer.token}` }, payload: { hideFromRecommendations: 'yes' } });
  assert.strictEqual(bad.statusCode, 400);
  const ok = await app.inject({ method: 'POST', url: '/api/recommendations/preferences', headers: { authorization: `Bearer ${viewer.token}` }, payload: { dismissMemberId: sparse.member.id } });
  assert.strictEqual(ok.statusCode, 200);
  assert.ok(!recommend(viewer.member.id, matchContext(), { limit: 50 }).some((r) => r.member.id === sparse.member.id));
  const put = await app.inject({ method: 'PUT', url: '/api/profiles', headers: { authorization: `Bearer ${viewer.token}` }, payload: { recommendationPreferences: { dismissedMemberIds: [] } } });
  assert.strictEqual(put.statusCode, 200);
  assert.ok(durableDb.getMemberById(viewer.member.id).recommendationPreferences.dismissedMemberIds.includes(sparse.member.id), 'protected from raw profile edits');
});

await test('Project collaborators: own project only, gaps first, evidence attached, nobody added', async () => {
  const project = durableDb.getMemberById(viewer.member.id).projects.find((p) => p.title === 'Study Buddy');
  const r = await get(`/api/projects/collaborators?projectId=${encodeURIComponent(project.id)}`, viewer.token);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.missingCapabilities.sort(), ['Postgres', 'PyTorch'].sort());
  const top = r.json.candidates[0];
  assert.ok(top.covers.some((c) => ['PyTorch', 'Postgres'].includes(c)));
  assert.ok(top.evidence.length > 0 && !('email' in top.member));
  const otherProject = durableDb.getMemberById(verifiedDev.member.id).projects[0];
  assert.strictEqual((await get(`/api/projects/collaborators?projectId=${encodeURIComponent(otherProject.id)}`, viewer.token)).status, 404, "cannot query someone else's project");
  assert.ok(!durableDb.getMemberById(viewer.member.id).projects.some((p) => p.title === otherProject.title), 'nothing added');
});

await test('/api/intelligence/me returns only the session member\'s own intelligence', async () => {
  const r = await get('/api/intelligence/me', viewer.token);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.intelligence.memberId, viewer.member.id);
  assert.strictEqual((await app.inject({ method: 'GET', url: '/api/intelligence/me' })).statusCode, 401);
});

await test('Assistant (/api/eora) uses only real data: no invented people, statistics or levels', async () => {
  const realNames = new Set(durableDb.getAllMembers().map((m) => m.fullName));
  const knownSeedNames = ['Aman Verma', 'Rahul Sharma', 'Priya Mehta', 'Neha Kapoor'];
  for (const prompt of ['find collaborators', 'review my profile', 'internship', 'roadmap', 'hello']) {
    const r = await app.inject({ method: 'POST', url: '/api/eora', headers: { authorization: `Bearer ${viewer.token}` }, payload: { prompt } });
    const text = JSON.parse(r.body).reply;
    assert.ok(!/\d+% higher|Level \d of \d|have mastered|Google/.test(text), `fabricated claim for "${prompt}": ${text}`);
    // Any person named must be an actual member returned by the engine, never a hardcoded name.
    for (const n of knownSeedNames) if (text.includes(n)) assert.ok(realNames.has(n));
    assert.ok(!/^Rahul,/.test(text), 'never addresses a different person');
  }
});

await test('Matching never calls the network (AI outage cannot break networking)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network disabled'); };
  try {
    assert.strictEqual((await get('/api/discover', viewer.token)).status, 200);
    assert.strictEqual((await get('/api/recommendations', viewer.token)).status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('Password endpoints are rate limited (429 with Retry-After)', async () => {
  const email = `brute_${run}@x.test`;
  let last;
  for (let i = 0; i < 11; i++) {
    last = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '203.0.113.7', payload: { email, password: 'wrong-password' } });
  }
  assert.strictEqual(last.statusCode, 429);
  assert.ok(Number(last.headers['retry-after']) > 0);
  const other = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '198.51.100.9', payload: { email, password: 'wrong-password' } });
  assert.strictEqual(other.statusCode, 401, 'other clients are unaffected');
});

console.log(`\n=== ${passed}/${total} passed ===`);
if (passed !== total) process.exit(1);
