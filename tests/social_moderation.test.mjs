/**
 * Moderation workflow (D1), repost identity (D2, single instance) and impression interval (D4).
 * In-process Fastify inject; isolated local store; no network.
 *
 * Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/social_moderation.test.mjs
 */
import assert from 'node:assert';
import crypto from 'node:crypto';

process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
delete process.env.COLLABORATE_ENABLE_FIXTURES;

const { buildServer } = await import('../apps/api/src/server.ts');
const { durableDb } = await import('../src/lib/db/index.ts');
const { repostId, LIMITS } = await import('../src/modules/social/service.ts');
const { IMPRESSION_FLUSH_INTERVAL_MS, IMPRESSION_VISIBLE_RATIO, IMPRESSION_DWELL_MS } = await import('../src/modules/social/constants.ts');

const app = buildServer();
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
const J = (r) => JSON.parse(r.body);
const sessionCall = (cookie) => (method, url, payload) =>
  app.inject({ method, url, headers: { cookie, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: payload !== undefined ? JSON.stringify(payload) : undefined });
async function register(name) {
  const email = `mod_${crypto.randomBytes(5).toString('hex')}@example.invalid`;
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email, password: 'mod-pass-1234', fullName: name }) });
  assert.strictEqual(r.statusCode, 201, r.body);
  return { id: J(r).member.id, email, call: sessionCall(String(r.headers['set-cookie']).split(';')[0]) };
}
async function promoteToAdmin(u) {
  durableDb.saveMember({ ...durableDb.getMemberById(u.id), role: 'admin' });
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email: u.email, password: 'mod-pass-1234' }) });
  assert.strictEqual(r.statusCode, 200, r.body);
  return { ...u, call: sessionCall(String(r.headers['set-cookie']).split(';')[0]) };
}
const notifTitles = (id) => durableDb.getNotificationsForUser(id).map((n) => n.title);

const author = await register('Mod Author');
const r1 = await register('Mod Reporter One');
const r2 = await register('Mod Reporter Two');
const r3 = await register('Mod Reporter Three');
const viewer = await register('Mod Viewer');
const admin = await promoteToAdmin(await register('Mod Admin'));

async function hiddenPost(text) {
  const p = J(await author.call('POST', '/api/posts', { text })).post;
  for (const r of [r1, r2, r3]) assert.strictEqual((await r.call('POST', `/api/posts/${p.id}/report`, { reason: 'spam', details: `from ${r.id}` })).statusCode, 200);
  return p;
}
const findItem = (list, id) => list.items.find((i) => i.targetId === id);

let postA;

await test('authorisation: members (and anonymous) cannot use moderation APIs', async () => {
  for (const [m, u] of [['GET', '/api/admin/reports'], ['POST', '/api/admin/reports/rep_x'], ['GET', '/api/admin/posts/post_x']]) {
    assert.strictEqual((await app.inject({ method: m, url: u })).statusCode, 401, `${m} ${u} anonymous`);
    assert.strictEqual((await viewer.call(m, u, m === 'POST' ? { decision: 'dismiss' } : undefined)).statusCode, 403, `${m} ${u} member`);
  }
  // A member whose stored role is not admin cannot forge it.
  assert.strictEqual((await viewer.call('GET', '/api/admin/reports?role=admin')).statusCode, 403);
});

await test('auto-hide: three reports hide the post, author notified, admin listing shows it with full content', async () => {
  postA = await hiddenPost('Questionable content for review A');
  assert.strictEqual((await viewer.call('GET', `/api/posts/${postA.id}`)).statusCode, 404);
  const own = J(await author.call('GET', `/api/posts/${postA.id}`)).post;
  assert.strictEqual(own.moderation, 'hidden_pending_review');
  assert.ok(notifTitles(author.id).includes('Your post is under review'));
  const list = J(await admin.call('GET', '/api/admin/reports'));
  const item = findItem(list, postA.id);
  assert.ok(item, 'listed as pending');
  assert.strictEqual(item.state, 'hidden_pending_review');
  assert.strictEqual(item.openReports, 3);
  assert.strictEqual(item.distinctReporters, 3);
  assert.strictEqual(item.content.text, 'Questionable content for review A');
  assert.strictEqual(item.reports.length, 3);
  assert.ok(!JSON.stringify(list).includes('@example.invalid'), 'no emails in the moderation payload');
});

await test('admin visibility: admins can open hidden posts; members still cannot', async () => {
  const r = await admin.call('GET', `/api/admin/posts/${postA.id}`);
  assert.strictEqual(r.statusCode, 200, r.body);
  assert.strictEqual(J(r).post.moderation, 'hidden_pending_review');
  assert.strictEqual((await viewer.call('GET', `/api/admin/posts/${postA.id}`)).statusCode, 403);
});

