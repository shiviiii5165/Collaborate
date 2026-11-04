/**
 * Phase 2: multi-instance durable storage against a real Postgres engine (PGlite, in-process).
 * Two DurableCollaborateDatabase instances share one database, standing in for two API
 * instances on Render. Applies migrations 001-003 exactly as shipped (minus the uuid-ossp
 * extension, which 001 does not use and PGlite does not bundle).
 *
 * Run: npx tsx tests/phase2_multi_instance_pg.test.mjs
 */
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

delete process.env.DATABASE_URL; // never touch a real database from this test
process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
process.env.COLLABORATE_ENABLE_FIXTURES = 'true';
process.env.TATHASTU_INTEGRATION_MODE = 'live';
process.env.AIT_CLIENT_SECRET = 'test_only_client_secret_not_real';
process.env.AIT_REDIRECT_URI = 'https://collaborate.aitathastu.com/api/auth/tathastu/callback';
process.env.AI_TATHASTU_CLIENT_ID = 'collaborate';
process.env.AI_TATHASTU_BASE_URL = 'https://www.aitathastu.com';
const WEBHOOK_SECRET = 'pg_test_webhook_secret_7781';
process.env.AI_TATHASTU_WEBHOOK_SECRET = WEBHOOK_SECRET;

const MIGRATIONS = path.join(process.cwd(), 'src', 'lib', 'db', 'migrations');

/** pg-compatible pool over one PGlite connection; a mutex serializes "connections". */
function poolFor(pg) {
  let tail = Promise.resolve();
  const acquire = () => {
    let release;
    const next = new Promise((r) => (release = r));
    const ready = tail.then(() => release);
    tail = tail.then(() => next);
    return ready;
  };
  return {
    async query(sql, params = []) {
      const release = await acquire();
      try {
        return await pg.query(sql, params);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await acquire();
      return { query: (sql, params = []) => pg.query(sql, params), release };
    },
  };
}

async function freshDatabase() {
  const pg = await PGlite.create();
  for (const f of fs.readdirSync(MIGRATIONS).filter((x) => /^\d{3}_.+\.sql$/.test(x)).sort()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').replace(/CREATE EXTENSION[^;]+;/gi, '');
    await pg.exec(sql);
  }
  return { pg, pool: poolFor(pg) };
}

const shared = await freshDatabase();
globalThis.__collaborate_durable_db_options__ = { pool: shared.pool }; // server singleton = instance A
const { DurableCollaborateDatabase, ConcurrentModificationError, BackfillRequiredError, durableDb: instanceA } = await import('../src/lib/db/index.ts');
const { buildServer } = await import('../apps/api/src/server.ts');
const { projectionV1 } = await import('./helpers/projection-v1.mjs');

const instanceB = new DurableCollaborateDatabase({ pool: shared.pool });
const app = buildServer(); // serves from instance A

let passed = 0;
let total = 0;
async function test(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.log(`  [FAIL] ${name}\n         ${err.stack?.split('\n').slice(0, 4).join('\n         ')}`);
  }
}
const run = crypto.randomBytes(3).toString('hex');

console.log('\n=== Phase 2: multi-instance storage on Postgres (PGlite) ===\n');

await test('Shared store is active and starts empty (no demo seed, no JSON file)', async () => {
  assert.strictEqual(instanceA.usesSharedStore, true);
  await instanceA.syncFromStore();
  assert.strictEqual(instanceA.getAllMembers().length, 0);
});

let token;
let memberId;
await test('A member registered on instance A (through the API) is visible to instance B, with credentials', async () => {
  const email = `pg_${run}@independent.test`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'password-1234', fullName: 'PG Member' } });
  assert.strictEqual(res.statusCode, 201, res.body);
  memberId = JSON.parse(res.body).member.id;
  token = res.headers['set-cookie'].split(';')[0].split('=')[1];
  await instanceB.syncFromStore();
  assert.strictEqual(instanceB.getMemberById(memberId)?.email, email);
  assert.ok(instanceB.getCredential(memberId), 'credential is durable and shared');
  const count = await shared.pool.query("SELECT count(*)::int AS n FROM collaborate_documents WHERE collection IN ('member','credential')");
  assert.ok(count.rows[0].n >= 2);
});

await test('A change made on instance B is served by instance A on its next request', async () => {
  const m = instanceB.getMemberById(memberId);
  m.headline = 'Edited on instance B';
  await instanceB.saveMemberAsync(m);
  const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(JSON.parse(res.body).member.headline, 'Edited on instance B');
});

