# Weekly Plans + Check-ins

> Students submit weekly plans and Friday check-ins on a system-enforced cadence, using a versioned assignment system that supports evolving questions over time.

| Field | Value |
|-------|-------|
| Status | Draft |
| Owner | — |
| Last Updated | 2026-03-11 |
| Depends On | `01-portal-scaffold.md` |
| Enables | Home module (aggregates plan status), Scoring (goal hit rates) |

---

## Recent Changes

| Date | What changed | Section |
|------|-------------|---------|
| 2026-03-11 | Post-audit fix: target Supabase Postgres (not SQLite), lazy creation instead of cron | Schema, Design |
| 2026-03-11 | Adversarial review complete (12 decisions). Added 3 meta-principles, `effective_from` on template versions, `archived` on questions, audit trail on assignment edits, multiple blocks per day, hours warning | All |
| 2026-03-11 | Redesigned around unified assignment system with versioned question templates | All |
| 2026-03-11 | Resolved: ET default timezone (user-overridable), no grace period, system-created cadences | Open Questions |
| 2026-03-11 | Initial spec | All |

---

## Goal

Replace the manual Notion/doc-based Weekly Planning View (`reference/02-weekly-planning-view.md`) with a structured, enforceable system. Students submit plans on time, check in on Fridays, and all responses are tracked with versioned questions so forms can evolve without losing historical comparability.

## Success Criteria

