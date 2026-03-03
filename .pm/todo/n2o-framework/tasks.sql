-- N2O Framework Backlog
-- Load with: sqlite3 .pm/tasks.db < .pm/todo/n2o-framework/tasks.sql
--
-- Sprints:
--   observability      — JSONL parsing, workflow events, analytics (horizon: active)
--   framework-polish   — n2o CLI improvements (horizon: active)
--   team-collab        — multi-user features (horizon: next)
--   skill-quality      — skill audits and versioning (horizon: next)
--   icebox             — way-later ideas (horizon: icebox)
--   framework-v1       — already completed work (status: green)

-- =============================================================================
-- COMPLETED WORK (framework-v1)
-- =============================================================================

INSERT INTO tasks (sprint, task_num, title, type, status, horizon, description, done_when) VALUES
('framework-v1', 1, 'E2E test suite for n2o init', 'e2e', 'green', 'active',
  '13 tests covering basic init, Node/Rust/Python/Go detection, idempotency, DB integrity, template filling, gitignore dedup, package managers, script executability.',
  'All 13 tests pass: bash tests/test-n2o-init.sh');

INSERT INTO tasks (sprint, task_num, title, type, status, horizon, description, done_when) VALUES
('framework-v1', 2, 'Write observability spec', 'docs', 'green', 'active',
  'Spec covering JSONL transcript parsing, workflow_events schema, transcript collection, phase timing, analysis views. Includes "Future: Hooks" section.',
  'specs/done/observability.md exists with ranked goals and implementation order');

INSERT INTO tasks (sprint, task_num, title, type, status, horizon, description, done_when) VALUES
('framework-v1', 3, 'Write N2O roadmap spec', 'docs', 'green', 'active',
  'Comprehensive roadmap with 7 goals, dependency map, implementation phases, current maturity assessment.',
  'specs/active/n2o-roadmap.md exists with all 7 goals documented');

INSERT INTO tasks (sprint, task_num, title, type, status, horizon, description, done_when) VALUES
('framework-v1', 4, 'Add priority/horizon fields to tasks schema', 'database', 'green', 'active',
  'Added priority (REAL), priority_reason, assignment_reason, horizon, session_id columns. Updated available_tasks view to filter by horizon and order by priority.',
  'Schema loads without errors, available_tasks filters by horizon=active');

INSERT INTO tasks (sprint, task_num, title, type, status, horizon, description, done_when) VALUES
('framework-v1', 5, 'Seed tasks DB with framework backlog', 'docs', 'green', 'active',
  'Created .pm/todo/n2o-framework/tasks.sql with all framework work tracked across sprints with priorities, horizons, and dependencies.',
  'Tasks load into DB, available_tasks shows correct ordering');

