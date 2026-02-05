# 007: Online Task Database / Linear Integration

## Problem

The current system is single-player. Each developer has their own local `tasks.db` — there's no shared view of sprint progress, no cross-team visibility, and no way for a PM to see that Ella just completed Task 3 without asking her. This blocks scaling beyond one person per project and makes the developer tracking vision (006) siloed per machine.

N2O already uses Linear. Stakeholders and PMs expect to see progress in a familiar UI, not by running SQL queries.

## Design Constraint

This must be **extensible to other task managers** (Asana, Jira, Notion, etc.), not locked to Linear. The architecture should have a clean boundary between the agent-side task execution and the external PM tool.

---

## Recommendation: Hybrid with Direct API Sync

**SQLite for agents, Linear for humans, connected by a sync script using direct API calls.**

```
┌─────────────────────────────────────────────────────┐
│ Agent Layer (fast, local, no network)                │
│                                                      │
│  tdd-agent → SQLite ← pm-agent                      │
│               ↑                                      │
│          triggers, views, dependency resolution      │
│          (available_tasks, velocity_report, etc.)    │
└──────────────────────┬──────────────────────────────┘
                       │
                       │ sync script (direct API calls)
                       │ fires at: claim, block, complete, sprint-end
                       │
┌──────────────────────▼──────────────────────────────┐
│ Human Layer (Linear)                                 │
│                                                      │
│  Issues, assignments, progress, dashboards           │
│  PMs plan here, stakeholders track here              │
└─────────────────────────────────────────────────────┘
```

### Why Not MCP?

Linear has an official MCP server, and Claude Code supports project-scoped MCP configuration via `.mcp.json` (committable to git, shared across the team). It's tempting to use MCP as the integration layer — agents would read/write Linear issues directly through MCP tool calls. But **MCP should not be in the hot path of agent execution.** Here's why:

#### 1. Protocol overhead

Every MCP tool call goes through multiple layers:

```
Agent → Claude Code → MCP client → JSON-RPC → MCP server → Linear API
                                                              ↓
Agent ← Claude Code ← MCP client ← JSON-RPC ← MCP server ← response
```

That's two network hops and JSON-RPC serialization/deserialization at each layer. A local SQLite query is microseconds. An MCP round-trip to Linear is hundreds of milliseconds at best. The TDD agent updates task status 5-6 times per task cycle (pending → red → green, plus audit updates, plus dependency checks). Over an 8-task sprint, that's 40-50 MCP calls that could be local reads/writes.

#### 2. Context window consumption

Every MCP tool call consumes tokens in the conversation — the tool definition, the call parameters, and the full response. A `SELECT * FROM available_tasks` against SQLite returns a compact result through a bash call. The equivalent via MCP returns a JSON blob with Linear's full issue schema (id, identifier, title, description, state, assignee, labels, priority, estimate, cycle, project, team, creator, createdAt, updatedAt, ...) for every matching issue. That's significantly more tokens per query, and context is finite.

#### 3. Dependency resolution doesn't exist in Linear

The `available_tasks` view is the core of the task-picking workflow:

```sql
SELECT t.* FROM tasks t
WHERE t.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM task_dependencies d
    JOIN tasks dep ON dep.sprint = d.depends_on_sprint
      AND dep.task_num = d.depends_on_task
    WHERE d.sprint = t.sprint
      AND d.task_num = t.task_num
      AND dep.status != 'green'
  );
```

This is a SQL join with subquery filtering. Linear has issue relations but no equivalent "show me all issues whose blocking relations are all resolved" query. Via MCP, you'd need to: fetch all issues, fetch all relations, walk the dependency graph in the agent's context, and filter. That's multiple MCP calls, a large context payload, and computation that the agent does instead of SQLite.

#### 4. Custom views have no MCP equivalent

The analytical views — `velocity_report`, `estimation_accuracy`, `estimation_accuracy_by_type`, `developer_quality`, `sprint_velocity` — are SQL aggregations. They don't exist in Linear's data model and can't be computed via MCP without fetching all raw data and doing the math in-context. These views are what make the developer tracking system (006) possible.

