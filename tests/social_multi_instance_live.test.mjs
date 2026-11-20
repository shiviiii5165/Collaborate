/**
 * Two real API processes on one disposable LOCAL Postgres: simultaneous duplicate reposts and
 * cross-instance moderation (dismiss / remove / restore seen by the other instance).
 *
 * Needs COLLABORATE_TEST_PG_URL pointing at an EMPTY, disposable Postgres on localhost, e.g.
 *   docker run --rm -d --name collab-test-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16-alpine
 *   COLLABORATE_TEST_PG_URL=postgres://postgres:test@127.0.0.1:55432/postgres npm run test:live-pg
 * Skips (exit 0) when the variable is not set. Refuses any non-local host.
 */
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import pgPkg from 'pg';

const url = process.env.COLLABORATE_TEST_PG_URL;
if (!url) {
  console.log('SKIPPED: set COLLABORATE_TEST_PG_URL to a disposable local Postgres to run this test.');
  process.exit(0);
}
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`Refusing to run against non-local database host "${host}".`);
  process.exit(1);
}

const db = new pgPkg.Pool({ connectionString: url, ssl: false });
const existing = await db.query(`SELECT to_regclass('public.collaborate_documents') t`);
if (existing.rows[0].t) {
  const n = (await db.query('SELECT count(*)::int n FROM collaborate_documents')).rows[0].n;
  if (n > 0) {
    console.error('Refusing to run: collaborate_documents is not empty (use a fresh disposable database).');
    process.exit(1);
  }
} else {
  const MIG = path.join(process.cwd(), 'src', 'lib', 'db', 'migrations');
  for (const f of fs.readdirSync(MIG).filter((x) => /^\d{3}_.+\.sql$/.test(x)).sort()) await db.query(fs.readFileSync(path.join(MIG, f), 'utf8'));
}

const secret = crypto.randomBytes(32).toString('hex');
const children = [];
function startInstance(port) {
  const env = {
    ...process.env,
    DATABASE_URL: url,
    PORT: String(port),
    NODE_ENV: 'development',
    AUTH_SECRET: secret, // same signing secret on both instances, as in production
    SESSION_SECRET: secret,
    COLLABORATE_DATA_FILE: path.join(process.cwd(), 'tmp-never-used.json'),
  };
  delete env.COLLABORATE_ENABLE_FIXTURES;
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/index.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`instance ${port} did not start:\n${log}`)), 60_000);
    const check = setInterval(() => {
      if (log.includes('Live on')) {
        clearTimeout(t);
        clearInterval(check);
        resolve(`http://127.0.0.1:${port}`);
      }
    }, 100);
  });
}

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

