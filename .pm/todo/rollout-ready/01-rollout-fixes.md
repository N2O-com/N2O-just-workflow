# Rollout Readiness Fixes

> Fix the bugs and doc gaps that will block Ella and Manda from using N2O on their projects.

| Field | Value |
|-------|-------|
| Status | Active |
| Owner | Wiley |
| Last Updated | 2026-03-03 |

---

## Current State

The N2O machinery (CLI, sync, data pipeline, 200+ tests) is production-quality. But a code audit found 6 issues that will cause real friction for first-time users:

- `n2o stats` reads the *framework repo's* DB, not the target project's (critical bug)
- `started_at` never set on task claim, breaking the Efficiency metric (critical bug)
- `.worktrees/` not in `.gitignore` template (accidental commit risk)
- `n2o check` only validates 3 of 6 skills, doesn't check hooks or rates.json
- Session hook tries to do too much in 5s timeout, auto-claims with no opt-out
- Onboarding docs are incomplete: `setup.md` is outdated, `n2o setup` not mentioned, no end-to-end walkthrough

---

## What Changes

### 1. Fix `n2o stats` path resolution

`cmd_stats()` at line 1824 uses `$N2O_DIR/.pm/tasks.db` — always the framework directory. Should detect the current project's `.pm/tasks.db` instead.

**Fix**: Add project path detection (check CWD for `.pm/tasks.db`, fall back to `$N2O_DIR`).

### 2. Fix `started_at` on task claim

`claim-task.sh` lines 189-198 set `owner` and `status='red'` but never set `started_at`. This breaks the Efficiency metric (`avg minutes per task`).

**Fix**: Add `started_at = datetime('now')` to the claim UPDATE.

### 3. Harden `n2o check` + gitignore

- `run_health_check()` only checks 3 skills (pm-agent, tdd-agent, bug-workflow). Add remaining 3.
- Add checks for: session hooks in settings.json, rates.json existence, `transcripts` + `workflow_events` tables.
- Add `.worktrees/` to the gitignore entries in `cmd_init()`.

### 4. Fix session hook reliability

- Move auto-sync + git pull to background (non-blocking) so they don't eat the 5s timeout.
- Add `claim_tasks: true` config option. When false, session hook shows context but doesn't auto-claim.
- Keep the critical path (developer identity + task context) fast and synchronous.

### 5. Update setup docs

- Rewrite `01-getting-started/setup.md` to reference `n2o init` instead of manual `mkdir + sqlite3` steps.
- Add `n2o setup` mention to `01-getting-started/team-quickstart.md` for auto-sync.

### 6. Write ONBOARDING.md

Single end-to-end guide: prerequisites -> clone framework -> `n2o setup` -> `n2o init <project>` -> `n2o check` -> open Claude Code -> first session -> `n2o stats`. Include common "what do I do when..." scenarios.

---

## Suggested Tasks

| # | Task | Done When | Can Parallel? |
|---|------|-----------|---------------|
| 1 | Fix `n2o stats` path resolution | `n2o stats` from a target project shows that project's data, not the framework's. Test updated. | Yes |
| 2 | Fix `started_at` on task claim | `claim-task.sh` UPDATE sets `started_at = datetime('now')`. Claim test verifies `started_at` is populated. | Yes |
| 3 | Harden `n2o check` + add `.worktrees/` to gitignore | `n2o check` validates all 6 skills, session hooks, rates.json, transcripts+workflow_events tables. Init adds `.worktrees/` to gitignore. | Yes |
| 4 | Fix session hook: background sync + claim opt-out | Auto-sync runs in background. `claim_tasks: false` in config skips auto-claim. Critical path completes well within 5s. | Yes |
| 5 | Update setup.md + team-quickstart.md | `setup.md` references `n2o init`, no manual steps. `team-quickstart.md` mentions `n2o setup`. | Yes |
| 6 | Write ONBOARDING.md | End-to-end walkthrough exists at `01-getting-started/ONBOARDING.md`. Covers full path from prerequisites to `n2o stats`. | After 1-5 |
