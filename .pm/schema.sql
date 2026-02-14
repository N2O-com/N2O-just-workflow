-- N2O Workflow Task Management Schema
-- Initialize with: sqlite3 .pm/tasks.db < .pm/schema.sql

-- =============================================================================
-- TABLES
-- =============================================================================

-- Tasks table: Primary Key is (sprint, task_num)
CREATE TABLE IF NOT EXISTS tasks (
    sprint TEXT NOT NULL,
    task_num INTEGER NOT NULL,
    spec TEXT,                          -- Spec file name (e.g., '01-deals-pipeline.md')
    title TEXT NOT NULL,
    description TEXT,                   -- Context (executable in isolation)
    done_when TEXT,                     -- What makes this done
    status TEXT DEFAULT 'pending',      -- pending, red, green, blocked
    blocked_reason TEXT,                -- Why task is blocked (if status = blocked)
    type TEXT,                          -- database, actions, frontend, infra, agent, e2e, docs
    owner TEXT,                         -- Engineer assigned
    skills TEXT,                        -- Comma-separated skills to invoke

    -- Audit tracking
    pattern_audited BOOLEAN DEFAULT 0,  -- Dev agent audited patterns after implementation
    pattern_audit_notes TEXT,           -- What patterns were found/documented
    skills_updated BOOLEAN DEFAULT 0,   -- Dev agent updated relevant skills
    skills_update_notes TEXT,           -- What skill updates were made
    tests_pass BOOLEAN DEFAULT 0,       -- All tests passing
    testing_posture TEXT,               -- Grade: A, B, C, D, F (target: A)
    verified BOOLEAN DEFAULT 0,         -- PM verified task completion

    -- Velocity tracking (auto-populated by triggers)
    started_at DATETIME,                -- Auto-set when status changes from 'pending'
    completed_at DATETIME,              -- Auto-set when status changes to 'green'

    -- Estimation and complexity (set by PM during task breakdown)
    estimated_hours REAL,               -- PM's estimate at planning time
    complexity TEXT,                     -- low, medium, high, unknown
    complexity_notes TEXT,              -- Why (e.g., 'unstable API', 'heavy integration')
    reversions INTEGER DEFAULT 0,       -- Times status went backward (green→red, green→blocked)

    -- Git tracking (set by commit-task.sh script)
    commit_hash TEXT,                   -- Git commit hash after task completion

    -- External PM tool sync (Linear, Asana, Jira, etc.)
    external_id TEXT,                   -- Linear issue ID, Asana task ID, etc.
    external_url TEXT,                  -- Link to task in PM tool
    last_synced_at DATETIME,            -- When this task was last synced

    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (sprint, task_num),

    -- Data integrity constraints
    CHECK (status IN ('pending', 'red', 'green', 'blocked')),
    CHECK (type IS NULL OR type IN ('database', 'actions', 'frontend', 'infra', 'agent', 'e2e', 'docs')),
    CHECK (testing_posture IS NULL OR testing_posture IN ('A', 'B', 'C', 'D', 'F')),
    CHECK (complexity IS NULL OR complexity IN ('low', 'medium', 'high', 'unknown'))
);

-- Developers table: Developer profiles and skill ratings
CREATE TABLE IF NOT EXISTS developers (
    name TEXT PRIMARY KEY,              -- Short identifier (e.g., 'luke', 'ella', 'manda')
    full_name TEXT NOT NULL,
    role TEXT,                          -- e.g., 'frontend', 'backend', 'fullstack'

    -- Skill ratings (1-5, updated periodically by manager)
    skill_react INTEGER,
    skill_node INTEGER,
    skill_database INTEGER,
    skill_infra INTEGER,
    skill_testing INTEGER,
    skill_debugging INTEGER,

    -- Thinking style / strengths (free text, manager-written)
    strengths TEXT,                     -- e.g., 'Strong systems thinker, good at decomposition'
    growth_areas TEXT,                  -- e.g., 'Tends to over-engineer, needs more testing discipline'

    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Task dependencies table
CREATE TABLE IF NOT EXISTS task_dependencies (
    sprint TEXT NOT NULL,
    task_num INTEGER NOT NULL,
    depends_on_sprint TEXT NOT NULL,
    depends_on_task INTEGER NOT NULL,
    PRIMARY KEY (sprint, task_num, depends_on_sprint, depends_on_task),
    FOREIGN KEY (sprint, task_num) REFERENCES tasks(sprint, task_num),
    FOREIGN KEY (depends_on_sprint, depends_on_task) REFERENCES tasks(sprint, task_num)
);

-- =============================================================================
-- VIEWS
-- =============================================================================

-- Available tasks: Pending tasks with no unfinished dependencies AND not claimed
DROP VIEW IF EXISTS available_tasks;
CREATE VIEW available_tasks AS
SELECT t.*
FROM tasks t
WHERE t.status = 'pending'
  AND t.owner IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM task_dependencies d
    JOIN tasks dep ON dep.sprint = d.depends_on_sprint AND dep.task_num = d.depends_on_task
    WHERE d.sprint = t.sprint
      AND d.task_num = t.task_num
      AND dep.status != 'green'
  );

