/**
 * Migration rehearsal on a DISPOSABLE in-process Postgres (PGlite). It never connects to any
 * external database: DATABASE_URL is ignored and unset for the run.
 *
 *   npx tsx scripts/rehearse_migration.ts                       # built-in synthetic fixture
 *   npx tsx scripts/rehearse_migration.ts --source <file.json> --confirm-non-production
 *
 * --source is only for data you are explicitly approved to use (synthetic or non-production).
 * Never point it at a production export.
 *
 * Steps (exit code 1 if any fails):
 *  1 fixture provenance   2 clean migrations (001..003, in order, transactional)
 *  3 backfill dry run     4 backfill             5 backfill again (idempotency)
 *  6 count + ownership    7-10 integrity checks  11 revocation keeps local data
 *  12 partial-failure recovery and rollback/re-apply rehearsal
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

delete process.env.DATABASE_URL;
process.env.COLLABORATE_ALLOW_LOCAL_STORAGE = 'true';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const sourceIdx = args.indexOf('--source');
const sourceFile = sourceIdx !== -1 ? args[sourceIdx + 1] : null;
if (sourceFile && !args.includes('--confirm-non-production')) {
  console.error('Refusing: --source requires --confirm-non-production (synthetic or approved non-production data only).');
  process.exit(2);
}

const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`);
};

/** Fully synthetic fixture: no real names, emails or credentials (hashes are random bytes). */
function syntheticFixture() {
  const crypto = require('node:crypto');
  const iso = '2026-10-01T00:00:00.000Z';
  const member = (id: string, extra: any = {}) => ({
    id, email: `${id}@synthetic.invalid`, fullName: `Synthetic ${id}`, headline: '', avatarUrl: '/images/default_avatar.svg',
    bannerUrl: '', isVerified: false, plan: 'free', statusBadges: [], location: '', about: '', contextTags: [], socialLinks: {},
    metrics: { projects: 0, skills: 0, achievements: 0, githubContributions: '0', leetcodeProblems: '0', publications: 0 },
    skills: [], projects: [], experience: [], education: [], recentActivity: [], aiSpecializations: [], collaborationInterests: [],
    discoverable: true, profileVisibility: 'public', contactVisibility: 'connections_only', isLinkedWithTathastu: false,
    tathastuSyncStatus: 'unlinked', tathastuSyncSettings: { autoSyncProjects: false, autoSyncSkills: false, autoSyncAchievements: false },
    role: 'member', ...extra,
  });
  const linkedSub = 'urn:synthetic:linked-1';
  const legacyProjection = {
    schema: 'ProfessionalProjectionV1', version: 1, audience: 'collaborate', generatedAt: iso,
    identity: { id: linkedSub, email: null, name: 'Synthetic linked', headline: null, avatarUrl: null, careerRole: null, careerRoleOther: null, location: null },
    education: null, experience: null, achievements: null,
    skills: { items: [{ name: 'Imported Skill', category: 'other', evidenceStrength: 0.5, verified: true, verificationStatus: 'verified', sources: ['github'] }], erisReadiness: null },
    projects: [{ key: 'k1', title: 'Imported Project', description: null, technologies: ['Go'], links: [], status: 'active', sources: ['github'] }],
    activity: null,
    privacy: { scopes: { skills: true, projects: true }, masked: ['education', 'experience', 'achievements', 'activity', 'skills.erisReadiness'], hiddenProjects: 0, consentUpdatedAt: iso },
  };
  const members: Record<string, any> = {
    usr_a: member('usr_a', { skills: ['Local Skill A'] }),
    usr_b: member('usr_b'),
    usr_c: member('usr_c'),
    usr_linked: member('usr_linked', {
      tathastu_user_id: linkedSub, isLinkedWithTathastu: true, tathastuSyncStatus: 'synced', tathastuLastSyncedAt: iso,
      skills: ['Imported Skill', 'Typed Locally'],
      projects: [
        { id: 'p_local', title: 'Local Project', description: '', tags: [], sourceOrigin: 'collaborate' },
        { id: 'p_core', title: 'Imported Project', description: '', tags: ['Go'], sourceOrigin: 'tathastu_core', stars: 10, forks: 2 },
      ],
      tathastuProfile: legacyProjection,
    }),
  };
  const cred = () => ({ passwordHash: crypto.randomBytes(32).toString('hex'), salt: crypto.randomBytes(16).toString('hex') });
  return {
    members,
    credentials: { usr_a: cred(), usr_b: cred(), usr_linked: cred() },
    identityMappings: { map_1: { id: 'map_1', memberId: 'usr_linked', provider: 'aitathastu_oidc', externalSubjectId: linkedSub, externalEmail: 'usr_linked@synthetic.invalid', createdAt: iso } },
    connections: { conn_1: { id: 'conn_1', requesterId: 'usr_a', recipientId: 'usr_b', status: 'accepted', createdAt: iso, updatedAt: iso } },
    conversations: { conv_1: { id: 'conv_1', participantIds: ['usr_a', 'usr_b'], unreadCounts: {}, updatedAt: iso } },
    messages: [
      { id: 'msg_1', conversationId: 'conv_1', senderId: 'usr_a', recipientId: 'usr_b', content: 'synthetic', timestamp: iso, status: 'read' },
      { id: 'msg_2', conversationId: 'conv_1', senderId: 'usr_b', recipientId: 'usr_a', content: 'synthetic', timestamp: iso, status: 'read' },
    ],
    verificationRequests: {},
    // Two audit entries with the SAME id (created in the same millisecond by the old id scheme).
    verificationAuditLogs: [
      { id: 'audit_1', requestId: 'r', memberId: 'usr_a', action: 'approved', reviewer: 'adm', category: 'identity', notes: '', timestamp: iso },
      { id: 'audit_1', requestId: 'r2', memberId: 'usr_b', action: 'rejected', reviewer: 'adm', category: 'identity', notes: '', timestamp: iso },
    ],
    abuseReports: {},
    profileViewLedger: [{ id: 'v1', viewerId: 'usr_a', targetId: 'usr_b', dateKey: '2026-10-01', viewedAt: iso }],
    blockedUsers: ['usr_c:usr_a'],
    notifications: [{ id: 'n1', recipientId: 'usr_a', type: 'system', title: 't', body: 'b', isRead: false, createdAt: iso }],
    savedMembers: { usr_a: ['usr_b'] },
    webhookEvents: { 'payments:evt_old': { provider: 'payments', eventId: 'evt_old', eventType: 'payment.succeeded', processedAt: iso } },
  };
}

