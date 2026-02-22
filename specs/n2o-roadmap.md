# N2O Framework Roadmap

## Overview

N2O is a workflow framework for AI-assisted software development. It provides a CLI (`n2o init` / `n2o sync`), SQLite-based task management, and 6 skills (pm-agent, tdd-agent, bug-workflow, detect-project, react-best-practices, web-design-guidelines) coordinated through a manifest-based file ownership model.

**Current version:** 1.0.0

| Goal | Existing Foundation | Maturity |
|------|-------------------|----------|
| 1. Seamless Updates | `n2o sync`, version pinning, selective sync, changelogs, schema migrations | **Done** |
| 2. Best Tooling Always | YAML trigger descriptions, CLAUDE.md auto-invocation instructions, config toggles | **Done** |
| 3. Frictionless Init | `n2o init --interactive`, detect-project skill | Partial |
| 4. Team Collaboration | SQLite schema with `owner`/`developers`, Linear sync design (change 008) | Design only |
| 5. Parallelization | Atomic task claiming, staging discipline in tdd-agent | Minimal |
| 6. Skill Quality | tdd-agent's 3-subagent audit system, CODIFY phase | Minimal |
| 7. Observability | `workflow_events` table, `n2o stats` CLI, velocity/estimation views, reversion triggers | **Done** |

---

## Dependency Map

```
                    ┌─────────────────┐
                    │ 3. Frictionless  │
                    │    Init          │
                    └────────┬────────┘
                             │ enables onboarding for
                             ▼
┌──────────────┐    ┌─────────────────┐    ┌──────────────────┐
│ 1. Seamless  │───▶│ 4. Team         │◀───│ 5. Parallel-     │
│    Updates   │    │    Collaboration │    │    ization       │
└──────┬───────┘    └─────────────────┘    └──────────────────┘
       │
       ▼
┌──────────────┐    ┌──────────────────┐
│ 6. Skill     │───▶│ 2. Best Tooling  │
│    Quality   │    │    Always        │
└──────┬───────┘    └──────────────────┘
       │
       ▼
┌──────────────┐
│ 7. Observ-   │
│    ability   │
└──────────────┘
```

| Goal | Depends On | Enables |
|------|-----------|---------|
| 1. Seamless Updates | — | 4, 6 |
| 2. Best Tooling | 6 | (end-user experience) |
| 3. Frictionless Init | 1 (partially) | 4 |
| 4. Team Collaboration | 1, 3, 5 | (multi-user usage) |
| 5. Parallelization | — | 4 |
| 6. Skill Quality | 7 | 2 |
| 7. Observability | — | 6 |

---

## Goal 1: Seamless Updates

Push framework updates to users without overriding their setup. Updates should be available but opt-in.

### Current State — COMPLETE

All Phase 1 items implemented:

- **Version pinning**: `n2o pin` / `n2o pin <version>` / `n2o pin --unpin`. Sync respects pin unless `--force`.
- **Selective sync**: `n2o sync --only=agents,patterns,schema,scripts` syncs specific categories.
- **Readable changelogs**: `n2o release` auto-generates changelog entries from git log. `show_changelog()` displays changes between versions during sync.
- **Schema migrations**: `n2o migrate status`, `n2o migrate run`, `n2o migrate generate` — automated ALTER TABLE ADD/DROP COLUMN, new table/view/index detection, numbered migration files.
- **Backups**: Timestamped backups in `.n2o-backup/` before every sync.
- **Manifest**: `n2o-manifest.json` separates framework vs project file ownership.

### Remaining (Future)

- **Update notifications**: Lightweight mechanism to notify registered projects when a new framework version is available.

---

## Goal 2: Best Tooling Always

Use the best tools and patterns automatically without having to think about it. Skills should fire based on context, not manual summoning.

### Current State — COMPLETE

All auto-invocation infrastructure implemented:

