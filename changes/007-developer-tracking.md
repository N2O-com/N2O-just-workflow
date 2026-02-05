# 006: Developer Profiles and Performance Tracking

## Vision

Track individual developers across sprints — their skills, speed, estimation accuracy, and decision quality. Build a data foundation that eventually enables:

- **Developer "baseball cards"** — snapshot of each person's strengths, skill levels, and areas for growth
- **Estimation calibration** — understand how long tasks actually take vs. how long we thought, per person and per task type
- **Blow-up prediction** — identify which tasks are likely to take longer than estimated based on complexity factors (integration depth, API stability, novelty)
- **Decision quality** — track reversions, unwound decisions, and agent utilization as proxies for developer effectiveness

This is a long-term investment. The full vision (scoping agent, probability distributions, Hofstadter index) requires historical data to calibrate. The 80/20 starting point is capturing the raw data now so the analysis becomes possible later.

---

## What Already Exists

The schema already has building blocks:

| Existing | What it gives us |
|----------|-----------------|
| `owner TEXT` on tasks | Developer assignment (currently unused) |
| `started_at` / `completed_at` triggers | Actual duration per task (automatic) |
| `velocity_report` view | Hours per task |
| `sprint_velocity` view | Average hours per sprint |
| `type` column | Task category (database, frontend, actions, etc.) |
| `testing_posture` grade | Quality signal per task |

What's missing: developer profiles, estimation fields, complexity classification, reversion tracking, and any per-person aggregation.

---

## 80/20 Starting Point

Three schema additions that are low-effort and start generating useful data immediately.

### 1. Add a `developers` table

```sql
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
```

This is the "baseball card." Skill ratings are simple 1-5 integers that a manager updates periodically. Not auto-calculated — human judgment, informed by the data below.

### 2. Add estimation and complexity columns to tasks

```sql
ALTER TABLE tasks ADD COLUMN estimated_hours REAL;       -- PM's estimate at planning time
ALTER TABLE tasks ADD COLUMN complexity TEXT;             -- low, medium, high, unknown
ALTER TABLE tasks ADD COLUMN complexity_notes TEXT;       -- Why (e.g., 'unstable API', 'heavy integration')
ALTER TABLE tasks ADD COLUMN reversions INTEGER DEFAULT 0; -- Times status went backward (green→red, green→blocked)
```

- `estimated_hours` — set by PM during task breakdown. Compared against actual hours (already tracked by triggers) to measure estimation accuracy.
- `complexity` — simple classification. "High" means broader probability distribution on completion time.
- `complexity_notes` — captures *why* something is complex. Over time, patterns emerge (e.g., "every task touching Nylas API takes 3x estimate").
- `reversions` — incremented by a trigger whenever status goes backward. A proxy for decision quality and task stability.

### 3. Add per-developer performance views

```sql
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
```

### 4. Add reversion trigger

```sql
-- Track when a task's status goes backward (green→red, green→blocked)
CREATE TRIGGER IF NOT EXISTS track_reversion
AFTER UPDATE OF status ON tasks
WHEN (OLD.status = 'green' AND NEW.status IN ('red', 'blocked'))
  OR (OLD.status = 'red' AND NEW.status = 'blocked')
BEGIN
    UPDATE tasks SET reversions = COALESCE(reversions, 0) + 1
    WHERE sprint = NEW.sprint AND task_num = NEW.task_num;
END;
```

---

## What This Gives You Immediately

With just the 80/20 above, after a few sprints you can query:

```sql
-- "Who's fastest at frontend tasks?"
SELECT owner, avg_hours FROM developer_velocity
JOIN tasks USING(owner) WHERE type = 'frontend';

-- "Are we consistently underestimating database tasks?"
SELECT * FROM estimation_accuracy_by_type WHERE type = 'database';

-- "Which developer has the most reversions?"
SELECT * FROM developer_quality ORDER BY reversions_per_task DESC;

-- "What's Luke's blow-up ratio?"
SELECT * FROM estimation_accuracy WHERE owner = 'luke';

-- "Do high-complexity tasks blow up more than low?"
SELECT * FROM estimation_accuracy_by_complexity;
```

---

## Full Vision (Future Work)

These are ideas that become possible once enough historical data exists. They require more tooling but the 80/20 schema above captures the raw data they'd need.

### Scoping Agent

A PM-agent extension that, when breaking down tasks, queries historical data to suggest estimates:

```
"Tasks of type 'actions' with complexity 'high' have historically taken
4.2 hours (estimated: 2.0, blow-up ratio: 2.1x). Similar tasks by this
developer average 3.8 hours. Suggested estimate: 4 hours."
```

Requires: 20+ completed tasks with estimates to have meaningful averages.

