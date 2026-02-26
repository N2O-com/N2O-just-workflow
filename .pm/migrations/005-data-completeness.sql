-- Migration 005: Data Completeness
-- Closes 7 data collection gaps identified in the datapoints inventory.
-- Adds transcript-to-task linkage columns, cache token tracking,
-- user message timestamps, git diff stats, and task_trajectory view.

-- 1. Transcripts: user message timestamps (Gap 2)
ALTER TABLE transcripts ADD COLUMN user_message_timestamps TEXT;
-- JSON array of ISO timestamps for user messages

-- 2. Transcripts: cache token tracking (Gap 3)
ALTER TABLE transcripts ADD COLUMN cache_read_tokens INTEGER DEFAULT 0;
ALTER TABLE transcripts ADD COLUMN cache_creation_tokens INTEGER DEFAULT 0;

-- 3. Transcripts: user content length proxy (Gap 3)
ALTER TABLE transcripts ADD COLUMN total_user_content_length INTEGER DEFAULT 0;

-- 4. Tasks: git diff stats (Gap 5)
ALTER TABLE tasks ADD COLUMN lines_added INTEGER;
ALTER TABLE tasks ADD COLUMN lines_removed INTEGER;

-- 5. Task trajectory view (Gap 6)
CREATE VIEW IF NOT EXISTS task_trajectory AS
SELECT
    sprint, task_num,
    COUNT(*) as total_phases,
    SUM(CASE WHEN phase = 'FIX_AUDIT' THEN 1 ELSE 0 END) as audit_reversions,
    MIN(CASE WHEN phase = 'RED' THEN timestamp END) as first_red,
    MAX(CASE WHEN phase IN ('COMMIT', 'REPORT') THEN timestamp END) as completed_at,
    GROUP_CONCAT(phase, ' -> ') as trajectory
FROM workflow_events
WHERE event_type = 'phase_entered'
GROUP BY sprint, task_num;

-- Record migration
INSERT INTO _migrations (name, framework_version)
VALUES ('005-data-completeness', '0.6.0');
