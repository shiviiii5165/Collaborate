-- Collaborate by AI Tathastu: Separate Neon Database Schema Migration
-- Migration: 001_initial_schema.sql
-- Description: Isolated database schema for Collaborate. Does not share tables with Tathastu Core.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Members
CREATE TABLE IF NOT EXISTS members (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(32) DEFAULT 'member' NOT NULL, -- 'member', 'admin'
    plan VARCHAR(32) DEFAULT 'free' NOT NULL, -- 'free', 'premium'
    plan_expires_at TIMESTAMPTZ,
    is_verified BOOLEAN DEFAULT FALSE NOT NULL,
    verified_category VARCHAR(64), -- 'identity', 'institution', 'organization'
    verified_at TIMESTAMPTZ,
    is_under_18 BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 2. External Identity Mappings (OIDC / OAuth / SSO)
CREATE TABLE IF NOT EXISTS external_identity_mappings (
    id VARCHAR(64) PRIMARY KEY,
    member_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL, -- 'aitathastu_oidc', 'google'
    external_subject_id VARCHAR(255) NOT NULL,
    external_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(provider, external_subject_id),
    UNIQUE(provider, member_id)
);

-- 3. Professional Profiles
CREATE TABLE IF NOT EXISTS professional_profiles (
    member_id VARCHAR(64) PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
    headline VARCHAR(255) NOT NULL,
    about TEXT,
    avatar_url TEXT,
    banner_url TEXT,
    location VARCHAR(255),
    status_badges JSONB DEFAULT '[]'::jsonb NOT NULL,
    context_tags JSONB DEFAULT '[]'::jsonb NOT NULL,
    social_links JSONB DEFAULT '{}'::jsonb NOT NULL,
    metrics JSONB DEFAULT '{"projects":0,"skills":0,"achievements":0,"githubContributions":"0","leetcodeProblems":"0","publications":0}'::jsonb NOT NULL,
    skills JSONB DEFAULT '[]'::jsonb NOT NULL,
    ai_specializations JSONB DEFAULT '[]'::jsonb NOT NULL,
    collaboration_interests JSONB DEFAULT '[]'::jsonb NOT NULL,
    discoverable BOOLEAN DEFAULT TRUE NOT NULL,
    profile_visibility VARCHAR(32) DEFAULT 'public' NOT NULL, -- 'public', 'connections_only', 'private'
    contact_visibility VARCHAR(32) DEFAULT 'connections_only' NOT NULL,
    is_linked_with_tathastu BOOLEAN DEFAULT FALSE NOT NULL,
    tathastu_sync_status VARCHAR(32) DEFAULT 'unlinked' NOT NULL,
    tathastu_sync_settings JSONB DEFAULT '{"autoSyncProjects":true,"autoSyncSkills":true,"autoSyncAchievements":true}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 4. Profile Sections: Projects, Experience, Education, Recent Activity
CREATE TABLE IF NOT EXISTS profile_projects (
    id VARCHAR(64) PRIMARY KEY,
    member_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    featured BOOLEAN DEFAULT FALSE,
    tags JSONB DEFAULT '[]'::jsonb,
    stars INTEGER DEFAULT 0,
    forks INTEGER DEFAULT 0,
    demo_url TEXT,
    image_url TEXT,
    source_origin VARCHAR(64) DEFAULT 'collaborate',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_experience (
    id VARCHAR(64) PRIMARY KEY,
    member_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    role VARCHAR(255) NOT NULL,
    company VARCHAR(255) NOT NULL,
    period VARCHAR(128) NOT NULL,
    bullets JSONB DEFAULT '[]'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_education (
    id VARCHAR(64) PRIMARY KEY,
    member_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    institution VARCHAR(255) NOT NULL,
    period VARCHAR(128) NOT NULL,
    degree VARCHAR(255) NOT NULL,
    score VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_activities (
    id VARCHAR(64) PRIMARY KEY,
    member_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    activity_type VARCHAR(64) NOT NULL, -- 'github', 'leetcode', 'project', 'publication'
    title VARCHAR(255) NOT NULL,
    time_ago VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 5. Connections & Connection Requests
CREATE TABLE IF NOT EXISTS connection_records (
    id VARCHAR(64) PRIMARY KEY,
    requester_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    recipient_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL, -- 'request_sent', 'accepted', 'rejected', 'withdrawn', 'removed', 'blocked'
    intro_message VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(requester_id, recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_connections_users ON connection_records(requester_id, recipient_id, status);

-- 6. User Blocks & Safety
CREATE TABLE IF NOT EXISTS user_blocks (
    id VARCHAR(64) PRIMARY KEY,
    blocker_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    blocked_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(blocker_id, blocked_id)
);

-- 7. Conversations & Messages
CREATE TABLE IF NOT EXISTS conversations (
    id VARCHAR(64) PRIMARY KEY,
    participant_one VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    participant_two VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    last_message_content TEXT,
    last_message_timestamp TIMESTAMPTZ,
    last_message_sender VARCHAR(64),
    unread_count_one INTEGER DEFAULT 0 NOT NULL,
    unread_count_two INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(participant_one, participant_two)
);

CREATE TABLE IF NOT EXISTS direct_messages (
    id VARCHAR(64) PRIMARY KEY,
    conversation_id VARCHAR(64) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    recipient_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    status VARCHAR(32) DEFAULT 'delivered' NOT NULL, -- 'sent', 'delivered', 'read'
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON direct_messages(conversation_id, created_at);

-- 8. Profile View Ledger (Server-Authoritative Daily Quota Enforcement)
CREATE TABLE IF NOT EXISTS profile_view_ledger (
    id VARCHAR(64) PRIMARY KEY,
    viewer_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    target_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    date_key VARCHAR(10) NOT NULL, -- 'YYYY-MM-DD' in Asia/Kolkata
    viewed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(viewer_id, target_id, date_key)
);
CREATE INDEX IF NOT EXISTS idx_quota_lookup ON profile_view_ledger(viewer_id, date_key);

-- 9. Verification Requests, Decisions & Immutable Audit Logs
CREATE TABLE IF NOT EXISTS verification_requests (
    id VARCHAR(64) PRIMARY KEY,
    member_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    member_name VARCHAR(255) NOT NULL,
    member_email VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL, -- 'identity', 'institution', 'organization'
    evidence_summary TEXT NOT NULL,
    status VARCHAR(32) DEFAULT 'pending' NOT NULL, -- 'pending', 'approved', 'rejected'
    reviewer_notes TEXT,
    reviewed_by VARCHAR(64),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    request_id VARCHAR(64) NOT NULL,
    member_id VARCHAR(64) NOT NULL,
    action VARCHAR(32) NOT NULL, -- 'approved', 'rejected', 'revoked'
    reviewer VARCHAR(64) NOT NULL,
    category VARCHAR(64) NOT NULL,
    notes TEXT,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 10. Abuse Reports
CREATE TABLE IF NOT EXISTS abuse_reports (
    id VARCHAR(64) PRIMARY KEY,
    reporter_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    reported_member_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    reason VARCHAR(128) NOT NULL,
    details TEXT,
    status VARCHAR(32) DEFAULT 'pending' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 11. Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(64) PRIMARY KEY,
    recipient_id VARCHAR(64) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    actor_id VARCHAR(64) REFERENCES members(id) ON DELETE SET NULL,
    notification_type VARCHAR(64) NOT NULL, -- 'connection_request', 'connection_accepted', 'message', 'verification_approved'
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, is_read);
