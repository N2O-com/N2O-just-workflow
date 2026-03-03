# Setup

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Claude Code** | [Install instructions](https://docs.anthropic.com/claude-code) |
| **Claude Max subscription** | $200/month recommended for parallel work |
| **Terminal with tabs** | iTerm2 (Mac), Windows Terminal (Windows) |
| **bash 3.2+** | Pre-installed on Mac/Linux |
| **sqlite3** | Pre-installed on Mac/Linux. [Windows download](https://www.sqlite.org/download.html) |
| **jq** | `brew install jq` (Mac) or `apt install jq` (Linux) |
| **git** | Pre-installed on most systems |

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
# 1. Clone the N2O framework (one-time)
git clone <framework-repo-url> ~/n2o

# 2. Initialize your project
~/n2o/n2o init <your-project-path> --interactive --register

# 3. Verify everything is set up
~/n2o/n2o check <your-project-path>

# 4. Open Claude Code in your project
cd <your-project-path> && claude

# 5. Start planning your first feature
/pm-agent create a spec for [your feature]
```

`n2o init` handles everything: creates `.pm/` directories, initializes `tasks.db` from the schema, installs skills and session hooks, scaffolds `CLAUDE.md`, and registers your developer name.

`n2o check` verifies: all 6 skills installed, session hooks configured, rates.json present, database tables exist, and `.gitignore` is correct.

## What Goes Where

| Item | Location | In Git? |
|------|----------|---------|
| Task database | `.pm/tasks.db` | No |
| Database schema | `.pm/schema.sql` | Yes |
| Sprint specs | `.pm/todo/{sprint}/` | Yes |
| Task seeds | `.pm/todo/{sprint}/tasks.sql` | Yes |
| Agent skills | `.claude/skills/` | Yes |
| Config | `.pm/config.json` | Yes |
| Secrets | `.env.local` | No |

## Cleanup / Reset

```bash
# Reset the task database
rm .pm/tasks.db
sqlite3 .pm/tasks.db < .pm/schema.sql

# Reload a sprint's tasks
sqlite3 .pm/tasks.db < .pm/todo/{sprint}/tasks.sql
```

## Multiple Engineers

Each engineer:
- Has their own `.pm/tasks.db` (gitignored, no conflicts)
- Shares specs via `.pm/todo/{sprint}/` (in git)
- Shares task seeds via `tasks.sql` (in git)

To sync after pulling:
```bash
n2o sync <your-project-path>
```
