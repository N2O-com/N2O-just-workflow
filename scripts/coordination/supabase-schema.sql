-- Supabase Coordination Schema
-- Apply this to your Supabase project via the SQL Editor or CLI.
--
-- These tables form Layer 2 of the N2O coordination architecture:
-- Layer 1 (SQLite) = fast local execution, agent hot path
-- Layer 2 (Supabase) = cross-machine visibility, real-time subscriptions
--
-- Data flow: SQLite → Supabase (event-driven, non-blocking)

-- =============================================================================
-- TASKS: Mirror of local SQLite tasks (coordination-relevant fields only)
-- =============================================================================

CREATE TABLE IF NOT EXISTS tasks (
    sprint TEXT NOT NULL,
    task_num INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    done_when TEXT,
    status TEXT DEFAULT 'pending',
    type TEXT,
    owner TEXT,                          -- agent_id that claimed this task
    developer TEXT,                      -- human developer the agent belongs to
    session_id TEXT,
    priority REAL,

    -- Timestamps
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    merged_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (sprint, task_num)
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner);
CREATE INDEX IF NOT EXISTS idx_tasks_developer ON tasks(developer);

-- =============================================================================
-- AGENTS: Registry of active agents across all machines
-- =============================================================================

CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,            -- hostname or machine identifier
    developer TEXT,                      -- human developer running this agent
    task_sprint TEXT,                    -- currently working on
    task_num INTEGER,                    -- currently working on
    worktree_path TEXT,
    files_touched TEXT[],                -- array of file paths being modified
    started_at TIMESTAMPTZ DEFAULT NOW(),
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'active',        -- active, idle, stopped

    FOREIGN KEY (task_sprint, task_num) REFERENCES tasks(sprint, task_num)
);

CREATE INDEX IF NOT EXISTS idx_agents_developer ON agents(developer);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_heartbeat ON agents(last_heartbeat);

-- =============================================================================
-- ACTIVITY_LOG: Event stream for metrics, routing, and debugging
-- =============================================================================

CREATE TABLE IF NOT EXISTS activity_log (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,            -- task_claimed, task_completed, task_blocked,
                                         -- merge_landed, merge_conflict, agent_started,
                                         -- agent_stopped, heartbeat
    agent_id TEXT,
    machine_id TEXT,
    developer TEXT,
    task_sprint TEXT,
    task_num INTEGER,
    metadata JSONB DEFAULT '{}',         -- flexible payload per event type
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_event_type ON activity_log(event_type);
CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity_log(task_sprint, task_num);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);

-- =============================================================================
-- DEVELOPER_TWINS: Current state per developer (for routing)
-- =============================================================================

