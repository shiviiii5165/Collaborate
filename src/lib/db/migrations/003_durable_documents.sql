-- Collaborate — Migration 003: durable shared document store + webhook processing ledger
-- Additive and idempotent. Rollback: docs/architecture/PHASE2_DURABLE_STORAGE_MIGRATION.md

-- 1. Monotonic revision. Values are taken under pg_advisory_xact_lock, so rev order = commit order.
CREATE SEQUENCE IF NOT EXISTS collaborate_doc_rev_seq;

-- 2. Authoritative store for every collection the API keeps in memory.
--    doc IS NULL marks a deletion (tombstone) so other instances observe it.
CREATE TABLE IF NOT EXISTS collaborate_documents (
    collection VARCHAR(64)  NOT NULL,
    id         VARCHAR(255) NOT NULL,
    doc        JSONB,
    rev        BIGINT       NOT NULL,
    updated_at TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (collection, id)
);
-- Incremental sync: SELECT ... WHERE rev > $lastSeen ORDER BY rev
CREATE INDEX IF NOT EXISTS idx_collaborate_documents_rev ON collaborate_documents(rev);

-- 3. Webhook processing ledger. Existing rows were recorded as processed, so they default to it.
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS status VARCHAR(16) DEFAULT 'processed' NOT NULL;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 1 NOT NULL;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS last_error TEXT;
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(provider, status);
