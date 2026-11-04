-- Collaborate. by AI Tathastu — Migration 002: Central Integration & Projection Schema
-- Defines tathastu_profiles, tathastu_webhook_deliveries, and identity link columns

-- 1. Add tathastu_user_id column to members table if not exists
ALTER TABLE members ADD COLUMN IF NOT EXISTS tathastu_user_id VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_tathastu_user_id ON members(tathastu_user_id) WHERE tathastu_user_id IS NOT NULL;

-- 2. Tathastu Profiles (Latest Authorized ProfessionalProjectionV1 per User)
CREATE TABLE IF NOT EXISTS tathastu_profiles (
    user_id VARCHAR(64) PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
    tathastu_user_id VARCHAR(255) NOT NULL,
    projection JSONB NOT NULL,
    skills_names TEXT[] DEFAULT '{}',
    career_role VARCHAR(255),
    generated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tathastu_profiles_tathastu_user ON tathastu_profiles(tathastu_user_id);

-- 3. Tathastu Webhook Deliveries (Idempotent Webhook Processing)
CREATE TABLE IF NOT EXISTS tathastu_webhook_deliveries (
    delivery_id VARCHAR(255) PRIMARY KEY,
    event_type VARCHAR(128) NOT NULL,
    received_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tathastu_webhook_deliveries_received ON tathastu_webhook_deliveries(received_at);
