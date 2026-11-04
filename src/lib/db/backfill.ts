/**
 * Core of the one-time collaborate_documents backfill (scripts/backfill_documents.ts).
 *
 * - Idempotent: INSERT ... ON CONFLICT DO NOTHING never overwrites an existing (possibly newer)
 *   document, so a partial run (crash, network error) is recovered by simply re-running.
 * - Each document is its own statement; there is deliberately no single all-or-nothing
 *   transaction, so a long backfill cannot hold locks and a rerun resumes where it stopped.
 * - Array records whose ids collide (e.g. two audit entries created in the same millisecond)
 *   would collapse into one document; they are given a deterministic suffix and reported,
 *   so nothing is silently lost.
 * - Never logs document contents (only collection names and counts).
 */
import { enumerateDocuments, splitKey, type DocumentState } from './documents';
import { ensureOwnershipModel } from '@/modules/profile/ownership';

export interface BackfillPlan {
  docs: Map<string, string>;
  counts: Record<string, number>;
  renamedDuplicateIds: Record<string, number>;
  skipped: { webhookEvents: number };
}

function disambiguate(arr: any[] | undefined): number {
  if (!Array.isArray(arr)) return 0;
  const seen = new Map<string, number>();
  let renamed = 0;
  for (const item of arr) {
    if (!item || typeof item.id !== 'string') continue;
    const n = seen.get(item.id) ?? 0;
    seen.set(item.id, n + 1);
    if (n > 0) {
      item.id = `${item.id}__dup${n}`;
      renamed++;
    }
  }
  return renamed;
}

/**
 * Removes the given members and EVERYTHING that references them (credentials, identity
 * mappings, connections, conversations and their messages, notifications, blocks, saved lists,
 * view ledger, verification requests/audits, abuse reports), so no orphan survives.
 * Used only when the owner has decided to exclude specific accounts (e.g. test-run accounts).
 */
export function excludeMembers(state: DocumentState, ids: Iterable<string>) {
  const ex = new Set(ids);
  const has = (id: unknown) => typeof id === 'string' && ex.has(id);
  const before = Object.keys(state.members || {}).length;
  for (const id of ex) {
    delete state.members[id];
    delete state.credentials[id];
    if (state.savedMembers) delete state.savedMembers[id];
  }
  const dropRec = (rec: Record<string, any>, pred: (v: any) => boolean) => {
    for (const [k, v] of Object.entries(rec || {})) if (pred(v)) delete rec[k];
  };
  dropRec(state.identityMappings, (m) => has(m.memberId));
  dropRec(state.connections, (c) => has(c.requesterId) || has(c.recipientId));
  const droppedConvs = new Set<string>();
  dropRec(state.conversations, (c) => {
    const hit = (c.participantIds || []).some(has);
    if (hit) droppedConvs.add(c.id);
    return hit;
  });
  dropRec(state.verificationRequests, (r) => has(r.memberId));
  dropRec(state.abuseReports, (r) => has(r.reporterId) || has(r.reportedMemberId));
  state.messages = (state.messages || []).filter((m) => !droppedConvs.has(m.conversationId) && !has(m.senderId) && !has(m.recipientId));
  state.notifications = (state.notifications || []).filter((n) => !has(n.recipientId));
  for (const n of state.notifications) if (has(n.actorId)) delete n.actorId;
  state.verificationAuditLogs = (state.verificationAuditLogs || []).filter((a) => !has(a.memberId));
  state.profileViewLedger = (state.profileViewLedger || []).filter((e) => !has(e.viewerId) && !has(e.targetId));
  state.blockedUsers = (state.blockedUsers || []).filter((k) => !k.split(':').some(has));
  for (const [k, list] of Object.entries(state.savedMembers || {})) state.savedMembers![k] = list.filter((id) => !has(id));
  return { excludedMembers: before - Object.keys(state.members).length };
}

export function prepareBackfill(state: DocumentState): BackfillPlan {
  const renamedDuplicateIds: Record<string, number> = {};
  const r = (k: string, n: number) => {
    if (n) renamedDuplicateIds[k] = n;
  };
  r('message', disambiguate(state.messages));
  r('verification_audit', disambiguate(state.verificationAuditLogs));
  r('notification', disambiguate(state.notifications));
  r('profile_view_entry', disambiguate(state.profileViewLedger));
  if (Array.isArray(state.blockedUsers)) {
    const before = state.blockedUsers.length;
    state.blockedUsers = [...new Set(state.blockedUsers)]; // exact duplicates carry no information
    r('block_exact_duplicates_removed', before - state.blockedUsers.length);
  }

  // Split each member's sections into local vs imported (ambiguous data stays local).
  for (const m of Object.values(state.members || {})) ensureOwnershipModel(m as any);

  // Webhook idempotency state is not migrated as documents: it lives in webhook_events.
  const skipped = { webhookEvents: Object.keys(state.webhookEvents || {}).length };

  const docs = enumerateDocuments(state);
  const counts: Record<string, number> = {};
  for (const key of docs.keys()) {
    const [c] = splitKey(key);
    counts[c] = (counts[c] || 0) + 1;
  }
  return { docs, counts, renamedDuplicateIds, skipped };
}

export async function writeBackfill(pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }, docs: Map<string, string>) {
  let inserted = 0;
  for (const [key, json] of docs) {
    const [collection, id] = splitKey(key);
    const res = await pool.query(
      `INSERT INTO collaborate_documents (collection, id, doc, rev, updated_at)
       VALUES ($1, $2, $3::jsonb, nextval('collaborate_doc_rev_seq'), now())
       ON CONFLICT (collection, id) DO NOTHING RETURNING rev`,
      [collection, id, json]
    );
    inserted += res.rows.length;
  }
  return { inserted, total: docs.size, alreadyPresent: docs.size - inserted };
}
