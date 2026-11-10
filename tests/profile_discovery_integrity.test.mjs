/**
 * Profile & discovery integrity (2026-11-11): real people only, no duplicates, sourced statistics,
 * and no legacy readiness score presented as current intelligence. Pure functions: no DB, no network.
 * Run: npx tsx tests/profile_discovery_integrity.test.mjs
 */
import assert from 'node:assert';

const { isSyntheticAccount, isVisibleInDiscovery, toPublicMember, toSelfMember } = await import('../src/modules/profile/public-member.ts');
const { dedupeCandidates, recommend } = await import('../src/modules/intelligence/matching.ts');
const { parseProjectionV1 } = await import('../src/integrations/tathastu/contract/projection-v1.ts');
const { applyImportedProjection, ensureOwnershipModel } = await import('../src/modules/profile/ownership.ts');
const { projectionV1 } = await import('./helpers/projection-v1.mjs');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failed++;
    console.log(`  [FAIL] ${name}\n         ${err.stack?.split('\n').slice(0, 3).join('\n         ')}`);
  }
}

function member(id, over = {}) {
  const m = {
    id,
    email: `${id}@gmail.com`,
    fullName: `Member ${id}`,
    headline: '',
    avatarUrl: '',
    bannerUrl: '',
    isVerified: false,
    plan: 'free',
    statusBadges: [],
    location: '',
    about: '',
    contextTags: [],
    socialLinks: {},
    metrics: { projects: 0, skills: 0, achievements: 0, githubContributions: '—', leetcodeProblems: '—', publications: 0 },
    skills: [],
    projects: [],
    experience: [],
    education: [],
    recentActivity: [],
    aiSpecializations: [],
    collaborationInterests: [],
    discoverable: true,
    profileVisibility: 'public',
    contactVisibility: 'connections_only',
    isLinkedWithTathastu: false,
    tathastuSyncStatus: 'unlinked',
    tathastuSyncSettings: { autoSyncProjects: false, autoSyncSkills: false, autoSyncAchievements: false },
    ...over,
  };
  ensureOwnershipModel(m);
  return m;
}

function ctxOf(members, { blocked = [] } = {}) {
  const byId = new Map(members.map((m) => [m.id, m]));
  return {
    getMember: (id) => byId.get(id) ?? null,
    allMembers: () => members,
    isBlocked: (a, b) => blocked.some(([x, y]) => x === a && y === b),
    isConnected: () => false,
    acceptedConnectionIds: () => [],
  };
}

const linked = (id, projection) => {
  const m = member(id, { tathastu_user_id: `sub_${id}`, isLinkedWithTathastu: true });
  applyImportedProjection(m, parseProjectionV1(projection, 'collaborate'));
  return m;
};

console.log('Profile & discovery integrity');

await test('Test and demo accounts are never shown to real members (live test runs, reserved domains)', () => {
  const real = member('real');
  assert.ok(isSyntheticAccount({ email: 'alice_1762@test.collaborate.internal' }));
  assert.ok(isSyntheticAccount({ email: 'x@example.com' }));
  assert.ok(isSyntheticAccount({ email: 'x@foo.test' }));
  assert.ok(isSyntheticAccount({ email: 'a@gmail.com', isDemo: true }));
  assert.ok(!isSyntheticAccount({ email: 'student@lpu.in' }));
  const alice = member('alice', { email: 'alice_1762@test.collaborate.internal', skills: ['Python'] });
  assert.strictEqual(isVisibleInDiscovery(alice, real, false), false);
  assert.strictEqual(isVisibleInDiscovery(real, alice, false), true, 'real members stay visible to test runs');
});

