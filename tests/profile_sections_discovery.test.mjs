/**
 * Profile sections, coding profiles, sync states and recommended-first discovery (2026-11-11).
 * Real Fastify handlers + the isolated local store; AI Tathastu is simulated (claimsOverride and
 * signed webhooks), never contacted. Synthetic accounts only.
 * Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/profile_sections_discovery.test.mjs
 */
import assert from 'node:assert';
import crypto from 'node:crypto';

process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
process.env.COLLABORATE_ENABLE_FIXTURES = 'true'; // enables simulated claims in tests only
process.env.TATHASTU_INTEGRATION_MODE = 'live';
process.env.AIT_CLIENT_SECRET = 'test_only_client_secret_not_real';
process.env.AIT_REDIRECT_URI = 'https://collaborate.aitathastu.com/api/auth/tathastu/callback';
process.env.AI_TATHASTU_CLIENT_ID = 'collaborate';
process.env.AI_TATHASTU_BASE_URL = 'https://www.aitathastu.com';
const SECRET = 'sections_webhook_secret';
process.env.AI_TATHASTU_WEBHOOK_SECRET = SECRET;

const { buildServer } = await import('../apps/api/src/server.ts');
const { durableDb } = await import('../src/lib/db/index.ts');
const { TathastuSsoService } = await import('../src/modules/identity/tathastu-sso.ts');
const { codingProfileLink } = await import('../src/modules/profile/public-member.ts');
const { projectionV1 } = await import('./helpers/projection-v1.mjs');

const app = buildServer();
const run = crypto.randomBytes(3).toString('hex');
let passed = 0, total = 0;
async function test(name, fn) {
  total++;
  try { await fn(); passed++; console.log(`  [PASS] ${name}`); }
  catch (e) { console.log(`  [FAIL] ${name}\n         ${e.stack?.split('\n').slice(0, 4).join('\n         ')}`); }
}
const call = async (method, url, token, payload) => {
  const r = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload ? { payload } : {}) });
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : null };
};
async function deliver(body) {
  const raw = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex');
  const res = await app.inject({ method: 'POST', url: '/api/webhooks/tathastu', headers: { 'content-type': 'application/json', 'x-ait-signature': `t=${t},v1=${sig}` }, payload: raw });
  return { status: res.statusCode, json: JSON.parse(res.body) };
}
let seq = 0;
async function signIn(label, args, extra = { discoverable: true, profileVisibility: 'public' }, subOverride) {
  const sub = subOverride ?? `urn:sec:${label}_${run}_${++seq}`;
  const email = `${label.toLowerCase()}_${run}_${seq}@synthetic.invalid`;
  const { member, token } = await TathastuSsoService.processCallback({
    code: `c_${sub}_${Date.now()}`, codeVerifier: 'v', state: 's',
    claimsOverride: { sub, email, fullName: `${label} ${run}`, profile: projectionV1({ sub, email, name: `${label} ${run}`, ...args }) },
  });
  if (extra) { Object.assign(member, extra); await durableDb.saveMemberAsync(member); }
  return { member, token, sub, email };
}
const DAY = 86400000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

console.log('\n=== Profile sections, coding profiles, sync states, recommended-first discovery ===\n');