-- Blocked tasks: Tasks with status = 'blocked'
CREATE VIEW IF NOT EXISTS blocked_tasks AS
SELECT sprint, task_num, title, blocked_reason, owner
FROM tasks
WHERE status = 'blocked';

-- Sprint progress: Summary of task statuses per sprint
CREATE VIEW IF NOT EXISTS sprint_progress AS
SELECT
    sprint,
    COUNT(*) as total_tasks,
    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status = 'red' THEN 1 ELSE 0 END) as red,
    SUM(CASE WHEN status = 'green' THEN 1 ELSE 0 END) as green,
    SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked,
    SUM(CASE WHEN pattern_audited = 1 THEN 1 ELSE 0 END) as audited,
    SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) as verified,
    ROUND(100.0 * SUM(CASE WHEN status = 'green' THEN 1 ELSE 0 END) / COUNT(*), 1) as percent_complete
FROM tasks
GROUP BY sprint;

-- Needs pattern audit: Green tasks that haven't been audited
CREATE VIEW IF NOT EXISTS needs_pattern_audit AS
SELECT sprint, task_num, title, owner
FROM tasks
WHERE status = 'green'
  AND pattern_audited = 0;

-- Needs verification: Green and audited tasks pending PM verification
CREATE VIEW IF NOT EXISTS needs_verification AS
SELECT sprint, task_num, title, done_when, owner
FROM tasks
WHERE status = 'green'
  AND pattern_audited = 1
  AND verified = 0;

-- Refactor audit: Tasks with skills_update_notes (patterns identified)
CREATE VIEW IF NOT EXISTS refactor_audit AS
SELECT sprint, task_num, title, skills_update_notes
FROM tasks
WHERE skills_update_notes IS NOT NULL
  AND skills_update_notes != '';

-- Velocity report: Task completion times
CREATE VIEW IF NOT EXISTS velocity_report AS
SELECT
    sprint,
    task_num,
    title,
    started_at,
    completed_at,
    ROUND((julianday(completed_at) - julianday(started_at)) * 24, 1) as hours_to_complete
FROM tasks
WHERE started_at IS NOT NULL
  AND completed_at IS NOT NULL
ORDER BY sprint, task_num;

-- Sprint velocity: Average completion time per sprint
CREATE VIEW IF NOT EXISTS sprint_velocity AS
SELECT
    sprint,
    COUNT(*) as completed_tasks,
    ROUND(AVG((julianday(completed_at) - julianday(started_at)) * 24), 1) as avg_hours_per_task,
    ROUND(SUM((julianday(completed_at) - julianday(started_at)) * 24), 1) as total_hours
FROM tasks
WHERE started_at IS NOT NULL
  AND completed_at IS NOT NULL
GROUP BY sprint;

-- Developer velocity: average hours per task, by person
CREATE VIEW IF NOT EXISTS developer_velocity AS
SELECT
    owner,
    COUNT(*) as completed_tasks,
    ROUND(AVG((julianday(completed_at) - julianday(started_at)) * 24), 1) as avg_hours,
    ROUND(MIN((julianday(completed_at) - julianday(started_at)) * 24), 1) as fastest,
    ROUND(MAX((julianday(completed_at) - julianday(started_at)) * 24), 1) as slowest
FROM tasks
WHERE started_at IS NOT NULL
  AND completed_at IS NOT NULL
  AND owner IS NOT NULL
GROUP BY owner;

-- Estimation accuracy: how close estimates are to actuals, by person
CREATE VIEW IF NOT EXISTS estimation_accuracy AS
SELECT
    owner,
    COUNT(*) as tasks_with_estimates,
    ROUND(AVG(estimated_hours), 1) as avg_estimated,
    ROUND(AVG((julianday(completed_at) - julianday(started_at)) * 24), 1) as avg_actual,
    ROUND(
        AVG((julianday(completed_at) - julianday(started_at)) * 24) /
        NULLIF(AVG(estimated_hours), 0),
    2) as blow_up_ratio,  -- >1 means tasks take longer than estimated
    ROUND(AVG(ABS(
        (julianday(completed_at) - julianday(started_at)) * 24 - estimated_hours
    )), 1) as avg_error_hours
