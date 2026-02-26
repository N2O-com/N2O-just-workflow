-- Migration 009: Sync Resilience
-- Adds attempt tracking and error capture for Supabase sync.
-- Rows with sync_attempts >= 5 are skipped to avoid retrying permanently broken data.

ALTER TABLE transcripts ADD COLUMN sync_attempts INTEGER DEFAULT 0;
ALTER TABLE transcripts ADD COLUMN sync_error TEXT;

-- Record migration
INSERT INTO _migrations (name, framework_version)
VALUES ('009-sync-resilience', '0.6.3');