- Student can create/edit weekly plan with calendar blocks (multiple per day) and goals (committed/stretch)
- Plan assignment locks on submission. If not submitted by deadline, status becomes `overdue`
- Friday check-in: versioned question form, editable until submitted or deadline passes
- Student sees assignment status: pending / draft / submitted / locked / overdue
- History view shows past assignments with responses, even across question version changes
- Lead can view any student's assignments (read-only after lock)
- Adding/changing/removing check-in questions is a data change, not a code change
- UI warns (but doesn't block) when plan block hours and goal estimates diverge

## Current State

- No assignment or plan tables exist in the database
- No GraphQL resolvers for plans or check-ins
- Weekly Planning View template exists as markdown: `reference/02-weekly-planning-view.md`
- Friday check-in has 3 questions: what shipped/slipped, one improvement, other notes
- 1:1 agenda has 3 questions + commitment statement (`reference/03-how-youre-scored.md`)

## Design

**This spec covers:**
- Assignment system: `cadences`, `cadence_template_versions`, `cadence_questions`, `assignments`, `assignment_responses`, `assignment_edit_log`
- Plan-specific structured tables: `plan_blocks`, `plan_goals`
- GraphQL resolvers: assignment queries, plan CRUD, submit/lock mutations
- Student plan page at `/portal/plan` (replaces stub)
- Cadence logic (auto-create assignments, lock/unlock timing)
- Seed data: v1 question templates for Weekly Plan and Friday Check-in

**Out of scope:**
- Lead 1:1 view (Phase 2)
- SMS plan submission (sms-companion spec)
- Red-flag detection for missed assignments (Phase 2)
- Biweekly self-score cadence (deferred — will use same assignment system later)

### Meta-Principles (from adversarial review)

1. **Prospective only**: All config changes (cadence settings, template versions, timezone preferences) only affect future assignments. Once an assignment is created, its `due_date`, `template_version_id`, and structure are frozen.
2. **Submission locks, deadline creates overdue**: Assignments are editable until the student submits. Submission locks it. If the deadline passes without submission, status becomes `overdue`. Edits before submission are tracked via `assignment_edit_log`.
3. **Soft-delete everything**: No hard deletes on config data. Questions get an `archived` flag. `ON DELETE RESTRICT` on config FKs. Historical data is sacred.

### Assignment System

The core abstraction: a **cadence** defines a recurring form with versioned questions. Assignments are **lazily created** when a student first accesses the current period (no cron needed). Each assignment has its own independent lifecycle.

```
cadence ("Weekly Plan", weekly, due Sun 23:59 ET)
  └─ template v1 → questions: (none — plan uses structured tables)

cadence ("Friday Check-in", weekly, due Fri 23:59 ET)
  └─ template v1 → questions: "What shipped/slipped?", "One improvement", "Other notes"

assignment (Alice, "Friday Check-in", week of Mar 10, due Fri 23:59)
  └─ assignment_responses (answer to each question)

assignment (Alice, "Weekly Plan", week of Mar 10, due Sun 23:59)
  ├─ plan_blocks (multiple blocks per day allowed)
  └─ plan_goals (committed/stretch goals)
```

Two assignments per student per week (plan + check-in). Each has independent status — plan can be locked while check-in is overdue.

### State Transitions

**Stored in DB**: `pending` → `draft` → `submitted`
**Computed on read**: `locked`, `overdue` (resolver checks `due_date < NOW()`)

```
DB states:     pending → draft → submitted
Computed:      pending/draft + past due → overdue (read-only)
               submitted + past due → locked (read-only)
```

- **pending**: Lazily created when student first accesses current period
- **draft**: Student started editing (first mutation transitions to draft)
- **submitted**: Student clicked Submit. Assignment is now locked to edits.
- **locked** (computed): Submitted + past deadline. Resolver returns this, not stored.
- **overdue** (computed): Not submitted + past deadline. Resolver returns this, not stored.

Submission is the locking event. No background cron needed.

### Cadence Logic

**No cron needed.** Assignments are lazily created and statuses are computed on read.

| Event | Trigger | Effect |
|-------|---------|--------|
| Student visits `/portal/plan` | Resolver checks for current-period assignments | If none exist, creates them with status `pending` and `due_date` based on cadence config + user timezone |
| Student starts editing | First mutation | Status: `draft` |
| Student clicks "Submit" | Mutation | Status: `submitted` (locked to edits) |
| Student or lead reads assignment after deadline | Resolver computes effective status | `submitted` + past due → returns `locked`; `pending`/`draft` + past due → returns `overdue` |

**Why lazy creation, not cron**: The platform has no background job infrastructure. Lazy creation is simpler, doesn't require a new dependency, and produces the same result — assignments appear when needed. Status transitions are computed, not stored, for `locked`/`overdue` (the DB column stays at `submitted`/`pending`/`draft`, the resolver returns the effective status).

*Default timezone is ET. User can override via a `timezone` preference on `developers` table. Timezone changes are prospective only — existing assignment due_dates are immutable. Full IANA timezone range supported.

### Database Target

**All schema changes target Supabase Postgres** (same as RBAC Foundation). The `developers` table with `email` and `access_role` lives in Postgres, and assignments FK to `developers(name)`, so they must be in the same database. The platform Apollo Server already queries Postgres for developer lookups.

### Plan Goals Outcome Editing

`plan_goals.outcome` (stretch/committed/missed) is editable anytime until the Friday Check-in assignment for the same period is submitted or its deadline passes. This allows students to update outcomes throughout the week as work progresses. Edits are tracked in `assignment_edit_log`.

### Student UI

- **Plan tab**: Editable blocks grouped by day. Multiple blocks per day allowed (e.g., "Morning: standup + PR review" and "Afternoon: feature work"). Total hours per day and per week shown. Warning if total plan hours diverge significantly from goal estimates.
- **Goals tab**: Editable list of goals with committed-by date, stretch-by date, outcome dropdown (stretch/committed/missed). Outcome editable until Friday check-in is submitted.
- **Check-in tab**: Renders questions from active template version. Editable until submitted or deadline passes.
- **History**: Dropdown to select past weeks. Read-only view with responses, even if questions changed between versions. No pagination limit for v1 (trivial dataset at ~10 students).

### V1 Seed Data

**Weekly Plan cadence**: weekly, due Sunday 23:59 ET. No template questions (uses structured plan_blocks + plan_goals tables).

**Friday Check-in cadence**: weekly, due Friday 23:59 ET. V1 questions:

| # | dimension_key | question_text | response_type |
|---|--------------|---------------|---------------|
| 1 | shipped_slipped | What shipped? What slipped and why? | text |
| 2 | improvement | What is one specific thing you'll change about how you work next week? | text |
| 3 | other_notes | Anything else we should know — blockers, schedule changes, things you need from us? | text |

## Schema

**Target: Supabase Postgres** (not SQLite). Migration file: `platform/migrations/002-assignment-system.sql`

```sql
-- =============================================================================
-- Migration: Assignment System + Weekly Plans
-- Target: Supabase Postgres
-- =============================================================================

-- === Assignment system (generic, reusable) ===

CREATE TABLE cadences (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  cadence_type TEXT NOT NULL CHECK (cadence_type IN ('weekly','biweekly','monthly')),
  due_day INTEGER,                 -- 0=Sun..6=Sat
  due_time TEXT DEFAULT '23:59',
  timezone_default TEXT DEFAULT 'America/New_York',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cadence_template_versions (
  id SERIAL PRIMARY KEY,
  cadence_id INTEGER NOT NULL REFERENCES cadences(id),
  version_name TEXT NOT NULL,
  effective_from DATE,             -- applies to assignments created on/after this date
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cadence_questions (
  id SERIAL PRIMARY KEY,
  template_version_id INTEGER NOT NULL REFERENCES cadence_template_versions(id),
  ordinal INTEGER NOT NULL,
  dimension_key TEXT NOT NULL,      -- stable across versions for cross-time comparison
  question_text TEXT NOT NULL,
  response_type TEXT NOT NULL DEFAULT 'text'
    CHECK (response_type IN ('text','scale','select')),
  required BOOLEAN DEFAULT true,
  archived BOOLEAN DEFAULT false,   -- soft-delete; never hard-delete questions with responses
  options JSONB                     -- for 'select' type
);

CREATE TABLE assignments (
  id SERIAL PRIMARY KEY,
  cadence_id INTEGER NOT NULL REFERENCES cadences(id),
  developer TEXT NOT NULL REFERENCES developers(name),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  due_date TIMESTAMPTZ NOT NULL,    -- immutable once set
  template_version_id INTEGER REFERENCES cadence_template_versions(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','draft','submitted')),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cadence_id, developer, period_start)
);

-- Note: status only stores 'pending', 'draft', 'submitted'.
-- 'locked' and 'overdue' are computed on read by the resolver:
--   submitted + past due_date → locked
--   pending/draft + past due_date → overdue

CREATE TABLE assignment_responses (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES cadence_questions(id) ON DELETE RESTRICT,
  response_text TEXT,
  UNIQUE(assignment_id, question_id)
);

CREATE TABLE assignment_edit_log (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id),
  field_changed TEXT NOT NULL,      -- e.g., 'plan_block', 'plan_goal.outcome', 'response'
  old_value TEXT,
  new_value TEXT,
  edited_by TEXT NOT NULL REFERENCES developers(name),
  edited_at TIMESTAMPTZ DEFAULT NOW()
);

-- === Plan-specific structured data (hangs off assignments) ===

CREATE TABLE plan_blocks (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  display_order INTEGER NOT NULL DEFAULT 0,  -- for ordering multiple blocks per day
  block_description TEXT,
  hours REAL NOT NULL DEFAULT 0
);

CREATE TABLE plan_goals (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  description TEXT NOT NULL,
  committed_by DATE,
  stretch_by DATE,
  outcome TEXT CHECK (outcome IN ('stretch','committed','missed'))
);

-- === Seed data ===

INSERT INTO cadences (name, description, cadence_type, due_day, due_time) VALUES
('Weekly Plan', 'Calendar blocks and goals for the week', 'weekly', 0, '23:59'),
('Friday Check-in', 'End-of-week reflection on what shipped and what to improve', 'weekly', 5, '23:59');

INSERT INTO cadence_template_versions (cadence_id, version_name, effective_from) VALUES
(1, 'v1 (March 2026)', '2026-03-01'),
(2, 'v1 (March 2026)', '2026-03-01');

-- Friday Check-in v1 questions
INSERT INTO cadence_questions (template_version_id, ordinal, dimension_key, question_text, response_type) VALUES
(2, 1, 'shipped_slipped', 'What shipped? What slipped and why?', 'text'),
(2, 2, 'improvement', 'What is one specific thing you''ll change about how you work next week to be more effective?', 'text'),
(2, 3, 'other_notes', 'Anything else we should know — blockers coming up, schedule changes, things you need from us, ideas, feedback?', 'text');
```

## Implementation Plan

| # | Task | Done When |
|---|------|-----------|
| 1 | Run Postgres migration (assignment system + plan tables + seed data), add GraphQL resolvers with lazy creation and computed status | Migration runs against Supabase Postgres. Resolvers for `myAssignments`, `createPlanBlock`, `updatePlanGoal`, `submitAssignment`, `respondToQuestion` work. Lazy creation: querying current-period assignments creates them if missing. Computed status: resolver returns `locked`/`overdue` based on `due_date < NOW()`. Edit log captures mutations. Test: query creates assignment, add blocks/goals, submit (locks), verify submitted assignment rejects edits, verify past-due unsubmitted returns `overdue`. |
| 2 | Build student plan page with plan/goals/check-in tabs and history | Page renders at `/portal/plan`. Student sees pending assignments, can add multiple blocks per day, set goals, submit plan. Hours warning shows when block totals diverge from goals. Friday check-in renders questions from template. History shows past weeks. Manual verification: full lifecycle (pending → draft → submit → locked; unsubmitted → overdue). |

## Open Questions

1. ~~**Lock timezone**: EOD Sunday in what timezone?~~ **Resolved**: Default ET, user-overridable via timezone preference on developers table. Full IANA range supported.
2. ~~**Grace period**: What if a student submits Monday 8am?~~ **Resolved**: No grace period for v1. Overdue is overdue.
3. **Goal count**: Minimum/maximum goals per week? Template shows 4 rows.
4. ~~**Config changes mid-period?**~~ **Resolved**: Prospective only. Cadence settings, template versions, and timezone changes only affect future assignments. Existing assignments are immutable.
5. ~~**Template version activation timing?**~~ **Resolved**: New versions apply to next period via `effective_from` date. Mid-period activation does not affect current assignments.
6. ~~**Multiple blocks per day?**~~ **Resolved**: Yes. Students may have split schedules. `display_order` column for UI sorting.
7. ~~**Hours validation?**~~ **Resolved**: Warning in UI when plan block hours and goal estimates diverge. No hard enforcement.
8. ~~**Question deletion?**~~ **Resolved**: Soft-delete via `archived` flag. `ON DELETE RESTRICT` on FK. Never hard-delete questions that have responses.
9. ~~**Draft vs overdue state transition?**~~ **Resolved**: `overdue` = deadline passed without submission. `locked` = submitted + deadline passed. Independent statuses per assignment.
10. ~~**Goal outcome editing window?**~~ **Resolved**: Editable anytime until Friday check-in is submitted or deadline passes. Edits tracked in `assignment_edit_log`.
11. ~~**Timezone changes mid-week?**~~ **Resolved**: Prospective only. `due_date` is immutable once assignment is created.
12. ~~**History pagination?**~~ **Resolved**: No limit for v1. Trivial dataset at ~10 students.
13. ~~**Database target?**~~ **Resolved**: Supabase Postgres (same as RBAC Foundation). Assignments FK to `developers(name)` which lives in Postgres.
14. ~~**Assignment creation trigger?**~~ **Resolved**: Lazy creation. Resolver creates assignments on first access for current period. No cron dependency.
15. ~~**Status transition mechanism?**~~ **Resolved**: `locked`/`overdue` computed on read by resolver (`due_date < NOW()`). Only `pending`/`draft`/`submitted` stored in DB. No background job needed.

## References

- Vision spec: `.pm/backlog/student-portal/student-portal-spec.md` (Section 4.3)
- Weekly Planning View template: `.pm/backlog/student-portal/reference/02-weekly-planning-view.md`
- 1:1 agenda + self-score questions: `.pm/backlog/student-portal/reference/03-how-youre-scored.md`
