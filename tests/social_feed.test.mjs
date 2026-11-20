/**
 * Social feed: posts, platform-wide visibility, engagement, analytics, ranking and safety.
 * In-process Fastify inject; isolated store; no network.
 *
 * Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/social_feed.test.mjs
 */
import assert from 'node:assert';
import crypto from 'node:crypto';

process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
delete process.env.COLLABORATE_ENABLE_FIXTURES;

const { buildServer } = await import('../apps/api/src/server.ts');
const { durableDb } = await import('../src/lib/db/index.ts');
const { enumerateDocuments, applyDocument, emptyDocumentState, splitKey } = await import('../src/lib/db/documents.ts');

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

async function register(name, extra = {}) {
  const email = `feed_${crypto.randomBytes(5).toString('hex')}@example.invalid`;
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email, password: 'feed-pass-123', fullName: name, ...extra }) });
  assert.strictEqual(r.statusCode, 201, r.body);
  const cookie = String(r.headers['set-cookie']).split(';')[0];
  const id = JSON.parse(r.body).member.id;
  const call = (method, url, payload) =>
    app.inject({ method, url, headers: { cookie, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: payload !== undefined ? JSON.stringify(payload) : undefined });
  return { id, call, email };
}
const body = (r) => JSON.parse(r.body);

const alice = await register('Alice Feed');
const bob = await register('Bob Feed');
const carol = await register('Carol Feed');
// Give Bob ranking signals so For You is personalised for him.
durableDb.saveMember({ ...durableDb.getMemberById(bob.id), skills: ['PyTorch', 'RAG'] });

let alicePostId;

await test('auth: feed and post routes require a session', async () => {
  for (const [m, u] of [['GET', '/api/feed'], ['POST', '/api/posts'], ['POST', '/api/feed/impressions']]) {
    const r = await app.inject({ method: m, url: u });
    assert.strictEqual(r.statusCode, 401, `${m} ${u}`);
  }
});

await test('create: text post persists with topics from hashtags; no audience field exists', async () => {
  const r = await alice.call('POST', '/api/posts', { text: 'Shipping a #RAG eval harness for PyTorch models', audience: 'connections' });
  assert.strictEqual(r.statusCode, 201, r.body);
  const p = body(r).post;
  alicePostId = p.id;
  assert.ok(p.topics.includes('rag'));
  assert.strictEqual(p.author.id, alice.id);
  assert.strictEqual(p.audience, undefined);
  const stored = durableDb.getSocialState().posts[p.id];
  assert.ok(stored);
  assert.strictEqual(stored.audience, undefined, 'unknown audience field is never stored');
  assert.strictEqual(p.author.email, undefined, 'author card never carries email');
});

await test('visibility: post is visible to members with NO connection to the author', async () => {
  for (const viewer of [bob, carol]) {
    const r = await viewer.call('GET', '/api/feed?filter=latest');
    assert.strictEqual(r.statusCode, 200, r.body);
    assert.ok(body(r).posts.some((p) => p.id === alicePostId), 'non-connected member sees the post');
  }
  assert.strictEqual(durableDb.getConnectionState(alice.id, bob.id), null);
});

await test('validation: empty, oversized, non-https attachments and unknown kinds are refused', async () => {
  const alice = await register('Val Feed'); // own rate-limit bucket
  assert.strictEqual((await alice.call('POST', '/api/posts', { text: '   ' })).statusCode, 400);
  assert.strictEqual((await alice.call('POST', '/api/posts', { text: 'x'.repeat(3001) })).statusCode, 400);
  assert.strictEqual((await alice.call('POST', '/api/posts', { text: 'hi', attachments: [{ type: 'image', url: 'javascript:alert(1)' }] })).statusCode, 400);
  assert.strictEqual((await alice.call('POST', '/api/posts', { text: 'hi', attachments: [{ type: 'image', url: 'http://example.com/a.png' }] })).statusCode, 400);
  assert.strictEqual((await alice.call('POST', '/api/posts', { text: 'hi', attachments: [{ type: 'image', url: 'https://127.0.0.1/a.png' }] })).statusCode, 400);
  assert.strictEqual((await alice.call('POST', '/api/posts', { text: 'hi', kind: 'secret' })).statusCode, 400);
  const ok = await alice.call('POST', '/api/posts', { text: 'Diagram of our pipeline', attachments: [{ type: 'image', url: 'https://example.com/a.png' }] });
  assert.strictEqual(ok.statusCode, 201, ok.body);
});