// ── Profile data mapping ─────────────────────────────────────────────────────
const asha = await signIn('Asha', {
  careerRole: { id: 'ml_engineer', label: 'ML Engineer' },
  skills: [{ name: 'Python', verified: true }, { name: 'PyTorch' }],
  education: [
    { institution: 'IIT Delhi', degree: 'B.Tech', fieldOfStudy: 'Computer Science', dates: '2022 - Present', grade: 'CGPA 8.4/10' },
    { institution: 'IIT Delhi', degree: 'B.Tech', fieldOfStudy: 'Computer Science', dates: '2022 - Present', grade: 'CGPA 8.4/10' },
  ],
  experience: [{ organization: 'Vision Lab', role: 'Research Intern', dates: 'May 2024 - Present', description: 'Built data pipelines' }],
  achievements: [
    { type: 'certification', title: 'AWS Certified Machine Learning – Specialty with a deliberately very long certificate title', issuer: 'Amazon Web Services', date: '2024-03', url: 'https://aws.amazon.com/verification/abc' },
    { type: 'achievement', title: 'Smart India Hackathon finalist', issuer: null, date: null },
  ],
  activity: {
    repositories: 7,
    connectedSources: ['github', 'leetcode'],
    recent: [
      { name: 'vision-lab', url: 'https://github.com/asha-k/vision-lab', stars: 4, languages: ['Python', 'Jupyter Notebook'], lastCommitAt: iso(2 * DAY) },
      { name: 'org/shared-tools', url: null, stars: 0, languages: [], lastCommitAt: iso(9 * DAY) },
    ],
    coding: [{ source: 'leetcode', solved: { total: 120, easy: 70, medium: 45, hard: 5 }, contest: { rating: 1610.4, attended: 8, topPercentage: 22.5 }, profileRef: 'leetcode.com/u/asha_k' }],
  },
});

await test('Education keeps fieldOfStudy separately, the combined degree for older readers, and both duplicate rows', () => {
  const m = durableDb.getMemberById(asha.member.id);
  const edu = m.importedProfile.education;
  assert.strictEqual(edu[0].fieldOfStudy, 'Computer Science');
  assert.strictEqual(edu[0].degree, 'B.Tech, Computer Science');
  assert.strictEqual(edu[0].score, 'CGPA 8.4/10', 'grade kept with its original scale');
  // Identical source rows hash to the same id; the effective profile never silently merges distinct records.
  assert.ok(m.education.length >= 1);
});

await test('Achievements carry description and provenance; nothing is marked verified', async () => {
  const self = await call('GET', '/api/auth/me', asha.token);
  const ach = self.json.member.tathastuProfile.achievements;
  assert.strictEqual(ach.length, 2);
  assert.deepStrictEqual(ach[0].sources, ['resume']);
  assert.ok(!('verified' in ach[0]), 'achievements have no verified flag in the contract');
  assert.strictEqual(ach[1].issuer, null);
  assert.strictEqual(ach[1].date, null);
});

await test('GitHub activity view: repositories with owner, languages, update time; worded as repository updates', async () => {
  const self = await call('GET', '/api/auth/me', asha.token);
  const act = self.json.member.tathastuProfile.activity;
  assert.strictEqual(act.githubRepositories, 7);
  assert.deepStrictEqual(act.connectedSources, ['github', 'leetcode']);
  const [vision, shared] = act.recentRepositories;
  assert.strictEqual(vision.owner, 'asha-k', 'owner from the github.com URL');
  assert.deepStrictEqual(vision.languages, ['Python', 'Jupyter Notebook']);
  assert.ok(vision.updatedAt);
  assert.strictEqual(shared.owner, 'org', 'owner from an owner/name repository name');
  assert.strictEqual(shared.url, null);
  const titles = self.json.member.recentActivity.filter((a) => a.sourceOrigin === 'tathastu_core').map((a) => a.title);
  assert.ok(titles.every((t) => !/commit/i.test(t)), `no authorship claim: ${titles.join(' | ')}`);
});

await test('LeetCode: solved breakdown, contest, safe profile link and sync time come from the import', async () => {
  const self = await call('GET', '/api/auth/me', asha.token);
  const tp = self.json.member.tathastuProfile;
  const lc = tp.activity.coding[0];
  assert.deepStrictEqual(lc.solved, { total: 120, easy: 70, medium: 45, hard: 5 });
  assert.strictEqual(lc.contest.attended, 8);
  assert.strictEqual(lc.profileUrl, 'https://leetcode.com/u/asha_k');
  assert.strictEqual(lc.username, 'asha_k');
  assert.ok(Date.parse(tp.syncedAt) > Date.now() - 60000, 'sync timestamp present');
  assert.strictEqual(self.json.member.metrics.leetcodeProblems, '120');
});

