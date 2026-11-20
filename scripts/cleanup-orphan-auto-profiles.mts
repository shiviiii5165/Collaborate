/**
 * One-time repair: automatic profiles left behind by AI Tathastu accounts that were deleted before
 * Collaborate erased them on `integration.revoked` (reason account_deleted).
 *
 * A profile is a candidate only if ALL hold:
 *   - Collaborate created it automatically (autoProvisioned) and its owner never set a password here;
 *   - it no longer links to any AI Tathastu account (no tathastu_user_id, no identity mapping);
 *   - every AI Tathastu id it was ever linked to is ABSENT from the active-user list AI Tathastu exported
 *     (so the account is confirmed deleted there, not merely disconnected).
 * Candidates with no connections, conversations or messages are erased with --apply. Candidates with
 * activity are only reported, for an admin to review. Nothing else is touched.
 *
 * Dry run (default) prints counts and masked ids only:
 *   npx tsx scripts/cleanup-orphan-auto-profiles.mts --active-ids <file with one AI Tathastu user id per line>
 * Apply (erases the "erase" group, then re-runs the same checks):
 *   npx tsx scripts/cleanup-orphan-auto-profiles.mts --active-ids <file> --apply
 */
import fs from 'node:fs';

import { durableDb } from '../src/lib/db/index.ts';
import { TathastuSsoService } from '../src/modules/identity/tathastu-sso.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const file = arg('--active-ids');
const apply = process.argv.includes('--apply');
if (!file) {
  console.error('Usage: --active-ids <file> [--apply]');
  process.exit(2);
}
const active = new Set(fs.readFileSync(file, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
if (active.size === 0) {
  // An empty list would make every linked-before profile look deleted: refuse.
  console.error('The active-id list is empty; refusing to run.');
  process.exit(2);
}

await durableDb.syncFromStore();
const mask = (id: string) => `${id.slice(0, 12)}…`;

const erase: string[] = [];
const review: string[] = [];
const skipped: Record<string, number> = {};
const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };

for (const m of durableDb.getAllMembers()) {
  if (!TathastuSsoService.isUnadoptedAutomaticProfile(m)) continue;
  if (m.tathastu_user_id || durableDb.getMappingByMemberId('aitathastu_oidc', m.id)) { skip('still linked'); continue; }
  const subjects = m.unlinkedTathastuSubjects ?? [];
  if (subjects.length === 0) { skip('no recorded AI Tathastu id'); continue; }
  if (subjects.some((s) => active.has(s))) { skip('AI Tathastu account still active (user disconnected)'); continue; }
  (TathastuSsoService.isReclaimableShell(m) ? erase : review).push(m.id);
}

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', activeIdsLoaded: active.size, erase: erase.length, review: review.length, skipped }, null, 1));
console.log('erase:', erase.map(mask).join(', ') || '-');
console.log('review (has activity, not erased):', review.map(mask).join(', ') || '-');

if (apply) {
  let done = 0;
  for (const id of erase) {
    await durableDb.eraseMemberAsync(id);
    done++;
  }
  console.log(`[cleanup] erased ${done} orphan automatic profile(s)`);
}
process.exit(0);