#### 5. Triggers can't be replicated

SQLite triggers automatically set `started_at` when status leaves `pending` and `completed_at` when status reaches `green`. They also track reversions (006). This happens at the database level with zero agent involvement. Via MCP/Linear, every one of these would need to be explicit agent logic — more instructions in SKILL.md, more chances to forget, more tokens consumed.

#### 6. Failure modes

If Linear's MCP server is down, slow, or rate-limited, the TDD agent stops. Local SQLite has no failure mode — the file is on disk. Linear's MCP docs themselves note: "Remote MCP connections are still early and the connection may fail or require multiple attempts." That's acceptable for ad-hoc queries. It's not acceptable in the middle of a TDD execution loop.

#### 7. PM tool lock-in

If agents talk to Linear through MCP, every SKILL.md instruction is Linear-specific. Switching to Asana means finding an Asana MCP server, mapping its tool calls to the same operations, and rewriting agent instructions. With the hybrid approach, agents talk to SQLite (stable, never changes), and only the sync script is PM-tool-specific.

#### Where MCP does fit: The PM Agent

MCP is the right integration layer for the PM agent. The PM agent's interaction with Linear is fundamentally different from the TDD agent's — it's **low-frequency, exploratory, and human-paced**.

**Why MCP works for the PM agent but not the TDD agent:**

| Factor | TDD Agent | PM Agent |
|--------|-----------|----------|
| Frequency | 5-6 status updates per task, tight loop | 10-20 operations across an entire planning session |
| Latency sensitivity | High — microseconds matter in execution loop | Low — a few hundred ms per call is irrelevant during planning |
| Query predictability | Same queries every time (`available_tasks`, `UPDATE status`) | Exploratory ("show me tech-debt issues", "what did Luke ship last cycle") |
| Data richness needed | Minimal — compact rows, task status | Maximal — full issue descriptions, comments, relations, labels |
| Context token cost | Wasteful — Linear's full schema is noise | Valuable — the rich data IS the planning input |

**What the PM agent uses MCP for:**

Reading (planning phase):
- Browse the existing backlog — what's filed, deprioritized, assigned to whom
- Check the current cycle — in progress, blocked, shipped last cycle
- Read stakeholder comments on issues — requirements, clarifications, feedback
- Look at project-level status — cross-team dependencies or blockers

Writing (task breakdown phase):
- Create issues for the tasks generated from specs
- Set assignees, priorities, labels, estimates
- Add blocking/blocked-by relations between issues
- Post the spec summary as a comment on the parent issue

Reading (monitoring phase):
- Check which tasks are done vs. blocked
- Read blocked reasons to decide how to unblock
- Pull data to assess sprint health

The ad-hoc nature is key. The PM agent doesn't run the same queries every time — it's exploring and making judgment calls. MCP's tool-call interface is designed for exactly this kind of exploratory interaction. You can't pre-bake these queries into a sync script because you don't know them in advance.

**Setup** — one line, shared via git:

```bash
claude mcp add --transport sse linear-server https://mcp.linear.app/sse
```

This creates `.mcp.json` at the project root. Commit it to git. Every team member's PM agent gets Linear access automatically.

#### The PM → TDD Handoff: Linear-First Planning, SQLite-First Execution

The most important architectural decision is where tasks originate and how they flow between the two layers.

**Recommended flow:**

