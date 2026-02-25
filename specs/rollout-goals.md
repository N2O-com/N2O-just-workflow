# Rollout Goals
> Four goals that drive N2O adoption: available, improveable, data-complete, accelerating.

| Field | Value |
|-------|-------|
| Status | Active |
| Owner | Wiley |
| Last Updated | 2026-02-25 |
| Sprint | rollout |

---

## Recent Changes

| Date | Change |
|------|--------|
| 2026-02-25 | Updated all gaps to reflect implementation status; added "What We Built" and "Verification" per goal |
| 2026-02-25 | Closed remaining gaps: SessionEnd hook for transcript collection, concurrent sessions persisted to DB, 15 e2e tests |
| 2026-02-25 | Added e2e smoke test (13 tests) + meta-test audit (9 checks) covering the full user journey |

---

## Goals

### 1. Available to Team
Zero learning curve — everything automatic. A new team member runs one command and starts working.

**Success criteria:** `n2o init` + open Claude Code = fully operational. No manual config, no missing deps, no silent failures.

**What we built:**

| Gap | Fix | Where | Status |
|-----|-----|-------|--------|
| No `developer_name` in config | `n2o init` populates from `git config user.name`; session hook falls back to git if missing | `n2o:816-839`, `n2o-session-hook.sh:32-35` | Done |
| `claim-task.sh` swallows errors | `set -e` + explicit exit codes (1 for errors, 2 for "no tasks") at every failure point | `claim-task.sh:21,38,72,93,99,143,209` | Done |
| SQL injection in claim-task.sh | `sanitize_sql()` rejects `;` and `--`, escapes single quotes; applied to all user inputs | `claim-task.sh:33-42,78-86` | Done |
| Session hook output not portable | ANSI escape codes stripped via `sed` before stdout | `n2o-session-hook.sh:209-212` | Done |
| No machine prerequisite check | `n2o check` validates jq, sqlite3, git, bash >=3.2, config, DB tables, scripts, gitignore | `n2o:518-672` | Done |
| `n2o check` not run after init | Init Step 11 calls `run_health_check` (non-fatal) | `n2o:949` | Done |
| No getting-started guide | `quickstart.md` covers agent commands, parallel execution, queries, example session | `01-getting-started/quickstart.md` | Done |
| Compat test for upgrades | 10 tests: config/tasks/CLAUDE.md/schema preserved, skills/schema updated, backup, dry-run, pin | `tests/test-n2o-compat.sh` | Done |

**Verification:**
- `test-n2o-e2e.sh`: `test_e2e_init` verifies DB tables, config version, and rates.json after init
- `test-n2o-e2e.sh`: `test_e2e_check_passes` confirms `n2o check` exits 0 on healthy project
- `test-n2o-e2e.sh`: `test_e2e_check_detects_broken` confirms `n2o check` exits 1 when config is missing
- `test-n2o-e2e.sh`: `test_e2e_session_hook_fires` confirms session hook produces developer context on startup
- `test-n2o-compat.sh`: 10 tests simulate version upgrade and verify nothing breaks
- `test-n2o-claim.sh`: 25 tests covering claiming, priority, dependencies, contention, error handling

### 2. Improveable
The system consistently updates itself. Skill quality metrics feed back into skill revisions.

**Success criteria:** Every skill invocation is tracked with version, tokens, and duration. Version comparison (`n2o stats --compare`) shows improvement trends.

**What we built:**

| Capability | What it does | Where |
|-----------|-------------|-------|
| Skill event tracking | `skill_invoked` events captured with `skill_name`, `skill_version`, token counts | `collect-transcripts.sh:373-391` |
| Version extraction | Skill version read from YAML frontmatter via `get_skill_version()` | `collect-transcripts.sh:68-90` |
| Skill versioning table | `skill_versions` table stores version history with changelog and `introduced_at` | `.pm/schema.sql:492-503` |
| Comparison views | `skill_version_token_usage`, `skill_version_duration`, `skill_version_precision` | `.pm/schema.sql:506-569` |
| `n2o stats --compare` | A/B comparison of token usage, duration, and exploration ratio across skill versions | `n2o:1358-1487` |
| Skill linting | `lint-skills.sh` validates frontmatter, version field, descriptions for all 6 skills | `scripts/lint-skills.sh` |

