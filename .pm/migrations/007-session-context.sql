-- Migration 007: Session Context Fields
-- Adds working directory, git branch, assistant timestamps,
-- background task count, and web search count.

ALTER TABLE transcripts ADD COLUMN cwd TEXT;
ALTER TABLE transcripts ADD COLUMN git_branch TEXT;
ALTER TABLE transcripts ADD COLUMN assistant_message_timestamps TEXT;
ALTER TABLE transcripts ADD COLUMN background_task_count INTEGER DEFAULT 0;
ALTER TABLE transcripts ADD COLUMN web_search_count INTEGER DEFAULT 0;

-- Record migration
INSERT INTO _migrations (name, framework_version)
VALUES ('007-session-context', '0.6.2');