await test('dismiss: restores visibility, closes every open report, writes an audit record, notifies author', async () => {
  const before = J(await admin.call('GET', '/api/admin/reports'));
  const repId = findItem(before, postA.id).reports[2].id;
  const r = await admin.call('POST', `/api/admin/reports/${repId}`, { decision: 'dismiss', note: 'Not spam; legitimate opinion.' });
  assert.strictEqual(r.statusCode, 200, r.body);
  const res = J(r);
  assert.strictEqual(res.previousState, 'hidden_pending_review');
  assert.strictEqual(res.newState, 'visible');
  assert.strictEqual(res.closedReports.length, 3);
  assert.strictEqual((await viewer.call('GET', `/api/posts/${postA.id}`)).statusCode, 200);
  const reports = durableDb.getAbuseReports().filter((x) => x.targetId === postA.id);
  assert.ok(reports.every((x) => x.status === 'dismissed' && x.reviewedBy === admin.id && x.decision === 'dismiss' && x.reviewedAt && x.reviewNote === 'Not spam; legitimate opinion.'));
  const audit = durableDb.getSocialState().moderationAudit[res.auditId];
  assert.deepStrictEqual(
    { decision: audit.decision, reviewerId: audit.reviewerId, note: audit.note, previousState: audit.previousState, newState: audit.newState, targetId: audit.targetId },
    { decision: 'dismiss', reviewerId: admin.id, note: 'Not spam; legitimate opinion.', previousState: 'hidden_pending_review', newState: 'visible', targetId: postA.id }
  );
  assert.ok(audit.at);
  assert.ok(notifTitles(author.id).includes('Your post is visible again'));
  // No longer in the open queue; present under reviewed with its audit history.
  assert.ok(!findItem(J(await admin.call('GET', '/api/admin/reports')), postA.id));
  const reviewed = findItem(J(await admin.call('GET', '/api/admin/reports?status=reviewed')), postA.id);
  assert.strictEqual(reviewed.audit.length, 1);
  assert.strictEqual(reviewed.audit[0].reviewer.id, admin.id);
  // Dismissing again is refused.
  assert.strictEqual((await admin.call('POST', `/api/admin/reports/${repId}`, { decision: 'dismiss' })).statusCode, 409);
});

let postB;
await test('remove: hidden from everyone but author (content kept), reports resolved, author notified', async () => {
  postB = J(await author.call('POST', '/api/posts', { text: 'Clearly abusive content B' })).post;
  const rep = J(await r1.call('POST', `/api/posts/${postB.id}/report`, { reason: 'harassment' }));
  assert.strictEqual((await viewer.call('GET', `/api/posts/${postB.id}`)).statusCode, 200, 'one report does not hide');
  const r = await admin.call('POST', `/api/admin/reports/${rep.reportId}`, { decision: 'remove', note: 'Targeted harassment.' });
  assert.strictEqual(r.statusCode, 200, r.body);
  assert.strictEqual(J(r).newState, 'removed');
  assert.strictEqual((await viewer.call('GET', `/api/posts/${postB.id}`)).statusCode, 404);
  assert.ok(!J(await viewer.call('GET', '/api/feed?filter=latest')).posts.some((p) => p.id === postB.id));
  const own = J(await author.call('GET', `/api/posts/${postB.id}`)).post;
  assert.strictEqual(own.moderation, 'removed');
  assert.strictEqual(own.text, 'Clearly abusive content B', 'content kept for the author and for restore');
  assert.strictEqual((await author.call('PUT', `/api/posts/${postB.id}`, { text: 'edited to evade' })).statusCode, 409, 'no edits while removed');
  assert.strictEqual(durableDb.getAbuseReportById(rep.reportId).status, 'resolved');
  assert.ok(notifTitles(author.id).includes('Your post was removed'));
  assert.strictEqual((await admin.call('POST', `/api/admin/reports/${rep.reportId}`, { decision: 'remove' })).statusCode, 409);
});

