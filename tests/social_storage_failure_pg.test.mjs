/**
 * D3: failed writes are never persisted later. D2: one repost per member is enforced by the
 * shared document key across instances. Real Postgres engine (PGlite, in-process) with a
 * fault-injecting pool. Never touches a real database.
 *
 * Run: npx tsx tests/social_storage_failure_pg.test.mjs
 */
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

delete process.env.DATABASE_URL;
process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
delete process.env.COLLABORATE_ENABLE_FIXTURES;

const MIGRATIONS = path.join(process.cwd(), 'src', 'lib', 'db', 'migrations');
const pg = await PGlite.create();
for (const f of fs.readdirSync(MIGRATIONS).filter((x) => /^\d{3}_.+\.sql$/.test(x)).sort()) {
  await pg.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').replace(/CREATE EXTENSION[^;]+;/gi, ''));
}

// Fault injection: 'connect' fails pool.connect(); 'write' fails the first document INSERT/UPDATE.
const fault = { connect: 0, write: 0 };
let tail = Promise.resolve();
const acquire = () => {
  let release;
  const next = new Promise((r) => (release = r));
  const ready = tail.then(() => release);
  tail = tail.then(() => next);
  return ready;
};
const pool = {
  async query(sql, params = []) {
    const release = await acquire();
    try {
      return await pg.query(sql, params);
    } finally {
      release();
    }
  },
  async connect() {
    if (fault.connect > 0) {
      fault.connect--;
      throw new Error('simulated outage: connection refused');
    }
    const release = await acquire();
    return {
      query: async (sql, params = []) => {
        if (fault.write > 0 && /collaborate_documents/.test(sql) && /^\s*(INSERT|UPDATE)/i.test(sql)) {
          fault.write--;
          throw new Error('simulated outage: connection lost mid-transaction');
        }
        return pg.query(sql, params);
      },
      release,
    };
  },
};
globalThis.__collaborate_durable_db_options__ = { pool };
const { durableDb, DurableCollaborateDatabase, ConcurrentModificationError, StorageWriteDiscardedError } = await import('../src/lib/db/index.ts');
const { buildServer } = await import('../apps/api/src/server.ts');
const { repostId } = await import('../src/modules/social/service.ts');
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
const callAs = (cookie) => (method, url, payload) =>
  app.inject({ method, url, headers: { cookie, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: payload !== undefined ? JSON.stringify(payload) : undefined });
async function register(name) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email: `st_${crypto.randomBytes(4).toString('hex')}@example.invalid`, password: 'storage-pass-1', fullName: name }) });
  assert.strictEqual(r.statusCode, 201, r.body);
  return { id: J(r).member.id, call: callAs(String(r.headers['set-cookie']).split(';')[0]) };
}
const storedPosts = async (text) => (await pg.query(`SELECT id FROM collaborate_documents WHERE collection='post' AND doc->>'text'=$1`, [text])).rows;
const inMemory = (text) => Object.values(durableDb.getSocialState().posts).filter((p) => p.text === text);

const alice = await register('Storage Alice');
const bob = await register('Storage Bob');

console.log('\n=== D3 failed-write durability / D2 repost identity (PGlite) ===\n');

await test('outage at connect: client gets 503, nothing stored, nothing left in memory', async () => {
  fault.connect = 1;
  const r = await alice.call('POST', '/api/posts', { text: 'Written during outage A' });
  assert.strictEqual(r.statusCode, 503, r.body);
  assert.strictEqual((await storedPosts('Written during outage A')).length, 0);
  assert.strictEqual(inMemory('Written during outage A').length, 0, 'not visible to later requests on this instance');
});

await test('recovery: an unrelated later write succeeds and does NOT persist the failed post', async () => {
  const r = await bob.call('POST', '/api/posts', { text: 'Unrelated write after recovery' });
  assert.strictEqual(r.statusCode, 201, r.body);
  assert.strictEqual((await storedPosts('Unrelated write after recovery')).length, 1);
  assert.strictEqual((await storedPosts('Written during outage A')).length, 0);
  const feed = J(await bob.call('GET', '/api/feed?filter=latest')).posts.map((p) => p.text);
  assert.ok(!feed.includes('Written during outage A'));
});