-- =============================================================================
-- OBSERVABILITY SPRINT (active)
-- =============================================================================

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('observability', 1, 'Add observability schema (workflow_events + transcripts tables)', 'database', 'active', 1.0,
  'Schema is the foundation — everything else depends on these tables existing',
  'Add workflow_events table (session_id, event_type, tool_name, tool_use_id, skill_name, phase, agent_id, agent_type, metadata) and transcripts table (session_id, file_path, message_count, token counts, timestamps) to .pm/schema.sql. Include indexes on session_id, event_type, and task FK.',
  'Tables exist in schema.sql, DB rebuilds without errors');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('observability', 2, 'Write JSONL transcript parser script', 'agent', 'active', 2.0,
  'Core deliverable — turns raw transcripts into queryable data',
  'Create scripts/collect-transcripts.sh. Reads project path from .pm/config.json, finds JSONL files in ~/.claude/projects/{encoded-path}/, extracts session metadata + tool calls + subagent spawns + token usage, inserts into workflow_events and transcripts tables. Must be idempotent (skip already-indexed sessions). Handle both main session and subagent transcripts.',
  'Script parses at least one real JSONL session and populates both tables correctly');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('observability', 3, 'Add analysis views to schema', 'database', 'active', 3.0,
  'Views depend on the tables from task 1',
  'Add 5 views to schema.sql: developer_learning_rate (blow-up ratio over time), common_audit_findings (fake tests, violations by dev), reversion_hotspots (by type/complexity), skill_usage (invocation frequency from workflow_events), phase_timing (time per TDD phase from phase_entered events).',
  'All 5 views exist in schema.sql and query without errors');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('observability', 4, 'Add n2o stats CLI command', 'agent', 'active', 4.0,
  'Data without a consumer is dead — this makes insights visible',
  'Add "stats" subcommand to the n2o CLI script. Queries workflow_events and transcripts tables. Prints: sessions today, tool calls by type, subagent invocations, token usage summary, phase timing distribution, recent reversions. Formatted for terminal with colors.',
  'n2o stats prints formatted output from real data');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('observability', 5, 'Add phase-transition markers to tdd-agent SKILL.md', 'agent', 'active', 5.0,
  'Hooks cant infer TDD phases — need explicit markers in SKILL.md',
  'Add ~8 single-line sqlite3 INSERT commands to tdd-agent SKILL.md, one at each phase transition (RED, GREEN, REFACTOR, AUDIT, FIX_AUDIT, CODIFY, COMMIT, REPORT). Goes after existing status UPDATE statements. Also add decision summary INSERT at REPORT phase with fix_audit_iterations, patterns_found, user_interventions.',
  'Each TDD phase has a corresponding INSERT, visible in SKILL.md');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('observability', 6, 'Add phase logging to pm-agent and bug-workflow', 'agent', 'active', 6.0,
  'Same pattern as tdd-agent but for other skills',
  'Add phase-transition INSERT markers to pm-agent SKILL.md (SPEC, BREAKDOWN, PRIORITIZE, ASSIGN) and bug-workflow SKILL.md (REPRODUCE, INVESTIGATE, SCOPE, HYPOTHESIS, TASK). Follow same pattern as tdd-agent markers.',
  'Both skills have phase markers that INSERT into workflow_events');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('observability', 7, 'Write skill linter script', 'agent', 'active', 7.0,
  'Ensures skill updates dont accidentally remove logging markers',
  'Create scripts/lint-skills.sh. Reads a requirements manifest, greps each SKILL.md for required patterns (phase markers, status UPDATEs). Reports missing patterns. Integrate with n2o sync so skill updates are validated.',
  'Linter catches intentionally removed phase markers');

-- =============================================================================
-- FRAMEWORK POLISH SPRINT (active)
-- =============================================================================

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('framework-polish', 1, 'Version pinning for n2o sync', 'agent', 'active', 1.0,
  'Foundation for safe updates — projects must be able to pin versions',
  'Add n2o_version_pinned field to config.json. n2o sync checks the pin and refuses to sync if framework version is newer than pinned version unless --force is passed. Add --upgrade flag to bump the pin.',
  'Project with pinned version rejects newer sync without --force');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('framework-polish', 2, 'Selective sync (n2o sync --only=agents)', 'agent', 'active', 2.0,
  'Reduces risk of sync — update only what you want',
  'Add --only flag to n2o sync. Options: agents, patterns, schema, scripts. Only sync files matching the selected category. Multiple values allowed (--only=agents,schema).',
  'n2o sync --only=agents updates only 02-agents/ files');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('framework-polish', 3, 'Readable changelogs for n2o sync --dry-run', 'agent', 'active', 3.0,
  'Users need to understand what changed before accepting a sync',
  'Enhance n2o sync --dry-run output to show human-readable summary: which files changed, what was added/removed (not just file names). Show version being synced from/to.',
  'Dry-run output shows meaningful change descriptions');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('framework-polish', 4, 'Post-init validation health check', 'agent', 'active', 4.0,
  'Catches broken init state before user starts working',
  'After n2o init completes, run a validation pass: verify schema loaded (tables exist), config.json is valid JSON with required fields, skills are accessible (.claude/skills/ populated), .gitignore has required entries. Report pass/fail for each check.',
  'n2o init prints health check results, catches intentionally broken init');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('framework-polish', 5, 'Update notifications for registered projects', 'agent', 'active', 5.0,
  'Depends on version pinning — users need to know updates exist',
  'When a registered project has a pinned version older than the current framework version, n2o sync --all (or a new n2o check command) reports which projects have updates available.',
  'Command lists projects with available updates');