await test('spam: identical text twice in a day is refused', async () => {
  const r = await alice.call('POST', '/api/posts', { text: 'Shipping a #RAG eval harness for PyTorch models' });
  assert.strictEqual(r.statusCode, 409);
});

await test('likes: idempotent, no duplicates, counter derived from records', async () => {
  for (let i = 0; i < 3; i++) assert.strictEqual((await bob.call('POST', `/api/posts/${alicePostId}/like`, { liked: true })).statusCode, 200);
  await carol.call('POST', `/api/posts/${alicePostId}/like`, { liked: true });
  let p = body(await alice.call('GET', `/api/posts/${alicePostId}`)).post;
  assert.strictEqual(p.counts.likes, 2);
  await bob.call('POST', `/api/posts/${alicePostId}/like`, { liked: false });
  await bob.call('POST', `/api/posts/${alicePostId}/like`, { liked: false });
  p = body(await bob.call('GET', `/api/posts/${alicePostId}`)).post;
  assert.strictEqual(p.counts.likes, 1);
  assert.strictEqual(p.viewer.liked, false);
  const likeNotifs = durableDb.getNotificationsForUser(alice.id).filter((n) => n.title === 'New like');
  assert.strictEqual(likeNotifs.length, 2, 'one like notification per member, not per toggle');
});

await test('comments: create, reply (threaded one level), edit own, cannot edit others', async () => {
  const c = body(await bob.call('POST', `/api/posts/${alicePostId}/comments`, { text: 'Which retriever?' })).comment;
  const reply = await carol.call('POST', `/api/posts/${alicePostId}/comments`, { text: 'BM25 + dense', parentId: c.id });
  assert.strictEqual(reply.statusCode, 201, reply.body);
  const nested = body(await alice.call('POST', `/api/posts/${alicePostId}/comments`, { text: 'Agreed', parentId: body(reply).comment.id })).comment;
  assert.strictEqual(nested.parentId, c.id, 'reply to a reply attaches to the top-level comment');
  assert.strictEqual((await carol.call('PUT', `/api/comments/${c.id}`, { text: 'hijack' })).statusCode, 403);
  const edited = await bob.call('PUT', `/api/comments/${c.id}`, { text: 'Which retriever do you use?' });
  assert.strictEqual(edited.statusCode, 200);
  assert.ok(body(edited).comment.editedAt);
  const list = body(await carol.call('GET', `/api/posts/${alicePostId}/comments`)).comments;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].replies.length, 2);
  assert.ok(durableDb.getNotificationsForUser(bob.id).some((n) => n.title === 'New reply'));
  // Deleting a comment with replies leaves a placeholder; count excludes it.
  assert.strictEqual((await bob.call('DELETE', `/api/comments/${c.id}`)).statusCode, 200);
  const after = body(await carol.call('GET', `/api/posts/${alicePostId}/comments`)).comments;
  assert.strictEqual(after[0].deleted, true);
  assert.strictEqual(after[0].text, '');
  assert.strictEqual(body(await carol.call('GET', `/api/posts/${alicePostId}`)).post.counts.comments, 2);
});

await test('repost: with commentary, one per member, not own post, credited to original', async () => {
  const r = await bob.call('POST', '/api/posts', { repostOfId: alicePostId, text: 'Worth reading' });
  assert.strictEqual(r.statusCode, 201, r.body);
  const rp = body(r).post;
  assert.strictEqual(rp.repostOf.id, alicePostId);
  assert.strictEqual((await bob.call('POST', '/api/posts', { repostOfId: alicePostId })).statusCode, 409);
  assert.strictEqual((await alice.call('POST', '/api/posts', { repostOfId: alicePostId })).statusCode, 400);
  // Reposting the repost credits the original.
  const viaRepost = await carol.call('POST', '/api/posts', { repostOfId: rp.id });
  assert.strictEqual(viaRepost.statusCode, 201);
  assert.strictEqual(body(viaRepost).post.repostOf.id, alicePostId);
  assert.strictEqual(body(await alice.call('GET', `/api/posts/${alicePostId}`)).post.counts.reposts, 2);
});