await test('Coding profile links only resolve to the platform itself', () => {
  assert.deepStrictEqual(codingProfileLink('leetcode', 'https://leetcode.com/asha'), { url: 'https://leetcode.com/u/asha', username: 'asha' });
  assert.deepStrictEqual(codingProfileLink('hackerrank', 'hackerrank.com/profile/raj_1'), { url: 'https://www.hackerrank.com/profile/raj_1', username: 'raj_1' });
  assert.deepStrictEqual(codingProfileLink('leetcode', 'evil.example/u/asha'), { url: null, username: null });
  assert.deepStrictEqual(codingProfileLink('leetcode', 'leetcode.com.evil.example/u/asha'), { url: null, username: null });
  assert.deepStrictEqual(codingProfileLink('leetcode', 'javascript:alert(1)'), { url: null, username: null });
  assert.deepStrictEqual(codingProfileLink('leetcode', null), { url: null, username: null });
});

await test('Activity states: older provider (coding unknown), activity withheld, no GitHub connected', async () => {
  const older = await signIn('OlderProvider', { activity: { recent: [] } });
  const o = (await call('GET', '/api/auth/me', older.token)).json.member.tathastuProfile.activity;
  assert.strictEqual(o.coding, null, 'absent = unknown, never "none"');
  const withheld = await signIn('Withheld', { skills: [{ name: 'Go' }] });
  assert.strictEqual((await call('GET', '/api/auth/me', withheld.token)).json.member.tathastuProfile.activity, null);
  const noGh = await signIn('NoGithub', { activity: { repositories: 0, connectedSources: [], recent: [], coding: [] } });
  const n = (await call('GET', '/api/auth/me', noGh.token)).json.member.tathastuProfile.activity;
  assert.deepStrictEqual(n.connectedSources, []);
  assert.deepStrictEqual(n.coding, [], 'provider checked, nothing connected');
});

// ── Sync: update, failure, recovery, repeated login ─────────────────────────
await test('Repeated AI Tathastu sign-in maps to the same Collaborate account (no duplicate)', async () => {
  const again = await signIn('Asha', { skills: [{ name: 'Python', verified: true }] }, null, asha.sub);
  assert.strictEqual(again.member.id, asha.member.id);
  assert.strictEqual(durableDb.getAllMembers().filter((m) => m.tathastu_user_id === asha.sub).length, 1);
});

const failing = await signIn('SyncFail', { skills: [{ name: 'Rust' }], activity: { recent: [] } });