FROM tasks
WHERE started_at IS NOT NULL
  AND completed_at IS NOT NULL
  AND estimated_hours IS NOT NULL
  AND owner IS NOT NULL
GROUP BY owner;

-- Estimation accuracy by task type: are we worse at estimating frontend vs database?
CREATE VIEW IF NOT EXISTS estimation_accuracy_by_type AS
SELECT
    type,
    COUNT(*) as tasks,
    ROUND(AVG(estimated_hours), 1) as avg_estimated,
    ROUND(AVG((julianday(completed_at) - julianday(started_at)) * 24), 1) as avg_actual,
    ROUND(
        AVG((julianday(completed_at) - julianday(started_at)) * 24) /
        NULLIF(AVG(estimated_hours), 0),
    2) as blow_up_ratio
FROM tasks
WHERE started_at IS NOT NULL
  AND completed_at IS NOT NULL
  AND estimated_hours IS NOT NULL
GROUP BY type;

-- Estimation accuracy by complexity: do "high" complexity tasks blow up more?
CREATE VIEW IF NOT EXISTS estimation_accuracy_by_complexity AS
SELECT
    complexity,
    COUNT(*) as tasks,
    ROUND(AVG(estimated_hours), 1) as avg_estimated,
    ROUND(AVG((julianday(completed_at) - julianday(started_at)) * 24), 1) as avg_actual,
    ROUND(
        AVG((julianday(completed_at) - julianday(started_at)) * 24) /
        NULLIF(AVG(estimated_hours), 0),
    2) as blow_up_ratio
FROM tasks
WHERE started_at IS NOT NULL
  AND completed_at IS NOT NULL
  AND estimated_hours IS NOT NULL
  AND complexity IS NOT NULL
GROUP BY complexity;

-- Developer quality: reversions and testing posture by person
CREATE VIEW IF NOT EXISTS developer_quality AS
SELECT
    owner,
    COUNT(*) as total_tasks,
    SUM(reversions) as total_reversions,
    ROUND(1.0 * SUM(reversions) / COUNT(*), 2) as reversions_per_task,
    SUM(CASE WHEN testing_posture = 'A' THEN 1 ELSE 0 END) as a_grades,
    ROUND(100.0 * SUM(CASE WHEN testing_posture = 'A' THEN 1 ELSE 0 END) / COUNT(*), 1) as a_grade_pct
FROM tasks
WHERE owner IS NOT NULL
  AND status = 'green'
GROUP BY owner;

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_sprint ON tasks(sprint);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner);
CREATE INDEX IF NOT EXISTS idx_deps_depends_on ON task_dependencies(depends_on_sprint, depends_on_task);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Update timestamp on task modification
CREATE TRIGGER IF NOT EXISTS update_task_timestamp
AFTER UPDATE ON tasks
BEGIN
    UPDATE tasks SET updated_at = CURRENT_TIMESTAMP
    WHERE sprint = NEW.sprint AND task_num = NEW.task_num;
END;

-- Auto-set started_at when task leaves 'pending' status
-- This captures when work actually began on the task
CREATE TRIGGER IF NOT EXISTS set_started_at
AFTER UPDATE OF status ON tasks
WHEN OLD.status = 'pending' AND NEW.status != 'pending' AND OLD.started_at IS NULL
BEGIN
    UPDATE tasks SET started_at = CURRENT_TIMESTAMP
    WHERE sprint = NEW.sprint AND task_num = NEW.task_num;
END;

-- Auto-set completed_at when task reaches 'green' status
-- This captures when the task was successfully completed
CREATE TRIGGER IF NOT EXISTS set_completed_at
AFTER UPDATE OF status ON tasks
WHEN NEW.status = 'green' AND OLD.status != 'green'
BEGIN
    UPDATE tasks SET completed_at = CURRENT_TIMESTAMP
    WHERE sprint = NEW.sprint AND task_num = NEW.task_num;
END;

-- Track when a task's status goes backward (green→red, green→blocked)
CREATE TRIGGER IF NOT EXISTS track_reversion
AFTER UPDATE OF status ON tasks
WHEN (OLD.status = 'green' AND NEW.status IN ('red', 'blocked'))
  OR (OLD.status = 'red' AND NEW.status = 'blocked')
BEGIN
    UPDATE tasks SET reversions = COALESCE(reversions, 0) + 1
    WHERE sprint = NEW.sprint AND task_num = NEW.task_num;
END;