-- =============================================================================
-- TEAM COLLABORATION SPRINT (next)
-- =============================================================================

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('team-collab', 1, 'Implement Linear sync scripts', 'agent', 'next', 1.0,
  'Core multiplayer feature — change 008 is fully designed, just needs implementation',
  'Implement the hybrid SQLite + Linear architecture from change 008. PM agent creates/updates Linear issues via API. Sync script keeps SQLite and Linear in agreement. Batch operations to respect rate limits.',
  'Tasks created in SQLite appear in Linear, status changes sync both directions');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('team-collab', 2, 'Branch-per-task workflow', 'agent', 'next', 2.0,
  'Simplest path to parallel development — leverage git',
  'When tdd-agent claims a task, create a feature branch (task/{sprint}-{num}). Work happens on branch. Merge to sprint branch when task reaches green. Git handles most conflicts automatically.',
  'tdd-agent creates and works on task branches, merges on completion');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('team-collab', 3, 'Conflict detection before commit', 'agent', 'next', 3.0,
  'Safety net for parallel work — detect before overwriting',
  'Before committing, check if another agent/branch has modified the same files since the task started. Alert the user rather than silently overwriting. Can use git merge-base to detect divergent changes.',
  'Agent warns when committing files modified by another task');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('team-collab', 4, 'Populate team array during n2o init', 'agent', 'next', 4.0,
  'Team config needed for task routing and Linear sync',
  'During n2o init --interactive, prompt for team members. Store in config.json team array. Also populate developers table with names and roles.',
  'Team members appear in config.json and developers table after init');

-- =============================================================================
-- SKILL QUALITY SPRINT (next)
-- =============================================================================

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('skill-quality', 1, 'Skill-by-skill audit: define success criteria per skill', 'docs', 'next', 1.0,
  'Cant measure quality without defining what good looks like',
  'For each of the 6 skills (pm-agent, tdd-agent, bug-workflow, detect-project, react-best-practices, web-design-guidelines), document: what it should do, its success criteria, expected failure modes, and quality metrics. Create a skill contract document.',
  'Each skill has documented success criteria and failure modes');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('skill-quality', 2, 'Skill versioning (tag versions, track which used)', 'agent', 'next', 2.0,
  'Needed for A/B testing — must know which version produced which outcome',
  'Add version field to SKILL.md YAML frontmatter. Record skill_version in workflow_events when skill is invoked. n2o sync tracks which version each project is running.',
  'Skill invocations in workflow_events include skill_version');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority, priority_reason, description, done_when) VALUES
('skill-quality', 3, 'Basic A/B comparison (manual assignment, compare metrics)', 'agent', 'next', 3.0,
  'First step toward data-driven skill improvement',
  'Assign different skill versions to different projects/developers manually. After N tasks, compare metrics: task completion time, testing posture grade, reversion rate, audit pass rate. Generate comparison report.',
  'Can compare two skill versions on speed, quality, and accuracy');

-- =============================================================================
-- ICEBOX (way later)
-- =============================================================================

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority_reason, description, done_when) VALUES
('icebox', 1, 'Dashboard/HTML init interface', 'frontend', 'icebox',
  'Requires web stack, high effort, low ROI until team > 5',
  'Web-based setup wizard for teams less comfortable with CLI. Could generate the n2o init command or run it directly. See specs/active/workflow-dashboard.md for design.',
  'Browser-based init flow creates a working N2O project');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority_reason, description, done_when) VALUES
('icebox', 2, 'Task routing algorithm', 'agent', 'icebox',
  'Needs historical data from observability first — minimum viable data doesnt exist yet',
  'Assign tasks based on developer skills (developers table), velocity (developer_velocity view), estimation accuracy, and current load. Predict task duration from historical data.',
  'PM agent assigns tasks to developers matching skill requirements');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority_reason, description, done_when) VALUES
