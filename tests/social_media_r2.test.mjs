/**
 * R2 media uploads for posts: validation, ownership, signed URLs, attachment linking, visibility
 * and orphan cleanup. Uses an in-memory FAKE R2 store; never contacts a real bucket. The one
 * real-SDK test only signs URLs offline with dummy credentials (signing makes no network call).
 *
 * Run: npx tsx --import ./tests/setup-isolated-db.mjs tests/social_media_r2.test.mjs
 */
import assert from 'node:assert';
import crypto from 'node:crypto';

process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
delete process.env.COLLABORATE_ENABLE_FIXTURES;
for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_ENDPOINT']) delete process.env[k];

const { buildServer } = await import('../apps/api/src/server.ts');
const { durableDb } = await import('../src/lib/db/index.ts');
const { setMediaStore, getMediaStore, readR2Config } = await import('../src/lib/media/r2.ts');
const Media = await import('../src/modules/media/service.ts');

// ---------------------------------------------------------------------------
// Fake R2: objects in a Map; signed URLs are opaque tokens recorded for assertions.
// ---------------------------------------------------------------------------
class FakeR2 {
  objects = new Map();
  signedPuts = [];
  signedGets = [];
  deleted = [];
  failDeletes = 0;
  async presignPut(key, contentType, size, expires) {
    this.signedPuts.push({ key, contentType, size, expires });
    return `https://fake-r2.invalid/put/${encodeURIComponent(key)}?ct=${encodeURIComponent(contentType)}&len=${size}&exp=${expires}`;
  }
  async presignGet(key, expires, opts) {
    this.signedGets.push({ key, expires, ...opts });
    return `https://fake-r2.invalid/get/${encodeURIComponent(key)}?exp=${expires}`;
  }
  async head(key) {
    const o = this.objects.get(key);
    return o ? { size: o.body.length, contentType: o.contentType } : null;
  }
  async readPrefix(key, n) {
    return this.objects.get(key).body.subarray(0, n);
  }
  async delete(key) {
    if (this.failDeletes > 0) {
      this.failDeletes--;
      throw new Error('simulated R2 outage');
    }
    this.deleted.push(key);
    this.objects.delete(key);
  }
  /** What the browser does with the signed URL. */
  put(key, body, contentType) {
    this.objects.set(key, { body, contentType });
  }
}
const r2 = new FakeR2();
setMediaStore(r2);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(200)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(300)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), crypto.randomBytes(500)]);
const HTML_AS_PNG = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(200, ' '));

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
  const email = `media_${crypto.randomBytes(5).toString('hex')}@example.invalid`;
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email, password: 'media-pass-1234', fullName: name }) });
  assert.strictEqual(r.statusCode, 201, r.body);
  return { id: J(r).member.id, email, call: sessionCall(String(r.headers['set-cookie']).split(';')[0]) };
}
async function promoteToAdmin(u) {
  durableDb.saveMember({ ...durableDb.getMemberById(u.id), role: 'admin' });
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email: u.email, password: 'media-pass-1234' }) });
  return { ...u, call: sessionCall(String(r.headers['set-cookie']).split(';')[0]) };
}
const mediaDoc = (id) => durableDb.getSocialState().mediaObjects[id];

/** Full browser flow: request URL, PUT bytes to (fake) R2, complete. */
async function upload(user, body, { contentType = 'image/png', fileName = 'photo.png', kind } = {}) {
  const start = await user.call('POST', '/api/media/uploads', { fileName, contentType, size: body.length, ...(kind ? { kind } : {}) });
  assert.strictEqual(start.statusCode, 201, start.body);
  const { media, upload: up } = J(start);
  r2.put(mediaDoc(media.id).key, body, contentType);
  const done = await user.call('POST', `/api/media/${media.id}/complete`, {});
  return { id: media.id, start: J(start), done, up };
}

const alice = await register('Media Alice');
const bob = await register('Media Bob');
const carol = await register('Media Carol');
const admin = await promoteToAdmin(await register('Media Admin'));

console.log('\n=== R2 media uploads (fake R2, isolated store) ===\n');