**Verification:**
- `test-n2o-e2e.sh`: `test_e2e_workflow_events` asserts exactly 1 `skill_invoked` event with `skill_name='tdd-agent'`
- `test-n2o-skills.sh`: 21 tests validate YAML frontmatter, version fields, trigger descriptions, lint pass
- `test-n2o-migrate.sh`: 30 tests verify migration infrastructure including `003-skill-versioning.sql`

### 3. Capture All Data
Every datapoint that might be useful later: time-to-complete, reversions, dollar cost, brain cycles.

**Success criteria:** `workflow_events` and `transcripts` tables are populated automatically. No manual collection steps.

**What we built:**

| Gap | Fix | Where | Status |
|-----|-----|-------|--------|
| `skill_invoked` events not emitted | Collector detects `Skill` tool calls and emits `skill_invoked` events with version | `collect-transcripts.sh:373-391` | Done |
| No dollar cost tracking | Rate card math: `(input × rate + output × rate) / 1M` using `templates/rates.json` | `collect-transcripts.sh:279-312` | Done |
| No brain cycles metric | `user_message_count` extracted per session; `n2o stats` shows avg per task | `collect-transcripts.sh:204`, `n2o:1703-1705` | Done |
| No concurrent session count | Session hook counts `claude` processes via `pgrep`, prints to context, and persists to `developer_context` table | `n2o-session-hook.sh:37-50` | Done |
| Transcript collection not automated | `SessionEnd` hook triggers `collect-transcripts.sh --quiet` when session terminates | `.claude/settings.json`, `n2o:210-211` | Done |

**Verification:**
- `test-n2o-e2e.sh`: `test_e2e_transcript_collection` asserts exact message counts (7 total, 2 user, 4 assistant), token sums (2600 input, 1050 output), and tool call count (6)
- `test-n2o-e2e.sh`: `test_e2e_cost_estimation` asserts exact dollar cost `0.02355` from known token counts
- `test-n2o-e2e.sh`: `test_e2e_workflow_events` asserts 4 tool_call + 1 skill_invoked + 1 subagent_spawn events
- `test-n2o-e2e.sh`: `test_e2e_idempotent_collection` confirms no duplicates on re-run
- `test-n2o-transcripts.sh`: 10 tests covering JSONL parsing, token sums, tool calls, subagent detection, idempotency

**Remaining gaps:** None — all data collection is automated.

### 4. Accelerant
Natively makes people faster. Metrics prove it.

**Success criteria:** Leadership can see throughput, efficiency, quality, and cost per task — all derivable from existing data.

**What we built:**

| Metric | Definition | Source | Where |
|--------|-----------|--------|-------|
| Throughput | Tasks completed in 7d / 30d windows | `tasks.completed_at` | `n2o:1675-1677` |
| Efficiency | Avg minutes per task (start → complete) | `tasks.started_at, completed_at` | `n2o:1680-1681` |
| Quality | % of tasks with `testing_posture='A'` | `tasks.testing_posture` | `n2o:1684-1685` |
| Predictability | Avg blow-up ratio (actual / estimated hours) | `tasks.actual_hours, estimated_hours` | `n2o:1688-1689` |
| Adoption | % of tasks using tdd-agent skill | `workflow_events.skill_name` | `n2o:1691-1693` |
| Cost/Task | Avg `estimated_cost_usd` per task | `transcripts.estimated_cost_usd` | `n2o:1695-1697` |
| Concurrency | Avg sessions per day | `transcripts.started_at` | `n2o:1699-1701` |
| Brain Cycles | Avg user messages per task | `transcripts.user_message_count` | `n2o:1703-1705` |

All 8 metrics appear in both terminal output (`n2o stats`) and JSON output (`n2o stats --json`). Definitions documented in `specs/metrics-definition.md`.