function poolFor(pg: any) {
  let tail: Promise<unknown> = Promise.resolve();
  const acquire = () => {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const ready = tail.then(() => release);
    tail = tail.then(() => next);
    return ready;
  };
  return {
    async query(sql: string, params: unknown[] = []) {
      const release = await acquire();
      try {
        return await pg.query(sql, params);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await acquire();
      return {
        query: (sql: string, params: unknown[] = []) => (params.length ? pg.query(sql, params) : pg.exec(sql).then((r: any[]) => r[r.length - 1] ?? { rows: [] })),
        release,
      };
    },
  };
}

async function main() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrations, migrationFiles } = require('./migrate.js');
  const { emptyDocumentState } = await import('../src/lib/db/documents');
  const { prepareBackfill, writeBackfill } = await import('../src/lib/db/backfill');
  const { runIntegrityChecks, expectedCounts, storedCounts } = await import('../src/lib/db/verification');
  const { DurableCollaborateDatabase } = await import('../src/lib/db/index');
  const { clearImportedProfile } = await import('../src/modules/profile/ownership');

  // 1. Fixture provenance
  const source = sourceFile ? JSON.parse(fs.readFileSync(path.resolve(sourceFile), 'utf8')) : syntheticFixture();
  record('1 fixture provenance', true, sourceFile ? `operator-approved non-production file (${path.basename(sourceFile)})` : 'built-in synthetic fixture');
  const fresh = () => ({ ...emptyDocumentState(), ...structuredClone(source) });

  // 2. Clean migrations (PGlite lacks the uuid-ossp extension, which 001 does not use)
  const pg = await PGlite.create();
  const raw = poolFor(pg);
  const pool = {
    ...raw,
    async connect() {
      const c = await raw.connect();
      return { ...c, query: (sql: string, p: unknown[] = []) => c.query(sql.replace(/CREATE EXTENSION[^;]+;/gi, ''), p) };
    },
  };
  const applied: string[] = await applyMigrations(pool, () => undefined);
  record('2 clean migrations in order', JSON.stringify(applied) === JSON.stringify(migrationFiles()), applied.join(', '));

  // 3. Dry run (plan only)
  const plan = prepareBackfill(fresh());
  const expected = expectedCounts(fresh());
  const planMatches = Object.entries(expected).every(([k, n]) => plan.counts[k] === n);
  record('3 backfill dry run plan matches source', planMatches, `planned ${plan.docs.size} documents; renamed duplicates ${JSON.stringify(plan.renamedDuplicateIds)}`);
  const before = await storedCounts(pool);
  record('3b dry run wrote nothing', Object.keys(before).length === 0);

  // 4. Backfill
  const first = await writeBackfill(pool, prepareBackfill(fresh()).docs);
  record('4 backfill', first.inserted === plan.docs.size, `${first.inserted}/${first.total}`);

  // 5. Idempotency
  const second = await writeBackfill(pool, prepareBackfill(fresh()).docs);
  record('5 second backfill inserts nothing', second.inserted === 0, `${second.alreadyPresent} already present`);

  // 6. Counts and ownership invariants
  const stored = await storedCounts(pool);
  const mismatches = Object.entries(expected).filter(([k, n]) => stored[k] !== n);
  record('6 collection counts match source', mismatches.length === 0, mismatches.length ? JSON.stringify(mismatches) : JSON.stringify(stored));

  // 7-10 integrity
  for (const r of await runIntegrityChecks(pool)) record(`7-10 ${r.name}`, r.offending.length === 0, r.offending.length ? `offending ids: ${r.offending.slice(0, 10).join(', ')}` : '');

  // 11. Revocation on the migrated data keeps Collaborate-authored data
  const inst = new DurableCollaborateDatabase({ pool });
  await inst.syncFromStore();
  const linkedId = Object.values<any>(source.members).find((m) => m.tathastu_user_id)?.id;
  if (linkedId) {
    const m = inst.getMemberById(linkedId)!;
    const localBefore = JSON.stringify(m.localProfile);
    clearImportedProfile(m);
    await inst.saveMemberAsync(m);
    const reader = new DurableCollaborateDatabase({ pool });
    await reader.syncFromStore();
    const after = reader.getMemberById(linkedId)!;
    const noImported = after.importedProfile === null && !after.projects.some((p) => p.sourceOrigin === 'tathastu_core');
    record('11 revocation removes imported data only', noImported && JSON.stringify(after.localProfile) === localBefore, `skills after: ${after.skills.length}, local projects: ${after.localProfile?.projects.length}`);
  } else {
    record('11 revocation removes imported data only', true, 'no linked member in source (skipped)');
  }

  // 12a. Partial-failure recovery: fail half-way, then re-run completes without duplicates
  const pg2 = await PGlite.create();
  const raw2 = poolFor(pg2);
  const pool2 = { ...raw2, async connect() { const c = await raw2.connect(); return { ...c, query: (s: string, p: unknown[] = []) => c.query(s.replace(/CREATE EXTENSION[^;]+;/gi, ''), p) }; } };
  await applyMigrations(pool2, () => undefined);
  let calls = 0;
  const flaky = { query: async (s: string, p?: unknown[]) => { if (++calls === Math.ceil(plan.docs.size / 2)) throw new Error('simulated network drop'); return raw2.query(s, p); } };
  let failedOnce = false;
  try { await writeBackfill(flaky, prepareBackfill(fresh()).docs); } catch { failedOnce = true; }
  const resumed = await writeBackfill(pool2, prepareBackfill(fresh()).docs);
  const stored2 = await storedCounts(pool2);
  record('12a partial failure recovered by re-run', failedOnce && Object.entries(expected).every(([k, n]) => stored2[k] === n), `resumed inserted ${resumed.inserted}`);

  // 12b. Rollback SQL from the runbook, then re-apply migrations
  await pg2.exec(`DROP TABLE collaborate_documents; DROP SEQUENCE collaborate_doc_rev_seq;
                  ALTER TABLE webhook_events DROP COLUMN status, DROP COLUMN attempts, DROP COLUMN locked_until, DROP COLUMN last_error;`);
  const gone = await pg2.query(`SELECT to_regclass('collaborate_documents') AS t`);
  const legacyIntact = await pg2.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('members','webhook_events','external_identity_mappings')`);
  await applyMigrations(pool2, () => undefined);
  const back = await pg2.query(`SELECT to_regclass('collaborate_documents') AS t`);
  record('12b rollback SQL valid; legacy schema intact; re-apply works', (gone.rows[0] as any).t === null && (legacyIntact.rows[0] as any).n === 3 && (back.rows[0] as any).t !== null);

  await pg.close();
  await pg2.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nRehearsal: ${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Rehearsal error:', err?.message || err);
  process.exit(1);
});
