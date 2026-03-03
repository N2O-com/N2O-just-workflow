# 001: Atomic Task Claiming for Parallel Agents

## Problem

When multiple terminal tabs each run `/tdd-agent`, there is no mechanism to prevent two agents from picking the same task. Both agents query `available_tasks`, both see the same pending task, and both start working on it — duplicating effort.

The `owner` column exists in the `tasks` table but is never used in the `available_tasks` view, and the tdd-agent workflow never instructs agents to set it when picking a task.

## Proposed Change

### 1. Update `available_tasks` view to exclude claimed tasks

In `.pm/schema.sql`, replace the existing `available_tasks` view:

```sql
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
```

The only addition is `AND t.owner IS NULL` on line 5.

### 2. Add a claim query to the tdd-agent workflow

In `skills/tdd-agent/SKILL.md`, update Phase 1 ("Pick Next Task"). After selecting a task from `available_tasks`, the agent should claim it atomically:

```sql
-- Claim the task (atomic — only one agent succeeds)
UPDATE tasks
SET owner = 'tab-N'
WHERE sprint = 'SPRINT_NAME'
  AND task_num = TASK_NUM
  AND status = 'pending'
  AND owner IS NULL;
```

The agent should then check that the update affected 1 row. If 0 rows were affected, another agent already claimed it — pick a different task.

The `tab-N` identifier can be anything unique per terminal session (e.g., `tab-1`, `tab-2`, or even a timestamp).

### 3. Update the SKILL.md Phase 1 instructions

Replace the current Phase 1 section in `skills/tdd-agent/SKILL.md` (around lines 132-148) with instructions that include the claim step:

```markdown
## Phase 1: Pick Next Task

Query available tasks with no pending dependencies:

\`\`\`bash
sqlite3 .pm/tasks.db "SELECT sprint, task_num, title, done_when FROM available_tasks WHERE sprint = 'SPRINT_NAME';"
\`\`\`

**Selection criteria**:
- No unfinished dependencies (task only appears in `available_tasks` if dependencies are done)
- Status = 'pending'
- Not claimed by another agent (`owner IS NULL`)
- Clear "Done When" criteria

**Claim the task** before starting work:

\`\`\`bash
sqlite3 .pm/tasks.db "UPDATE tasks SET owner = 'tab-ID' WHERE sprint = 'SPRINT_NAME' AND task_num = TASK_NUM AND status = 'pending' AND owner IS NULL; SELECT changes();"
\`\`\`

If `changes()` returns `0`, another agent already claimed it. Pick a different task.

**If no tasks available**: Either all tasks are blocked/claimed, or sprint is complete. Report to planning agent.
```

## Files Affected

| File | Change |
|------|--------|
| `.pm/schema.sql` | Add `AND t.owner IS NULL` to `available_tasks` view |
| `skills/tdd-agent/SKILL.md` | Add claim step to Phase 1 |

## Done When

- [ ] `available_tasks` view in `.pm/schema.sql` includes `AND t.owner IS NULL`
- [ ] `skills/tdd-agent/SKILL.md` Phase 1 includes the claim query with `SELECT changes()` check
- [ ] Verify: Run two queries in parallel — only one should succeed in claiming the same task
  ```bash
  # Terminal 1 and 2 simultaneously:
  sqlite3 .pm/tasks.db "UPDATE tasks SET owner='test' WHERE sprint='X' AND task_num=1 AND owner IS NULL; SELECT changes();"
  # One returns 1, the other returns 0
  ```
- [ ] Existing tasks with `owner IS NULL` still appear in `available_tasks`

## Notes

- This is backward-compatible. If nobody sets `owner`, all tasks remain visible (since `owner IS NULL` is the default).
- The `owner` column already exists in the schema — no migration needed.
- SQLite serializes writes at the file level, so the `UPDATE ... WHERE owner IS NULL` is inherently atomic for local use. Two concurrent writes can't both succeed for the same row.
- To unclaim a task (e.g., agent crashes), the PM can run: `UPDATE tasks SET owner = NULL WHERE sprint = '...' AND task_num = ...;`