('icebox', 3, 'Intelligent merging / merge queue', 'agent', 'icebox',
  'Branch-per-task solves 90% of the problem — only needed for remaining 10%',
  'When two agents modify the same file and cant merge automatically, queue the second to run after the first commits. Attempt semantic merge understanding code structure rather than line-based.',
  'Two agents working on overlapping files resolve automatically');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority_reason, description, done_when) VALUES
('icebox', 4, 'Full A/B testing framework for skills', 'agent', 'icebox',
  'Manual A/B comparison covers MVP — automated framework is premature',
  'Automated experimentation framework: version labels, random assignment mechanism, outcome measurement, statistical significance testing. Beyond manual version assignment.',
  'Skill versions are randomly assigned and outcomes compared automatically');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority_reason, description, done_when) VALUES
('icebox', 5, 'Skill auto-invocation / context-based routing', 'agent', 'icebox',
  'Depends on skill quality audit first — dont auto-invoke broken skills',
  'When a user says "I found a bug", bug-workflow activates without needing /bug-workflow. Skill router in CLAUDE.md maps user intent to the right skill based on trigger descriptions.',
  'Skills fire based on context without explicit slash commands');

INSERT INTO tasks (sprint, task_num, title, type, horizon, priority_reason, description, done_when) VALUES
('icebox', 6, 'Schema migrations automation', 'agent', 'icebox',
  'CREATE IF NOT EXISTS works for now — only needed when we restructure tables',
  'Automated, non-destructive migrations (ALTER TABLE additions) rather than relying solely on CREATE TABLE IF NOT EXISTS. Migration scripts with version tracking.',
  'Schema changes applied incrementally without losing data');

-- =============================================================================
-- DEPENDENCIES
-- =============================================================================

-- Observability sprint
-- Task 2 (JSONL parser) depends on Task 1 (schema)
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('observability', 2, 'observability', 1);

-- Task 3 (analysis views) depends on Task 1 (schema)
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('observability', 3, 'observability', 1);

-- Task 4 (n2o stats) depends on Task 2 (parser) and Task 3 (views)
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('observability', 4, 'observability', 2);
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('observability', 4, 'observability', 3);

-- Task 5 (tdd-agent phase markers) depends on Task 1 (schema)
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('observability', 5, 'observability', 1);

-- Task 6 (pm-agent/bug phase markers) depends on Task 5 (tdd-agent markers — establish pattern first)
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('observability', 6, 'observability', 5);

-- Task 7 (skill linter) depends on Task 5 (needs markers to exist to validate)
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('observability', 7, 'observability', 5);

-- Framework polish sprint
-- Task 5 (update notifications) depends on Task 1 (version pinning)
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('framework-polish', 5, 'framework-polish', 1);

-- Team collab sprint
-- Task 3 (conflict detection) depends on Task 2 (branch-per-task)
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('team-collab', 3, 'team-collab', 2);

-- Skill quality sprint
-- Task 3 (A/B comparison) depends on Task 1 (audit) and Task 2 (versioning)
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('skill-quality', 3, 'skill-quality', 1);
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('skill-quality', 3, 'skill-quality', 2);

-- =============================================================================
-- VERIFY
-- =============================================================================
-- After loading, check:
--
-- Active available tasks (what to work on now):
--   sqlite3 .pm/tasks.db "SELECT sprint, task_num, title, priority FROM available_tasks ORDER BY sprint, priority;"
--
-- All tasks by horizon:
--   sqlite3 -header -column .pm/tasks.db "SELECT horizon, COUNT(*) as tasks FROM tasks GROUP BY horizon;"
--
-- Sprint progress:
--   sqlite3 -header -column .pm/tasks.db "SELECT * FROM sprint_progress;"
--
-- Dependencies:
--   sqlite3 -header -column .pm/tasks.db "SELECT * FROM task_dependencies;"