```
PM Agent (MCP)                    Sync Script               TDD Agent (SQLite)
     │                                │                           │
     │ 1. Browse Linear backlog       │                           │
     │ 2. Create issues in Linear     │                           │
     │    (assignees, relations,      │                           │
     │     estimates, labels)         │                           │
     │ 3. Organize into cycle         │                           │
     │                                │                           │
     │────── sprint ready ───────────>│                           │
     │                                │ 4. Pull issues from       │
     │                                │    Linear → SQLite        │
     │                                │    (populate tasks.db     │
     │                                │     with external_id)     │
     │                                │                           │
     │                                │──── tasks available ─────>│
     │                                │                           │
     │                                │     5. TDD execution      │
     │                                │        (local SQLite,     │
     │                                │         fast, offline)    │
     │                                │                           │
     │                                │<──── claim/complete ──────│
     │                                │                           │
     │                                │ 6. Push completions       │
     │                                │    back to Linear         │
     │                                │                           │
     │ 7. Monitor progress in Linear  │                           │
     │ 8. Unblock tasks via MCP       │                           │
     │                                │                           │
```

**Why Linear-first for planning:**
- PMs are comfortable creating issues in Linear — it's their tool
- Linear's UI handles drag-and-drop prioritization, label management, and cycle planning better than SQL seed files
- Stakeholders can comment on issues, add context, and track progress without touching the command line
- The PM agent reads this context via MCP during planning — stakeholder comments, existing issues, cross-project dependencies

**Why SQLite-first for execution:**
- All seven reasons above (protocol overhead, context consumption, dependency resolution, custom views, triggers, failure modes, PM tool lock-in)
- The TDD agent never needs to know Linear exists

**What this replaces:** The current workflow has the PM agent writing SQL seed files (`.pm/todo/{sprint}/tasks.sql`) and loading them with `sqlite3 .pm/tasks.db < tasks.sql`. In this model, the PM agent creates issues in Linear via MCP, and the sync script generates the SQLite rows. The seed files become optional — useful for git-tracked history, but no longer the primary input path.

**The seed files could still be generated** by the sync script as a byproduct of the pull — write the SQL inserts to `tasks.sql` while populating `tasks.db`. This preserves the git-tracked, diffable task history that the current system values.

---

### Why Direct API Sync Over MCP for the Sync Layer

The sync script calls Linear's GraphQL API directly rather than going through MCP:

| Factor | MCP | Direct API |
|--------|-----|------------|
| Network hops | 2 (agent → MCP server → Linear) | 1 (script → Linear) |
| Batching | One tool call per operation | GraphQL mutations batch naturally |
| Auth | OAuth 2.1 flow, per-session | API key in `.env.local`, persistent |
| Error handling | Opaque (MCP layer can swallow errors) | Direct HTTP status codes |
| Extensibility | Need MCP server per PM tool | Need adapter script per PM tool (simpler) |
| Runs where | Inside agent context (tokens) | Outside agent context (background script) |

The sync script runs outside the agent's context — it doesn't consume tokens, doesn't add to conversation length, and can log/retry independently.

---

## Architecture Detail

### What syncs to Linear

| Field | Direction | When |
|-------|-----------|------|
| Task title, description, assignee | Linear → SQLite | Sprint start |
| Task claimed (owner set) | SQLite → Linear | Task claimed |
| Status (done/not done) | SQLite → Linear | Task completion |
| Time spent (hours) | SQLite → Linear | Task completion |
| Blocked status + reason | SQLite → Linear | When blocked |
| Sprint summary | SQLite → Linear | Sprint end |
| Testing posture, audit notes | Stays in SQLite | Never syncs (agent-only data) |
| Reversions, blow-up ratio | Stays in SQLite | Never syncs (agent-only data) |
| Comments/updates from PM | Linear → SQLite | On-demand pull |

Agent-specific data (audit grades, pattern compliance, reversion counts) stays in SQLite only. It's not useful in Linear's UI and would clutter the interface for non-technical stakeholders.

### Sync script interface

```bash
# scripts/sync/linear-sync.sh
# Called by tdd-agent at key moments:

./scripts/sync/linear-sync.sh claim <sprint> <task_num>
# → Updates Linear issue assignee + "In Progress" state

./scripts/sync/linear-sync.sh complete <sprint> <task_num>
# → Updates Linear issue to "Done" + posts time spent

./scripts/sync/linear-sync.sh blocked <sprint> <task_num>
# → Updates Linear issue to "Blocked" + posts reason as comment

./scripts/sync/linear-sync.sh sprint-summary <sprint>
# → Posts sprint velocity, completion %, blocked count to Linear project
```

