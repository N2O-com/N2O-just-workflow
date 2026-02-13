# Setup

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Claude Code** | [Install instructions](https://docs.anthropic.com/claude-code) |
| **Claude Max subscription** | $200/month recommended for parallel work |
| **Terminal with tabs** | iTerm2 (Mac), Windows Terminal (Windows) |
| **SQLite** | Pre-installed on Mac/Linux. [Windows download](https://www.sqlite.org/download.html) |

### Install Claude Code

**Windows:**
```powershell
irm https://claude.ai/install.ps1 | iex
```

**Mac/Linux:**
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

## First-Time Setup
```bash
# 1. Create required directories
mkdir -p .pm/todo .wm

# 2. Initialize the task database
sqlite3 .pm/tasks.db < .pm/schema.sql

# 3. Open Claude Code
claude

# 4. Start planning your first feature
/pm-agent create a spec for [your feature]
```

## Verify It's Working

Check that the database was created:
```bash
sqlite3 .pm/tasks.db "SELECT name FROM sqlite_master WHERE type='table';"
```

You should see:
```
tasks
task_dependencies
```

Try invoking an agent:
```bash
claude
> /pm-agent what specs exist?
```

## What Goes Where

| Item | Location | In Git? |
|------|----------|---------|
| Task database | `.pm/tasks.db` | No |
| Database schema | `.pm/schema.sql` | Yes |
| Sprint specs | `.pm/todo/{sprint}/` | Yes |
| Task seeds | `.pm/todo/{sprint}/tasks.sql` | Yes |
| Working memory | `.wm/` | No |
| Agent skills | `02-agents/` | Yes |
| Patterns | `03-patterns/` | Yes |
| Secrets | `.env.local` | No |

## Cleanup / Reset

If things get messy and you need to start fresh:
```bash
# Reset the task database
rm .pm/tasks.db
sqlite3 .pm/tasks.db < .pm/schema.sql

# Reload a sprint's tasks
sqlite3 .pm/tasks.db < .pm/todo/{sprint}/tasks.sql

# Clear working memory
rm -rf .wm/*
```

## Multiple Engineers

Each engineer:
- Has their own `.pm/tasks.db` (gitignored, no conflicts)
- Shares specs via `.pm/todo/{sprint}/` (in git)
- Shares task seeds via `tasks.sql` (in git)

To sync:
```bash
git pull
sqlite3 .pm/tasks.db < .pm/todo/{sprint}/tasks.sql
```