- **YAML trigger descriptions**: All 6 skills have rich `description` fields with explicit trigger phrases, contextual signals, and negative signals (what NOT to use the skill for).
- **CLAUDE.md auto-invocation instruction**: Agent instruction block in `templates/CLAUDE.md` tells Claude to auto-invoke skills based on user intent, prefer false positives, and treat pattern skills as ambient.
- **Pattern skills as ambient**: react-best-practices and web-design-guidelines described as "consult automatically when writing/reviewing relevant code" — passive linters, not explicit invocations.
- **Config toggles**: `auto_invoke_skills` (boolean) and `disabled_skills` (array) in `.pm/config.json` for suppression.
- **Multiple skills simultaneously**: CLAUDE.md instruction explicitly supports multiple skills firing at once.

### Remaining (Future)

- **Sensitivity tuning**: Monitor real-world auto-invocation accuracy and adjust trigger descriptions.
- **Skill quality prerequisite**: Skills must work reliably before aggressive auto-invocation (Goal 6).

---

## Goal 3: Frictionless Init

Make project initialization exceptionally easy. Ideally through simple CLI prompting. Must be fully E2E tested before shipping. Dashboard/HTML interface is a stretch goal.

### Current State

- `n2o init` exists with 8-step process: directory creation, file copying, project detection (Node/Rust/Python/Go), interactive prompting, database init, .gitignore setup, config helper generation.
- `--interactive` mode prompts for project name and commands; non-interactive mode auto-detects everything.
- `detect-project` skill fills in CLAUDE.md post-init.
- Re-init detection warns if `.pm/config.json` already exists.
- No E2E tests exist for the init flow.

### Desired State

- **Zero-thought init**: `n2o init .` detects everything, applies sensible defaults, and just works. No prompts needed for the common case.
- **Full E2E test coverage**: Test the entire init flow — directory creation, file scaffolding, database init, config generation — in a test harness with temp directories. Test across project types (Node, Python, Go, Rust). This must be done before shipping to new users.
- **Post-init validation**: After init, run a health check that verifies the scaffolded project is properly configured (schema loaded, config valid, skills accessible).
- **Dashboard/HTML interface** (stretch): A web-based setup wizard for teams less comfortable with CLI. Could generate the `n2o init` command or run it directly.
- **Edge case handling**: Existing .claude directory, partial init recovery, monorepo detection.

### Key Considerations

- E2E testing a bash CLI requires a test harness (create temp dirs, run init, validate output, clean up). Could use bats (Bash Automated Testing System) or a simple shell test suite.
- The dashboard is a significant scope expansion — separate spec, likely builds on `specs/workflow-dashboard.md`.
- Init must remain idempotent — running it twice shouldn't break anything.

### Priority / Effort

**Near-term** for CLI polish and E2E tests. **Future** for dashboard. Effort: Low-Medium (CLI), High (dashboard).

---

## Goal 4: Team Collaboration

Make it easy for multiple people to work on the same project simultaneously without interfering with each other. Future: task routing algorithm that assigns work intelligently.

### Current State

- SQLite is local per developer. `tasks.db` is gitignored — no merge conflicts on the database.
- `developers` table exists with skill ratings, strengths, growth areas.
- `available_tasks` view filters by `owner IS NULL` for atomic claiming.
- Change 008 fully designs a hybrid architecture: SQLite for agents (speed), Linear for humans (visibility), connected by a sync script.
- Schema has `external_id`, `external_url`, `last_synced_at` columns ready for external tool integration.
- `config.json` has `pm_tool` (null) and `team` (empty array) fields.
- `scripts/linear-sync.sh` exists as a starting point.

### Desired State

- **No interference**: Two developers working on the same project at the same time. Each has their own local tasks.db, claims tasks atomically, and works in feature branches. Conflicts resolved at git merge time, not during development.
- **Team visibility**: A shared view (Linear, or a simple dashboard) where everyone can see sprint progress, who's working on what, and what's blocked.
- **Linear sync** (or similar): Implement the hybrid architecture from change 008. PM agent creates/updates Linear issues via MCP. Sync script keeps SQLite and Linear in agreement.
- **Task routing algorithm** (future): Assign tasks based on developer skills (`developers` table), velocity (`developer_velocity` view), estimation accuracy (`estimation_accuracy` view), and current load. Predict task duration based on historical data.
- **Tool-agnostic sync layer**: While Linear is the first target, the sync architecture should accommodate Asana, Jira, or other tools later.