The script reads state from SQLite (`tasks.db`), maps to Linear's GraphQL API, and updates `last_synced_at` in SQLite. Linear's API is GraphQL, so reads and writes can be batched efficiently — fetch multiple issues in one query, update with mutations.

### SKILL.md changes (minimal)

Add 3-4 lines to the tdd-agent workflow at key moments:

```markdown
# After claiming task (Phase 1):
./scripts/sync/linear-sync.sh claim $SPRINT $TASK_NUM

# After task blocked (error handling):
./scripts/sync/linear-sync.sh blocked $SPRINT $TASK_NUM

# After commit (Phase 9):
./scripts/sync/linear-sync.sh complete $SPRINT $TASK_NUM
```

The agent doesn't know or care what PM tool is on the other end. It calls the sync script and moves on.

### Extensibility

```
scripts/sync/
├── linear-sync.sh          # Adapter for Linear (GraphQL API)
├── asana-sync.sh           # Adapter for Asana (REST API) — future
├── jira-sync.sh            # Adapter for Jira (REST API) — future
└── sync.sh                 # Orchestrator: reads config, calls correct adapter
```

Each adapter translates between SQLite fields and the PM tool's API. Adding a new PM tool means writing one adapter file. No changes to agents, SKILL.md files, or the SQLite schema.

---

## Schema Additions

```sql
ALTER TABLE tasks ADD COLUMN external_id TEXT;        -- Linear issue ID, Asana task ID, etc.
ALTER TABLE tasks ADD COLUMN external_url TEXT;        -- Link to task in PM tool
ALTER TABLE tasks ADD COLUMN last_synced_at DATETIME;  -- When this task was last synced
```

---

## 80/20 Starting Point

1. **Add `external_id`, `external_url`, `last_synced_at` columns to schema** — start linking tasks to Linear issues, even if sync is initially manual
2. **Add `.mcp.json` with Linear MCP server** — gives PM agent access to Linear for planning (ad-hoc use, not hot path)
3. **Write a one-way sync script** — reads completed tasks from SQLite, posts summaries to Linear. No two-way sync, no state conflict risk. PMs get visibility.
4. **Expand to full boundary sync** — claim/block/complete hooks in tdd-agent, Linear issue state updates

## Open Questions

- How much real-time visibility do PMs need? (Boundary sync covers most cases. Continuous would require a background watcher process.)
- Should PMs be able to modify tasks in Linear and have changes flow back? (Two-way sync adds significant complexity. Recommend starting one-way.)
- Who builds and maintains the sync layer? (This is infrastructure work, not feature work.)

## Done When

- [ ] `tasks` table has new columns: `external_id`, `external_url`, `last_synced_at`
- [ ] `.mcp.json` exists with Linear MCP server configured
- [ ] `scripts/sync/linear-sync.sh` exists and handles: `claim`, `complete`, `blocked`, `sprint-summary`
- [ ] `tdd-agent/SKILL.md` calls sync script at claim/block/complete moments
- [ ] `pm-agent/SKILL.md` documents Linear MCP availability for planning
- [ ] Verify: Claim a task locally, run sync script, confirm Linear issue updates to "In Progress"
- [ ] Verify: Complete a task locally, run sync script, confirm Linear issue updates to "Done"
- [ ] Verify: PM agent can read Linear backlog via MCP (`/pm-agent show me the current cycle`)

## Files Affected

| File | Change |
|------|--------|
| `.pm/schema.sql` | Add `external_id`, `external_url`, `last_synced_at` columns |
| `.mcp.json` | New — project-scoped Linear MCP config for PM agent |
| `scripts/sync/` | New directory for sync scripts and adapters |
| `skills/tdd-agent/SKILL.md` | Add sync script calls at claim/block/complete moments |
| `skills/pm-agent/SKILL.md` | Note availability of Linear MCP for planning |