### Hofstadter's Law Index

Per-task-type or per-complexity blow-up distributions. Not just the average blow-up ratio, but the variance — a task type where actuals range from 0.5x to 5x the estimate has a wider distribution than one that's consistently 1.2x. High variance = high Hofstadter risk.

The `blow_up_ratio` in the views above is the starting point. With enough data points, you could compute standard deviation and identify which categories have fat tails.

Factors that widen the distribution (captured in `complexity_notes`):
- **Integration with unstable APIs** — new companies, frequent breaking changes, poor documentation
- **Integration with stable APIs** — large companies, versioned APIs, good docs → narrower distribution
- **Novel technology** — first time using a library/framework → wider
- **Repeated patterns** — "another CRUD endpoint" → narrower
- **Cross-service coordination** — multiple services involved → wider
- **Pure logic** — isolated function, no external dependencies → narrowest

### Developer Baseball Cards (Rendered)

A view or report that compiles all per-developer data into a snapshot:

```
┌─────────────────────────────────────────────────┐
│  LUKE                                           │
│  Role: Fullstack | Sprints: 12                  │
├─────────────────────────────────────────────────┤
│  Skills          │ Performance                  │
│  React:     ████░│ Avg hours/task: 2.3          │
│  Node:      ███░░│ Blow-up ratio:  1.4x         │
│  Database:  ██░░░│ A-grade rate:   89%           │
│  Infra:     █░░░░│ Reversions/task: 0.1          │
│  Testing:   ████░│ Tasks completed: 47           │
│  Debugging: ███░░│                               │
├─────────────────────────────────────────────────┤
│  Strengths: Strong systems thinker, fast at     │
│  React components, good test instincts          │
│  Growth: Database schema design, infra tasks    │
│  take 2x longer than team average               │
├─────────────────────────────────────────────────┤
│  Best at: frontend (1.8 hrs avg)                │
│  Worst at: database (4.1 hrs avg, 2.3x blowup) │
└─────────────────────────────────────────────────┘
```

### Decision Quality Metrics (Future Columns)

Additional columns that could be added later as tracking matures:

| Metric | What it measures | How to capture |
|--------|-----------------|----------------|
| `decisions_unwound` | Times a completed approach was reversed | Manual increment or git revert detection |
| `avg_active_agents` | Parallel agent utilization | Would require agent session logging |
| `first_attempt_pass_rate` | % of tasks that reach green without going through blocked | Derivable from existing status history |
| `audit_iteration_count` | How many FIX AUDIT loops before reaching A | Add column, tdd-agent records it |

---

## Files Affected

| File | Change |
|------|--------|
| `.pm/schema.sql` | Add `developers` table, new columns on `tasks`, new views, new trigger |
| `skills/pm-agent/SKILL.md` | Add instructions to set `estimated_hours` and `complexity` during task breakdown |
| `skills/tdd-agent/SKILL.md` | Add instructions to set `owner` when claiming tasks (ties into change 001) |

## Done When

- [ ] `developers` table exists in schema with skill rating columns and strengths/growth_areas fields
- [ ] `tasks` table has new columns: `estimated_hours`, `complexity`, `complexity_notes`, `reversions`
- [ ] Views exist: `developer_velocity`, `estimation_accuracy`, `estimation_accuracy_by_type`, `estimation_accuracy_by_complexity`, `developer_quality`
- [ ] `track_reversion` trigger fires when status goes backward (green→red, green→blocked)
- [ ] `pm-agent/SKILL.md` includes instructions to set `estimated_hours` and `complexity` during task breakdown
- [ ] Verify: Complete a task with an estimate, query `estimation_accuracy`, confirm blow_up_ratio calculates correctly
- [ ] Verify: Set status to green, then to red, confirm `reversions` increments

## Notes

- The `developers` table skill ratings (1-5) are manager-written, not auto-calculated. Auto-calculation from task data is tempting but would reward speed over quality and gaming over growth. Human judgment, *informed by* the data, is better.
- `estimated_hours` should be set at planning time by PM, before work starts. Changing estimates after seeing actuals defeats the purpose.
- The `complexity` field is intentionally simple (low/medium/high/unknown). Finer granularity isn't useful until there's enough data to distinguish categories.
- The reversion trigger only catches status regressions within the database. It won't catch git reverts or code rewrites that happen outside the task status workflow.
- All of the 80/20 additions are backward-compatible. Tasks without estimates or owners simply don't appear in the new views. Existing workflows continue working unchanged.
- The foreign key from `tasks.owner` to `developers.name` is intentionally omitted — it would break existing tasks that have NULL owners and add friction to the claiming workflow. The join is implicit.
