-- Migration 006: Comprehensive JSONL Extraction
-- Captures all remaining JSONL data elements: stop reasons, thinking blocks,
-- service tier, sidechain flags, system errors/retries, turn durations,
-- tool result errors, and compaction events.

-- 1. Stop reason distribution (JSON object with counts per reason)
ALTER TABLE transcripts ADD COLUMN stop_reason_counts TEXT;

-- 2. Thinking blocks
ALTER TABLE transcripts ADD COLUMN thinking_message_count INTEGER DEFAULT 0;
ALTER TABLE transcripts ADD COLUMN thinking_total_length INTEGER DEFAULT 0;

-- 3. Service tier
ALTER TABLE transcripts ADD COLUMN service_tier TEXT;

-- 4. Sidechain flag
ALTER TABLE transcripts ADD COLUMN has_sidechain INTEGER DEFAULT 0;

-- 5. System message subtypes
ALTER TABLE transcripts ADD COLUMN system_error_count INTEGER DEFAULT 0;
ALTER TABLE transcripts ADD COLUMN system_retry_count INTEGER DEFAULT 0;
ALTER TABLE transcripts ADD COLUMN avg_turn_duration_ms INTEGER;
ALTER TABLE transcripts ADD COLUMN compaction_count INTEGER DEFAULT 0;

-- 6. Tool result errors
ALTER TABLE transcripts ADD COLUMN tool_result_error_count INTEGER DEFAULT 0;

-- 7. Analytics views

-- Brain cycles per task
CREATE VIEW IF NOT EXISTS brain_cycles_per_task AS
SELECT
    t.sprint, t.task_num, t.title, t.complexity,
    tr.user_message_count as brain_cycles,
    tr.total_user_content_length as total_prompt_chars,
    CASE WHEN tr.user_message_count > 0 THEN ROUND(1.0 * tr.total_user_content_length / tr.user_message_count) ELSE 0 END as avg_chars_per_prompt,
    tr.compaction_count,
    json_extract(tr.stop_reason_counts, '$.max_tokens') as max_token_hits
FROM tasks t
JOIN transcripts tr ON tr.sprint = t.sprint AND tr.task_num = t.task_num
WHERE tr.user_message_count > 0;

-- Context loading time
CREATE VIEW IF NOT EXISTS context_loading_time AS
SELECT
    we.sprint, we.task_num,
    COUNT(CASE WHEN we.tool_name IN ('Read', 'Glob', 'Grep') AND we.id < first_write.first_write_id THEN 1 END) as reads_before_first_write,
    COUNT(CASE WHEN we.tool_name IN ('Read', 'Glob', 'Grep') THEN 1 END) as total_reads,
    COUNT(CASE WHEN we.tool_name IN ('Edit', 'Write') THEN 1 END) as total_writes,
    CASE
        WHEN COUNT(CASE WHEN we.tool_name IN ('Edit', 'Write') THEN 1 END) > 0
        THEN ROUND(1.0 *
            COUNT(CASE WHEN we.tool_name IN ('Read', 'Glob', 'Grep') AND we.id < first_write.first_write_id THEN 1 END) /
            COUNT(CASE WHEN we.tool_name IN ('Edit', 'Write') THEN 1 END), 2)
        ELSE NULL
    END as context_load_ratio
FROM workflow_events we
LEFT JOIN (
    SELECT sprint, task_num, MIN(id) as first_write_id
    FROM workflow_events
    WHERE event_type = 'tool_call' AND tool_name IN ('Edit', 'Write')
    GROUP BY sprint, task_num
) first_write ON we.sprint = first_write.sprint AND we.task_num = first_write.task_num
WHERE we.event_type = 'tool_call'
GROUP BY we.sprint, we.task_num;

-- Session health
CREATE VIEW IF NOT EXISTS session_health AS
SELECT
    tr.session_id, tr.sprint, tr.task_num, tr.model,
    tr.system_error_count, tr.system_retry_count, tr.compaction_count,
    tr.tool_result_error_count, tr.thinking_message_count, tr.thinking_total_length,
    tr.has_sidechain, tr.avg_turn_duration_ms, tr.service_tier, tr.stop_reason_counts,
    (tr.system_error_count + tr.system_retry_count + tr.tool_result_error_count) as total_errors,
    CASE
        WHEN (tr.system_error_count + tr.system_retry_count + tr.tool_result_error_count) = 0
            AND tr.compaction_count = 0 THEN 'healthy'
        WHEN tr.compaction_count > 0 THEN 'context_pressure'
        WHEN (tr.system_error_count + tr.system_retry_count) > 2 THEN 'degraded'
        ELSE 'minor_issues'
    END as health_status
FROM transcripts tr;

-- Record migration
INSERT INTO _migrations (name, framework_version)
VALUES ('006-comprehensive-jsonl', '0.6.1');