### Key Considerations

- The SQLite-local + Linear-remote hybrid is well-designed (change 008). Implementation is the bottleneck, not design.
- Linear API rate limits matter if we're syncing frequently. Batch operations where possible.
- Task routing needs historical data — depends on Goal 7 (Observability) generating enough data first. Minimum viable routing: assign by task type matching developer skills.
- The `team` array in config.json should be populated during init (Goal 3).

### Priority / Effort

**Medium-term** for Linear sync scripts. **Future** for task routing algorithm. Effort: High.

---

## Goal 5: Parallelization

Allow multiple tasks to execute in parallel, even in the same file. Queue or merge intelligently when conflicts arise. Enforce strong file structure to minimize conflicts.

### Current State

- Atomic task claiming via `available_tasks` view (filters unblocked, unowned tasks).
- tdd-agent enforces staging discipline: "NEVER use `git add .`", explicitly stage files.
- pm-agent documents parallel execution: "User opens new tab, invokes `/tdd-agent` there."
- Sprint-end squash consolidates commits per task.
- No file locking, conflict detection, or merge queuing exists.

### Desired State

- **File lock table**: A `file_locks` table in tasks.db mapping file paths to the agent/task currently modifying them. Agents check locks before editing, queue if locked.
- **Conflict detection**: Before committing, detect if another agent has modified the same files. Alert rather than silently overwrite.
- **Branch-per-task**: Each task works in its own branch. Merge to sprint branch when complete. Git handles most conflicts automatically.
- **Strong file structure**: Enforce small, focused files as a convention. A file size linter or skill rule that flags files over N lines that could be decomposed.
- **Intelligent merging** (future): When two agents modify the same file, attempt semantic merge (understanding code structure) rather than line-based merge. Fall back to queuing if merge fails.
- **Merge queue**: If two tasks touch the same file and can't be merged automatically, queue the second to run after the first commits.

### Key Considerations

- Branch-per-task is the simplest path to parallelization and leverages git's existing merge capabilities. Most conflicts resolve automatically.
- File locking adds complexity. Start with branch isolation; add locking only if branch-per-task proves insufficient.
- Small file architecture is a convention/culture issue more than a tooling issue. Can be reinforced through skills and pm-agent task decomposition.
- SQLite's file-level locking provides atomicity for task claiming but doesn't help with source code conflicts.

### Priority / Effort

**Medium-term** for branch-per-task and conflict detection. **Future** for intelligent merging. Effort: High.

---

## Goal 6: Skill Quality

Ensure all skills work well. Measure performance. A/B test different versions. Skills should auto-invoke (shared with Goal 2).

### Current State

- 6 skills: pm-agent (1041 lines), tdd-agent (1297 lines), bug-workflow (373 lines), detect-project (159 lines), react-best-practices, web-design-guidelines.
- tdd-agent already runs 3-subagent audits (Pattern Compliance, Gap Analysis, Testing Posture).
- CODIFY phase reports patterns for user review rather than auto-documenting.
- No skill versioning, no A/B testing, no performance metrics.

### Desired State

- **Skill-by-skill audit**: Go through each skill and define exactly what it should do, its success criteria, and its failure modes. Document expected behavior as a contract.
- **Performance metrics per skill**: Track speed of execution (time from invocation to completion), accuracy (did the task succeed on first attempt?), code quality (testing posture grade, reversion rate).
- **Skill versioning**: Maintain multiple versions of a skill. Tag versions, track which version was used for each task.
- **A/B testing**: Run two versions of a skill on different developers' machines. Compare outcomes across speed, accuracy, and code quality. Requires Goal 7 (Observability) as a prerequisite.
- **Auto-invocation** (shared with Goal 2): Skills fire based on context. The bar: if you have to think about which technology to use, the technology has failed.

