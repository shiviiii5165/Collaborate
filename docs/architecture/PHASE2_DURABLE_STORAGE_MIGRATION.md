# Phase 2: Durable shared storage — migration and rollback plan

Status: implemented locally. It has not been applied to any hosted database and has not been deployed.

## Problem

`DurableCollaborateDatabase` (`src/lib/db/index.ts`) keeps every collection in a per-process
JS object and serves all reads from it. Postgres receives some fire-and-forget writes into the
relational tables from migration 001, but it is never read back. With two or more API instances:

- Each instance has its own copy of members, connections, messages, credentials and mappings.
- Writes on one instance are invisible to the others, and the copies diverge.
- `data/collaborate.db.json` lives on Render's ephemeral disk, so a redeploy loses data.
- Credentials and most profile sections (projects, experience, education) were never written to Postgres.

## Design (no new infrastructure: the existing Neon/Postgres database only)

Migration `003_durable_documents.sql` adds:

| Object | Purpose |
|---|---|
| `collaborate_documents(collection, id, doc JSONB NULL, rev BIGINT, updated_at)` | Authoritative store for every collection the API keeps in memory. `doc IS NULL` is a tombstone, so deletions propagate to other instances. |
| `collaborate_doc_rev_seq` | Monotonic revision. Assigned under a transaction-scoped advisory lock, so revision order equals commit order. |
| `webhook_events.status / attempts / locked_until / last_error` | Turns the idempotency table into a processing ledger. A delivery counts as processed only after it succeeds. Failed or crashed deliveries can be retried. Defaults keep existing rows `processed`. |

Runtime behaviour when `DATABASE_URL` is set:

1. **Read path.** Before every request, the instance pulls only the documents with `rev > lastSeenRev`
   (one indexed query) and applies them. The first request loads everything. The read API stays
   synchronous, so no route logic changes.
2. **Write path.** Mutations work on the in-memory view as before. Before the response is sent,
   the changed documents (diffed against the last persisted JSON) are written in one transaction:
   - Take `pg_advisory_xact_lock`.
   - Run a conditional `UPDATE ... WHERE rev = <revision this instance read>`, or `INSERT ... ON CONFLICT DO NOTHING` for new documents.
   - Assign a new revision from the sequence.
   - If another instance changed the same document first, the whole transaction rolls back, the conflicting documents are reloaded, and the client gets `409 CONCURRENT_MODIFICATION`. A stale instance can never silently overwrite a newer write.
   - `*Async` repository methods (used by webhooks and SSO) flush before returning, so a webhook is marked processed only after its data is durable.
3. Postgres mode never writes the JSON file and never auto-seeds demo personas.
4. **Fail closed.** If `collaborate_documents` is empty but the legacy `members` table has rows, the API refuses to serve and asks for the backfill. It never serves an empty network over existing users.

Local development and tests without `DATABASE_URL` keep the JSON-file store unchanged.

The legacy relational write-through (members, professional_profiles, connections and so on) is kept as a
secondary copy. It is no longer read by anything.

## Migration procedure (manual, operator-run; not done by this change)

1. Take a Neon branch or snapshot of production. This is the rollback point.
2. `DATABASE_URL=<target> node scripts/migrate.js`. It now applies 001, 002 and 003 in order. All are idempotent (`IF NOT EXISTS`).
3. Backfill the documents, choosing a source:
   - The current JSON file from the running Render instance (preferred: it is the only copy of credentials and full profiles):
     `DATABASE_URL=<target> npx tsx scripts/backfill_documents.ts --from-json <path-to-collaborate.db.json>`
   The full operator procedure with checks is in the Ecosystem folder: `PRODUCTION_MIGRATION_RUNBOOK.md`.
   - Otherwise the relational tables only: `... --from-relational`. Credentials are not present there, so password users would have to reset.
   The backfill uses `INSERT ... ON CONFLICT DO NOTHING`, so it is safe to re-run and never overwrites newer documents.
4. Verify: `SELECT collection, count(*) FROM collaborate_documents WHERE doc IS NOT NULL GROUP BY 1;` should match the source counts.
5. Deploy the API. Scale beyond one instance only after step 4 is verified.

## Rollback

- **Code rollback.** Redeploy the previous commit. Migration 003 is additive (a new table, a new sequence, and new nullable or defaulted columns), and the old code ignores all of it.
- **Data written after the migration** lives in `collaborate_documents`. The old code would not see it. To keep it, export it before rolling back:
  `SELECT collection, id, doc FROM collaborate_documents WHERE doc IS NOT NULL` (or restore from the step-1 snapshot).
- **Schema rollback** (only if required):
  `DROP TABLE collaborate_documents; DROP SEQUENCE collaborate_doc_rev_seq; ALTER TABLE webhook_events DROP COLUMN status, DROP COLUMN attempts, DROP COLUMN locked_until, DROP COLUMN last_error;`

## Known limits

- Flush diffs every in-memory document on requests that mutated state (O(documents)). This is fine at beta scale. Per-document dirty tracking is the next step if the number of documents grows large.
- The full dataset is held in memory on every instance. Moving reads to per-query SQL is a later phase.
- Writes are globally serialized by one advisory lock. Throughput is limited to a few hundred writes per second, which is ample for now.
- The profile-view ledger is stored as one document per (viewer, day). Two instances recording views for the same viewer at the same moment therefore conflict, and one gets 409, so the 3-per-day quota cannot be exceeded through concurrency.
