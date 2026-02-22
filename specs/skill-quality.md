# Skill Quality Spec

Quality spec for the N2O workflow framework's skills. Defines what we measure about each skill and why.

Philosophy: capture data now, analyze later.

## 1. Primary Metrics (all skills)

### Token Usage

Per skill invocation:
- Input tokens + output tokens per invocation
- Source: `workflow_events` table (`input_tokens`, `output_tokens` columns)
- Aggregated in: `skill_token_usage` view
- Why: understand cost per skill, identify which skills are most expensive

### Duration

Per skill invocation:
- Seconds from skill start to task completion
- Source: `workflow_events` timestamps (`skill_invoked` -> `task_completed`)
- Aggregated in: `skill_duration` view
- Why: identify slow skills, track speed improvements over time

### Exploration Ratio

Per task:
- Formula: `(unique files read but not modified) / (total unique files read)`
- Source: `workflow_events` tool_call events with `file_path` in metadata
- Read tools: `Read`, `Glob`, `Grep`; Write tools: `Edit`, `Write`
- Aggregated in: `skill_precision` view
- Target: <0.3 (meaning >70% of file reads lead to modifications)
- Why: measures how targeted agents are. High exploration ratio = wasted tokens on unnecessary file reads.
- Lower is better. An exploration ratio of 0.1 means the agent knew exactly which files to read.

## 2. Per-Skill Quality Signals

### tdd-agent

- **First-attempt A-grade rate**: % of tasks graded A on first audit (no FIX AUDIT loops). Captured via `task_completed` event metadata field `fix_audit_iterations`.
- **Phase time distribution**: % of total task time in each phase (RED, GREEN, REFACTOR, AUDIT, FIX_AUDIT, COMMIT). Source: `phase_timing` view. Key signal: if AUDIT+FIX >40% of total time, the implementation phase is producing low-quality code.
- **Token efficiency**: average tokens per task by complexity level (S/M/L/XL). Source: `token_efficiency_trend` view. Should improve (decrease) over time as patterns are codified.

### pm-agent

- **Downstream success**: % of pm-agent-planned tasks that complete without reversions. Source: `tasks` table (`reversions` column). A high reversion rate means specs/task descriptions aren't precise enough.
- **Task sizing accuracy**: estimation blow-up ratio (`actual hours / estimated hours`). Source: `estimation_accuracy` view (already exists). Target: 0.8-1.5. Values >2.0 indicate systematic underestimation.

### bug-workflow

- **Root cause accuracy**: % of bug-workflow tasks where the resulting fix succeeded (no reversion). Source: `tasks` table where the originating skill was `bug-workflow` and `reversions = 0`. Low accuracy means hypotheses aren't being verified with evidence before creating tasks.

### detect-project

- **Coverage**: % of CLAUDE.md sections filled vs total sections available. Manual metric -- checked by reviewing CLAUDE.md for `<!-- FILLED -->` vs `<!-- UNFILLED -->` markers.

## 3. Blow-Up Factor Analysis

Understanding why tasks take much longer than estimated. A task "blows up" when actual time > 2x estimated time.

Factors that correlate with blow-ups:

| Factor | How to identify | Data source |
|--------|----------------|-------------|
| **Dependencies** | Task was blocked on incomplete prerequisite work | `task_dependencies` table, `blocked_tasks` view |
| **Unfamiliar tools/frameworks** | Task uses libraries the team hasn't used before | `type` column on tasks (new types correlate with blow-ups) |
| **Non-standard patterns** | Task doesn't match established patterns in the codebase | `pattern_audit_notes` showing violations, high exploration ratio |
| **Scope creep** | Task turns out bigger than scoped | Actual hours >> estimated hours without audit failures |
| **Audit failures** | Multiple FIX AUDIT iterations before A grade | `fix_audit_iterations` in `task_completed` metadata |
| **Test complexity** | Tests are harder to write than the implementation | Phase timing showing RED phase > GREEN phase by 2x+ |

The `blow_up_factors` view surfaces tasks where actual > 2x estimated along with their type, complexity, and reversion count to help identify patterns.

## 4. Data Collection Architecture

All metrics flow through one pipeline:

1. **Claude Code** saves JSONL transcripts automatically at `~/.claude/projects/{path}/{session}.jsonl`
2. **`scripts/collect-transcripts.sh`** parses JSONL files and loads structured data into `workflow_events` and `transcripts` tables
3. **SQL views** aggregate the raw events into queryable metrics
4. **`n2o stats`** surfaces the metrics in the CLI

Key design decisions:

- **Real columns over JSON parsing**: `input_tokens`, `output_tokens`, `tool_calls_in_msg` are real columns on `workflow_events`, not buried in the `metadata` JSON blob. This enables fast aggregation queries.
- **Per-assistant-message tokens**: Claude's JSONL provides tokens per assistant message, not per tool call. When a message contains multiple tool calls, all tool call rows get the same token count. The `tool_calls_in_msg` column lets views divide accurately.
- **Batch over real-time**: All data collection happens via transcript parsing, not real-time hooks. This avoids adding latency to the development workflow.
- **Views over summary tables**: Views are always current and require no maintenance. If performance becomes an issue at scale, materialized summary tables can be added later.

## 5. Schema Reference

### Columns on `workflow_events`

- `input_tokens INTEGER` -- tokens in the context window for this turn
- `output_tokens INTEGER` -- tokens generated in this turn's response
- `tool_calls_in_msg INTEGER` -- number of tool calls sharing these tokens

### Views

| View | Purpose |
|------|---------|
| `skill_token_usage` | Token totals and averages per skill per sprint |
| `skill_duration` | Duration per skill invocation in seconds |
| `skill_precision` | Files read vs modified, exploration ratio per task |
| `phase_time_distribution` | Phase durations as % of total task time |
| `token_efficiency_trend` | Avg tokens per task by sprint and complexity |
| `blow_up_factors` | Tasks where actual > 2x estimated, with context |

### Existing views (already in schema)

| View | Purpose |
|------|---------|
| `skill_usage` | Tool invocation frequency |
| `phase_timing` | Phase durations in seconds |
| `estimation_accuracy` | Estimate vs actual hours |
| `developer_quality` | Per-developer reversion and grade stats |
| `velocity_report` | Hours per task |
