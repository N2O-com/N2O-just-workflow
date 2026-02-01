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

    -- Git tracking (set by commit-task.sh script)
    commit_hash TEXT,                   -- Git commit hash after task completion

    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (sprint, task_num),

    -- Data integrity constraints
    CHECK (status IN ('pending', 'red', 'green', 'blocked')),
    CHECK (type IS NULL OR type IN ('database', 'actions', 'frontend', 'infra', 'agent', 'e2e', 'docs')),
    CHECK (testing_posture IS NULL OR testing_posture IN ('A', 'B', 'C', 'D', 'F'))
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

-- Available tasks: Pending tasks with no unfinished dependencies
CREATE VIEW IF NOT EXISTS available_tasks AS
SELECT t.*
FROM tasks t
WHERE t.status = 'pending'
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
