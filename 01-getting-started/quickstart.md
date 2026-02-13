# Quickstart

## Agent Commands

All commands are typed inside Claude Code (run `claude` in your terminal).

### PM Agent
```
/pm-agent create a spec for user authentication
/pm-agent break down the auth spec into tasks
/pm-agent verify sprint completion
```

Also responds to: "create spec", "sprint planning", "break down", "plan"

### TDD Agent
```
/tdd-agent
/tdd-agent implement the next available task
/tdd-agent continue with task 5
```

Also responds to: "implement task", "tdd", "next task", "build"

### Bug Workflow
```
/bug-workflow login redirect failing after OAuth
/bug-workflow investigate why the CSV upload hangs
```

Also responds to: "found a bug", "something's broken", "help me debug"

## Parallel Execution

The power of this system is running multiple agents simultaneously.

**Setup**: Open 8-10 terminal tabs, each in the same project directory.

**Run**: In each tab, start Claude Code and run `/tdd-agent`. Each instance will:
1. Query SQLite for an unblocked task
2. Claim it (so other instances don't pick it)
3. Implement using TDD
4. Commit when audit passes

**Result**: 8 tasks running in parallel instead of 1.

## Common Queries

Check what's available to work on:
```bash
sqlite3 .pm/tasks.db "SELECT task_num, title, type FROM tasks WHERE status = 'pending' AND sprint = 'current-sprint';"
```

Check sprint progress:
```bash
sqlite3 .pm/tasks.db "SELECT * FROM sprint_progress;"
```

See what's blocked and why:
```bash
sqlite3 .pm/tasks.db "SELECT * FROM blocked_tasks;"
```

Check velocity (how long tasks are taking):
```bash
sqlite3 .pm/tasks.db "SELECT * FROM sprint_velocity WHERE sprint = 'current-sprint';"
```

## Example Session
```bash
$ claude
Claude Code v1.0

> /pm-agent create a spec for CSV file import

[PM Agent reads .wm/ for context, checks existing code]
[Writes spec to .pm/todo/csv-sprint/csv-import.md]
[Breaks into 6 tasks, loads into tasks.db]

Done. Created 6 tasks for csv-sprint:
1. Create CSV upload API route (backend)
2. Build file picker component (frontend)
3. Add Papaparse parsing logic (middleware)
4. Create editable table component (frontend)
5. Add Zustand store for table state (frontend)
6. Write validation for column headers (backend)

> /tdd-agent

[TDD Agent queries for unblocked task]
[Picks "Create CSV upload API route"]
[RED: writes failing test]
[GREEN: implements to pass]
[REFACTOR: cleans up]
[AUDIT: 3 subagents check work]
[COMMIT: ./scripts/git/commit-task.sh csv-sprint 1]

Task 1 complete. 5 remaining.

> /tdd-agent

[Picks next unblocked task...]
```

## Tips

- **Don't use `git add .`** — Stage files explicitly when multiple agents work in parallel
- **Check `available_tasks` first** — Make sure there's unblocked work before starting `/tdd-agent`
- **Let audits fail** — If a task fails audit, the agent loops back automatically. Don't intervene.
- **Review specs before implementation** — The PM Agent drafts, you approve, then TDD builds
- **One branch per sprint** — Not per task. Atomic commits make rollback easy.
