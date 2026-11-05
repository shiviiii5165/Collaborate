/**
 * Phase 2 regression suite: privacy serialization, profile ownership, consent/revocation,
 * and webhook synchronization reliability. Local store (isolated temp file), Fastify inject,
 * no network. Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/phase2_privacy_ownership_sync.test.mjs
 */
import assert from 'node:assert';
import crypto from 'node:crypto';

process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
process.env.COLLABORATE_ENABLE_FIXTURES = 'true'; // claimsOverride (simulated verified claims) for setup only
process.env.TATHASTU_INTEGRATION_MODE = 'live';
process.env.AIT_CLIENT_SECRET = 'test_only_client_secret_not_real';
process.env.AIT_REDIRECT_URI = 'https://collaborate.aitathastu.com/api/auth/tathastu/callback';
process.env.AI_TATHASTU_CLIENT_ID = 'collaborate';
process.env.AI_TATHASTU_BASE_URL = 'https://www.aitathastu.com';
const WEBHOOK_SECRET = 'phase2_test_webhook_secret_5521';
process.env.AI_TATHASTU_WEBHOOK_SECRET = WEBHOOK_SECRET;

const { buildServer } = await import('../apps/api/src/server.ts');
const { durableDb } = await import('../src/lib/db/index.ts');
const { TathastuSsoService } = await import('../src/modules/identity/tathastu-sso.ts');
const { IdentityService } = await import('../src/modules/identity/service.ts');
const { ensureOwnershipModel } = await import('../src/modules/profile/ownership.ts');
const { toPublicMember } = await import('../src/modules/profile/public-member.ts');
const { projectionV1 } = await import('./helpers/projection-v1.mjs');

