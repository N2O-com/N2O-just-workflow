# Scripts

Automation scripts for git operations. These link commits to tasks in the
SQLite database for traceability.

## Available Scripts

| Script | Usage | Purpose |
|--------|-------|---------|
| `git/commit-task.sh` | `./scripts/git/commit-task.sh <sprint> <task_num>` | Commit staged changes with conventional format, record hash in tasks.db |

## How commit-task.sh Works

1. Looks up task title from `.pm/tasks.db` using sprint + task_num
2. Maps task type to conventional commit prefix (feat, chore, test, docs)
3. Creates commit: `{prefix}({sprint}): {title} (Task #{num})`
4. Records the commit hash back in tasks.db

**Note**: The TDD Agent calls this automatically when a task passes audit.
You usually don't run it manually.

**Prerequisites**: Files must be staged (`git add`) before running. Never
use `git add .` — stage files explicitly, especially when multiple agents
work in parallel.

## Commit Message Format

Example: `feat(auth-sprint): create login form (Task #5)`

- `feat` — type of change (feat, chore, test, docs, fix, refactor)
- `(auth-sprint)` — sprint name
- `create login form` — task title from SQLite
- `(Task #5)` — task number for traceability back to the database

## Example
```bash
git add src/lib/parser.ts src/lib/parser.test.ts
./scripts/git/commit-task.sh auth-sprint 5
# → feat(auth-sprint): create login form (Task #5)
```