try {
  const [A, B] = await Promise.all([startInstance(4711), startInstance(4712)]);
  console.log(`\n=== Two API processes on one Postgres: ${A} and ${B} ===\n`);

  const req = async (base, cookie, method, p, body) => {
    const res = await fetch(base + p, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {}, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  const register = async (name) => {
    const email = `live_${crypto.randomBytes(4).toString('hex')}@example.invalid`;
    const r = await req(A, null, 'POST', '/api/auth/register', { email, password: 'live-pass-1234', fullName: name });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return { id: r.body.member.id, email, cookie: r.cookie };
  };

  const author = await register('Live Author');
  const reposter = await register('Live Reposter');
  const viewer = await register('Live Viewer');
  const reporters = await Promise.all(['R1', 'R2', 'R3'].map((n) => register(`Live ${n}`)));

  await test('sessions and data are shared: a user registered on A is authenticated on B', async () => {
    const me = await req(B, reposter.cookie, 'GET', '/api/auth/me');
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.member.id, reposter.id);
  });

  await test('simultaneous duplicate reposts on A and B: exactly one stored, the other gets 409 ALREADY_REPOSTED', async () => {
    const originals = [];
    for (let i = 0; i < 8; i++) originals.push((await req(A, author.cookie, 'POST', '/api/posts', { text: `Live original ${i}` })).body.post.id);
    for (const id of originals) {
      const [ra, rb] = await Promise.all([
        req(A, reposter.cookie, 'POST', '/api/posts', { repostOfId: id }),
        req(B, reposter.cookie, 'POST', '/api/posts', { repostOfId: id, text: 'with thoughts' }),
      ]);
      const statuses = [ra.status, rb.status].sort();
      assert.deepStrictEqual(statuses, [201, 409], `statuses for ${id}: ${JSON.stringify([ra.body, rb.body])}`);
      const loser = ra.status === 409 ? ra : rb;
      assert.strictEqual(loser.body.error, 'ALREADY_REPOSTED');
      const n = (await db.query(`SELECT count(*)::int n FROM collaborate_documents WHERE collection='post' AND doc->>'repostOfId'=$1 AND doc->>'authorId'=$2 AND doc->>'deletedAt' IS NULL`, [id, reposter.id])).rows[0].n;
      assert.strictEqual(n, 1, `stored reposts for ${id}`);
      const count = (await req(B, author.cookie, 'GET', `/api/posts/${id}`)).body.post.counts.reposts;
      assert.strictEqual(count, 1);
    }
  });

  // Promote an admin directly in the shared store (as an operator would), then sign in on A.
  const adminUser = await register('Live Admin');
  await db.query(
    `UPDATE collaborate_documents SET doc = jsonb_set(doc, '{role}', '"admin"'), rev = nextval('collaborate_doc_rev_seq'), updated_at = now() WHERE collection='member' AND id=$1`,
    [adminUser.id]
  );
  const adminLogin = await req(A, null, 'POST', '/api/auth/login', { email: adminUser.email, password: 'live-pass-1234' });
  const admin = { cookie: adminLogin.cookie };

  await test('moderation across instances: hidden via reports on B, dismissed on A, visible again on B', async () => {
    const p = (await req(A, author.cookie, 'POST', '/api/posts', { text: 'Live moderation target' })).body.post;
    for (const r of reporters) assert.strictEqual((await req(B, r.cookie, 'POST', `/api/posts/${p.id}/report`, { reason: 'spam' })).status, 200);
    assert.strictEqual((await req(A, viewer.cookie, 'GET', `/api/posts/${p.id}`)).status, 404, 'hidden on A after reports on B');
    const list = await req(A, admin.cookie, 'GET', '/api/admin/reports');
    assert.strictEqual(list.status, 200, JSON.stringify(list.body));
    const item = list.body.items.find((i) => i.targetId === p.id);
    assert.strictEqual(item.state, 'hidden_pending_review');
    assert.strictEqual((await req(B, viewer.cookie, 'GET', '/api/admin/reports')).status, 403, 'members refused on B too');
    const d = await req(A, admin.cookie, 'POST', `/api/admin/reports/${item.reports[0].id}`, { decision: 'dismiss', note: 'live dismiss' });
    assert.strictEqual(d.status, 200, JSON.stringify(d.body));
    assert.strictEqual((await req(B, viewer.cookie, 'GET', `/api/posts/${p.id}`)).status, 200, 'visible on B after dismissal on A');
  });

  await test('moderation across instances: removed on B (admin session from A), hidden on A; restored on A, visible on B', async () => {
    const p = (await req(B, author.cookie, 'POST', '/api/posts', { text: 'Live removal target' })).body.post;
    const rep = (await req(A, reporters[0].cookie, 'POST', `/api/posts/${p.id}/report`, { reason: 'abuse' })).body.reportId;
    const rm = await req(B, admin.cookie, 'POST', `/api/admin/reports/${rep}`, { decision: 'remove', note: 'live remove' });
    assert.strictEqual(rm.status, 200, JSON.stringify(rm.body));
    assert.strictEqual((await req(A, viewer.cookie, 'GET', `/api/posts/${p.id}`)).status, 404);
    assert.strictEqual((await req(A, author.cookie, 'GET', `/api/posts/${p.id}`)).body.post.moderation, 'removed');
    const rs = await req(A, admin.cookie, 'POST', `/api/admin/reports/${rep}`, { decision: 'restore', note: 'live restore' });
    assert.strictEqual(rs.status, 200, JSON.stringify(rs.body));
    assert.strictEqual((await req(B, viewer.cookie, 'GET', `/api/posts/${p.id}`)).status, 200);
    const audit = (await db.query(`SELECT doc->>'decision' d, doc->>'reviewerId' r FROM collaborate_documents WHERE collection='moderation_audit' AND doc->>'targetId'=$1 ORDER BY doc->>'at'`, [p.id])).rows;
    assert.deepStrictEqual(audit.map((a) => a.d), ['remove', 'restore']);
    assert.ok(audit.every((a) => a.r === adminUser.id));
  });

  await test('concurrent moderation decisions on A and B for the same content: one applies, one is refused, one audit entry', async () => {
    const p = (await req(A, author.cookie, 'POST', '/api/posts', { text: 'Live double decision' })).body.post;
    const rep = (await req(B, reporters[1].cookie, 'POST', `/api/posts/${p.id}/report`, { reason: 'spam' })).body.reportId;
    const [x, y] = await Promise.all([
      req(A, admin.cookie, 'POST', `/api/admin/reports/${rep}`, { decision: 'dismiss' }),
      req(B, admin.cookie, 'POST', `/api/admin/reports/${rep}`, { decision: 'dismiss' }),
    ]);
    assert.deepStrictEqual([x.status, y.status].sort(), [200, 409], JSON.stringify([x.body, y.body]));
    const n = (await db.query(`SELECT count(*)::int n FROM collaborate_documents WHERE collection='moderation_audit' AND doc->>'targetId'=$1`, [p.id])).rows[0].n;
    assert.strictEqual(n, 1);
  });
} finally {
  for (const c of children) c.kill();
  await db.end();
}
console.log(`\n=== ${passed}/${total} passed ===`);