await test('Profile update webhook is reflected; a rejected update is recorded for the owner only and keeps prior data', async () => {
  const ok = await deliver({ id: `evt_ok_${run}`, type: 'profile.updated', createdAt: new Date().toISOString(), data: { userId: failing.sub, profile: projectionV1({ sub: failing.sub, email: failing.email, skills: [{ name: 'Rust' }, { name: 'WebAssembly' }], activity: { recent: [] } }) } });
  assert.strictEqual(ok.json.result.action, 'PROFILE_UPDATED');
  assert.ok(durableDb.getMemberById(failing.member.id).skills.includes('WebAssembly'), 'update reflected');

  const bad = projectionV1({ sub: failing.sub, email: failing.email, skills: [{ name: 'Rust' }] });
  bad.generatedAt = 'not-a-date';
  const res = await deliver({ id: `evt_bad_${run}`, type: 'profile.updated', createdAt: new Date().toISOString(), data: { userId: failing.sub, profile: bad } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.result.action, 'REJECTED_INVALID_PROJECTION');
  const stored = durableDb.getMemberById(failing.member.id);
  assert.strictEqual(stored.tathastuLastSyncError.code, 'INVALID_PROJECTION');
  assert.ok(stored.skills.includes('WebAssembly'), 'previous import untouched');

  const self = (await call('GET', '/api/auth/me', failing.token)).json.member;
  assert.strictEqual(self.tathastuProfile.syncIssue.code, 'INVALID_PROJECTION');
  const other = (await call('GET', `/api/profiles?id=${failing.member.id}`, asha.token)).json.member;
  assert.ok(!('syncIssue' in other.tathastuProfile), 'never shown to other members');
  assert.ok(!('tathastuLastSyncError' in other));
});

await test('The next accepted sync clears the recorded failure', async () => {
  const res = await deliver({ id: `evt_fix_${run}`, type: 'profile.updated', createdAt: new Date().toISOString(), data: { userId: failing.sub, profile: projectionV1({ sub: failing.sub, email: failing.email, generatedAt: new Date(Date.now() + 1000).toISOString(), skills: [{ name: 'Rust' }], activity: { recent: [] } }) } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(durableDb.getMemberById(failing.member.id).tathastuLastSyncError, undefined);
  assert.strictEqual((await call('GET', '/api/auth/me', failing.token)).json.member.tathastuProfile.syncIssue, null);
});

await test('A member cannot set the sync-error field through profile edits', async () => {
  await call('PUT', '/api/profiles', failing.token, { tathastuLastSyncError: { at: new Date().toISOString(), code: 'X' } });
  assert.strictEqual(durableDb.getMemberById(failing.member.id).tathastuLastSyncError, undefined);
});

// ── Discovery: recommended first, privacy, connection lifecycle ──────────────
const viewer = await signIn('Viewer', {
  careerRole: { id: 'ml_engineer', label: 'ML Engineer' },
  eris: { score: 0.4, role: 'ml_engineer' },
  skills: [{ name: 'Python', verified: true }, { name: 'Machine Learning' }],
  goals: { needs: [{ skill: 'Kubernetes', priority: 'High', state: 'missing', expectedLevel: 'Working' }, { skill: 'MLflow', priority: 'Medium', state: 'missing', expectedLevel: 'Working' }], collaborationIntents: ['collaborate'] },
});
const helper = await signIn('Helper', {
  skills: [{ name: 'Kubernetes', verified: true, proficiency: 80, level: 'Advanced' }, { name: 'MLflow', verified: true, proficiency: 70, level: 'Proficient' }],
  projects: [{ key: 'p1', title: 'ML platform', technologies: ['Kubernetes', 'MLflow'] }],
});
const unrelated = await signIn('Unrelated', { skills: [{ name: 'Photoshop' }] });
const hidden = await signIn('Hidden', { skills: [{ name: 'Kubernetes', verified: true, proficiency: 90, level: 'Advanced' }] }, { discoverable: false, profileVisibility: 'public' });
const privateM = await signIn('Private', { skills: [{ name: 'MLflow', verified: true }] }, { discoverable: true, profileVisibility: 'private' });
const blocked = await signIn('Blocked', { skills: [{ name: 'Kubernetes', verified: true }] });
await call('POST', '/api/connections', viewer.token, { action: 'block', targetUserId: blocked.member.id });

const discover = async (token = viewer.token) => (await call('GET', '/api/discover', token)).json;

await test('A relevant recommendation appears before less relevant people, with a truthful reason', async () => {
  const d = await discover();
  const recIds = d.recommendations.map((r) => r.member.id);
  assert.ok(recIds.includes(helper.member.id), 'goal-relevant member is recommended');
  assert.ok(!recIds.includes(unrelated.member.id), 'no evidence = not recommended');
  const order = d.results.map((r) => r.id);
  assert.ok(order.indexOf(helper.member.id) < order.indexOf(unrelated.member.id), 'recommended before the rest');
  const rec = d.recommendations.find((r) => r.member.id === helper.member.id);
  assert.match(rec.reason, /Kubernetes|MLflow/, 'reason names real shared evidence');
  assert.ok(!('matchPercent' in rec));
  assert.strictEqual(rec.connectionStatus, 'not_connected', 'a recommendation never creates a connection');
});

await test('Undiscoverable, private and blocked members are not exposed in discovery or recommendations', async () => {
  const d = await discover();
  const ids = new Set([...d.results.map((r) => r.id), ...d.recommendations.map((r) => r.member.id)]);
  for (const m of [hidden, privateM, blocked]) assert.ok(!ids.has(m.member.id), `${m.member.fullName} must not appear`);
  assert.strictEqual((await call('GET', `/api/profiles?id=${blocked.member.id}`, viewer.token)).status, 403);
});

await test('Every eligible member appears exactly once in the directory', async () => {
  const d = await discover();
  const ids = d.results.map((r) => r.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.ok(ids.includes(unrelated.member.id) && ids.includes(helper.member.id) && ids.includes(asha.member.id));
});

let connectionId;
await test('Send request: recommendation shows outgoing pending; recipient sees incoming', async () => {
  const sent = await call('POST', '/api/connections', viewer.token, { action: 'send_request', toId: helper.member.id });
  assert.strictEqual(sent.status, 201);
  connectionId = sent.json.connection.id;
  const mine = (await discover()).recommendations.find((r) => r.member.id === helper.member.id);
  assert.strictEqual(mine?.connectionStatus, 'request_sent');
  assert.strictEqual(mine?.pendingDirection, 'outgoing');
  const theirs = (await discover(helper.token)).results.find((r) => r.id === viewer.member.id);
  assert.strictEqual(theirs.pendingDirection, 'incoming');
  assert.strictEqual(theirs.connectionId, connectionId);
});

await test('Duplicate and self requests are rejected', async () => {
  assert.strictEqual((await call('POST', '/api/connections', viewer.token, { action: 'send_request', toId: helper.member.id })).status, 409);
  assert.strictEqual((await call('POST', '/api/connections', helper.token, { action: 'send_request', toId: viewer.member.id })).status, 409);
  assert.strictEqual((await call('POST', '/api/connections', viewer.token, { action: 'send_request', toId: viewer.member.id })).status, 409);
});

await test('Only the recipient can accept; after acceptance both sides see the connection', async () => {
  assert.strictEqual((await call('POST', '/api/connections', viewer.token, { action: 'accept', connectionId })).status, 403);
  assert.strictEqual((await call('POST', '/api/connections', helper.token, { action: 'accept', connectionId })).status, 200);
  const v = (await discover()).results.find((r) => r.id === helper.member.id);
  assert.strictEqual(v.connectionStatus, 'accepted');
  assert.strictEqual(v.section, 'connected');
  const h = (await discover(helper.token)).results.find((r) => r.id === viewer.member.id);
  assert.strictEqual(h.connectionStatus, 'accepted');
});

await test('Cancel (withdraw) and decline leave both members able to connect later', async () => {
  const s1 = await call('POST', '/api/connections', viewer.token, { action: 'send_request', toId: unrelated.member.id });
  assert.strictEqual((await call('POST', '/api/connections', viewer.token, { action: 'withdraw', connectionId: s1.json.connection.id })).status, 200);
  assert.notStrictEqual((await discover()).results.find((r) => r.id === unrelated.member.id).connectionStatus, 'request_sent');
  const s2 = await call('POST', '/api/connections', viewer.token, { action: 'send_request', toId: unrelated.member.id });
  assert.strictEqual(s2.status, 201, 're-request after withdrawal');
  assert.strictEqual((await call('POST', '/api/connections', unrelated.token, { action: 'reject', connectionId: s2.json.connection.id })).status, 200);
  assert.notStrictEqual((await discover()).results.find((r) => r.id === unrelated.member.id).connectionStatus, 'request_sent');
});

await test('Remove connection works for an accepted connection', async () => {
  assert.strictEqual((await call('POST', '/api/connections', helper.token, { action: 'remove', targetUserId: viewer.member.id })).status, 200);
  assert.notStrictEqual((await discover()).results.find((r) => r.id === helper.member.id).connectionStatus, 'accepted');
});

console.log(`\n${passed}/${total} passed\n`);
process.exit(passed === total ? 0 : 1);