await test('not configured: uploads answer 503 MEDIA_NOT_CONFIGURED; env config needs all five variables', async () => {
  setMediaStore(null);
  const r = await alice.call('POST', '/api/media/uploads', { fileName: 'a.png', contentType: 'image/png', size: 100 });
  assert.strictEqual(r.statusCode, 503);
  assert.strictEqual(J(r).error, 'MEDIA_NOT_CONFIGURED');
  setMediaStore(r2);
  assert.strictEqual(readR2Config({}), null);
  assert.strictEqual(readR2Config({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c' }), null, 'bucket missing');
  const cfg = readR2Config({ R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET_NAME: 'collaborate-media', R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com' });
  assert.strictEqual(cfg.bucket, 'collaborate-media');
});

await test('authentication required for every media route', async () => {
  for (const [m, u] of [['POST', '/api/media/uploads'], ['POST', '/api/media/med_x/complete'], ['DELETE', '/api/media/med_x'], ['GET', '/api/media/med_x']]) {
    assert.strictEqual((await app.inject({ method: m, url: u })).statusCode, 401, `${m} ${u}`);
  }
  assert.strictEqual((await alice.call('POST', '/api/admin/media/cleanup', {})).statusCode, 403);
});

await test('validation: type allow-list (no SVG/HTML), size limits per type, kind mismatch, file name sanitised', async () => {
  const bad = async (body, status, code) => {
    const r = await alice.call('POST', '/api/media/uploads', body);
    assert.strictEqual(r.statusCode, status, `${JSON.stringify(body)} -> ${r.body}`);
    assert.strictEqual(J(r).error, code);
  };
  await bad({ fileName: 'x.svg', contentType: 'image/svg+xml', size: 100 }, 400, 'UNSUPPORTED_FILE_TYPE');
  await bad({ fileName: 'x.html', contentType: 'text/html', size: 100 }, 400, 'UNSUPPORTED_FILE_TYPE');
  await bad({ fileName: 'x.exe', contentType: 'application/octet-stream', size: 100 }, 400, 'UNSUPPORTED_FILE_TYPE');
  await bad({ fileName: 'x.png', contentType: 'image/png', size: 10 * 1024 * 1024 + 1 }, 413, 'FILE_TOO_LARGE');
  await bad({ fileName: 'x.pdf', contentType: 'application/pdf', size: 20 * 1024 * 1024 + 1 }, 413, 'FILE_TOO_LARGE');
  await bad({ fileName: 'x.mp4', contentType: 'video/mp4', size: 100 * 1024 * 1024 + 1 }, 413, 'FILE_TOO_LARGE');
  await bad({ fileName: 'x.png', contentType: 'image/png', size: 0 }, 400, 'VALIDATION_ERROR');
  await bad({ fileName: 'x.png', contentType: 'image/png', size: 1.5 }, 400, 'VALIDATION_ERROR');
  await bad({ fileName: 'x.pdf', contentType: 'application/pdf', size: 100, kind: 'image' }, 400, 'UNSUPPORTED_FILE_TYPE');
  // Video at exactly the limit is accepted.
  const ok = await alice.call('POST', '/api/media/uploads', { fileName: '../../etc/<evil>"name".mp4', contentType: 'video/mp4', size: 100 * 1024 * 1024 });
  assert.strictEqual(ok.statusCode, 201, ok.body);
  const doc = mediaDoc(J(ok).media.id);
  assert.strictEqual(doc.fileName, 'evilname.mp4');
  assert.match(doc.key, new RegExp(`^posts/${alice.id}/med_[a-z0-9]+\\.mp4$`), 'key never contains the user file name');
});

await test('signed upload URL: short-lived, bound to declared type and size; record stays pending until verified', async () => {
  const start = await alice.call('POST', '/api/media/uploads', { fileName: 'pic.png', contentType: 'image/png', size: PNG.length });
  const { media, upload: up } = J(start);
  assert.strictEqual(up.method, 'PUT');
  assert.deepStrictEqual(up.headers, { 'Content-Type': 'image/png' });
  const signed = r2.signedPuts.at(-1);
  assert.deepStrictEqual([signed.contentType, signed.size, signed.expires], ['image/png', PNG.length, 600]);
  assert.strictEqual(media.status, 'pending');
  assert.ok(!('key' in media) && !('ownerId' in media), 'storage key and owner are not exposed');
  // Completing before the browser uploaded anything: clear retryable error.
  const early = await alice.call('POST', `/api/media/${media.id}/complete`, {});
  assert.strictEqual(early.statusCode, 409);
  assert.strictEqual(J(early).error, 'UPLOAD_NOT_FOUND');
  r2.put(mediaDoc(media.id).key, PNG, 'image/png');
  const done = await alice.call('POST', `/api/media/${media.id}/complete`, {});
  assert.strictEqual(done.statusCode, 200, done.body);
  assert.strictEqual(J(done).media.status, 'ready');
  // Retrying completion is idempotent.
  assert.strictEqual((await alice.call('POST', `/api/media/${media.id}/complete`, {})).statusCode, 200);
});

await test('verification rejects files that differ from what was declared (size, type, file signature) and deletes them', async () => {
  // Wrong signature: HTML bytes declared as PNG.
  const s1 = J(await alice.call('POST', '/api/media/uploads', { fileName: 'x.png', contentType: 'image/png', size: HTML_AS_PNG.length }));
  const k1 = mediaDoc(s1.media.id).key;
  r2.put(k1, HTML_AS_PNG, 'image/png');
  const r1 = await alice.call('POST', `/api/media/${s1.media.id}/complete`, {});
  assert.strictEqual(r1.statusCode, 422);
  assert.strictEqual(J(r1).error, 'UPLOAD_REJECTED');
  assert.ok(!r2.objects.has(k1) && mediaDoc(s1.media.id) === undefined, 'object and record removed');
  // Size mismatch.
  const s2 = J(await alice.call('POST', '/api/media/uploads', { fileName: 'y.png', contentType: 'image/png', size: PNG.length + 10 }));
  r2.put(mediaDoc(s2.media.id).key, PNG, 'image/png');
  assert.strictEqual((await alice.call('POST', `/api/media/${s2.media.id}/complete`, {})).statusCode, 422);
  // Stored content type differs from the declared one.
  const s3 = J(await alice.call('POST', '/api/media/uploads', { fileName: 'z.pdf', contentType: 'application/pdf', size: PDF.length }));
  r2.put(mediaDoc(s3.media.id).key, PDF, 'text/html');
  assert.strictEqual((await alice.call('POST', `/api/media/${s3.media.id}/complete`, {})).statusCode, 422);
});

await test('ownership: another member cannot complete, read, delete or attach someone else\'s upload', async () => {
  const { id } = await upload(alice, PNG);
  assert.strictEqual((await bob.call('POST', `/api/media/${id}/complete`, {})).statusCode, 404);
  assert.strictEqual((await bob.call('GET', `/api/media/${id}`)).statusCode, 404, 'unattached upload is private to its owner');
  assert.strictEqual((await bob.call('DELETE', `/api/media/${id}`)).statusCode, 404);
  const steal = await bob.call('POST', '/api/posts', { text: 'Using Alice\'s file', attachments: [{ type: 'image', mediaId: id }] });
  assert.strictEqual(steal.statusCode, 400);
  assert.strictEqual(J(steal).error, 'MEDIA_NOT_FOUND');
  assert.strictEqual(mediaDoc(id).status, 'ready', 'unchanged');
  // The owner can preview it before posting.
  const own = await alice.call('GET', `/api/media/${id}`);
  assert.strictEqual(own.statusCode, 302);
});

let imagePost;
let imageId;
let pdfId;
await test('attachment linking: post with uploaded image + PDF; media becomes attached; URL is the API path, not R2', async () => {
  imageId = (await upload(alice, PNG)).id;
  pdfId = (await upload(alice, PDF, { contentType: 'application/pdf', fileName: 'Research paper.pdf' })).id;
  const r = await alice.call('POST', '/api/posts', {
    text: 'Results from our experiment',
    attachments: [
      { type: 'image', mediaId: imageId, title: 'Figure 1' },
      { type: 'document', mediaId: pdfId },
      { type: 'link', url: 'https://example.com/code' },
    ],
  });
  assert.strictEqual(r.statusCode, 201, r.body);
  imagePost = J(r).post;
  const [img, pdf, link] = imagePost.attachments;
  assert.deepStrictEqual([img.type, img.url, img.title, img.mediaId], ['image', `/api/media/${imageId}`, 'Figure 1', imageId]);
  assert.deepStrictEqual([pdf.type, pdf.fileName, pdf.size], ['document', 'Research paper.pdf', PDF.length]);
  assert.strictEqual(link.url, 'https://example.com/code');
  assert.ok(!JSON.stringify(imagePost).includes('fake-r2') && !JSON.stringify(imagePost).includes('posts/'), 'no storage keys or signed URLs stored in the post');
  assert.strictEqual(mediaDoc(imageId).status, 'attached');
  assert.strictEqual(mediaDoc(imageId).postId, imagePost.id);
  // The post body in the store keeps only the reference.
  assert.strictEqual(durableDb.getSocialState().posts[imagePost.id].attachments[0].mediaId, imageId);
});

await test('attachment rules: unfinished, reused, duplicated, mistyped and link-with-mediaId attachments are refused', async () => {
  const pending = J(await alice.call('POST', '/api/media/uploads', { fileName: 'p.png', contentType: 'image/png', size: PNG.length })).media.id;
  const e = async (attachments, code) => {
    const r = await alice.call('POST', '/api/posts', { text: `attempt ${crypto.randomBytes(3).toString('hex')}`, attachments });
    assert.strictEqual(r.statusCode, 400, r.body);
    assert.strictEqual(J(r).error, code);
  };
  await e([{ type: 'image', mediaId: pending }], 'UPLOAD_INCOMPLETE');
  await e([{ type: 'image', mediaId: imageId }], 'MEDIA_IN_USE');
  const fresh = (await upload(alice, PNG)).id;
  await e([{ type: 'image', mediaId: fresh }, { type: 'image', mediaId: fresh }], 'VALIDATION_ERROR');
  await e([{ type: 'video', mediaId: fresh }], 'VALIDATION_ERROR');
  await e([{ type: 'link', mediaId: fresh }], 'VALIDATION_ERROR');
  await e([{ type: 'image', mediaId: 'med_doesnotexist' }], 'MEDIA_NOT_FOUND');
  // A link attachment can never point at our media path (must be absolute https).
  await e([{ type: 'image', url: `/api/media/${fresh}` }], 'VALIDATION_ERROR');
  assert.strictEqual(mediaDoc(fresh).status, 'ready', 'failed posts leave the upload usable');
});

await test('reading: members who can see the post get a 302 to a 5-minute signed URL; PDFs download, images inline', async () => {
  const r = await bob.call('GET', `/api/media/${imageId}`);
  assert.strictEqual(r.statusCode, 302);
  assert.match(r.headers.location, /^https:\/\/fake-r2\.invalid\/get\//);
  assert.strictEqual(r.headers['cache-control'], 'private, no-store');
  const g = r2.signedGets.at(-1);
  assert.deepStrictEqual([g.expires, g.contentType, g.downloadName], [300, 'image/png', undefined]);
  await bob.call('GET', `/api/media/${pdfId}`);
  assert.strictEqual(r2.signedGets.at(-1).downloadName, 'Research paper.pdf');
  const asJson = J(await bob.call('GET', `/api/media/${imageId}?format=json`));
  assert.strictEqual(asJson.expiresIn, 300);
});

await test('reading follows post visibility: blocked members, hidden and removed posts; author and admins still see it', async () => {
  // Carol blocks Alice: Carol can no longer load Alice's media.
  assert.strictEqual((await carol.call('GET', `/api/media/${imageId}`)).statusCode, 302, 'visible before the block');
  await durableDb.blockMemberAsync(carol.id, alice.id);
  assert.ok(durableDb.getBlockedIdsFor(carol.id).has(alice.id));
  assert.strictEqual((await carol.call('GET', `/api/media/${imageId}`)).statusCode, 404, 'blocked');
  // Admin removes the post: media hidden from members, kept for author/admin and for restore.
  const rep = J(await bob.call('POST', `/api/posts/${imagePost.id}/report`, { reason: 'spam' })).reportId;
  assert.strictEqual((await admin.call('POST', `/api/admin/reports/${rep}`, { decision: 'remove', note: 'test' })).statusCode, 200);
  assert.strictEqual((await bob.call('GET', `/api/media/${imageId}`)).statusCode, 404, 'removed post: hidden');
  assert.strictEqual((await alice.call('GET', `/api/media/${imageId}`)).statusCode, 302, 'author still sees own media');
  assert.strictEqual((await admin.call('GET', `/api/media/${imageId}`)).statusCode, 302, 'admin can review');
  assert.strictEqual(mediaDoc(imageId).status, 'attached', 'moderation keeps media for restore');
  assert.strictEqual((await admin.call('POST', `/api/admin/reports/${rep}`, { decision: 'restore' })).statusCode, 200);
  assert.strictEqual((await bob.call('GET', `/api/media/${imageId}`)).statusCode, 302, 'restored');
});

await test('edit: removing an uploaded file detaches it; adding a new one attaches it; others keep working', async () => {
  const newImg = (await upload(alice, PNG)).id;
  const r = await alice.call('PUT', `/api/posts/${imagePost.id}`, {
    attachments: [{ type: 'image', mediaId: newImg }, { type: 'document', mediaId: pdfId }],
  });
  assert.strictEqual(r.statusCode, 200, r.body);
  assert.strictEqual(mediaDoc(imageId).status, 'detached');
  assert.strictEqual(mediaDoc(newImg).status, 'attached');
  assert.strictEqual(mediaDoc(pdfId).status, 'attached', 'kept attachment stays attached to the same post');
  assert.strictEqual((await bob.call('GET', `/api/media/${imageId}`)).statusCode, 404, 'detached media is no longer served');
  imageId = newImg;
});

await test('discard: owner deletes an unused upload immediately (R2 object and record); attached files cannot be discarded', async () => {
  const { id } = await upload(alice, PNG);
  const key = mediaDoc(id).key;
  assert.strictEqual((await alice.call('DELETE', `/api/media/${id}`)).statusCode, 200);
  assert.ok(!r2.objects.has(key) && mediaDoc(id) === undefined);
  const inUse = await alice.call('DELETE', `/api/media/${imageId}`);
  assert.strictEqual(inUse.statusCode, 409);
  assert.strictEqual(J(inUse).error, 'MEDIA_IN_USE');
});

await test('quota: at most 20 unfinished uploads per member', async () => {
  const before = Object.values(durableDb.getSocialState().mediaObjects).filter((m) => m.ownerId === carol.id && ['pending', 'ready'].includes(m.status)).length;
  for (let i = before; i < 20; i++) assert.strictEqual((await carol.call('POST', '/api/media/uploads', { fileName: `${i}.png`, contentType: 'image/png', size: 100 })).statusCode, 201);
  const over = await carol.call('POST', '/api/media/uploads', { fileName: 'more.png', contentType: 'image/png', size: 100 });
  assert.strictEqual(over.statusCode, 429);
  assert.strictEqual(J(over).error, 'TOO_MANY_UPLOADS');
});

await test('orphan cleanup: deletes stale pending, unused ready, detached and deleted-post media; keeps attached and fresh', async () => {
  const fresh = (await upload(bob, PNG)).id;
  const staleReady = (await upload(bob, PNG)).id;
  const stalePending = J(await bob.call('POST', '/api/media/uploads', { fileName: 'p.png', contentType: 'image/png', size: 100 })).media.id;
  const s = durableDb.getSocialState().mediaObjects;
  const longAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
  s[staleReady] = { ...s[staleReady], uploadedAt: longAgo, createdAt: longAgo };
  s[stalePending] = { ...s[stalePending], createdAt: longAgo };
  // A post deleted by its author: its media is detached and cleaned.
  const vid = (await upload(bob, MP4, { contentType: 'video/mp4', fileName: 'demo.mp4' })).id;
  const vpost = J(await bob.call('POST', '/api/posts', { text: 'Demo video', attachments: [{ type: 'video', mediaId: vid }] })).post;
  assert.strictEqual(mediaDoc(vid).status, 'attached');
  assert.strictEqual((await bob.call('DELETE', `/api/posts/${vpost.id}`)).statusCode, 200);
  assert.strictEqual(mediaDoc(vid).status, 'detached');
  const detachedEarlier = Object.values(s).filter((m) => m.status === 'detached').map((m) => m.id);
  const keys = Object.fromEntries([fresh, staleReady, stalePending, vid, imageId, pdfId].map((id) => [id, mediaDoc(id).key]));

  const res = await admin.call('POST', '/api/admin/media/cleanup', {});
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.ok(J(res).deleted >= 3 + detachedEarlier.length - 1);
  for (const id of [staleReady, stalePending, vid, ...detachedEarlier]) assert.strictEqual(mediaDoc(id), undefined, `${id} removed`);
  for (const id of [staleReady, vid]) assert.ok(r2.deleted.includes(keys[id]), `${id} deleted from R2`);
  for (const id of [fresh, imageId, pdfId]) assert.ok(mediaDoc(id), `${id} kept`);
  assert.ok(!r2.deleted.includes(keys[imageId]));
});

await test('cleanup: an R2 failure leaves the record claimed (not attachable) and it is retried later', async () => {
  const id = (await upload(bob, PNG)).id;
  durableDb.getSocialState().mediaObjects[id] = { ...mediaDoc(id), status: 'detached' };
  r2.failDeletes = 1;
  const first = await Media.cleanupOrphanMedia();
  assert.strictEqual(first.failed, 1);
  assert.strictEqual(mediaDoc(id).status, 'deleting');
  const att = await bob.call('POST', '/api/posts', { text: 'try claimed file', attachments: [{ type: 'image', mediaId: id }] });
  assert.strictEqual(att.statusCode, 400, 'a claimed file cannot be attached');
  const retry = await Media.cleanupOrphanMedia({ now: Date.now() + Media.MEDIA_LIMITS.deletingTtlMs + 1000 });
  assert.ok(retry.deleted >= 1);
  assert.strictEqual(mediaDoc(id), undefined);
});

await test('real R2 client (offline signing only): signed PUT binds content-type and content-length, signed GET is short-lived', async () => {
  setMediaStore(undefined);
  const saved = { ...process.env };
  Object.assign(process.env, {
    R2_ACCOUNT_ID: 'testaccount',
    R2_ACCESS_KEY_ID: 'AKIATESTONLY',
    R2_SECRET_ACCESS_KEY: 'test-secret-not-real',
    R2_BUCKET_NAME: 'test-bucket',
    R2_ENDPOINT: 'https://testaccount.r2.cloudflarestorage.com',
  });
  try {
    const store = getMediaStore();
    const put = new URL(await store.presignPut('posts/u/med_1.png', 'image/png', 1234, 600));
    assert.strictEqual(put.hostname, 'testaccount.r2.cloudflarestorage.com');
    assert.ok(put.pathname.startsWith('/test-bucket/posts/u/med_1.png'), put.pathname);
    assert.strictEqual(put.searchParams.get('X-Amz-Expires'), '600');
    const signedHeaders = put.searchParams.get('X-Amz-SignedHeaders').split(';');
    assert.ok(signedHeaders.includes('content-type') && signedHeaders.includes('content-length'), signedHeaders.join(';'));
    assert.ok(!put.searchParams.has('x-amz-checksum-crc32'), 'no SDK checksum parameter (R2 rejects it on presigned PUT)');
    const get = new URL(await store.presignGet('posts/u/med_1.pdf', 300, { contentType: 'application/pdf', downloadName: 'a "b".pdf' }));
    assert.strictEqual(get.searchParams.get('X-Amz-Expires'), '300');
    assert.match(get.searchParams.get('response-content-disposition'), /^attachment; filename="a _b_.pdf"$/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    setMediaStore(r2);
  }
});

await test('regression: link-only posts, reposts and editing text are unchanged', async () => {
  const p = await alice.call('POST', '/api/posts', { text: 'Link only post', attachments: [{ type: 'link', url: 'https://example.org' }] });
  assert.strictEqual(p.statusCode, 201, p.body);
  assert.strictEqual(J(p).post.attachments[0].url, 'https://example.org/');
  const rp = await bob.call('POST', '/api/posts', { repostOfId: J(p).post.id });
  assert.strictEqual(rp.statusCode, 201);
  const ed = await alice.call('PUT', `/api/posts/${imagePost.id}`, { text: 'Edited text only' });
  assert.strictEqual(ed.statusCode, 200);
  assert.strictEqual(J(ed).post.attachments.length, 2, 'attachments untouched by text edit');
});

console.log(`\n=== ${passed}/${total} passed ===`);