await test('share and bookmark: persisted, deduped per member; Saved filter lists bookmarks', async () => {
  await carol.call('POST', `/api/posts/${alicePostId}/share`);
  await carol.call('POST', `/api/posts/${alicePostId}/share`);
  assert.strictEqual(body(await alice.call('GET', `/api/posts/${alicePostId}`)).post.counts.shares, 1);
  await carol.call('POST', `/api/posts/${alicePostId}/bookmark`, { bookmarked: true });
  let saved = body(await carol.call('GET', '/api/feed?filter=saved')).posts;
  assert.deepStrictEqual(saved.map((p) => p.id), [alicePostId]);
  await carol.call('POST', `/api/posts/${alicePostId}/bookmark`, { bookmarked: false });
  saved = body(await carol.call('GET', '/api/feed?filter=saved')).posts;
  assert.strictEqual(saved.length, 0);
});

await test('analytics: impressions dedupe within 30 min, unique reach, author excluded, author only', async () => {
  await bob.call('POST', '/api/feed/impressions', { postIds: [alicePostId] });
  await bob.call('POST', '/api/feed/impressions', { postIds: [alicePostId, alicePostId] });
  await carol.call('POST', '/api/feed/impressions', { postIds: [alicePostId] });
  await alice.call('POST', '/api/feed/impressions', { postIds: [alicePostId] });
  let a = body(await alice.call('GET', `/api/posts/${alicePostId}/analytics`));
  assert.strictEqual(a.impressions, 2);
  assert.strictEqual(a.uniqueReach, 2);
  assert.strictEqual(a.likes, 1);
  assert.strictEqual(a.reposts, 2);
  assert.strictEqual(a.shares, 1);
  assert.strictEqual(a.engagementRate, null, 'rate withheld below the impression threshold');
  // After the window, a repeat view counts again (but reach does not grow).
  const key = `${alicePostId}|${bob.id}`;
  const v = durableDb.getSocialState().postViews[key];
  v.lastAt = new Date(Date.now() - 31 * 60_000).toISOString();
  await bob.call('POST', '/api/feed/impressions', { postIds: [alicePostId] });
  a = body(await alice.call('GET', `/api/posts/${alicePostId}/analytics`));
  assert.strictEqual(a.impressions, 3);
  assert.strictEqual(a.uniqueReach, 2);
  assert.strictEqual((await bob.call('GET', `/api/posts/${alicePostId}/analytics`)).statusCode, 403);
});

await test('edit and delete: author only; delete removes content and engagement', async () => {
  assert.strictEqual((await bob.call('PUT', `/api/posts/${alicePostId}`, { text: 'hacked' })).statusCode, 403);
  const e = await alice.call('PUT', `/api/posts/${alicePostId}`, { text: 'Shipping a #RAG eval harness (v2)' });
  assert.strictEqual(e.statusCode, 200, e.body);
  assert.ok(body(e).post.editedAt);
  assert.strictEqual((await bob.call('DELETE', `/api/posts/${alicePostId}`)).statusCode, 403);
  assert.strictEqual((await alice.call('DELETE', `/api/posts/${alicePostId}`)).statusCode, 200);
  assert.strictEqual((await bob.call('GET', `/api/posts/${alicePostId}`)).statusCode, 404);
  const s = durableDb.getSocialState();
  assert.strictEqual(s.posts[alicePostId].text, '');
  assert.ok(!Object.values(s.postLikes).some((l) => l.postId === alicePostId));
  assert.ok(!Object.values(s.postComments).some((c) => c.postId === alicePostId));
  const feed = body(await carol.call('GET', '/api/feed?filter=latest')).posts;
  assert.ok(!feed.some((p) => p.id === alicePostId));
  const repost = feed.find((p) => p.repostOf);
  assert.ok(repost && repost.repostOf.unavailable, 'reposts show the original as unavailable');
});

