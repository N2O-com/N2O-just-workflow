-- Skill versioning: Track version history per skill
-- Migration 003: skill-versioning

-- Create skill_versions table
CREATE TABLE IF NOT EXISTS skill_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_name TEXT NOT NULL,
    version TEXT NOT NULL,
    framework_version TEXT,
    introduced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    changelog TEXT,
    UNIQUE(skill_name, version)
);

CREATE INDEX IF NOT EXISTS idx_skill_versions_name ON skill_versions(skill_name);

-- Version comparison views

DROP VIEW IF EXISTS skill_version_token_usage;
CREATE VIEW IF NOT EXISTS skill_version_token_usage AS
SELECT
    skill_name,
    skill_version,
    COUNT(*) as invocations,
    COALESCE(SUM(input_tokens / NULLIF(tool_calls_in_msg, 0)), 0) as total_input_tokens,
    COALESCE(SUM(output_tokens / NULLIF(tool_calls_in_msg, 0)), 0) as total_output_tokens,
    ROUND(AVG((input_tokens + output_tokens) / NULLIF(tool_calls_in_msg, 0)), 0) as avg_tokens_per_call
FROM workflow_events
WHERE event_type = 'tool_call' AND input_tokens IS NOT NULL AND skill_version IS NOT NULL
GROUP BY skill_name, skill_version;

DROP VIEW IF EXISTS skill_version_duration;
CREATE VIEW IF NOT EXISTS skill_version_duration AS
SELECT
    e1.skill_name,
    e1.skill_version,
    COUNT(*) as invocations,
    ROUND(AVG((julianday(e2.timestamp) - julianday(e1.timestamp)) * 86400)) as avg_seconds,
    ROUND(MIN((julianday(e2.timestamp) - julianday(e1.timestamp)) * 86400)) as min_seconds,
    ROUND(MAX((julianday(e2.timestamp) - julianday(e1.timestamp)) * 86400)) as max_seconds
FROM workflow_events e1
JOIN workflow_events e2
    ON e1.sprint = e2.sprint AND e1.task_num = e2.task_num
    AND e2.event_type = 'task_completed' AND e2.skill_name = e1.skill_name
WHERE e1.event_type = 'skill_invoked' AND e1.skill_version IS NOT NULL
GROUP BY e1.skill_name, e1.skill_version;

DROP VIEW IF EXISTS skill_version_precision;
CREATE VIEW IF NOT EXISTS skill_version_precision AS
SELECT
    we.skill_name,
    we.skill_version,
    COUNT(DISTINCT we.sprint || '/' || we.task_num) as tasks,
    ROUND(AVG(sub.exploration_ratio), 2) as avg_exploration_ratio
FROM workflow_events we
JOIN (
    SELECT
        sprint,
        task_num,
        COUNT(DISTINCT CASE WHEN tool_name IN ('Read', 'Glob', 'Grep')
            THEN json_extract(metadata, '$.file_path') END) as files_read,
        COUNT(DISTINCT CASE WHEN tool_name IN ('Edit', 'Write')
            THEN json_extract(metadata, '$.file_path') END) as files_modified,
        CASE
            WHEN COUNT(DISTINCT CASE WHEN tool_name IN ('Read', 'Glob', 'Grep')
                THEN json_extract(metadata, '$.file_path') END) > 0
            THEN ROUND(1.0 - (
                1.0 * COUNT(DISTINCT CASE WHEN tool_name IN ('Edit', 'Write')
                    THEN json_extract(metadata, '$.file_path') END) /
                COUNT(DISTINCT CASE WHEN tool_name IN ('Read', 'Glob', 'Grep')
                    THEN json_extract(metadata, '$.file_path') END)
            ), 2)
            ELSE NULL
        END as exploration_ratio
    FROM workflow_events
    WHERE event_type = 'tool_call'
    GROUP BY sprint, task_num
) sub ON we.sprint = sub.sprint AND we.task_num = sub.task_num
WHERE we.event_type = 'tool_call' AND we.skill_version IS NOT NULL AND sub.exploration_ratio IS NOT NULL
GROUP BY we.skill_name, we.skill_version;

-- Seed initial version data for all 6 skills
INSERT OR IGNORE INTO skill_versions (skill_name, version, changelog) VALUES
    ('tdd-agent', '1.0.0', 'Initial versioned release'),
    ('pm-agent', '1.0.0', 'Initial versioned release'),
    ('bug-workflow', '1.0.0', 'Initial versioned release'),
    ('detect-project', '1.0.0', 'Initial versioned release'),
    ('react-best-practices', '1.0.0', 'Initial versioned release'),
    ('web-design-guidelines', '1.0.0', 'Initial versioned release');

-- Add verified_at column to tasks table for completion-to-review tracking
-- Note: this will error if column already exists (e.g., fresh schema).
-- The n2o migration runner uses seed_migrations() for fresh installs,
-- so this only runs against pre-existing databases that lack the column.
ALTER TABLE tasks ADD COLUMN verified_at DATETIME;