**Verification:**
- `test-n2o-stats.sh`: `test_stats_json_keys` confirms JSON output has all required top-level keys
- `test-n2o-stats.sh`: `test_stats_terminal_sections` confirms terminal output includes "Leadership Metrics" section
- `test-n2o-e2e.sh`: `test_e2e_stats_json` validates JSON structure with 7 required keys
- `test-n2o-e2e.sh`: `test_e2e_stats_terminal` confirms "Session Summary", "Leadership Metrics", "Sprint Progress" sections present
- 9 SQL views power the metrics: `skill_token_usage`, `skill_duration`, `skill_precision`, `blow_up_factors`, `velocity_report`, `estimation_accuracy`, `skill_usage`, plus 3 version comparison views

---

## E2E Verification

The full user journey is tested end-to-end in `tests/test-n2o-e2e.sh` (15 tests) with a meta-test audit `tests/test-n2o-e2e-audit.sh` (9 checks) that programmatically validates no tests are fake.

| E2E Test | Goals Covered | What it proves |
|----------|--------------|----------------|
| `test_e2e_init` | 1 | Init scaffolds DB, config, rates.json correctly |
| `test_e2e_seed_tasks` | 3, 4 | Task insertion and sprint views return exact counts |
| `test_e2e_transcript_collection` | 3 | JSONL parsing extracts exact token sums and message counts |
| `test_e2e_workflow_events` | 2, 3 | Skill invocations tracked with correct event types |
| `test_e2e_cost_estimation` | 3, 4 | Dollar cost matches rate card math to 5 decimal places |
| `test_e2e_idempotent_collection` | 3 | Re-running collection doesn't create duplicates |
| `test_e2e_stats_json` | 4 | Stats JSON has all required metric keys |
| `test_e2e_stats_terminal` | 4 | Stats terminal shows all sections including leadership |
| `test_e2e_check_passes` | 1 | Health check passes on properly initialized project |
| `test_e2e_check_detects_broken` | 1 | Health check catches missing config |
| `test_e2e_sync_restores_schema` | 1 | Sync repairs corrupted framework files |
| `test_e2e_sync_preserves_config` | 1 | Sync doesn't overwrite project customizations |
| `test_e2e_session_hook_fires` | 1, 3 | Session hook produces developer context on startup |
| `test_e2e_session_end_hook_registered` | 3 | SessionEnd hook registered in settings.json after init |
| `test_e2e_concurrent_sessions_persisted` | 3 | Session hook persists concurrent count to developer_context table |

**Meta-test audit** (`test-n2o-e2e-audit.sh`) ensures these tests stay real:
- Every test has assertions (no empty bodies)
- No existence-only tests (must check content, not just file presence)
- No exit-code-only tests (must assert on output, not just $?)
- Assertions use specific literal values (not dynamic variables)
- No commented-out assertions
- Complex tests have >=3 assertions

**Full suite:** 21 test suites (15 e2e tests + 9 audit checks), all green. `bash tests/run-all.sh` passes.

---

## Remaining Gaps

| Gap | Goal | Severity | Path Forward |
|-----|------|----------|-------------|
| ~~Transcript collection not automated~~ | 3 | ~~Medium~~ | ~~Done — SessionEnd hook triggers `collect-transcripts.sh`~~ |
| ~~Concurrent sessions not persisted~~ | 3 | ~~Low~~ | ~~Done — Session hook writes to `developer_context` table~~ |
| `n2o stats --compare` untested | 2 | Low | Add tests for `--compare <skill>` output |
| Observatory dashboard | 4 | Deferred | Phase 2 — `specs/workflow-dashboard.md` |
| NLP-based analysis nodes | 2 | Deferred | Phase 2 |
| Subscription cost tracking | 4 | Deferred | `specs/subscription-management.md` — admin-only feature |

---

## Phase 2 (Deferred)

| Item | Spec | Description |
|------|------|-------------|
| Observatory dashboard | `specs/workflow-dashboard.md` | GraphQL API + Next.js dashboard for leadership metrics |
| NLP analysis nodes | — | Natural language analysis of transcript content |
| Subscription management | `specs/subscription-management.md` | Per-developer plan tracking, admin-only CLI |
