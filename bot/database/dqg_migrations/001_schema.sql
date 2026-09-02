-- =============================================================================
-- Data Quality Gate POC — real-schema slice
-- =============================================================================
-- A self-contained extract of 4 REAL tables from
-- infrastructure/supabase/00_complete-schema.sql (users, schools,
-- broadcast_logs, dashboard_audit_log — exact column definitions,
-- constraints, and indexes copied verbatim), stripped of everything that
-- doesn't apply on a plain Postgres container: Row Level Security
-- policies (auth.uid() is Supabase-Auth-specific, not available on plain
-- postgres/pgvector images), materialized-view-dependent indexes, and
-- other tables/functions/triggers not needed for this test.
--
-- This is NOT the real product schema file and must never be confused
-- with infrastructure/supabase/00_complete-schema.sql, which is untouched.
-- Purpose: prove the V1 Data Quality Gate (agent-skills-taleemabad,
-- skills/data-quality-gate) correctly introspects and blocks against
-- REAL production-shaped table definitions, not synthetic fixtures.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public;

CREATE TABLE IF NOT EXISTS users (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    phone_number VARCHAR(20) NOT NULL,
    name VARCHAR(100),
    grades_taught VARCHAR(100),
    registration_completed BOOLEAN DEFAULT false,
    registration_started_at TIMESTAMP,
    registration_completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    school_name VARCHAR(200),
    subjects_taught JSONB DEFAULT '[]',
    source VARCHAR(50) DEFAULT 'direct',
    session_id VARCHAR(255),
    first_message_at TIMESTAMP,
    registered_at TIMESTAMP,
    registration_state TEXT DEFAULT 'unregistered',
    registration_state_updated_at TIMESTAMPTZ,
    preferred_language VARCHAR(10) DEFAULT 'en',
    portal_password_hash TEXT,
    portal_invite_token TEXT,
    portal_invite_expires_at TIMESTAMPTZ,
    portal_activated BOOLEAN DEFAULT false,
    portal_last_login TIMESTAMPTZ,
    password_reset_code VARCHAR(6),
    password_reset_expires_at TIMESTAMPTZ,
    language_locked BOOLEAN DEFAULT false,
    is_test_user BOOLEAN DEFAULT false,
    language_nudge_sent BOOLEAN DEFAULT false,
    registration_pending_name BOOLEAN DEFAULT false,
    country VARCHAR(100),
    region VARCHAR(100),
    organization VARCHAR(200),
    school_id UUID,
    role VARCHAR(32),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS schools (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 VARCHAR(255) NOT NULL,
    region               VARCHAR(64),
    principal_user_id    UUID REFERENCES users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, region)
);
CREATE INDEX IF NOT EXISTS idx_schools_region ON schools(region);
CREATE INDEX IF NOT EXISTS idx_schools_principal ON schools(principal_user_id)
    WHERE principal_user_id IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'users_school_id_fkey' AND table_name = 'users'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_school_id_fkey
            FOREIGN KEY (school_id) REFERENCES schools(id);
    END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_users_school_id ON users(school_id) WHERE school_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role      ON users(role)      WHERE role IS NOT NULL;

CREATE TABLE IF NOT EXISTS broadcast_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    admin_user_id UUID,
    admin_username TEXT NOT NULL,
    admin_ip_address TEXT,
    admin_user_agent TEXT,
    message_content TEXT NOT NULL,
    filters JSONB NOT NULL,
    template_id TEXT,
    template_name TEXT,
    template_status TEXT,
    template_rejected_reason TEXT,
    template_submitted_at TIMESTAMPTZ,
    total_recipients INTEGER NOT NULL,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    delivered_count INTEGER DEFAULT 0,
    read_count INTEGER DEFAULT 0,
    replied_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    created_at TIMESTAMPTZ DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancelled_by TEXT,
    errors JSONB,
    error_message TEXT,
    audit_trail JSONB DEFAULT '[]',
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS dashboard_audit_log (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    user_id UUID,
    action VARCHAR(100) NOT NULL,
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    organization_id UUID,
    affected_user_id UUID,
    query_filters JSONB,
    resource_type VARCHAR(50),
    resource_id UUID,
    PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_audit_log_affected_user ON dashboard_audit_log USING btree (affected_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON dashboard_audit_log USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_org ON dashboard_audit_log USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON dashboard_audit_log USING btree (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON dashboard_audit_log USING btree (user_id);