CREATE TABLE IF NOT EXISTS developer_twins (
    developer TEXT PRIMARY KEY,
    machine_id TEXT,                     -- last known machine

    -- Context state (updated by session hooks)
    loaded_context JSONB DEFAULT '{}',   -- {files: [], modules: [], domains: []}
    path_history JSONB DEFAULT '[]',     -- [{sprint, task_num, files, completed_at}, ...]
    trajectory JSONB DEFAULT '[]',       -- [{sprint, task_num, title}, ...] upcoming tasks

    -- Availability (updated by session hooks + config)
    availability JSONB DEFAULT '{}',     -- {hours_per_day, session_start, avg_session_length}
    session_started_at TIMESTAMPTZ,
    session_duration_minutes INTEGER,

    -- Skill profile (set by managers, mirrors local developers table)
    skill_react INTEGER,
    skill_node INTEGER,
    skill_database INTEGER,
    skill_infra INTEGER,
    skill_testing INTEGER,
    skill_debugging INTEGER,

    -- Velocity (computed from activity_log)
    velocity JSONB DEFAULT '{}',         -- {avg_minutes_per_task, by_type: {frontend: 25.1, ...}}

    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- VIEWS
-- =============================================================================

-- Active agents with their current tasks (for cross-machine visibility)
CREATE OR REPLACE VIEW active_agents AS
SELECT
    a.agent_id,
    a.machine_id,
    a.developer,
    a.task_sprint,
    a.task_num,
    t.title AS task_title,
    a.files_touched,
    a.started_at,
    a.last_heartbeat,
    EXTRACT(EPOCH FROM (NOW() - a.last_heartbeat)) AS seconds_since_heartbeat
FROM agents a
LEFT JOIN tasks t ON t.sprint = a.task_sprint AND t.task_num = a.task_num
WHERE a.status = 'active'
  AND a.last_heartbeat > NOW() - INTERVAL '5 minutes';

-- Working sets: which files each active developer is touching
-- Used by routing algorithm for overlap avoidance
CREATE OR REPLACE VIEW active_working_sets AS
SELECT
    a.developer,
    a.machine_id,
    ARRAY_AGG(DISTINCT f) AS all_files_touched
FROM agents a, UNNEST(a.files_touched) AS f
WHERE a.status = 'active'
  AND a.last_heartbeat > NOW() - INTERVAL '5 minutes'
GROUP BY a.developer, a.machine_id;

-- =============================================================================
-- TRANSCRIPTS: Session-level metrics from Claude Code JSONL transcripts
-- Synced incrementally from local SQLite (only new rows)
-- =============================================================================

CREATE TABLE IF NOT EXISTS transcripts (
    session_id TEXT PRIMARY KEY,
    parent_session_id TEXT,              -- For subagent transcripts
    agent_id TEXT,                       -- For subagent transcripts
    developer TEXT,                      -- Engineer who ran this session
    machine_id TEXT,                     -- Hostname of the machine

    -- Counts
    message_count INTEGER,
    user_message_count INTEGER,
    assistant_message_count INTEGER,
    tool_call_count INTEGER,

    -- Tokens
    total_input_tokens INTEGER,
    total_output_tokens INTEGER,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_creation_tokens INTEGER DEFAULT 0,
    estimated_cost_usd NUMERIC,

    -- Model and timing
    model TEXT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,

    -- Task linkage
    sprint TEXT,
    task_num INTEGER,

    -- User behavior
    user_message_timestamps JSONB DEFAULT '[]',
    assistant_message_timestamps JSONB DEFAULT '[]',
    total_user_content_length INTEGER DEFAULT 0,

    -- Session quality signals
    stop_reason_counts JSONB DEFAULT '{}',
    thinking_message_count INTEGER DEFAULT 0,
    thinking_total_length INTEGER DEFAULT 0,
    service_tier TEXT,
    has_sidechain BOOLEAN DEFAULT FALSE,
    system_error_count INTEGER DEFAULT 0,
    system_retry_count INTEGER DEFAULT 0,
    avg_turn_duration_ms INTEGER,
    tool_result_error_count INTEGER DEFAULT 0,
    compaction_count INTEGER DEFAULT 0,

    -- Session context
    cwd TEXT,
    git_branch TEXT,
    background_task_count INTEGER DEFAULT 0,
    web_search_count INTEGER DEFAULT 0,

    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcripts_developer ON transcripts(developer);
CREATE INDEX IF NOT EXISTS idx_transcripts_sprint ON transcripts(sprint, task_num);
CREATE INDEX IF NOT EXISTS idx_transcripts_started ON transcripts(started_at);
CREATE INDEX IF NOT EXISTS idx_transcripts_model ON transcripts(model);

-- Per-developer session summary (for querying engineer productivity)
CREATE OR REPLACE VIEW developer_session_summary AS
SELECT
    developer,
    COUNT(*) as total_sessions,
    SUM(total_input_tokens + total_output_tokens) as total_tokens,
    SUM(estimated_cost_usd) as total_cost_usd,
    AVG(user_message_count) as avg_user_messages,
    AVG(tool_call_count) as avg_tool_calls,
    AVG(compaction_count) as avg_compactions,
    AVG(system_error_count) as avg_errors,
    SUM(CASE WHEN has_sidechain THEN 1 ELSE 0 END) as sidechain_sessions,
    MIN(started_at) as first_session,
    MAX(started_at) as latest_session
FROM transcripts
WHERE developer IS NOT NULL
GROUP BY developer;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_twins ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;

-- Service role has full access (agents use service role key)
CREATE POLICY "Service role full access" ON tasks
    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON agents
    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON activity_log
    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON developer_twins
    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON transcripts
    FOR ALL USING (true) WITH CHECK (true);

-- =============================================================================
-- REAL-TIME
-- =============================================================================

-- Enable real-time on tables that need push notifications
-- Agents subscribe to task claims and agent registry changes
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE agents;
