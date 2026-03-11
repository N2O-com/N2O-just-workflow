-- Migration 014: SMS Companion Channel
-- Adds RBAC columns to developers, creates SMS tables.
-- Run against Supabase: each statement is idempotent.

-- access_role: shared with RBAC Foundation (no-op if already added)
ALTER TABLE developers ADD COLUMN IF NOT EXISTS access_role TEXT
  DEFAULT 'engineer'
  CHECK (access_role IN ('admin', 'engineer'));

-- phone_number: E.164 format, unique (identity factor for SMS)
ALTER TABLE developers ADD COLUMN IF NOT EXISTS phone_number TEXT UNIQUE;

-- Set default admin
UPDATE developers SET access_role = 'admin' WHERE name = 'whsimonds';

-- Notification preferences per developer
CREATE TABLE IF NOT EXISTS notification_preferences (
    developer TEXT PRIMARY KEY REFERENCES developers(name),
    enabled BOOLEAN DEFAULT false,
    digest_time TEXT DEFAULT '08:00',
    digest_days TEXT DEFAULT 'Mon,Tue,Wed,Thu,Fri',
    quiet_start TEXT,
    quiet_end TEXT,
    timezone TEXT DEFAULT 'America/New_York',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SMS message log (all inbound + outbound)
CREATE TABLE IF NOT EXISTS sms_log (
    id SERIAL PRIMARY KEY,
    developer TEXT REFERENCES developers(name),
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    message_type TEXT CHECK (message_type IN ('query_response', 'digest',
                            'confirmation', 'pagination', 'test', 'fallback',
                            'rate_limited')),
    message_body TEXT NOT NULL,
    twilio_sid TEXT,
    phone_number TEXT,
    status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered',
                                     'failed', 'received')),
    claude_model TEXT,
    claude_query TEXT,
    response_body TEXT,
    latency_ms INTEGER,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SMS context (confirmations + pagination state)
CREATE TABLE IF NOT EXISTS sms_context (
    id SERIAL PRIMARY KEY,
    developer TEXT NOT NULL REFERENCES developers(name),
    context_type TEXT NOT NULL CHECK (context_type IN ('confirmation', 'pagination')),
    payload JSONB NOT NULL,
    page_index INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'expired')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Fast lookup for active context entries
CREATE INDEX IF NOT EXISTS idx_sms_context_lookup
  ON sms_context (developer, context_type, status)
  WHERE status = 'pending';