await test('Concurrent writes to the same document: the later writer gets a conflict, nothing is lost', async () => {
  await instanceA.syncFromStore();
  await instanceB.syncFromStore();
  const a = instanceA.getMemberById(memberId);
  const b = instanceB.getMemberById(memberId);
  a.about = 'written by A';
  b.about = 'written by B';
  await instanceA.saveMemberAsync(a);
  await assert.rejects(() => instanceB.saveMemberAsync(b), (e) => e instanceof ConcurrentModificationError);
  assert.strictEqual(instanceB.getMemberById(memberId).about, 'written by A', 'B reloaded the winning version');
  const row = await shared.pool.query("SELECT doc->>'about' AS about FROM collaborate_documents WHERE collection='member' AND id=$1", [memberId]);
  assert.strictEqual(row.rows[0].about, 'written by A');
});

await test('Deletions propagate between instances (tombstones)', async () => {
  instanceA.setMapping({ id: `map_${run}`, memberId, provider: 'aitathastu_oidc', externalSubjectId: `sub_${run}`, externalEmail: 'x@y.test', createdAt: new Date().toISOString() });
  await instanceA.flush();
  await instanceB.syncFromStore();
  assert.ok(instanceB.getMappingByExternalSub('aitathastu_oidc', `sub_${run}`));
  instanceA.removeMapping(`map_${run}`);
  await instanceA.flush();
  await instanceB.syncFromStore();
  assert.strictEqual(instanceB.getMappingByExternalSub('aitathastu_oidc', `sub_${run}`), null);
});

await test('Daily view quota cannot be exceeded by recording views concurrently on two instances', async () => {
  const targets = [];
  for (let i = 0; i < 4; i++) {
    const t = { ...instanceA.getMemberById(memberId), id: `tgt_${run}_${i}`, email: `t${i}_${run}@x.test` };
    instanceA.saveMember(t);
    targets.push(t.id);
  }
  await instanceA.flush();
  await instanceB.syncFromStore();
  assert.ok(instanceA.recordProfileView(memberId, targets[0]).allowed);
  assert.ok(instanceA.recordProfileView(memberId, targets[1]).allowed);
  await instanceA.flush();
  await instanceB.syncFromStore();
  // Both instances now see 2 views and each records a different 3rd/4th view at once.
  assert.ok(instanceA.recordProfileView(memberId, targets[2]).allowed);
  assert.ok(instanceB.recordProfileView(memberId, targets[3]).allowed);
  await instanceA.flush();
  await assert.rejects(() => instanceB.flush(), (e) => e instanceof ConcurrentModificationError, 'second concurrent view conflicts');
  const doc = await shared.pool.query("SELECT doc FROM collaborate_documents WHERE collection='profile_view_day' AND id LIKE $1", [`${memberId}|%`]);
  assert.strictEqual(doc.rows[0].doc.entries.length, 3, 'exactly 3 views stored');
});

await test('Webhook delivery ledger is shared: one instance processes, the other sees in-progress/processed', async () => {
  const id = `del_${run}`;
  assert.strictEqual(await instanceA.beginWebhookDelivery('aitathastu', id, 'profile.updated'), 'claimed');
  assert.strictEqual(await instanceB.beginWebhookDelivery('aitathastu', id, 'profile.updated'), 'in_progress');
  await instanceA.failWebhookDelivery('aitathastu', id, 'crash');
  assert.strictEqual(await instanceB.beginWebhookDelivery('aitathastu', id, 'profile.updated'), 'claimed', 'failed delivery retried elsewhere');
  await instanceB.completeWebhookDelivery('aitathastu', id);
  assert.strictEqual(await instanceA.beginWebhookDelivery('aitathastu', id, 'profile.updated'), 'processed');
  const row = await shared.pool.query("SELECT status, attempts, payload FROM webhook_events WHERE provider='aitathastu' AND event_id=$1", [id]);
  assert.strictEqual(row.rows[0].status, 'processed');
  assert.strictEqual(row.rows[0].attempts, 2);
  assert.deepStrictEqual(row.rows[0].payload, {}, 'no personal data stored in the ledger');
});

await test('An abandoned in-progress claim (crashed instance) becomes retryable after its lock expires', async () => {
  const id = `del_lock_${run}`;
  assert.strictEqual(await instanceA.beginWebhookDelivery('aitathastu', id, 'profile.updated', 1), 'claimed');
  await new Promise((r) => setTimeout(r, 1200));
  assert.strictEqual(await instanceB.beginWebhookDelivery('aitathastu', id, 'profile.updated'), 'claimed');
});

