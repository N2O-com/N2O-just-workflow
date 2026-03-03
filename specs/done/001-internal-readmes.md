# 005: Add READMEs Inside scripts/ and .pm/

## Problem

The `scripts/` and `.pm/` directories have no self-describing documentation. Someone browsing the repo has to read root-level docs to understand what these folders contain and how to use them. The scripts in particular (`commit-task.sh`) are not obvious from the filename — you need to read the file to know its purpose, arguments, and prerequisites.

## Proposed Change

### 1. Add scripts/README.md

```markdown
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

**Prerequisites**: Files must be staged (`git add`) before running. Never
use `git add .` — stage files explicitly, especially when multiple agents
work in parallel.

## Example

\`\`\`bash
git add src/lib/parser.ts src/lib/parser.test.ts
./scripts/git/commit-task.sh auth-sprint 5
# → feat(auth-sprint): create login form (Task #5)
\`\`\`
```

### 2. Add .pm/README.md

```markdown
# .pm/ — Project Management

SQLite-based task tracking system. Tasks are stored in a queryable database
instead of markdown checklists.

## Contents

| File/Directory | Purpose | In Git? |
|---------------|---------|---------|
| `schema.sql` | Database schema (tables, views, triggers) | Yes |
| `tasks.db` | Live task database | No (gitignored) |
| `backlog/` | Unrefined ideas, temporary | Yes |
| `todo/{sprint}/` | Sprint specs and task seeds | Yes |

## Key Design

- **`tasks.sql` seeds** are in git (diffable, reviewable)
- **`tasks.db`** is gitignored (local state, no merge conflicts)
- The database is regenerated from seeds when needed

## Common Commands

\`\`\`bash
# Initialize database
sqlite3 .pm/tasks.db < .pm/schema.sql

# Load a sprint's tasks
sqlite3 .pm/tasks.db < .pm/todo/{sprint}/tasks.sql

# See available (unblocked) tasks
sqlite3 .pm/tasks.db "SELECT * FROM available_tasks WHERE sprint = '{sprint}';"

# Check sprint progress
sqlite3 .pm/tasks.db "SELECT * FROM sprint_progress;"

# Reset database
rm .pm/tasks.db && sqlite3 .pm/tasks.db < .pm/schema.sql
\`\`\`

## Schema Overview

- **2 tables**: `tasks`, `task_dependencies`
- **8 views**: `available_tasks`, `blocked_tasks`, `sprint_progress`,
  `needs_pattern_audit`, `needs_verification`, `refactor_audit`,
  `velocity_report`, `sprint_velocity`
- **3 triggers**: auto-set `started_at`, `completed_at`, `updated_at`

See `schema.sql` for full definitions.
```

## Files Affected

| File | Change |
|------|--------|
| `scripts/README.md` | New |
| `.pm/README.md` | New |

## Done When

- [ ] `scripts/README.md` exists with script table and usage examples
- [ ] `.pm/README.md` exists with contents table and common commands
- [ ] `grep -r "scripts/" *.md` shows no broken references
- [ ] `grep -r ".pm/" *.md` shows no broken references

## Notes

- These are purely additive — no existing files change.
- Content is derived from existing documentation scattered across README.md, QUICKSTART.md, and the schema file itself. This just puts it where someone would naturally look.