await test('Duplicate records of one person collapse; distinct people with the same name are kept', () => {
  const a1 = member('a1', { fullName: 'Alice Researcher', tathastu_user_id: 'sub_alice', skills: ['Python'] });
  const a2 = member('a2', { fullName: 'Alice Researcher', tathastu_user_id: 'sub_alice', skills: ['Python', 'PyTorch'] });
  const sameEmail = member('a3', { fullName: 'A. Researcher', email: 'A2@gmail.com' }); // same mailbox as a2
  const otherAlice = member('a4', { fullName: 'Alice Researcher' });
  const out = dedupeCandidates([a1, a2, sameEmail, otherAlice]);
  assert.deepStrictEqual(out.map((m) => m.id).sort(), ['a2', 'a4'], 'richest record wins; same-name stranger kept');
  const viewer = member('v', { email: 'a4@gmail.com' });
  assert.ok(!dedupeCandidates([otherAlice], viewer).length, 'another record of the viewer is never recommended');
});

await test('Recommendations: only real, eligible people with an evidenced reason, each once', () => {
  const viewer = member('viewer', { skills: ['Python', 'Machine Learning'], collaborationInterests: ['Research collaboration'] });
  const mlDev = member('ml', { skills: ['Python', 'PyTorch', 'Machine Learning'] });
  const mlDup = member('ml_dup', { email: 'ml@gmail.com', skills: ['Python'] }); // second record of mlDev
  const unrelated = member('chef', { skills: ['Cooking'] });
  const hidden = member('hidden', { skills: ['Python'], discoverable: false });
  const optedOut = member('opt', { skills: ['Python'], recommendationPreferences: { hideFromRecommendations: true } });
  const blocked = member('blk', { skills: ['Python'] });
  const suspended = member('sus', { skills: ['Python'], isRestricted: true });
  const deleted = member('del', { skills: ['Python'], deactivated: true });
  const tester = member('tst', { skills: ['Python'], email: 'bob_1@test.collaborate.internal' });
  const all = [viewer, mlDev, mlDup, unrelated, hidden, optedOut, blocked, suspended, deleted, tester];
  const ids = recommend('viewer', ctxOf(all, { blocked: [['viewer', 'blk']] }), { limit: 20 }).map((r) => r.member.id);
  assert.deepStrictEqual(ids, ['ml']);
});

await test('No relevant matches gives an empty list, not filler', () => {
  const viewer = member('viewer', { skills: ['Quantum Chemistry'] });
  const other = member('o', { skills: ['Cooking'], collaborationInterests: ['Open to networking'] });
  assert.deepStrictEqual(recommend('viewer', ctxOf([viewer, other])), []);
});

await test('Someone who can help with the goal ranks above an identical-profile peer', () => {
  const goals = { needs: [{ skill: 'PyTorch', priority: 'High', state: 'missing', expectedLevel: 'Working' }], assessed: true };
  const role = { id: 'ml_engineer', label: 'ML Engineer' };
  const viewer = linked('viewer', projectionV1({ sub: 'sub_viewer', careerRole: role, skills: [{ name: 'Python' }, { name: 'JavaScript' }], eris: { score: 0.3 }, goals }));
  const twin = member('twin', { skills: ['Python', 'JavaScript'] });
  const helper = linked('helper', projectionV1({ sub: 'sub_helper', skills: [{ name: 'PyTorch', verified: true, proficiency: 70, level: 'Proficient' }, { name: 'Python', verified: true }] }));
  const ids = recommend('viewer', ctxOf([viewer, twin, helper])).map((r) => r.member.id);
  assert.strictEqual(ids[0], 'helper');
});

await test('LeetCode: sourced counts shown; contest kept separate; absent = unknown, never 0', () => {
  const coding = [{ source: 'leetcode', solved: { total: 120, easy: 70, medium: 45, hard: 5 }, contest: { rating: 1610, attended: 8, topPercentage: 22.5 }, profileRef: 'leetcode.com/u/asha', verification: 'public_profile_import' }];
  const withLc = linked('lc', projectionV1({ sub: 'sub_lc', activity: { recent: [], coding }, achievements: [{ title: 'LeetCode: 120 problems solved' }, { title: 'Hackathon winner' }] }));
  assert.strictEqual(withLc.metrics.leetcodeProblems, '120');
  assert.strictEqual(withLc.metrics.achievements, 1, 'the LeetCode row is not an achievement');
  const view = toPublicMember(withLc, { viewerId: 'someone' }).tathastuProfile;
  assert.deepStrictEqual(view.activity.coding[0].solved, { total: 120, easy: 70, medium: 45, hard: 5 });
  assert.strictEqual(view.activity.coding[0].contest.rating, 1610);
  assert.deepStrictEqual(view.achievements.map((a) => a.title), ['Hackathon winner']);

  const older = linked('old', projectionV1({ sub: 'sub_old', activity: { recent: [] } })); // provider without coding
  assert.strictEqual(older.metrics.leetcodeProblems, '—');
  assert.strictEqual(toPublicMember(older).tathastuProfile.activity.coding, null, 'unknown, not "none"');
  const local = member('local', { metrics: { projects: 0, skills: 0, achievements: 0, githubContributions: '0', leetcodeProblems: '0', publications: 0 } });
  assert.strictEqual(local.metrics.leetcodeProblems, '—', 'a default 0 is not a solved count');
});