await test('client retry after the failed write creates exactly one post (no duplicate, no false 409)', async () => {
  const r = await alice.call('POST', '/api/posts', { text: 'Written during outage A' });
  assert.strictEqual(r.statusCode, 201, r.body);
  assert.strictEqual((await storedPosts('Written during outage A')).length, 1);
});

await test('outage mid-transaction: 503, rolled back, engagement not left pending', async () => {
  const p = J(await alice.call('POST', '/api/posts', { text: 'Target for failed like' })).post;
  fault.write = 1;
  const like = await bob.call('POST', `/api/posts/${p.id}/like`, { liked: true });
  assert.strictEqual(like.statusCode, 503, like.body);
  assert.strictEqual(durableDb.getSocialState().postLikes[`${p.id}|${bob.id}`], undefined);
  await bob.call('POST', '/api/posts', { text: 'Another unrelated write' });
  const stored = (await pg.query(`SELECT count(*)::int n FROM collaborate_documents WHERE collection='post_like' AND id=$1`, [`${p.id}|${bob.id}`])).rows[0].n;
  assert.strictEqual(stored, 0, 'the failed like was never written later');
  // Retry succeeds and counts once.
  const retry = await bob.call('POST', `/api/posts/${p.id}/like`, { liked: true });
  assert.strictEqual(J(retry).likes, 1);
});