### Key Considerations

- A/B testing requires an experimentation framework: version labels, assignment mechanism, outcome measurement. Start simple — manual version assignment, compare metrics after N tasks.
- Code quality measurement is hard. Proxies: testing posture grade (A-F), reversion count, pattern audit pass rate, time-to-green.
- Observability (Goal 7) is a prerequisite — you need measurement infrastructure before you can compare versions.
- The existing CODIFY phase is a lightweight quality feedback loop. Patterns discovered during implementation feed back into skills. This is valuable but manual.

### Priority / Effort

**Medium-term** for skill audits and metrics. **Future** for A/B testing framework. Effort: Medium-High.

---

## Goal 7: Observability

Track credit usage, Claude activity, skill invocations, conversation transcripts, and reversion frequency.

### Current State — COMPLETE (Phase 1)

Core observability infrastructure implemented:

- **`workflow_events` table**: Records skill invocations, phase transitions, task completions with timestamps, session IDs, and metadata (JSON). Replaces the originally planned `skill_invocations` table with a more general event-sourcing approach.
- **`n2o stats` CLI**: `n2o stats [--json]` command surfaces sprint progress, velocity, estimation accuracy, and developer quality metrics.
- **Analytics views**: `velocity_report`, `sprint_velocity`, `developer_velocity`, `estimation_accuracy`, `developer_quality`, `phase_durations`, `session_activity`.
- **Auto-tracking triggers**: `started_at`, `completed_at`, `reversions` (increment on backward status changes).
- **Per-task quality**: `testing_posture` grade, `pattern_audit_notes`, `commit_hash`.

### Remaining (Future)

- **Credit usage tracking**: Track Claude API token consumption per task/sprint/developer. Depends on what Claude Code exposes.
- **Conversation transcripts**: Full conversation logs for replay and debugging. Storage/retention policy needed.
- **Dashboard integration**: Web dashboard to surface observability data (see `specs/workflow-dashboard.md`).

### Priority / Effort

**Future** for credit tracking and transcripts. Phase 1 observability is complete. Effort: Medium.

---

## Implementation Phases

### Phase 1 — Foundation (COMPLETE)
- **Goal 1**: ~~Version pinning, selective sync, readable changelogs~~ ✅ + schema migrations
- **Goal 2**: ~~Skill auto-invocation, context-based routing~~ ✅ (moved from Phase 3)
- **Goal 7**: ~~`workflow_events` table, `n2o stats` CLI command~~ ✅

### Phase 2 — Polish & Multi-User Basics (Next)
- **Goal 3**: E2E test suite for `n2o init`, zero-thought defaults
- **Goal 4**: Linear sync scripts (implement change 008 design)
- **Goal 5**: Branch-per-task workflow, conflict detection
- **Goal 6**: Skill-by-skill audit, define success criteria per skill

### Phase 3 — Automation (Medium-term)
- **Goal 6**: Skill versioning, basic A/B comparison
- **Goal 7**: Credit tracking, conversation logging, reversion dashboard

### Phase 4 — Intelligence (Future)
- **Goal 4**: Task routing algorithm, duration prediction
- **Goal 5**: Intelligent merging, merge queue
- **Goal 3**: Dashboard/HTML init interface
- **Goal 6**: Full A/B testing framework

---

## Open Questions

1. Should `n2o sync` support per-skill opt-in (e.g., skip react-best-practices for Go projects)?
2. What's the right granularity for skill auto-invocation — too eager is annoying, too conservative defeats the purpose?
3. How many completed tasks are needed before the task routing algorithm provides useful recommendations?
4. Should conversation transcripts be stored locally or centrally? What's the retention policy?
5. Is Linear the right default PM tool, or should the sync layer be tool-agnostic from day one?
6. How do we E2E test the init flow across macOS and Linux?
7. What's the minimum viable A/B test — manual version assignment with metric comparison, or does it need automated assignment?
