-- Migration 008: Transcript Sync Support
-- Adds synced_at column to transcripts for tracking Supabase sync state.
-- Enables diff-based sync: only rows with synced_at IS NULL need uploading.

ALTER TABLE transcripts ADD COLUMN synced_at DATETIME;

-- Record migration
INSERT INTO _migrations (name, framework_version)
VALUES ('008-transcript-sync', '0.6.3');
