/**
 * Post-backfill integrity checks for collaborate_documents. Used by the rehearsal
 * (scripts/rehearse_migration.ts) and copied verbatim into PRODUCTION_MIGRATION_RUNBOOK.md.
 * Every query returns offending ids only (never hashes, salts, emails or profile content).
 */
import type { DocumentState } from './documents';

export interface IntegrityCheck {
  name: string;
  sql: string;
}

export const INTEGRITY_CHECKS: IntegrityCheck[] = [
  {
    name: 'every credential belongs to an existing member',
    sql: `SELECT c.id FROM collaborate_documents c
          LEFT JOIN collaborate_documents m ON m.collection='member' AND m.id=c.id AND m.doc IS NOT NULL
          WHERE c.collection='credential' AND c.doc IS NOT NULL AND m.id IS NULL`,
  },
  {
    name: 'every credential has a password hash and salt',
    sql: `SELECT id FROM collaborate_documents WHERE collection='credential' AND doc IS NOT NULL
          AND (coalesce(length(doc->>'passwordHash'),0) < 16 OR coalesce(length(doc->>'salt'),0) < 8)`,
  },
  {
    name: 'every identity mapping references an existing member',
    sql: `SELECT d.id FROM collaborate_documents d
          LEFT JOIN collaborate_documents m ON m.collection='member' AND m.id = d.doc->>'memberId' AND m.doc IS NOT NULL
          WHERE d.collection='identity_mapping' AND d.doc IS NOT NULL AND m.id IS NULL`,
  },
  {
    name: 'no provider subject is mapped more than once',
    sql: `SELECT (doc->>'provider') || ':' || (doc->>'externalSubjectId') AS id FROM collaborate_documents
          WHERE collection='identity_mapping' AND doc IS NOT NULL GROUP BY 1 HAVING count(*) > 1`,
  },
  {
    name: 'no member has two mappings for the same provider',
    sql: `SELECT (doc->>'provider') || ':' || (doc->>'memberId') AS id FROM collaborate_documents
          WHERE collection='identity_mapping' AND doc IS NOT NULL GROUP BY 1 HAVING count(*) > 1`,
  },
  {
    name: 'every linked member has a matching identity mapping',
    sql: `SELECT m.id FROM collaborate_documents m
          WHERE m.collection='member' AND m.doc IS NOT NULL AND coalesce(m.doc->>'tathastu_user_id','') <> ''
          AND NOT EXISTS (SELECT 1 FROM collaborate_documents x WHERE x.collection='identity_mapping' AND x.doc IS NOT NULL
                          AND x.doc->>'memberId' = m.id AND x.doc->>'externalSubjectId' = m.doc->>'tathastu_user_id')`,
  },
  {
    name: 'every connection references existing members',
    sql: `SELECT d.id FROM collaborate_documents d WHERE d.collection='connection' AND d.doc IS NOT NULL AND (
            NOT EXISTS (SELECT 1 FROM collaborate_documents m WHERE m.collection='member' AND m.doc IS NOT NULL AND m.id=d.doc->>'requesterId') OR
            NOT EXISTS (SELECT 1 FROM collaborate_documents m WHERE m.collection='member' AND m.doc IS NOT NULL AND m.id=d.doc->>'recipientId'))`,
  },
  {
    name: 'every member has the ownership model (localProfile)',
    sql: `SELECT id FROM collaborate_documents WHERE collection='member' AND doc IS NOT NULL AND NOT (doc ? 'localProfile')`,
  },
  {
    name: 'no member still stores a raw legacy projection (tathastuProfile)',
    sql: `SELECT id FROM collaborate_documents WHERE collection='member' AND doc IS NOT NULL AND (doc ? 'tathastuProfile')`,
  },
];

export async function runIntegrityChecks(pool: { query: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }> }) {
  const results: { name: string; offending: string[] }[] = [];
  for (const c of INTEGRITY_CHECKS) {
    const res = await pool.query(c.sql);
    results.push({ name: c.name, offending: res.rows.map((r) => String(r.id)) });
  }
  return results;
}

/** Expected document counts per collection, computed from the source state. */
export function expectedCounts(s: DocumentState): Record<string, number> {
  const days = new Set((s.profileViewLedger || []).map((e: any) => `${e.viewerId}|${e.dateKey}`));
  const out: Record<string, number> = {
    member: Object.keys(s.members || {}).length,
    credential: Object.keys(s.credentials || {}).length,
    identity_mapping: Object.keys(s.identityMappings || {}).length,
    connection: Object.keys(s.connections || {}).length,
    conversation: Object.keys(s.conversations || {}).length,
    // Raw record counts: the backfill renames colliding ids, so every record becomes a document.
    message: (s.messages || []).length,
    verification_request: Object.keys(s.verificationRequests || {}).length,
    verification_audit: (s.verificationAuditLogs || []).length,
    abuse_report: Object.keys(s.abuseReports || {}).length,
    notification: (s.notifications || []).length,
    block: new Set(s.blockedUsers || []).size,
    saved_members: Object.keys(s.savedMembers || {}).length,
    profile_view_day: days.size,
  };
  for (const k of Object.keys(out)) if (out[k] === 0) delete out[k];
  return out;
}

export async function storedCounts(pool: { query: (sql: string) => Promise<{ rows: any[] }> }) {
  const res = await pool.query(`SELECT collection, count(*)::int AS n FROM collaborate_documents WHERE doc IS NOT NULL GROUP BY 1`);
  return Object.fromEntries(res.rows.map((r) => [r.collection, Number(r.n)])) as Record<string, number>;
}

/** Source records whose ids collide inside an array collection (they collapse to one document). */
export function duplicateIds(s: DocumentState): Record<string, number> {
  const dup = (arr: any[]) => arr.length - new Set(arr.map((x) => x.id)).size;
  const out: Record<string, number> = {
    message: dup(s.messages || []),
    verification_audit: dup(s.verificationAuditLogs || []),
    notification: dup(s.notifications || []),
    block: (s.blockedUsers || []).length - new Set(s.blockedUsers || []).size,
  };
  for (const k of Object.keys(out)) if (out[k] === 0) delete out[k];
  return out;
}