await test('End-to-end webhook on the shared store: import, duplicate on the other instance, revoke', async () => {
  const { TathastuSsoService } = await import('../src/modules/identity/tathastu-sso.ts');
  const sub = `urn:tathastu:person:pg_${run}`;
  const email = `pg_linked_${run}@linked.test`;
  await TathastuSsoService.processCallback({ code: `c_${run}`, codeVerifier: 'v', state: 's', claimsOverride: { sub, email, fullName: 'PG Linked' } });
  const sign = (body) => {
    const raw = JSON.stringify(body);
    const t = Math.floor(Date.now() / 1000);
    return { raw, header: `t=${t},v1=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex')}` };
  };
  const ev = { id: `del_e2e_${run}`, type: 'profile.updated', createdAt: new Date().toISOString(), data: { userId: sub, profile: projectionV1({ sub, email, skills: [{ name: 'Postgres' }] }) } };
  const { raw, header } = sign(ev);
  const res = await app.inject({ method: 'POST', url: '/api/webhooks/tathastu', headers: { 'content-type': 'application/json', 'x-ait-signature': header }, payload: raw });
  assert.strictEqual(res.statusCode, 200, res.body);
  await instanceB.syncFromStore();
  const onB = instanceB.getMemberByEmail(email);
  assert.ok(onB.skills.includes('Postgres'), 'imported data visible on instance B');
  assert.strictEqual(await instanceB.beginWebhookDelivery('aitathastu', ev.id, 'profile.updated'), 'processed', 'duplicate on instance B');

  const rev = sign({ id: `del_rev_${run}`, type: 'integration.revoked', createdAt: new Date(Date.now() + 1000).toISOString(), data: { userId: sub } });
  const r2 = await app.inject({ method: 'POST', url: '/api/webhooks/tathastu', headers: { 'content-type': 'application/json', 'x-ait-signature': rev.header }, payload: rev.raw });
  assert.strictEqual(r2.statusCode, 200);
  await instanceB.syncFromStore();
  const after = instanceB.getMemberByEmail(email);
  assert.ok(!after.skills.includes('Postgres') && after.importedProfile === null && !after.tathastu_user_id);
  assert.strictEqual(instanceB.getMappingByExternalSub('aitathastu_oidc', sub), null, 'mapping deletion propagated');
});

await test('Fails closed when legacy relational members exist but documents were never backfilled', async () => {
  const legacy = await freshDatabase();
  await legacy.pg.query("INSERT INTO members (id, email, full_name) VALUES ('usr_legacy', 'legacy@x.test', 'Legacy')");
  const inst = new DurableCollaborateDatabase({ pool: legacy.pool });
  await assert.rejects(() => inst.syncFromStore(), (e) => e instanceof BackfillRequiredError);
  await legacy.pg.close();
});

await test('Backfill from the JSON store is complete, idempotent, and loads on a new instance', async () => {
  const { prepareBackfill, writeBackfill } = await import('../src/lib/db/backfill.ts');
  const { emptyDocumentState } = await import('../src/lib/db/documents.ts');
  const source = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'collaborate.db.json'), 'utf8'));
  const db = await freshDatabase();
  const { docs } = prepareBackfill({ ...emptyDocumentState(), ...structuredClone(source) });
  const first = await writeBackfill(db.pool, docs);
  assert.strictEqual(first.inserted, docs.size);
  const second = await writeBackfill(db.pool, docs);
  assert.strictEqual(second.inserted, 0, 're-run inserts nothing');
  const inst = new DurableCollaborateDatabase({ pool: db.pool });
  await inst.syncFromStore();
  assert.strictEqual(inst.getAllMembers().length, Object.keys(source.members).length, 'every member loaded');
  assert.strictEqual(Object.keys(source.credentials || {}).filter((id) => inst.getCredential(id)).length, Object.keys(source.credentials || {}).length, 'every credential loaded');
  assert.strictEqual(inst.getAllConnections().length, Object.keys(source.connections || {}).length);
  for (const m of inst.getAllMembers()) assert.ok(m.localProfile, `member ${m.id} migrated to ownership model`);
  await db.pg.close();
});

console.log(`\n=== ${passed}/${total} passed ===`);
await shared.pg.close();
process.exit(passed === total ? 0 : 1);
