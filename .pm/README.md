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

**Note**: An example sprint is included at `todo/example-sprint/` showing
the expected format. When you run `/pm-agent`, it creates new sprint folders
here automatically.

## Common Commands
```bash
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
```

## Schema Overview

- **2 tables**: `tasks`, `task_dependencies`
- **8 views**: `available_tasks`, `blocked_tasks`, `sprint_progress`,
  `needs_pattern_audit`, `needs_verification`, `refactor_audit`,
  `velocity_report`, `sprint_velocity`
- **3 triggers**: auto-set `started_at`, `completed_at`, `updated_at`

See `schema.sql` for full definitions.