await test('blocking: blocked members see neither each other\'s posts nor can engage', async () => {
  const p = body(await carol.call('POST', '/api/posts', { text: 'Carol research note on agents', kind: 'research' })).post;
  await carol.call('POST', '/api/connections', { action: 'block', targetUserId: alice.id });
  const feed = body(await alice.call('GET', '/api/feed?filter=latest')).posts;
  assert.ok(!feed.some((x) => x.author.id === carol.id));
  assert.strictEqual((await alice.call('POST', `/api/posts/${p.id}/like`, { liked: true })).statusCode, 404);
  assert.strictEqual((await alice.call('POST', `/api/posts/${p.id}/comments`, { text: 'hi' })).statusCode, 404);
  await carol.call('POST', '/api/connections', { action: 'unblock', targetUserId: alice.id });
});

await test('moderation: reports from 3 distinct members hide a post pending review; duplicates ignored', async () => {
  const spammer = await register('Spam Feed');
  const p = body(await spammer.call('POST', '/api/posts', { text: 'Buy followers now' })).post;
  assert.strictEqual((await spammer.call('POST', `/api/posts/${p.id}/report`, { reason: 'spam' })).statusCode, 400);
  await alice.call('POST', `/api/posts/${p.id}/report`, { reason: 'spam' });
  assert.ok(body(await alice.call('POST', `/api/posts/${p.id}/report`, { reason: 'spam' })).alreadyReported);
  await bob.call('POST', `/api/posts/${p.id}/report`, { reason: 'spam' });
  assert.strictEqual((await carol.call('GET', `/api/posts/${p.id}`)).statusCode, 200, 'still visible with 2 reporters');
  await carol.call('POST', `/api/posts/${p.id}/report`, { reason: 'spam' });
  assert.strictEqual((await carol.call('GET', `/api/posts/${p.id}`)).statusCode, 404);
  assert.strictEqual((await spammer.call('GET', `/api/posts/${p.id}`)).statusCode, 200, 'author still sees own post');
  const reports = durableDb.getAbuseReports().filter((r) => r.targetId === p.id);
  assert.strictEqual(reports.length, 3);
  assert.ok(reports.every((r) => r.targetType === 'post' && r.reportedMemberId === spammer.id));
});

await test('restricted accounts: cannot post, and their posts are hidden from others', async () => {
  const dana = await register('Dana Feed');
  const p = body(await dana.call('POST', '/api/posts', { text: 'Before restriction' })).post;
  durableDb.saveMember({ ...durableDb.getMemberById(dana.id), isRestricted: true });
  assert.strictEqual((await dana.call('POST', '/api/posts', { text: 'After' })).statusCode, 403);
  assert.strictEqual((await bob.call('GET', `/api/posts/${p.id}`)).statusCode, 404);
});

await test('polls: one vote per member (changeable), results hidden until you vote', async () => {
  const p = body(await alice.call('POST', '/api/posts', { kind: 'poll', text: 'Best vector DB?', poll: { options: ['pgvector', 'Qdrant'], durationDays: 3 } })).post;
  const before = body(await bob.call('GET', `/api/posts/${p.id}`)).post;
  assert.strictEqual(before.poll.totalVotes, null);
  await bob.call('POST', `/api/posts/${p.id}/vote`, { option: 0 });
  const after = body(await bob.call('POST', `/api/posts/${p.id}/vote`, { option: 1 })).post;
  assert.strictEqual(after.poll.totalVotes, 1);
  assert.strictEqual(after.poll.options[1].votes, 1);
  assert.strictEqual((await bob.call('POST', `/api/posts/${p.id}/vote`, { option: 7 })).statusCode, 400);
  assert.strictEqual((await alice.call('POST', '/api/posts', { kind: 'poll', text: 'x', poll: { options: ['a'] } })).statusCode, 400);
});

await test('filters: research/projects/discussions/opportunities return only that kind', async () => {
  await bob.call('POST', '/api/posts', { kind: 'opportunity', text: 'Hiring an ML intern for a RAG project' });
  for (const [filter, kinds] of [['research', ['research']], ['discussions', ['question', 'poll']], ['opportunities', ['opportunity']]]) {
    const posts = body(await carol.call('GET', `/api/feed?filter=${filter}`)).posts;
    assert.ok(posts.length > 0, filter);
    assert.ok(posts.every((p) => kinds.includes(p.kind)), filter);
  }
});