await test('restore: undoes a removal, audited, author notified; restoring a visible post is refused', async () => {
  const rep = durableDb.getAbuseReports().find((x) => x.targetId === postB.id);
  const r = await admin.call('POST', `/api/admin/reports/${rep.id}`, { decision: 'restore', note: 'Appeal accepted.' });
  assert.strictEqual(r.statusCode, 200, r.body);
  assert.deepStrictEqual([J(r).previousState, J(r).newState], ['removed', 'visible']);
  assert.strictEqual((await viewer.call('GET', `/api/posts/${postB.id}`)).statusCode, 200);
  assert.strictEqual(durableDb.getSocialState().posts[postB.id].moderation, undefined);
  const audit = Object.values(durableDb.getSocialState().moderationAudit).filter((a) => a.targetId === postB.id).map((a) => a.decision).sort();
  assert.deepStrictEqual(audit, ['remove', 'restore']);
  assert.strictEqual((await admin.call('POST', `/api/admin/reports/${rep.id}`, { decision: 'restore' })).statusCode, 409);
});

await test('restore also lifts an auto-hide (open reports dismissed)', async () => {
  const p = await hiddenPost('Auto hidden then restored C');
  const rep = durableDb.getAbuseReports().find((x) => x.targetId === p.id);
  const r = await admin.call('POST', `/api/admin/reports/${rep.id}`, { decision: 'restore' });
  assert.strictEqual(r.statusCode, 200, r.body);
  assert.strictEqual((await viewer.call('GET', `/api/posts/${p.id}`)).statusCode, 200);
  assert.ok(durableDb.getAbuseReports().filter((x) => x.targetId === p.id).every((x) => x.status === 'dismissed' && x.decision === 'restore'));
});

await test('comments: hidden/removed comments are placeholders for others, visible to author and admin, restorable', async () => {
  const p = J(await author.call('POST', '/api/posts', { text: 'Post with a reported comment' })).post;
  const c = J(await r1.call('POST', `/api/posts/${p.id}/comments`, { text: 'Rude comment' })).comment;
  for (const r of [author, r2, r3]) await r.call('POST', `/api/comments/${c.id}/report`, { reason: 'abuse' });
  const seen = J(await viewer.call('GET', `/api/posts/${p.id}/comments`)).comments;
  assert.strictEqual(seen.length, 0, 'hidden comment without replies is not shown to others');
  const own = J(await r1.call('GET', `/api/posts/${p.id}/comments`)).comments;
  assert.strictEqual(own[0].text, 'Rude comment');
  assert.strictEqual(own[0].moderation, 'hidden_pending_review');
  assert.strictEqual((await r1.call('PUT', `/api/comments/${c.id}`, { text: 'x' })).statusCode, 409);
  const item = findItem(J(await admin.call('GET', '/api/admin/reports')), c.id);
  assert.strictEqual(item.targetType, 'comment');
  assert.strictEqual(item.content.text, 'Rude comment');
  const rem = await admin.call('POST', `/api/admin/reports/${item.reports[0].id}`, { decision: 'remove' });
  assert.strictEqual(rem.statusCode, 200, rem.body);
  assert.strictEqual(J(await viewer.call('GET', `/api/posts/${p.id}`)).post.counts.comments, 0, 'removed comment not counted');
  assert.ok(notifTitles(r1.id).includes('Your comment was removed'));
  await admin.call('POST', `/api/admin/reports/${item.reports[0].id}`, { decision: 'restore' });
  assert.strictEqual(J(await viewer.call('GET', `/api/posts/${p.id}/comments`)).comments[0].text, 'Rude comment');
});

await test('member reports can be dismissed only; invalid decisions and unknown reports are refused', async () => {
  const mr = J(await viewer.call('POST', '/api/reports', { reportedMemberId: author.id, reason: 'impersonation' }));
  const id = mr.reportId.id ?? mr.reportId;
  assert.strictEqual((await admin.call('POST', `/api/admin/reports/${id}`, { decision: 'remove' })).statusCode, 400);
  assert.strictEqual((await admin.call('POST', `/api/admin/reports/${id}`, { decision: 'ban' })).statusCode, 400);
  assert.strictEqual((await admin.call('POST', '/api/admin/reports/rep_does_not_exist', { decision: 'dismiss' })).statusCode, 404);
  const ok = await admin.call('POST', `/api/admin/reports/${id}`, { decision: 'dismiss' });
  assert.strictEqual(ok.statusCode, 200, ok.body);
  assert.strictEqual(durableDb.getAbuseReportById(id).status, 'dismissed');
});

await test('content deleted by its author: report can be dismissed, not removed/restored', async () => {
  const p = J(await author.call('POST', '/api/posts', { text: 'Deleted before review' })).post;
  const rep = J(await r2.call('POST', `/api/posts/${p.id}/report`, { reason: 'spam' }));
  await author.call('DELETE', `/api/posts/${p.id}`);
  assert.strictEqual((await admin.call('POST', `/api/admin/reports/${rep.reportId}`, { decision: 'remove' })).statusCode, 409);
  assert.strictEqual((await admin.call('POST', `/api/admin/reports/${rep.reportId}`, { decision: 'dismiss' })).statusCode, 200);
});

