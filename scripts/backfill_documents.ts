/**
 * One-time backfill of collaborate_documents (migration 003). Operator-run, never automatic.
 *
 *   DATABASE_URL=... npx tsx scripts/backfill_documents.ts --from-json <path/to/collaborate.db.json>
 *   DATABASE_URL=... npx tsx scripts/backfill_documents.ts --from-relational
 *   add --dry-run to print counts without writing.
 *   add --exclude-members <file> (one member id per line) to leave owner-selected accounts out,
 *   together with everything that references them (no orphans).
 *
 * --from-json is preferred: the JSON store is the only copy of credentials and full profiles.
 * --from-relational recovers members, profiles, identity mappings, connections and blocks
 * from the legacy tables; password users then need a password reset.
 *
 * Inserts use ON CONFLICT DO NOTHING: re-running is safe and never overwrites newer documents.
 * Procedure and rollback: docs/architecture/PHASE2_DURABLE_STORAGE_MIGRATION.md
 */
import fs from 'node:fs';
import { emptyDocumentState, type DocumentState } from '../src/lib/db/documents';
import { getNeonPool } from '../src/lib/db/neon';
import { excludeMembers, prepareBackfill, writeBackfill } from '../src/lib/db/backfill';
import { expectedCounts, storedCounts } from '../src/lib/db/verification';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const jsonIdx = args.indexOf('--from-json');
const fromRelational = args.includes('--from-relational');
const excludeIdx = args.indexOf('--exclude-members');

const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

async function loadFromRelational(pool: any): Promise<DocumentState> {
  const state = emptyDocumentState();
  const members = await pool.query(
    `SELECT m.*, p.headline, p.about, p.avatar_url, p.banner_url, p.location, p.status_badges, p.context_tags,
            p.social_links, p.metrics, p.skills, p.ai_specializations, p.collaboration_interests, p.discoverable,
            p.profile_visibility, p.contact_visibility, p.is_linked_with_tathastu, p.tathastu_sync_status,
            p.tathastu_sync_settings
       FROM members m LEFT JOIN professional_profiles p ON p.member_id = m.id`
  );
  for (const r of members.rows) {
    state.members[r.id] = {
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      headline: r.headline || '',
      avatarUrl: r.avatar_url || '/images/default_avatar.svg',
      bannerUrl: r.banner_url || '/images/campus_banner.jpg',
      isVerified: Boolean(r.is_verified),
      verifiedCategory: r.verified_category || undefined,
      verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : undefined,
      plan: r.plan || 'free',
      planExpiresAt: r.plan_expires_at ? new Date(r.plan_expires_at).toISOString() : undefined,
      statusBadges: parse(r.status_badges) || [],
      location: r.location || '',
      about: r.about || '',
      contextTags: parse(r.context_tags) || [],
      socialLinks: parse(r.social_links) || {},
      metrics: parse(r.metrics) || {},
      skills: parse(r.skills) || [],
      projects: [],
      experience: [],
      education: [],
      recentActivity: [],
      aiSpecializations: parse(r.ai_specializations) || [],
      collaborationInterests: parse(r.collaboration_interests) || [],
      discoverable: Boolean(r.discoverable),
      profileVisibility: r.profile_visibility || 'public',
      contactVisibility: r.contact_visibility || 'connections_only',
      isLinkedWithTathastu: Boolean(r.is_linked_with_tathastu),
      tathastuSyncStatus: r.tathastu_sync_status || 'unlinked',
      tathastuSyncSettings: parse(r.tathastu_sync_settings) || {},
      isUnder18: Boolean(r.is_under_18),
      safeguardingApproved: Boolean(r.safeguarding_approved),
      institutionDomain: r.institution_domain || undefined,
      isDemo: Boolean(r.is_demo),
      role: r.role || 'member',
      tathastu_user_id: r.tathastu_user_id || undefined,
    };
  }
  const maps = await pool.query('SELECT * FROM external_identity_mappings');
  for (const r of maps.rows) {
    state.identityMappings[r.id] = {
      id: r.id,
      memberId: r.member_id,
      provider: r.provider,
      externalSubjectId: r.external_subject_id,
      externalEmail: r.external_email,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }
  const conns = await pool.query('SELECT * FROM connection_records');
  for (const r of conns.rows) {
    state.connections[r.id] = {
      id: r.id,
      requesterId: r.requester_id,
      recipientId: r.recipient_id,
      status: r.status,
      introMessage: r.intro_message || undefined,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }
  const blocks = await pool.query('SELECT blocker_id, blocked_id FROM user_blocks');
  for (const r of blocks.rows) state.blockedUsers.push(`${r.blocker_id}:${r.blocked_id}`);
  return state;
}

async function main() {
  if ((jsonIdx === -1) === !fromRelational) {
    console.error('Usage: backfill_documents.ts (--from-json <file> | --from-relational) [--dry-run]');
    process.exit(2);
  }
  const jsonFile = jsonIdx !== -1 ? args[jsonIdx + 1] : null;
  if (jsonIdx !== -1 && (!jsonFile || jsonFile.startsWith('--') || !fs.existsSync(jsonFile))) {
    console.error('--from-json requires an existing file path.');
    process.exit(2);
  }

  // A JSON dry run needs no database; everything else does.
  const needsDb = !(dryRun && jsonFile);
  const pool = needsDb ? getNeonPool() : null;
  if (needsDb && !pool) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }

  let state: DocumentState;
  if (jsonFile) {
    const parsed = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.members !== 'object') {
      console.error('Source is not a Collaborate JSON store (missing "members").');
      process.exit(2);
    }
    state = { ...emptyDocumentState(), ...parsed };
  } else {
    state = await loadFromRelational(pool);
  }

  if (excludeIdx !== -1) {
    const listFile = args[excludeIdx + 1];
    if (!listFile || !fs.existsSync(listFile)) {
      console.error('--exclude-members requires an existing file (one member id per line).');
      process.exit(2);
    }
    const ids = fs.readFileSync(listFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
    const { excludedMembers } = excludeMembers(state, ids);
    console.log(`Excluded ${excludedMembers} of ${ids.length} listed members (and everything referencing them).`);
  }
  const expected = expectedCounts(state);
  const plan = prepareBackfill(state);
  console.log('Source records per collection:', expected);
  console.log('Documents to write per collection:', plan.counts);
  if (Object.keys(plan.renamedDuplicateIds).length) console.log('Colliding ids renamed (kept, not dropped):', plan.renamedDuplicateIds);
  console.log('Not migrated as documents (stay in webhook_events):', plan.skipped);

  if (dryRun) {
    if (pool) await pool.end();
    console.log('Dry run: nothing was written.');
    return;
  }

  try {
    await pool.query('SELECT 1 FROM collaborate_documents LIMIT 1');
  } catch {
    console.error('collaborate_documents does not exist. Run `node scripts/migrate.js` first.');
    await pool.end();
    process.exit(2);
  }
  const { inserted, total, alreadyPresent } = await writeBackfill(pool, plan.docs);
  console.log(`Inserted ${inserted} of ${total} documents; ${alreadyPresent} already present and left unchanged.`);
  const stored = await storedCounts(pool);
  console.log('Stored documents per collection:', stored);
  await pool.end();
}

main().catch((err) => {
  console.error('Backfill failed (safe to re-run; existing documents are never overwritten):', err?.message || err);
  process.exit(1);
});