await test('a concurrent request whose changes were discarded by another failed flush reports failure, not success', async () => {
  // Request 2 starts (epoch recorded) and mutates; request 1's flush fails and discards everything.
  const epochAtStart = durableDb.discardEpoch;
  const s = durableDb.getSocialState();
  s.posts.post_concurrent_probe = { id: 'post_concurrent_probe', authorId: alice.id, kind: 'update', text: 'concurrent probe', topics: [], attachments: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  durableDb.markSocialChanged();
  fault.connect = 1;
  await assert.rejects(() => durableDb.flush(true), /simulated outage/);
  assert.strictEqual(s.posts.post_concurrent_probe, undefined, 'discarded, not pending');
  await assert.rejects(() => durableDb.flush(true, epochAtStart), (e) => e instanceof StorageWriteDiscardedError);
  assert.strictEqual((await pg.query(`SELECT count(*)::int n FROM collaborate_documents WHERE id='post_concurrent_probe'`)).rows[0].n, 0);
  // A request that started after the failure is unaffected.
  await durableDb.flush(true, durableDb.discardEpoch);
});

await test('conflict path: non-conflicting changes in the rejected flush are discarded too (nothing written)', async () => {
  const other = new DurableCollaborateDatabase({ pool });
  await other.syncFromStore();
  await durableDb.syncFromStore();
  const target = J(await alice.call('POST', '/api/posts', { text: 'Conflict target' })).post;
  await other.syncFromStore();
  // Instance B edits the post and commits first.
  other.getSocialState().posts[target.id] = { ...other.getSocialState().posts[target.id], text: 'Edited on B' };
  other.markSocialChanged();
  await other.flush();
  // Instance A edits the same post AND creates an unrelated post in the same flush.
  const sa = durableDb.getSocialState();
  sa.posts[target.id] = { ...sa.posts[target.id], text: 'Edited on A' };
  sa.posts.post_side_effect = { ...sa.posts[target.id], id: 'post_side_effect', text: 'side effect' };
  durableDb.markSocialChanged();
  await assert.rejects(() => durableDb.flush(), (e) => e instanceof ConcurrentModificationError);
  assert.strictEqual(sa.posts.post_side_effect, undefined, 'unrelated change discarded with the failed flush');
  assert.strictEqual(sa.posts[target.id].text, 'Edited on B', 'conflicting document reloaded from the database');
  await bob.call('POST', '/api/posts', { text: 'Write after conflict' });
  assert.strictEqual((await pg.query(`SELECT count(*)::int n FROM collaborate_documents WHERE id='post_side_effect'`)).rows[0].n, 0);
});

await test('D2: two instances storing the same member\'s repost: one wins, the other is rejected, one stored', async () => {
  const orig = J(await alice.call('POST', '/api/posts', { text: 'Original for cross-instance repost' })).post;
  const other = new DurableCollaborateDatabase({ pool });
  await other.syncFromStore();
  await durableDb.syncFromStore();
  const id = repostId(orig.id, bob.id);
  const doc = (text) => ({ id, authorId: bob.id, kind: 'update', text, topics: [], attachments: [], repostOfId: orig.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  // Neither instance has seen the other's repost (simultaneous requests).
  durableDb.getSocialState().posts[id] = doc('from A');
  durableDb.markSocialChanged();
  other.getSocialState().posts[id] = doc('from B');
  other.markSocialChanged();
  const results = await Promise.allSettled([durableDb.flush(), other.flush()]);
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const conflicts = results.filter((r) => r.status === 'rejected' && r.reason instanceof ConcurrentModificationError);
  assert.strictEqual(ok, 1);
  assert.strictEqual(conflicts.length, 1);
  assert.ok(conflicts[0].reason.keys.every((k) => k.startsWith('post/post_rp_')));
  const n = (await pg.query(`SELECT count(*)::int n FROM collaborate_documents WHERE collection='post' AND doc->>'repostOfId'=$1 AND doc->>'authorId'=$2 AND doc->>'deletedAt' IS NULL`, [orig.id, bob.id])).rows[0].n;
  assert.strictEqual(n, 1);
  // A later API attempt from either side gets the clear duplicate response.
  const again = await bob.call('POST', '/api/posts', { repostOfId: orig.id });
  assert.strictEqual(again.statusCode, 409);
  assert.strictEqual(J(again).error, 'ALREADY_REPOSTED');
});

await test('media cleanup vs attach on another instance: the claim wins, the stale attach conflicts, nothing dangles', async () => {
  const { setMediaStore } = await import('../src/lib/media/r2.ts');
  const Media = await import('../src/modules/media/service.ts');
  const deletedKeys = [];
  setMediaStore({ presignPut: async () => '', presignGet: async () => '', head: async () => null, readPrefix: async () => Buffer.alloc(0), delete: async (k) => void deletedKeys.push(k) });
  const id = `med_race_${crypto.randomBytes(4).toString('hex')}`;
  const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
  await durableDb.syncFromStore();
  durableDb.getSocialState().mediaObjects[id] = { id, ownerId: bob.id, key: `posts/${bob.id}/${id}.png`, kind: 'image', contentType: 'image/png', size: 10, fileName: 'a.png', status: 'ready', createdAt: old, uploadedAt: old };
  durableDb.markSocialChanged();
  await durableDb.flush(true);
  // Instance B loads the (stale, unused) upload and is about to attach it.
  const other = new DurableCollaborateDatabase({ pool });
  await other.syncFromStore();
  // Instance A's cleanup claims and deletes it first.
  const r = await Media.cleanupOrphanMedia();
  assert.ok(r.deleted >= 1 && deletedKeys.includes(`posts/${bob.id}/${id}.png`));
  // B's attach is based on the old revision: rejected, so no post can reference the deleted object.
  other.getSocialState().mediaObjects[id] = { ...other.getSocialState().mediaObjects[id], status: 'attached', postId: 'post_x' };
  other.markSocialChanged();
  await assert.rejects(() => other.flush(), (e) => e instanceof ConcurrentModificationError);
  const row = (await pg.query(`SELECT doc FROM collaborate_documents WHERE collection='media_object' AND id=$1`, [id])).rows[0];
  assert.ok(!row || row.doc === null, 'record deleted, not re-attached');
  setMediaStore(undefined);
});

await test('regression: profile save path (saveMemberAsync) still reverts on failure and works after', async () => {
  const before = durableDb.getMemberById(alice.id);
  fault.connect = 1;
  await assert.rejects(() => durableDb.saveMemberAsync({ ...before, headline: 'Unsaved headline' }));
  assert.notStrictEqual(durableDb.getMemberById(alice.id).headline, 'Unsaved headline');
  await durableDb.saveMemberAsync({ ...before, headline: 'Saved headline' });
  const row = (await pg.query(`SELECT doc->>'headline' h FROM collaborate_documents WHERE collection='member' AND id=$1`, [alice.id])).rows[0];
  assert.strictEqual(row.h, 'Saved headline');
});

console.log(`\n=== ${passed}/${total} passed ===`);