await test('D2 (single instance): repost id is derived from (original, member); duplicate gives 409 ALREADY_REPOSTED; undo + repost works', async () => {
  const orig = J(await author.call('POST', '/api/posts', { text: 'Original for repost identity' })).post;
  const first = await viewer.call('POST', '/api/posts', { repostOfId: orig.id });
  assert.strictEqual(first.statusCode, 201, first.body);
  assert.strictEqual(J(first).post.id, repostId(orig.id, viewer.id));
  const dup = await viewer.call('POST', '/api/posts', { repostOfId: orig.id, text: 'again' });
  assert.strictEqual(dup.statusCode, 409);
  assert.strictEqual(J(dup).error, 'ALREADY_REPOSTED');
  assert.strictEqual((await viewer.call('DELETE', `/api/posts/${J(first).post.id}`)).statusCode, 200);
  const again = await viewer.call('POST', '/api/posts', { repostOfId: orig.id });
  assert.strictEqual(again.statusCode, 201, again.body);
  assert.strictEqual(J(await author.call('GET', `/api/posts/${orig.id}`)).post.counts.reposts, 1);
  // Same commentary on reposts of two different posts is not "duplicate text".
  const o2 = J(await author.call('POST', '/api/posts', { text: 'Second original' })).post;
  const o3 = J(await author.call('POST', '/api/posts', { text: 'Third original' })).post;
  assert.strictEqual((await viewer.call('POST', '/api/posts', { repostOfId: o2.id, text: 'Great read' })).statusCode, 201);
  assert.strictEqual((await viewer.call('POST', '/api/posts', { repostOfId: o3.id, text: 'Great read' })).statusCode, 201);
  // ...while identical normal posts are still refused.
  await viewer.call('POST', '/api/posts', { text: 'Same normal text' });
  assert.strictEqual(J(await viewer.call('POST', '/api/posts', { text: 'Same normal text' })).error, 'DUPLICATE_POST');
});

await test('D4: impressions are batched every 30 s; visibility rule unchanged; repeat batches within 30 min count once', async () => {
  assert.strictEqual(IMPRESSION_FLUSH_INTERVAL_MS, 30_000);
  assert.strictEqual(IMPRESSION_VISIBLE_RATIO, 0.5);
  assert.strictEqual(IMPRESSION_DWELL_MS, 1_000);
  assert.strictEqual(LIMITS.impressionWindowMs, 30 * 60_000);
  const p = J(await author.call('POST', '/api/posts', { text: 'Impression interval check' })).post;
  // Simulate a viewer whose tab stays open: one batch every 30 s for 10 minutes.
  for (let i = 0; i < 20; i++) await viewer.call('POST', '/api/feed/impressions', { postIds: [p.id] });
  let a = J(await author.call('GET', `/api/posts/${p.id}/analytics`));
  assert.strictEqual(a.impressions, 1);
  assert.strictEqual(a.uniqueReach, 1);
  // After the dedupe window a new display counts again; reach stays 1.
  durableDb.getSocialState().postViews[`${p.id}|${viewer.id}`].lastAt = new Date(Date.now() - 31 * 60_000).toISOString();
  await viewer.call('POST', '/api/feed/impressions', { postIds: [p.id] });
  a = J(await author.call('GET', `/api/posts/${p.id}/analytics`));
  assert.deepStrictEqual([a.impressions, a.uniqueReach], [2, 1]);
});

await test('regression: profile, feed and engagement still work for ordinary members', async () => {
  const me = J(await viewer.call('GET', '/api/auth/me'));
  assert.strictEqual(me.member.id, viewer.id);
  const p = J(await r2.call('POST', '/api/posts', { text: 'Regression post' })).post;
  assert.strictEqual((await viewer.call('POST', `/api/posts/${p.id}/like`, { liked: true })).statusCode, 200);
  assert.strictEqual((await viewer.call('POST', `/api/posts/${p.id}/comments`, { text: 'ok' })).statusCode, 201);
  assert.strictEqual((await viewer.call('POST', `/api/posts/${p.id}/bookmark`, { bookmarked: true })).statusCode, 200);
  assert.ok(J(await viewer.call('GET', '/api/feed?filter=latest')).posts.some((x) => x.id === p.id));
  assert.strictEqual((await viewer.call('GET', `/api/profiles?id=${r2.id}`)).statusCode, 200);
});

console.log(`\n  ${passed}/${total} moderation tests passed`);