await test('ranking: personalised for members with signals, transparent chronological fallback otherwise', async () => {
  const fresh = await register('Eve Feed');
  const f = body(await fresh.call('GET', '/api/feed'));
  assert.strictEqual(f.ranking, 'chronological_fallback');
  const sorted = [...f.posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  assert.deepStrictEqual(f.posts.map((p) => p.id), sorted.map((p) => p.id));
  const b = body(await bob.call('GET', '/api/feed'));
  assert.strictEqual(b.ranking, 'personalized');
  assert.ok(b.posts.every((p) => typeof p.reason === 'string' && p.reason.length > 0));
  // A post matching Bob's skills (RAG) from a stranger is surfaced with that reason.
  const rel = await (await register('Frank Feed')).call('POST', '/api/posts', { text: 'Notes on reranking for RAG pipelines', kind: 'research' });
  const ranked = body(await bob.call('GET', '/api/feed')).posts;
  const hit = ranked.find((p) => p.id === body(rel).post.id);
  assert.ok(hit, 'stranger post reaches Bob');
  assert.match(hit.reason, /RAG/);
});

await test('pagination: cursors page through without duplicates', async () => {
  const g = await register('Gina Feed');
  for (let i = 0; i < 7; i++) await g.call('POST', '/api/posts', { text: `Paged update number ${i}` });
  const seen = new Set();
  let cursor = null;
  let pages = 0;
  do {
    const r = body(await carol.call('GET', `/api/feed?filter=latest&limit=4${cursor ? `&cursor=${cursor}` : ''}`));
    for (const p of r.posts) {
      assert.ok(!seen.has(p.id), 'no duplicates across pages');
      seen.add(p.id);
    }
    cursor = r.nextCursor;
    pages++;
  } while (cursor && pages < 20);
  assert.ok(pages >= 2);
  assert.strictEqual((await carol.call('GET', '/api/feed?cursor=garbage')).statusCode, 400);
});

await test('search and author filter work on persisted posts', async () => {
  const r = body(await carol.call('GET', '/api/feed?filter=latest&q=reranking')).posts;
  assert.ok(r.length >= 1 && r.every((p) => p.text.toLowerCase().includes('reranking')));
  const mine = body(await bob.call('GET', `/api/feed?filter=author&authorId=${bob.id}`)).posts;
  assert.ok(mine.length >= 1 && mine.every((p) => p.author.id === bob.id));
});

await test('safeguarding: adults cannot comment on a minor\'s post', async () => {
  const minor = await register('Minor Feed', { isUnder18: true });
  const p = body(await minor.call('POST', '/api/posts', { text: 'My first robotics project' })).post;
  assert.strictEqual((await bob.call('GET', `/api/posts/${p.id}`)).statusCode, 200);
  assert.strictEqual((await bob.call('POST', `/api/posts/${p.id}/comments`, { text: 'Nice' })).statusCode, 403);
});

await test('storage: social documents round-trip through the shared-store document mapping', async () => {
  const live = durableDb.getSocialState();
  const docs = enumerateDocuments({ ...emptyDocumentState(), ...live });
  const rebuilt = emptyDocumentState();
  for (const [key, json] of docs) {
    const [c, id] = splitKey(key);
    applyDocument(rebuilt, c, id, JSON.parse(json));
  }
  assert.deepStrictEqual(Object.keys(rebuilt.posts).sort(), Object.keys(live.posts).sort());
  assert.deepStrictEqual(Object.keys(rebuilt.postViews).sort(), Object.keys(live.postViews).sort());
  const anyPost = Object.keys(live.posts)[0];
  applyDocument(rebuilt, 'post', anyPost, null);
  assert.strictEqual(rebuilt.posts[anyPost], undefined);
});

await test('rate limit: post creation is limited per member', async () => {
  const h = await register('Hal Feed');
  let last;
  for (let i = 0; i < 11; i++) last = await h.call('POST', '/api/posts', { text: `Rate test ${i}` });
  assert.strictEqual(last.statusCode, 429);
});

console.log(`\n  ${passed}/${total} social feed tests passed`);