const app = buildServer();
const run = `${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let seq = 0;
async function independent(label, extra = {}) {
  const email = `${label}_${run}_${++seq}@independent.test`;
  const { member, token } = await IdentityService.registerStandalone(email, 'password-1234', `Indie ${label}`);
  Object.assign(member, extra);
  await durableDb.saveMemberAsync(member);
  return { member, token, email };
}
async function linked(label, profileArgs = {}) {
  const sub = `urn:tathastu:person:${label}_${run}_${++seq}`;
  const email = `${label}_${run}_${seq}@linked.test`;
  const { member, token } = await TathastuSsoService.processCallback({
    code: `code_${label}_${run}_${seq}`,
    codeVerifier: 'verifier',
    state: 'state',
    claimsOverride: { sub, email, fullName: `Linked ${label}`, profile: projectionV1({ sub, email, name: `Linked ${label}`, ...profileArgs }) },
  });
  return { member, token, sub, email };
}
const auth = (token) => ({ authorization: `Bearer ${token}` });
async function get(url, token) {
  const res = await app.inject({ method: 'GET', url, headers: token ? auth(token) : {} });
  return { status: res.statusCode, body: res.body, json: res.body ? JSON.parse(res.body) : null };
}
async function put(url, token, payload) {
  const res = await app.inject({ method: 'PUT', url, headers: auth(token), payload });
  return { status: res.statusCode, json: JSON.parse(res.body) };
}
function connect(a, b) {
  const c = durableDb.sendConnectionRequest(a.id, b.id);
  durableDb.respondToConnection(c.id, b.id, 'accept');
}
function signed(body, { secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000) } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return { raw, header: `t=${t},v1=${v1}` };
}
async function deliver(body, extraHeaders = {}) {
  const { raw, header } = signed(body);
  const res = await app.inject({
    method: 'POST',
    url: '/api/webhooks/tathastu',
    headers: { 'content-type': 'application/json', 'x-ait-signature': header, ...extraHeaders },
    payload: raw,
  });
  return { status: res.statusCode, json: JSON.parse(res.body) };
}
const profileEvent = (sub, email, args, { id = `del_${crypto.randomUUID()}`, generatedAt } = {}) => ({
  id,
  type: 'profile.updated',
  createdAt: new Date().toISOString(),
  data: { userId: sub, reason: 'test', profile: projectionV1({ sub, email, generatedAt, ...args }) },
});
const revokeEvent = (sub, { id = `del_${crypto.randomUUID()}`, createdAt = new Date(Date.now() + 1000).toISOString() } = {}) => ({
  id,
  type: 'integration.revoked',
  createdAt,
  data: { userId: sub },
});

const FORBIDDEN_PUBLIC_KEYS = ['email', 'tathastu_user_id', 'importedProfile', 'localProfile', 'importedIdentity', 'notificationPreferences', 'planExpiresAt', 'isUnder18', 'safeguardingApproved', 'tathastuSyncSettings', 'tathastuLinkedAt', 'institutionDomain'];
function assertPublic(m, label) {
  for (const k of FORBIDDEN_PUBLIC_KEYS) assert.ok(!(k in m), `${label}: must not expose ${k}`);
  if (m.tathastuProfile) {
    assert.ok(!('identity' in m.tathastuProfile), `${label}: raw projection identity leaked`);
    assert.ok(!JSON.stringify(m.tathastuProfile).includes('@'), `${label}: email-like data in tathastuProfile`);
  }
}

console.log('\n=== Phase 2: privacy, ownership, consent and sync ===\n');

// ---------------------------------------------------------------------------
// 1. Privacy serialization
// ---------------------------------------------------------------------------
const viewer = await independent('viewer');
const alice = await linked('alice', { skills: [{ name: 'Rust', verified: true }], projects: [{ key: 'a1', title: 'Alice Engine' }] });
alice.member.discoverable = true;
alice.member.socialLinks = { github: 'https://github.com/alice-private' };
await durableDb.saveMemberAsync(alice.member);
const bob = await independent('bob', { socialLinks: { linkedin: 'https://linkedin.com/in/bob-private' } });

await test('Discovery never exposes email, raw projection, identity mapping or contact links', async () => {
  const r = await get('/api/discover', viewer.token);
  assert.strictEqual(r.status, 200);
  assert.ok(!r.body.includes(alice.email) && !r.body.includes(bob.email), 'no member emails in discovery');
  assert.ok(!r.body.includes(alice.sub), 'no external subject ids');
  assert.ok(!r.body.includes('alice-private') && !r.body.includes('bob-private'), 'contact links hidden from non-connections');
  for (const m of r.json.members) assertPublic(m, 'discover');
  for (const rec of r.json.recommendations) assertPublic(rec.member, 'recommendation');
  const a = r.json.members.find((m) => m.id === alice.member.id);
  assert.ok(a, 'discoverable linked member listed');
  assert.ok(a.tathastuProfile.skills.items.some((s) => s.name === 'Rust' && s.verified), 'verified-skill indicator kept');
});

await test('Profile view of another member: no email; contact links only for accepted connections', async () => {
  const r1 = await get(`/api/profiles?id=${bob.member.id}`, viewer.token);
  assert.strictEqual(r1.status, 200);
  assertPublic(r1.json.member, 'profile view');
  assert.ok(!r1.body.includes(bob.email));
  assert.deepStrictEqual(r1.json.member.socialLinks, {});

  connect(viewer.member, bob.member);
  const r2 = await get(`/api/profiles?id=${bob.member.id}`, viewer.token);
  assert.strictEqual(r2.json.member.socialLinks.linkedin, 'https://linkedin.com/in/bob-private', 'connections see contact links');

  bob.member.contactVisibility = 'hidden';
  await durableDb.saveMemberAsync(bob.member);
  const r3 = await get(`/api/profiles?id=${bob.member.id}`, viewer.token);
  assert.deepStrictEqual(r3.json.member.socialLinks, {}, 'hidden contact info is never shown');
});

await test('Own profile (/api/auth/me) includes own email but no raw projection or ownership internals', async () => {
  const r = await get('/api/auth/me', alice.token);
  assert.strictEqual(r.json.member.email, alice.email);
  assert.ok(!('localProfile' in r.json.member) && !('importedIdentity' in r.json.member));
  assert.ok(!r.json.member.tathastuProfile || !('identity' in r.json.member.tathastuProfile));
});

await test('Directory list and saved list are sanitized', async () => {
  const list = await get('/api/profiles', viewer.token);
  assert.ok(Array.isArray(list.json));
  for (const m of list.json) assertPublic(m, 'directory');
  assert.ok(!list.body.includes('@independent.test') && !list.body.includes('@linked.test'));

  durableDb.saveMemberBookmark(viewer.member.id, alice.member.id);
  const saved = await get('/api/saved', viewer.token);
  assert.ok(saved.json.savedMembers.length >= 1);
  for (const m of saved.json.savedMembers) assertPublic(m, 'saved');
});

await test('Users cannot read another member\'s private profile or look them up by email', async () => {
  const priv = await independent('private', { profileVisibility: 'private' });
  assert.strictEqual((await get(`/api/profiles?id=${priv.member.id}`, viewer.token)).status, 403);
  assert.strictEqual((await get(`/api/profiles?email=${encodeURIComponent(priv.email)}`, viewer.token)).status, 404);
  assert.strictEqual((await get(`/api/profiles?id=${priv.member.id}`)).status, 401, 'guest');
});

await test('Visibility gate: non-discoverable, connections-only, blocked and under-18 members are not discoverable', async () => {
  const hidden = await independent('hidden', { discoverable: false });
  const connOnly = await independent('connonly', { profileVisibility: 'connections_only' });
  const blocker = await independent('blocker');
  const minor = await independent('minor', { isUnder18: true, discoverable: true, profileVisibility: 'public' });
  durableDb.blockMember(blocker.member.id, viewer.member.id); // blocker blocks the viewer

  const ids = (await get('/api/discover', viewer.token)).json.members.map((m) => m.id);
  assert.ok(!ids.includes(hidden.member.id), 'non-discoverable');
  assert.ok(!ids.includes(connOnly.member.id), 'connections-only, not connected');
  assert.ok(!ids.includes(blocker.member.id), 'blocked (reverse direction)');
  assert.ok(!ids.includes(minor.member.id), 'under-18 hidden from adults');

  connect(viewer.member, connOnly.member);
  const ids2 = (await get('/api/discover', viewer.token)).json.members.map((m) => m.id);
  assert.ok(ids2.includes(connOnly.member.id), 'connections-only visible once connected');
});

await test('New SSO member is not discoverable until they explicitly opt in', async () => {
  const fresh = await linked('fresh', { skills: [{ name: 'Elixir' }] });
  assert.strictEqual(fresh.member.discoverable, false);
  let ids = (await get('/api/discover', viewer.token)).json.members.map((m) => m.id);
  assert.ok(!ids.includes(fresh.member.id));
  const r = await put('/api/profiles', fresh.token, { discoverable: true });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.member.discoveryChoiceMade, true);
  ids = (await get('/api/discover', viewer.token)).json.members.map((m) => m.id);
  assert.ok(ids.includes(fresh.member.id));
});

await test('Independent members appear in discovery and recommendations', async () => {
  const peer = await independent('peer', { skills: ['Kubernetes'], collaborationInterests: ['open source'] });
  const me = await independent('me', { skills: ['Kubernetes'], collaborationInterests: ['open source'] });
  const r = await get('/api/discover', me.token);
  assert.ok(r.json.members.some((m) => m.id === peer.member.id));
  assert.ok(r.json.recommendations.some((x) => x.member.id === peer.member.id), 'independent profile is recommended');
});

// ---------------------------------------------------------------------------
// 2. Ownership: imported vs Collaborate-authored data
// ---------------------------------------------------------------------------
const owner = await linked('owner', {
  generatedAt: new Date(Date.now() - 120_000).toISOString(),
  skills: [{ name: 'Python', verified: true }, { name: 'SQL' }],
  projects: [{ key: 'imp1', title: 'Imported Project', description: 'from source', technologies: ['Py'] }],
  experience: [{ organization: 'Source Org', role: 'Engineer' }],
  education: [{ institution: 'Source University', degree: 'B.Tech' }],
  achievements: [{ type: 'certification', title: 'Source Cert' }],
});

await test('Local edits are stored as local data, hides and overrides (never written into imported data)', async () => {
  const before = (await get('/api/auth/me', owner.token)).json.member;
  const importedProject = before.projects.find((p) => p.title === 'Imported Project');
  assert.ok(importedProject && importedProject.id.startsWith('ait:'));
  const r = await put('/api/profiles', owner.token, {
    skills: ['Python', 'Go (local)'], // SQL removed (hide), Go added (local)
    projects: [
      { ...importedProject, description: 'Edited in Collaborate' }, // override
      { title: 'My Local Project', description: 'local', tags: [] },
    ],
    experience: [...before.experience, { role: 'Local Role', company: 'Local Co', period: '2024', bullets: [] }],
    education: [], // hide imported education
  });
  assert.strictEqual(r.status, 200);
  const m = durableDb.getMemberById(owner.member.id);
  assert.deepStrictEqual(m.localProfile.skills, ['Go (local)']);
  assert.ok(m.localProfile.hiddenImported.skills.includes('sql'));
  assert.ok(m.importedProfile.skills.some((s) => s.name === 'SQL'), 'imported copy untouched');
  assert.ok(m.localProfile.importedOverrides.projects[importedProject.id]);
  assert.strictEqual(m.importedProfile.projects[0].description, 'from source', 'source description unchanged');
  assert.ok(!m.skills.includes('SQL'));
  assert.ok(m.projects.find((p) => p.id === importedProject.id).locallyEdited);
  assert.strictEqual(m.education.length, 0);
});

await test('A client cannot forge imported entries (sourceOrigin/ids) into local data', async () => {
  const r = await put('/api/profiles', owner.token, {
    projects: [
      ...durableDb.getMemberById(owner.member.id).projects,
      { id: 'ait:proj:forged', title: 'Forged Import', description: '', tags: [] },
      { title: 'Spoofed Origin', description: '', tags: [], sourceOrigin: 'tathastu_core' },
    ],
  });
  assert.strictEqual(r.status, 200);
  const m = durableDb.getMemberById(owner.member.id);
  assert.ok(!m.projects.some((p) => p.title === 'Forged Import'));
  assert.strictEqual(m.projects.find((p) => p.title === 'Spoofed Origin').sourceOrigin, 'collaborate');
});

await test('profile.updated webhook updates imported data and preserves local data, hides and overrides', async () => {
  const r = await deliver(
    profileEvent(owner.sub, owner.email, {
      skills: [{ name: 'Python', verified: true }, { name: 'SQL' }, { name: 'Spark' }],
      projects: [{ key: 'imp1', title: 'Imported Project', description: 'source v2' }, { key: 'imp2', title: 'Second Import' }],
      experience: [{ organization: 'Source Org', role: 'Engineer' }],
      education: [{ institution: 'Source University', degree: 'B.Tech' }],
      achievements: [],
    })
  );
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.result.action, 'PROFILE_UPDATED');
  const m = durableDb.getMemberById(owner.member.id);
  assert.ok(m.skills.includes('Spark') && m.skills.includes('Go (local)') && !m.skills.includes('SQL'));
  assert.ok(m.projects.some((p) => p.title === 'Second Import'));
  assert.ok(m.projects.some((p) => p.title === 'My Local Project'));
  assert.strictEqual(m.projects.find((p) => p.id === 'ait:proj:imp1').description, 'Edited in Collaborate', 'override wins');
  assert.ok(m.experience.some((e) => e.company === 'Local Co'));
  assert.strictEqual(m.education.length, 0, 'hidden imported education stays hidden');
  assert.strictEqual(m.metrics.achievements, 0);
});

await test('Withdrawing one scope deletes only that imported section', async () => {
  const r = await deliver(profileEvent(owner.sub, owner.email, { skills: [{ name: 'Python' }] })); // projects etc. now null
  assert.strictEqual(r.json.result.action, 'PROFILE_UPDATED');
  const m = durableDb.getMemberById(owner.member.id);
  assert.ok(!m.projects.some((p) => p.sourceOrigin === 'tathastu_core'), 'imported projects removed');
  assert.ok(m.projects.some((p) => p.title === 'My Local Project'), 'local project kept');
  assert.ok(!m.experience.some((e) => e.company === 'Source Org'));
  assert.ok(m.experience.some((e) => e.company === 'Local Co'));
  assert.ok(m.skills.includes('Python') && m.skills.includes('Go (local)'));
});

// ---------------------------------------------------------------------------
// 3. Sync reliability
// ---------------------------------------------------------------------------
await test('Duplicate delivery is processed once', async () => {
  const ev = profileEvent(owner.sub, owner.email, { skills: [{ name: 'Python' }, { name: 'Dup Skill' }] });
  const r1 = await deliver(ev);
  const r2 = await deliver(ev);
  assert.strictEqual(r1.json.result.action, 'PROFILE_UPDATED');
  assert.strictEqual(r2.json.result.action, 'DUPLICATE_ACKNOWLEDGED');
});

await test('Older (stale) projection never overwrites a newer one', async () => {
  const old = profileEvent(owner.sub, owner.email, { skills: [{ name: 'Ancient Skill' }] }, { generatedAt: new Date(Date.now() - 3_600_000).toISOString() });
  const r = await deliver(old);
  assert.strictEqual(r.json.result.action, 'IGNORED_STALE');
  assert.ok(!durableDb.getMemberById(owner.member.id).skills.includes('Ancient Skill'));
});

await test('Failed processing is NOT marked processed and succeeds on retry', async () => {
  const ev = profileEvent(owner.sub, owner.email, { skills: [{ name: 'Python' }, { name: 'Retry Skill' }] });
  const original = durableDb.saveMemberAsync.bind(durableDb);
  durableDb.saveMemberAsync = async () => {
    throw new Error('simulated storage outage');
  };
  let r;
  try {
    r = await deliver(ev);
  } finally {
    durableDb.saveMemberAsync = original;
  }
  assert.strictEqual(r.status, 500);
  assert.strictEqual((await durableDb.getWebhookDelivery('aitathastu', ev.id)).status, 'failed');
  const retry = await deliver(ev);
  assert.strictEqual(retry.status, 200);
  assert.strictEqual(retry.json.result.action, 'PROFILE_UPDATED');
  assert.ok(durableDb.getMemberById(owner.member.id).skills.includes('Retry Skill'));
});

await test('HMAC is verified over the exact raw bytes (non-canonical JSON accepted, tampering rejected)', async () => {
  const ev = profileEvent(owner.sub, owner.email, { skills: [{ name: 'Python' }, { name: 'Raw Bytes Skill' }] });
  const raw = JSON.stringify(ev, null, 3); // whitespace a re-serializer would change
  const ok = await deliver(raw);
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  const { header } = signed(raw);
  const tampered = await app.inject({
    method: 'POST',
    url: '/api/webhooks/tathastu',
    headers: { 'content-type': 'application/json', 'x-ait-signature': header },
    payload: raw.replace('Raw Bytes Skill', 'Injected Skill'),
  });
  assert.strictEqual(tampered.statusCode, 401);
});

await test('Delivery id comes from the signed body; mismatching header and missing id are rejected', async () => {
  const ev = profileEvent(owner.sub, owner.email, { skills: [{ name: 'Python' }] });
  assert.strictEqual((await deliver(ev, { 'x-ait-delivery': 'someone-elses-id' })).status, 400);
  const noId = { ...ev };
  delete noId.id;
  assert.strictEqual((await deliver(noId)).status, 400);
  const old = signed(ev, { t: Math.floor(Date.now() / 1000) - 600 });
  const stale = await app.inject({ method: 'POST', url: '/api/webhooks/tathastu', headers: { 'content-type': 'application/json', 'x-ait-signature': old.header }, payload: old.raw });
  assert.strictEqual(stale.statusCode, 401, 'replay outside 5-minute window');
});

await test('Projection for a different subject, or an unsupported schema, is rejected and not imported', async () => {
  const other = profileEvent(owner.sub, owner.email, { skills: [{ name: 'Hijack' }] });
  other.data.profile.identity.id = alice.sub;
  assert.strictEqual((await deliver(other)).json.result.action, 'REJECTED_INVALID_PROJECTION');
  const v2 = profileEvent(owner.sub, owner.email, { skills: [{ name: 'FutureSkill' }] });
  v2.data.profile.version = 2;
  assert.strictEqual((await deliver(v2)).json.result.action, 'REJECTED_INVALID_PROJECTION');
  const m = durableDb.getMemberById(owner.member.id);
  assert.ok(!m.skills.includes('Hijack') && !m.skills.includes('FutureSkill'));
});

// ---------------------------------------------------------------------------
// 4. Revocation
// ---------------------------------------------------------------------------
await test('integration.revoked deletes all imported data, keeps all local data, and is idempotent', async () => {
  const r = await deliver(revokeEvent(owner.sub));
  assert.strictEqual(r.json.result.action, 'INTEGRATION_REVOKED');
  const m = durableDb.getMemberById(owner.member.id);
  assert.strictEqual(m.importedProfile, null);
  assert.strictEqual(m.tathastu_user_id, undefined);
  assert.ok(!m.skills.includes('Python') && m.skills.includes('Go (local)'));
  assert.ok(m.projects.every((p) => p.sourceOrigin !== 'tathastu_core'));
  assert.ok(m.projects.some((p) => p.title === 'My Local Project'));
  assert.ok(m.experience.some((e) => e.company === 'Local Co'));
  assert.ok(!JSON.stringify(toPublicMember(m)).includes('Source Org'));
  const snapshot = JSON.stringify(m);
  const again = await deliver(revokeEvent(owner.sub));
  assert.strictEqual(again.json.result.action, 'IGNORED_UNKNOWN_USER');
  assert.strictEqual(JSON.stringify(durableDb.getMemberById(owner.member.id)), snapshot, 'second revoke changes nothing');
});

await test('A late profile.updated after revocation cannot restore revoked data', async () => {
  const late = profileEvent(owner.sub, owner.email, { skills: [{ name: 'Resurrected' }] });
  const r = await deliver(late);
  assert.strictEqual(r.json.result.action, 'IGNORED_UNKNOWN_USER');
  assert.ok(!durableDb.getMemberById(owner.member.id).skills.includes('Resurrected'));
});

await test('A revocation sent before a re-link does not undo the new link', async () => {
  const u = await linked('relink', { skills: [{ name: 'Zig' }] });
  const staleRevoke = revokeEvent(u.sub, { createdAt: new Date(Date.now() - 60_000).toISOString() });
  const r = await deliver(staleRevoke);
  assert.strictEqual(r.json.result.action, 'IGNORED_STALE_REVOCATION');
  assert.ok(durableDb.getMemberById(u.member.id).skills.includes('Zig'));
});

await test('User-initiated unlink purges imported data; later webhooks for that subject are ignored', async () => {
  const u = await linked('selfunlink', { skills: [{ name: 'Haskell' }] });
  await put('/api/profiles', u.token, { skills: ['Haskell', 'Local Only'] });
  const res = await app.inject({ method: 'POST', url: '/api/federation', headers: auth(u.token), payload: { action: 'revoke_link' } });
  assert.strictEqual(res.statusCode, 200);
  const m = durableDb.getMemberById(u.member.id);
  assert.deepStrictEqual(m.skills, ['Local Only']);
  assert.strictEqual(m.tathastu_user_id, undefined);
  const r = await deliver(profileEvent(u.sub, u.email, { skills: [{ name: 'Haskell' }] }));
  assert.strictEqual(r.json.result.action, 'IGNORED_UNKNOWN_USER');
});

// ---------------------------------------------------------------------------
// 5. Legacy data migration & resilience
// ---------------------------------------------------------------------------
await test('Legacy member (pre-Phase 2 mixed data, fictional projection) migrates without losing local data', async () => {
  const legacy = {
    ...(await independent('legacy')).member,
    tathastu_user_id: 'urn:legacy',
    skills: ['Typed Skill'],
    projects: [
      { id: 'l1', title: 'Local Legacy', description: '', tags: [] },
      { id: 'c1', title: 'Core Legacy', description: '', tags: [], sourceOrigin: 'tathastu_core', stars: 10, forks: 2 },
    ],
    tathastuProfile: { schemaVersion: '1.0', profile: { displayName: 'x' }, identity: { email: 'leak@legacy.test' } },
  };
  delete legacy.localProfile;
  delete legacy.importedProfile;
  const pub = toPublicMember(legacy);
  assert.ok(!JSON.stringify(pub).includes('leak@legacy.test'), 'legacy raw projection never serialized');
  ensureOwnershipModel(legacy);
  assert.deepStrictEqual(legacy.localProfile.skills, ['Typed Skill'], 'ambiguous data stays local');
  assert.ok(legacy.projects.some((p) => p.title === 'Local Legacy'));
  assert.ok(!legacy.projects.some((p) => p.title === 'Core Legacy'), 'provably imported project dropped');
  assert.strictEqual(legacy.tathastuProfile, undefined);
});

await test('Live "Sync profile" without a user token asks for re-authorization (no client-secret bearer call)', async () => {
  const u = await linked('livesync', { skills: [{ name: 'OCaml' }] });
  const prev = process.env.COLLABORATE_ENABLE_FIXTURES;
  delete process.env.COLLABORATE_ENABLE_FIXTURES; // live adapter
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (...a) => {
    calls.push(String(a[0]));
    return new Response('{}', { status: 500 });
  };
  try {
    const res = await app.inject({ method: 'POST', url: '/api/federation', headers: auth(u.token), payload: { action: 'sync_profile' } });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(JSON.parse(res.body).error, 'REAUTHORIZE_REQUIRED');
    assert.strictEqual(calls.length, 0, 'no outbound call with the client secret as bearer');
  } finally {
    globalThis.fetch = realFetch;
    process.env.COLLABORATE_ENABLE_FIXTURES = prev;
  }
});

console.log(`\n=== ${passed}/${total} passed ===`);
if (passed !== total) process.exit(1);
