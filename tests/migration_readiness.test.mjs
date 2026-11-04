/**
 * Migration readiness: runner TLS selection and transactions, backfill duplicate handling and
 * failure modes, and integrity checks that must FAIL on corrupted data. Disposable PGlite only.
 * Run: npx tsx tests/migration_readiness.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';

delete process.env.DATABASE_URL;
process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';
const require = createRequire(import.meta.url);
const { sslFor, applyMigrations, migrationFiles } = require('../scripts/migrate.js');
const { prepareBackfill, writeBackfill } = await import('../src/lib/db/backfill.ts');
const { runIntegrityChecks, expectedCounts, storedCounts } = await import('../src/lib/db/verification.ts');
const { emptyDocumentState } = await import('../src/lib/db/documents.ts');

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
function poolFor(pg) {
  let tail = Promise.resolve();
  const acquire = () => {
    let release;
    const next = new Promise((r) => (release = r));
    const ready = tail.then(() => release);
    tail = tail.then(() => next);
    return ready;
  };
  const strip = (s) => s.replace(/CREATE EXTENSION[^;]+;/gi, '');
  return {
    async query(sql, params = []) {
      const r = await acquire();
      try { return await pg.query(sql, params); } finally { r(); }
    },
    async connect() {
      const r = await acquire();
      return { query: (sql, p = []) => (p.length ? pg.query(strip(sql), p) : pg.exec(strip(sql)).then((x) => x[x.length - 1] ?? { rows: [] })), release: r };
    },
  };
}
async function migrated() {
  const pg = await PGlite.create();
  const pool = poolFor(pg);
  await applyMigrations(pool, () => undefined);
  return { pg, pool };
}
const member = (id, extra = {}) => ({ id, email: `${id}@synthetic.invalid`, fullName: id, headline: '', avatarUrl: '', bannerUrl: '', isVerified: false, plan: 'free', statusBadges: [], location: '', about: '', contextTags: [], socialLinks: {}, metrics: {}, skills: [], projects: [], experience: [], education: [], recentActivity: [], aiSpecializations: [], collaborationInterests: [], discoverable: true, profileVisibility: 'public', contactVisibility: 'connections_only', isLinkedWithTathastu: false, tathastuSyncStatus: 'unlinked', tathastuSyncSettings: {}, ...extra });

console.log('\n=== Migration readiness ===\n');

await test('migrate.js TLS: Neon uses the system trust store (no Supabase CA pin); Supabase pins its CA; always verified', () => {
  const neon = sslFor('postgresql://u:p@ep-cool-123.us-east-2.aws.neon.tech/db?sslmode=require');
  assert.strictEqual(neon.rejectUnauthorized, true);
  assert.strictEqual(neon.ca, undefined, 'Neon must not be pinned to the Supabase root CA');
  const supa = sslFor('postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres');
  assert.ok(supa.ca && supa.ca.includes('BEGIN CERTIFICATE'));
  assert.strictEqual(supa.rejectUnauthorized, true);
  assert.strictEqual(sslFor('postgresql://u:p@localhost:5432/db'), false);
});

await test('migrate.js applies 001..003 in numeric order and is idempotent', async () => {
  assert.deepStrictEqual(migrationFiles(), ['001_initial_schema.sql', '002_tathastu_integration.sql', '003_durable_documents.sql']);
  const { pg, pool } = await migrated();
  const again = await applyMigrations(pool, () => undefined);
  assert.strictEqual(again.length, 3, 're-run succeeds');
  await pg.close();
});

await test('A failing migration rolls back completely and stops the run', async () => {
  const pg = await PGlite.create();
  const pool = poolFor(pg);
  const real = pool.connect.bind(pool);
  let n = 0;
  pool.connect = async () => {
    const c = await real();
    n++;
    if (n === 3) return { ...c, query: (sql, p) => (sql === 'BEGIN' || sql === 'ROLLBACK' ? c.query(sql, p) : Promise.reject(new Error('boom'))) };
    return c;
  };
  await assert.rejects(() => applyMigrations(pool, () => undefined), /003_durable_documents\.sql failed and was rolled back/);
  const t = await pg.query(`SELECT to_regclass('collaborate_documents') AS t`);
  assert.strictEqual(t.rows[0].t, null, '003 left nothing behind');
  const m = await pg.query(`SELECT to_regclass('members') AS t`);
  assert.ok(m.rows[0].t, 'earlier migrations stay applied');
  await pg.close();
});

await test('Backfill keeps records with colliding ids (renamed), and counts reconcile exactly', async () => {
  const state = {
    ...emptyDocumentState(),
    members: { a: member('a'), b: member('b') },
    verificationAuditLogs: [{ id: 'x', memberId: 'a' }, { id: 'x', memberId: 'b' }, { id: 'x', memberId: 'a' }],
    notifications: [{ id: 'n', recipientId: 'a' }, { id: 'n', recipientId: 'b' }],
    blockedUsers: ['a:b', 'a:b'],
  };
  const expected = expectedCounts(structuredClone(state));
  const plan = prepareBackfill(structuredClone(state));
  assert.strictEqual(plan.counts.verification_audit, 3);
  assert.strictEqual(plan.counts.notification, 2);
  assert.deepStrictEqual(plan.renamedDuplicateIds, { verification_audit: 2, notification: 1, block_exact_duplicates_removed: 1 });
  const { pg, pool } = await migrated();
  await writeBackfill(pool, plan.docs);
  const stored = await storedCounts(pool);
  for (const [k, v] of Object.entries(expected)) assert.strictEqual(stored[k], v, `${k}`);
  await pg.close();
});

await test('Backfill never overwrites an existing (newer) document', async () => {
  const { pg, pool } = await migrated();
  await pool.query(`INSERT INTO collaborate_documents (collection,id,doc,rev) VALUES ('member','a','{"id":"a","fullName":"NEWER"}'::jsonb, nextval('collaborate_doc_rev_seq'))`);
  const r = await writeBackfill(pool, prepareBackfill({ ...emptyDocumentState(), members: { a: member('a', { fullName: 'OLD' }) } }).docs);
  assert.strictEqual(r.inserted, 0);
  const row = await pool.query(`SELECT doc->>'fullName' AS n FROM collaborate_documents WHERE id='a'`);
  assert.strictEqual(row.rows[0].n, 'NEWER');
  await pg.close();
});

await test('Integrity checks FAIL on corrupted data (orphans, duplicate subjects, missing mapping, empty hashes)', async () => {
  const state = {
    ...emptyDocumentState(),
    members: { a: member('a'), linked: member('linked', { tathastu_user_id: 'sub-missing' }) },
    credentials: { a: { passwordHash: 'x'.repeat(64), salt: 'y'.repeat(32) }, ghost: { passwordHash: 'x'.repeat(64), salt: 'y'.repeat(32) }, linked: { passwordHash: '', salt: '' } },
    identityMappings: {
      m1: { id: 'm1', memberId: 'a', provider: 'aitathastu_oidc', externalSubjectId: 'dup', externalEmail: 'e' },
      m2: { id: 'm2', memberId: 'nobody', provider: 'aitathastu_oidc', externalSubjectId: 'dup', externalEmail: 'e' },
    },
    connections: { c1: { id: 'c1', requesterId: 'a', recipientId: 'ghost', status: 'accepted' } },
  };
  const { pg, pool } = await migrated();
  await writeBackfill(pool, prepareBackfill(state).docs);
  const results = Object.fromEntries((await runIntegrityChecks(pool)).map((r) => [r.name, r.offending]));
  assert.deepStrictEqual(results['every credential belongs to an existing member'], ['ghost']);
  assert.deepStrictEqual(results['every credential has a password hash and salt'], ['linked']);
  assert.deepStrictEqual(results['every identity mapping references an existing member'], ['m2']);
  assert.strictEqual(results['no provider subject is mapped more than once'].length, 1);
  assert.deepStrictEqual(results['every linked member has a matching identity mapping'], ['linked']);
  assert.deepStrictEqual(results['every connection references existing members'], ['c1']);
  await pg.close();
});

await test('Backfill CLI: dry run needs no database, rejects bad input, and prints no secrets or personal data', () => {
  const fixture = path.join(process.cwd(), 'tests', '.tmp_backfill_fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ ...emptyDocumentState(), members: { a: member('a', { email: 'secret-person@synthetic.invalid' }) }, credentials: { a: { passwordHash: 'HASHVALUE_SHOULD_NOT_PRINT', salt: 'SALTVALUE_SHOULD_NOT_PRINT' } } }));
  try {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const ok = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backfill_documents.ts', '--from-json', fixture, '--dry-run'], { env, encoding: 'utf8' });
    assert.strictEqual(ok.status, 0, ok.stderr);
    const out = ok.stdout + ok.stderr;
    assert.ok(out.includes('Dry run: nothing was written.'));
    for (const s of ['HASHVALUE', 'SALTVALUE', 'secret-person']) assert.ok(!out.includes(s), `printed ${s}`);
    const bad = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backfill_documents.ts', '--from-json', 'does-not-exist.json', '--dry-run'], { env, encoding: 'utf8' });
    assert.strictEqual(bad.status, 2);
    const noDb = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backfill_documents.ts', '--from-json', fixture], { env, encoding: 'utf8' });
    assert.strictEqual(noDb.status, 2, 'real run without DATABASE_URL refuses');
  } finally {
    fs.rmSync(fixture, { force: true });
  }
});

await test('Rehearsal refuses an external source without explicit non-production confirmation', () => {
  const env = { ...process.env };
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/rehearse_migration.ts', '--source', 'x.json'], { env, encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.ok(r.stderr.includes('--confirm-non-production'));
});

await test('Excluding accounts removes every reference: integrity checks stay clean, nobody else is touched', async () => {
  const { excludeMembers } = await import('../src/lib/db/backfill.ts');
  const iso = '2026-10-01T00:00:00.000Z';
  const state = {
    ...emptyDocumentState(),
    members: { keep: member('keep'), other: member('other'), test1: member('test1', { tathastu_user_id: 's1' }) },
    credentials: { keep: { passwordHash: 'x'.repeat(64), salt: 'y'.repeat(32) }, test1: { passwordHash: 'x'.repeat(64), salt: 'y'.repeat(32) } },
    identityMappings: { m1: { id: 'm1', memberId: 'test1', provider: 'aitathastu_oidc', externalSubjectId: 's1', externalEmail: 'e' } },
    connections: { c1: { id: 'c1', requesterId: 'keep', recipientId: 'test1', status: 'accepted' }, c2: { id: 'c2', requesterId: 'keep', recipientId: 'other', status: 'accepted' } },
    conversations: { cv: { id: 'cv', participantIds: ['keep', 'test1'], unreadCounts: {}, updatedAt: iso } },
    messages: [{ id: 'mm', conversationId: 'cv', senderId: 'test1', recipientId: 'keep', timestamp: iso }],
    notifications: [{ id: 'n1', recipientId: 'keep', actorId: 'test1' }, { id: 'n2', recipientId: 'test1' }],
    blockedUsers: ['test1:keep'],
    savedMembers: { keep: ['test1', 'other'], test1: ['keep'] },
    profileViewLedger: [{ id: 'v', viewerId: 'keep', targetId: 'test1', dateKey: '2026-10-01' }],
  };
  const r = excludeMembers(state, ['test1', 'not-present']);
  assert.strictEqual(r.excludedMembers, 1);
  assert.deepStrictEqual(Object.keys(state.members).sort(), ['keep', 'other']);
  assert.deepStrictEqual(Object.keys(state.connections), ['c2']);
  assert.strictEqual(state.messages.length, 0);
  assert.deepStrictEqual(state.notifications.map((n) => n.id), ['n1']);
  assert.strictEqual(state.notifications[0].actorId, undefined);
  assert.deepStrictEqual(state.savedMembers, { keep: ['other'] });
  const { pg, pool } = await migrated();
  await writeBackfill(pool, prepareBackfill(state).docs);
  for (const c of await runIntegrityChecks(pool)) assert.deepStrictEqual(c.offending, [], c.name);
  assert.ok(!JSON.stringify((await pool.query('SELECT doc FROM collaborate_documents')).rows).includes('test1'), 'no reference survives');
  await pg.close();
});

await test('Hosted runtime fails closed without NODE_ENV=production or with test fixtures enabled', async () => {
  const { assertSafeRuntimeConfig } = await import('../src/lib/auth/secrets.ts');
  const saved = { RENDER: process.env.RENDER, NODE_ENV: process.env.NODE_ENV, FIX: process.env.COLLABORATE_ENABLE_FIXTURES };
  try {
    process.env.RENDER = 'true';
    delete process.env.NODE_ENV;
    assert.throws(() => assertSafeRuntimeConfig(), /NODE_ENV must be "production"/);
    process.env.NODE_ENV = 'production';
    process.env.COLLABORATE_ENABLE_FIXTURES = 'true';
    assert.throws(() => assertSafeRuntimeConfig(), /COLLABORATE_ENABLE_FIXTURES/);
    delete process.env.COLLABORATE_ENABLE_FIXTURES;
    assert.doesNotThrow(() => assertSafeRuntimeConfig());
  } finally {
    for (const [k, v] of [['RENDER', saved.RENDER], ['NODE_ENV', saved.NODE_ENV], ['COLLABORATE_ENABLE_FIXTURES', saved.FIX]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

console.log(`\n=== ${passed}/${total} passed ===`);
process.exit(passed === total ? 0 : 1);