await test('Old ERIS readiness payloads are accepted but the score is never exposed', () => {
  const m = linked('eris', projectionV1({ sub: 'sub_eris', skills: [{ name: 'Python' }], eris: { score: 0.33, role: 'ml_engineer', gaps: [{ skill: 'PyTorch', readiness: 0 }] } }));
  for (const shape of [toPublicMember(m, { viewerId: 'x' }), toSelfMember(m)]) {
    const json = JSON.stringify(shape.tathastuProfile);
    assert.ok(!json.includes('erisReadiness') && !json.includes('0.33') && !json.includes('readiness'), json);
    assert.strictEqual(shape.tathastuProfile.careerDirection, null, 'no goals shared: no direction section');
  }
});

await test('Current v3 payload: canonical role label, strengths, owner-only development areas, assessment date', () => {
  const p = projectionV1({
    sub: 'sub_v3',
    careerRole: { id: 'ml_engineer', label: 'ML Engineer' },
    skills: [
      { name: 'Python', proficiency: 72, level: 'Proficient' },
      { name: 'SQL', proficiency: 30, level: 'Working' },
      { name: 'Docker', proficiency: null, level: null },
    ],
    eris: { score: 0.33 },
    goals: { needs: [{ skill: 'PyTorch', priority: 'High', state: 'missing', expectedLevel: 'Working' }], assessed: true, assessedAt: '2026-11-10T08:00:00Z' },
  });
  const m = linked('v3', p);
  const self = toSelfMember(m).tathastuProfile.careerDirection;
  assert.deepStrictEqual(self, { label: 'ML Engineer', strengths: ['Python'], developmentAreas: ['PyTorch'], assessed: true, assessedAt: '2026-11-10T08:00:00.000Z' });
  const other = toPublicMember(m, { viewerId: 'someone' }).tathastuProfile.careerDirection;
  assert.strictEqual(other.developmentAreas, null, "another member never sees someone's gaps");
  assert.ok(!JSON.stringify(other).includes('ml_engineer'), 'no raw role id');
});

await test('Cross-user isolation: one member\'s imported data never appears on another', () => {
  const a = linked('iso_a', projectionV1({ sub: 'sub_iso_a', skills: [{ name: 'Rust' }], activity: { recent: [], coding: [{ source: 'leetcode', solved: { total: 9, easy: 9, medium: 0, hard: 0 }, contest: null, profileRef: null }] } }));
  const b = linked('iso_b', projectionV1({ sub: 'sub_iso_b', skills: [{ name: 'Go' }] }));
  assert.ok(!b.skills.includes('Rust'));
  assert.strictEqual(b.metrics.leetcodeProblems, '—');
  assert.strictEqual(toPublicMember(b).tathastuProfile.activity, null);
  assert.strictEqual(a.metrics.leetcodeProblems, '9');
});

await test('Public profile never exposes email or the raw projection', () => {
  const m = linked('pub', projectionV1({ sub: 'sub_pub', skills: [{ name: 'Python' }] }));
  const json = JSON.stringify(toPublicMember(m, { viewerId: 'x' }));
  assert.ok(!json.includes('pub@gmail.com'));
  assert.ok(!json.includes('sub_pub'));
});

console.log(`=== ${passed}/${passed + failed} passed ===`);
if (failed) process.exit(1);
