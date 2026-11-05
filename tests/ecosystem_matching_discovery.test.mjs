/**
 * Ecosystem regression suite (2026-11): AI Tathastu goals in the contract, goal-aware matching,
 * discovery ordering/pagination/eligibility for students A-E, profile privacy, and the full
 * connection lifecycle. Synthetic accounts only.
 * Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/ecosystem_matching_discovery.test.mjs
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
const SECRET = 'eco_webhook_secret';
process.env.AI_TATHASTU_WEBHOOK_SECRET = SECRET;

const { buildServer } = await import('../apps/api/src/server.ts');
const { durableDb } = await import('../src/lib/db/index.ts');
const { TathastuSsoService } = await import('../src/modules/identity/tathastu-sso.ts');
const { IdentityService } = await import('../src/modules/identity/service.ts');
const { applyLocalProfileEdit } = await import('../src/modules/profile/ownership.ts');
const { parseProjectionV1 } = await import('../src/integrations/tathastu/contract/projection-v1.ts');
const { recommend } = await import('../src/modules/intelligence/matching.ts');
const { matchContext } = await import('../src/lib/recommendations.ts');
const { projectionV1 } = await import('./helpers/projection-v1.mjs');

const app = buildServer();
const run = crypto.randomBytes(3).toString('hex');
let passed = 0, total = 0;
async function test(name, fn) {
  total++;
  try { await fn(); passed++; console.log(`  [PASS] ${name}`); }
  catch (e) { console.log(`  [FAIL] ${name}\n         ${e.stack?.split('\n').slice(0, 4).join('\n         ')}`); }
}
let seq = 0;
async function linked(label, args, extra = { discoverable: true, profileVisibility: 'public' }) {
  const sub = `urn:eco:${label}_${run}_${++seq}`;
  const email = `${label}_${run}_${seq}@synthetic.invalid`;
  const { member, token } = await TathastuSsoService.processCallback({
    code: `c_${sub}`, codeVerifier: 'v', state: 's',
    claimsOverride: { sub, email, fullName: `${label} ${run}`, profile: projectionV1({ sub, email, name: `${label} ${run}`, ...args }) },
  });
  Object.assign(member, extra);
  await durableDb.saveMemberAsync(member);
  return { member, token, sub, email };
}
async function indie(label, extra = {}) {
  const { member, token } = await IdentityService.registerStandalone(`${label}_${run}_${++seq}@synthetic.invalid`, 'password-1234', `${label} ${run}`);
  Object.assign(member, { discoverable: true, profileVisibility: 'public', ...extra });
  if (extra.skills || extra.projects) applyLocalProfileEdit(member, { skills: extra.skills, projects: extra.projects });
  await durableDb.saveMemberAsync(member);
  return { member, token };
}
const call = async (method, url, token, payload) => {
  const r = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload ? { payload } : {}) });
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : null, body: r.body };
};
async function deliver(body) {
  const raw = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const res = await app.inject({ method: 'POST', url: '/api/webhooks/tathastu', headers: { 'content-type': 'application/json', 'x-ait-signature': `t=${t},v1=${crypto.createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex')}` }, payload: raw });
  return { status: res.statusCode, json: JSON.parse(res.body) };
}
const rankOf = (results, id) => results.findIndex((r) => r.member.id === id);
const ML = { id: 'ml_engineer', label: 'ML Engineer' };

console.log('\n=== Ecosystem: contract, matching, discovery, privacy, connections ===\n');

// ── Contract ──────────────────────────────────────────────────────────────────
await test('Contract: payloads without the new fields (older AI Tathastu) still validate', () => {
  const p = parseProjectionV1(projectionV1({ sub: 'urn:old', skills: [{ name: 'Python' }] }));
  assert.strictEqual(p.goals, null);
  assert.strictEqual(p.skills.items[0].proficiency, null);
});

await test('Contract: proficiency outside 0-100 and unknown priorities are rejected', () => {
  assert.throws(() => parseProjectionV1(projectionV1({ sub: 'urn:bad', skills: [{ name: 'X', proficiency: 140 }] })));
  const bad = projectionV1({ sub: 'urn:bad2', careerRole: ML, eris: { score: 0.5 }, skills: [], goals: { needs: [{ skill: 'PyTorch', priority: 'Urgent', state: 'missing' }] } });
  assert.throws(() => parseProjectionV1(bad));
});

const student = await linked('MLStudent', {
  careerRole: ML,
  skills: [{ name: 'Python', verified: true, proficiency: 60, level: 'Proficient' }, { name: 'Machine Learning' }],
  eris: { score: 0.4, role: 'ml_engineer' },
  goals: {
    needs: [
      { skill: 'PyTorch', priority: 'High', state: 'missing', expectedLevel: 'Working' },
      { skill: 'MLflow', priority: 'Medium', state: 'missing', expectedLevel: 'Working' },
      { skill: 'Docker', priority: 'Medium', state: 'unverified', expectedLevel: 'Working' },
    ],
    collaborationIntents: ['collaborate', 'people_mentors'],
  },
});

await test('Contract: goals, target role id and skill proficiency persist on the imported profile', () => {
  const m = durableDb.getMemberById(student.member.id);
  assert.strictEqual(m.importedProfile.identity.careerRoleId, 'ml_engineer');
  assert.strictEqual(m.importedProfile.goals.needs[0].skill, 'PyTorch');
  assert.deepStrictEqual(m.importedProfile.goals.collaborationIntents, ['collaborate', 'people_mentors']);
  const py = m.importedProfile.skills.find((s) => s.name === 'Python');
  assert.strictEqual(py.proficiency, 60);
  assert.strictEqual(py.verified, true);
  const mlSkill = m.importedProfile.skills.find((s) => s.name === 'Machine Learning');
  assert.strictEqual(mlSkill.proficiency, null); // not assessed stays null, never a default
  assert.strictEqual(mlSkill.verified, false); // a claim is not turned into a verified skill
});

// ── Matching ──────────────────────────────────────────────────────────────────
const sameTitle = await linked('SameTitlePeer', { careerRole: ML, skills: [{ name: 'Python', verified: true }, { name: 'Machine Learning', verified: true }] });
const helper = await linked('PyTorchDeployer', {
  careerRole: { id: 'mlops_engineer', label: 'MLOps Engineer' },
  skills: [{ name: 'PyTorch', verified: true, proficiency: 82, level: 'Advanced' }, { name: 'Docker', verified: true, proficiency: 70, level: 'Proficient' }, { name: 'MLflow', proficiency: 55, level: 'Proficient' }],
  projects: [{ key: 'dep', title: 'Model serving platform', technologies: ['PyTorch', 'Docker', 'MLflow'] }],
});
const claimer = await linked('PyTorchClaimer', { skills: [{ name: 'PyTorch' }] });

await test('Matching: a member with strong evidence in skills your goal needs outranks a same-title, same-skills peer', () => {
  const recs = recommend(student.member.id, matchContext(), { limit: 50 });
  const h = rankOf(recs, helper.member.id);
  const s = rankOf(recs, sameTitle.member.id);
  assert.ok(h >= 0, 'helper is recommended');
  assert.ok(s === -1 || h < s, `helper (${h}) should rank above same-title peer (${s})`);
});

await test('Matching: credible (verified, assessed) evidence ranks above a bare claim of the same skill', () => {
  const recs = recommend(student.member.id, matchContext(), { limit: 50 });
  const h = rankOf(recs, helper.member.id);
  const c = rankOf(recs, claimer.member.id);
  assert.ok(h >= 0 && (c === -1 || h < c), `helper ${h} vs claimer ${c}`);
});

await test('Matching: every recommendation carries an explainable reason and separate relevance/confidence/compatibility', () => {
  const recs = recommend(student.member.id, matchContext(), { limit: 50 });
  const r = recs[rankOf(recs, helper.member.id)];
  assert.match(r.explanation.summary, /PyTorch/);
  assert.match(r.explanation.summary, /ML Engineer goal/);
  assert.ok(r.explanation.helpsWith.some((x) => x.skill === 'PyTorch' && /Advanced, verified/.test(x.evidence)));
  assert.ok(['low', 'medium', 'high'].includes(r.explanation.confidence));
  assert.ok(['unknown', 'low', 'medium', 'high'].includes(r.explanation.compatibility));
  assert.strictEqual(r.explanation.scoreMeaning, 'relative ranking within your results, not a probability');
  // The candidate's own gaps are never part of the explanation (they're the viewer-side input only).
  assert.ok(!JSON.stringify(r.explanation).includes('needs":'));
});

const robo = await linked('RoboticsStudent', { careerRole: { id: 'robotics_ai_engineer', label: 'Robotics Engineer' }, skills: [{ name: 'Python' }], eris: { score: 0.3 }, goals: { assessed: false, needs: [] } });
const rosExpert = await linked('ROSExpert', { skills: [{ name: 'ROS', verified: true, proficiency: 78, level: 'Advanced' }, { name: 'C++', verified: true, proficiency: 65, level: 'Proficient' }] });
const webDev = await linked('WebDev', { skills: [{ name: 'Python', verified: true, proficiency: 80, level: 'Advanced' }, { name: 'React', verified: true }] });

await test('Matching: an unassessed Robotics student still gets ROS/C++ experts first (role focus)', () => {
  const recs = recommend(robo.member.id, matchContext(), { limit: 50 });
  const r = rankOf(recs, rosExpert.member.id);
  const w = rankOf(recs, webDev.member.id);
  assert.ok(r >= 0 && (w === -1 || r < w), `ROS expert ${r} vs same-Python web dev ${w}`);
});

const llmStudent = await linked('LLMAppStudent', {
  careerRole: { id: 'llm_application_engineer', label: 'LLM Application Engineer' },
  skills: [{ name: 'Python' }], eris: { score: 0.3 },
  goals: { needs: [{ skill: 'Retrieval-Augmented Generation', priority: 'High', state: 'missing', expectedLevel: 'Proficient' }, { skill: 'LLM Evaluation', priority: 'Medium', state: 'missing', expectedLevel: 'Working' }] },
});
const ragBuilder = await linked('RAGBuilder', { skills: [{ name: 'RAG', verified: true, proficiency: 75, level: 'Advanced' }, { name: 'LLM Evaluation', proficiency: 50, level: 'Proficient' }] });

await test('Matching: aliases connect AI Tathastu names to member skills (Retrieval-Augmented Generation = RAG)', () => {
  const recs = recommend(llmStudent.member.id, matchContext(), { limit: 50 });
  const r = recs[rankOf(recs, ragBuilder.member.id)];
  assert.ok(r, 'RAG builder recommended');
  assert.ok(r.explanation.helpsWith.some((x) => x.skill === 'RAG'));
});

await test('Matching: revoking the goals scope stops goal-based matching (role focus remains from the public role)', async () => {
  const before = recommend(student.member.id, matchContext(), { limit: 50 })[rankOf(recommend(student.member.id, matchContext(), { limit: 50 }), helper.member.id)];
  assert.ok(before.explanation.helpsWith.some((x) => x.skill === 'MLflow'));
  const res = await deliver({ id: `d_${crypto.randomUUID()}`, type: 'profile.updated', createdAt: new Date().toISOString(),
    data: { userId: student.sub, reason: 'consent_changed', profile: projectionV1({ sub: student.sub, email: student.email, careerRole: ML, skills: [{ name: 'Python', verified: true }], goals: {} }) } });
  assert.strictEqual(res.status, 200);
  const m = durableDb.getMemberById(student.member.id);
  assert.strictEqual(m.importedProfile.goals, null);
});

// ── Discovery: students A-E ──────────────────────────────────────────────────
const viewer = await indie('Viewer', { skills: ['Python'] });
const B = await linked('StudentB', { skills: [{ name: 'Go' }] });
const C = await indie('StudentC', { skills: ['Rust'] });
const D = await linked('StudentD', {}); // linked, shares nothing (limited consent)
const E = await linked('StudentE', { skills: [{ name: 'Go' }] }, { discoverable: false, profileVisibility: 'public' });
const auto = await linked('AutoPrivate', { skills: [{ name: 'Go' }] }, { autoProvisioned: true, discoverable: false, profileVisibility: 'private' });

await test('Discovery: B (linked), C (independent) and D (limited consent) appear; E (discovery off) and private auto profiles do not; A (no Collaborate account) cannot', async () => {
  const d = await call('GET', `/api/discover?q=${run}`, viewer.token);
  const ids = new Set(d.json.members.map((m) => m.id));
  assert.ok(ids.has(B.member.id) && ids.has(C.member.id) && ids.has(D.member.id));
  assert.ok(!ids.has(E.member.id) && !ids.has(auto.member.id));
});

await test('Discovery: pagination covers every eligible member exactly once, in a stable order, recommended first', async () => {
  const all = (await call('GET', `/api/discover?q=${run}`, viewer.token)).json;
  const seen = [];
  for (let page = 1; page < 50; page++) {
    const r = (await call('GET', `/api/discover?q=${run}&page=${page}&pageSize=3`, viewer.token)).json;
    seen.push(...r.members.map((m) => m.id));
    if (!r.hasMore) break;
  }
  assert.strictEqual(seen.length, all.total);
  assert.strictEqual(new Set(seen).size, seen.length, 'no duplicates across pages');
  assert.deepStrictEqual(seen, all.members.map((m) => m.id), 'paged order equals full order');
  const sections = all.members.map((m) => m.section);
  const firstOther = sections.findIndex((s) => s !== 'recommended');
  assert.ok(firstOther === -1 || !sections.slice(firstOther).includes('recommended'), 'recommended come first');
});

await test('Discovery: a low match score never hides an eligible member from the directory', async () => {
  const d = await call('GET', `/api/discover?q=${run}`, viewer.token);
  const c = d.json.members.find((m) => m.id === C.member.id);
  assert.ok(c, 'independent member with nothing in common is listed');
});

// ── Privacy ───────────────────────────────────────────────────────────────────
await test('Privacy: discovery/profile/recommendation responses never contain email, external ids, goals or raw provenance', async () => {
  const d = await call('GET', `/api/discover?q=${run}`, viewer.token);
  const p = await call('GET', `/api/profiles?id=${student.member.id}`, viewer.token);
  const rec = await call('GET', '/api/recommendations?limit=20', robo.token);
  for (const body of [d.body, p.body, rec.body]) {
    assert.ok(!body.includes('@synthetic.invalid'), 'no email');
    assert.ok(!body.includes('urn:eco:'), 'no AI Tathastu subject');
    assert.ok(!body.includes('collaborationIntents') && !body.includes('"needs"'), 'no goals');
    assert.ok(!body.includes('importedProfile') && !body.includes('localProfile'), 'no ownership internals');
  }
});

await test('Privacy: contact links are hidden until an accepted connection', async () => {
  const m = durableDb.getMemberById(C.member.id);
  m.socialLinks = { linkedin: 'https://linkedin.com/in/synthetic' };
  m.contactVisibility = 'connections_only';
  await durableDb.saveMemberAsync(m);
  const p = await call('GET', `/api/profiles?id=${C.member.id}`, viewer.token);
  assert.deepStrictEqual(p.json.member.socialLinks, {});
});

// ── Connections ───────────────────────────────────────────────────────────────
const stranger = await indie('Stranger');
let connId;
await test('Connections: send creates one persisted pending request visible to both sides', async () => {
  const s = await call('POST', '/api/connections', viewer.token, { action: 'send', targetUserId: C.member.id });
  assert.strictEqual(s.status, 201);
  connId = s.json.connection.id;
  const mine = (await call('GET', '/api/connections', viewer.token)).json.connections.filter((c) => c.id === connId);
  const theirs = (await call('GET', '/api/connections', C.token)).json.connections.filter((c) => c.id === connId);
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(theirs[0].status, 'request_sent');
  const d = (await call('GET', `/api/discover?q=${run}`, C.token)).json.members.find((m) => m.id === viewer.member.id);
  assert.strictEqual(d?.pendingDirection, 'incoming');
});

await test('Connections API: view lists carry the other member (public shape) and the id the UI acts on', async () => {
  const theirs = (await call('GET', '/api/connections', C.token)).json;
  const incoming = theirs.pendingReceived.find((c) => c.connectionId === connId);
  assert.ok(incoming, 'pending request listed for the recipient');
  assert.strictEqual(incoming.member.id, viewer.member.id);
  assert.ok(!JSON.stringify(theirs.pendingReceived).includes('@synthetic.invalid'), 'no email');
  const mine = (await call('GET', '/api/connections', viewer.token)).json;
  assert.ok(mine.pendingSent.some((c) => c.connectionId === connId));
  assert.strictEqual(mine.accepted.length, 0);
});

await test('Messages API: the chat list includes the other member, last message and unread count', async () => {
  const peer = await indie('ChatPeer');
  const s = await call('POST', '/api/connections', viewer.token, { action: 'send', targetUserId: peer.member.id });
  await call('POST', '/api/connections', peer.token, { action: 'accept', connectionId: s.json.connection.id });
  const sent = await call('POST', '/api/messages', viewer.token, { recipientId: peer.member.id, content: 'hello' });
  assert.strictEqual(sent.status, 201);
  const list = (await call('GET', '/api/messages', peer.token)).json.conversations;
  const conv = list.find((c) => c.otherMember?.id === viewer.member.id);
  assert.ok(conv, 'conversation lists the other member');
  assert.strictEqual(conv.lastMessage.content, 'hello');
  assert.strictEqual(conv.unreadCount, 1);
  assert.ok(!JSON.stringify(list).includes('@synthetic.invalid'), 'no email');
});

await test('Connections: duplicate and self requests are refused with 409, not 500', async () => {
  assert.strictEqual((await call('POST', '/api/connections', viewer.token, { action: 'send', targetUserId: C.member.id })).status, 409);
  assert.strictEqual((await call('POST', '/api/connections', C.token, { action: 'send', targetUserId: viewer.member.id })).status, 409);
  assert.strictEqual((await call('POST', '/api/connections', viewer.token, { action: 'send', targetUserId: viewer.member.id })).status, 409);
});

await test('Connections: only the recipient can accept; the sender or a third party gets 403', async () => {
  assert.strictEqual((await call('POST', '/api/connections', viewer.token, { action: 'accept', connectionId: connId })).status, 403);
  assert.strictEqual((await call('POST', '/api/connections', stranger.token, { action: 'accept', connectionId: connId })).status, 403);
  assert.strictEqual(durableDb.getConnectionState(viewer.member.id, C.member.id).status, 'request_sent');
});

await test('Connections: recipient accepts; both see accepted; contact links now visible; accepting again is 409', async () => {
  const a = await call('POST', '/api/connections', C.token, { action: 'accept', connectionId: connId });
  assert.strictEqual(a.status, 200);
  assert.strictEqual(durableDb.getConnectionState(C.member.id, viewer.member.id).status, 'accepted');
  const p = await call('GET', `/api/profiles?id=${C.member.id}`, viewer.token);
  assert.strictEqual(p.json.connectionStatus, 'accepted');
  assert.strictEqual(p.json.member.socialLinks.linkedin, 'https://linkedin.com/in/synthetic');
  assert.strictEqual((await call('POST', '/api/connections', C.token, { action: 'accept', connectionId: connId })).status, 409);
  const d = (await call('GET', `/api/discover?q=${run}`, viewer.token)).json.members.find((m) => m.id === C.member.id);
  assert.strictEqual(d.section, 'connected');
});

await test('Connections: disconnect, then reconnecting reuses the single record for the pair (no duplicates)', async () => {
  assert.strictEqual((await call('POST', '/api/connections', viewer.token, { action: 'disconnect', targetUserId: C.member.id })).status, 200);
  const again = await call('POST', '/api/connections', C.token, { action: 'send', targetUserId: viewer.member.id });
  assert.strictEqual(again.status, 201);
  const pair = durableDb.getAllConnections().filter((c) => [c.requesterId, c.recipientId].sort().join() === [viewer.member.id, C.member.id].sort().join());
  assert.strictEqual(pair.length, 1);
  assert.strictEqual(pair[0].status, 'request_sent');
  assert.strictEqual(pair[0].requesterId, C.member.id);
});

await test('Connections: reject, withdraw and a reject of a withdrawn request behave correctly', async () => {
  const pending = durableDb.getConnectionState(viewer.member.id, C.member.id);
  assert.strictEqual((await call('POST', '/api/connections', viewer.token, { action: 'withdraw', connectionId: pending.id })).status, 403); // not the sender
  assert.strictEqual((await call('POST', '/api/connections', C.token, { action: 'withdraw', connectionId: pending.id })).status, 200);
  assert.strictEqual((await call('POST', '/api/connections', viewer.token, { action: 'reject', connectionId: pending.id })).status, 409); // no longer pending
  const s = await call('POST', '/api/connections', viewer.token, { action: 'send', targetUserId: stranger.member.id });
  assert.strictEqual((await call('POST', '/api/connections', stranger.token, { action: 'reject', connectionId: s.json.connection.id })).status, 200);
  assert.strictEqual(durableDb.getConnectionState(viewer.member.id, stranger.member.id).status, 'rejected');
});

await test('Connections: blocking prevents requests and hides each other from discovery', async () => {
  assert.strictEqual((await call('POST', '/api/connections', stranger.token, { action: 'block', targetUserId: viewer.member.id })).status, 200);
  assert.strictEqual((await call('POST', '/api/connections', viewer.token, { action: 'send', targetUserId: stranger.member.id })).status, 403);
  const d = await call('GET', `/api/discover?q=${run}`, viewer.token);
  assert.ok(!d.json.members.some((m) => m.id === stranger.member.id));
});

console.log(`\n=== ${passed}/${total} passed ===\n`);
if (passed !== total) process.exit(1);
