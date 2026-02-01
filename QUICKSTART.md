# Quick Start Guide

## How to Invoke the Workflow

### 1. PM Agent (Planning)

**Invoke with:**
- `/pm-agent` 
- Or natural language: "create spec", "new feature spec", "write spec", "break down", "sprint planning", "plan sprint"

**Example:**
```
/pm-agent create a spec for user profile editing
```

**What it does:**
- Creates feature specs in `.pm/todo/{sprint}/`
- Breaks specs into tasks
- Loads tasks into `.pm/tasks.db` (SQLite)

---

### 2. TDD Agent (Implementation)

**Invoke with:**
- `/tdd-agent`
- Or natural language: "implement task", "tdd", "test-driven development", "task execution", "implement feature"

**Example:**
```
/tdd-agent implement the next available task
```

**What it does:**
- Picks tasks from `.pm/tasks.db`
- Implements using TDD (RED → GREEN → REFACTOR → AUDIT → COMMIT)
- Updates task status in database
- Commits with conventional commit format

**Parallel work:**
- Open multiple tabs, each can run `/tdd-agent` on different tasks
- Tasks are tracked in shared `tasks.db`

---

### 3. Bug Workflow (Debugging)

**Invoke with:**
- `/bug-workflow`
- Or natural language: "found a bug", "bug report", "something's broken", "investigate this bug", "help me debug"

**Example:**
```
/bug-workflow investigate why user login is failing
```

**What it does:**
- Investigates bugs (database queries, temp E2E tests)
- Finds root cause
- Creates hotfix task in `tasks.db`
- Returns to `/tdd-agent` for implementation

---

## File Structure & Git

### Committed to Git (Tracked)

```
.pm/
├── schema.sql          # Database schema (in git)
└── todo/               # Feature specs (in git)
    └── {sprint}/
        ├── 01-feature.md
        └── tasks.sql    # Task seeds (in git)

skills/                 # All skill documentation (in git)
```

**Why tracked:**
- Specs are documentation of what was built
- Task seeds show what tasks were created
- Skills are reusable knowledge
- Git history preserves everything

### NOT Committed (Gitignored)

```
.pm/tasks.db           # Local SQLite database (gitignored)
.wm/                   # Working memory/scratch files (gitignored)
.env.local             # Environment variables (gitignored)
```

**Why gitignored:**
- `tasks.db` - Local state, would cause merge conflicts
- `.wm/` - Transitory brainstorming, cleaned up after sprint
- `.env.local` - Secrets, local config

### Key Design Principle

> **`tasks.sql` seeds live with their specs (diffable, in git). `tasks.db` is gitignored — no merge conflicts.**

This means:
- **Specs + task seeds** = Source of truth (in git, diffable)
- **tasks.db** = Local working state (gitignored, regenerated from seeds)

---

## Typical Workflow

### Starting a New Feature

1. **Planning:**
   ```
   /pm-agent create a spec for user profile editing
   ```
   - Creates `.pm/todo/user-profiles/01-profile-editing.md`
   - Breaks into tasks
   - Creates `.pm/todo/user-profiles/tasks.sql`
   - Loads into `.pm/tasks.db`

2. **Implementation (Tab 1):**
   ```
   /tdd-agent
   ```
   - Picks first task
   - Implements with TDD
   - Commits: `feat(user-profiles): create profile form (Task #1)`

3. **Implementation (Tab 2 - Parallel):**
   ```
   /tdd-agent
   ```
   - Picks different task (no dependencies)
   - Works in parallel
   - Both update same `tasks.db`

4. **If Bug Found:**
   ```
   /bug-workflow investigate login issue
   ```
   - Investigates
   - Creates hotfix task
   - Back to `/tdd-agent` to fix

5. **Sprint Complete:**
   ```
   /pm-agent verify sprint completion
   ```
   - Verifies all tasks done
   - Cleans up `.wm/` files
   - Deletes completed specs (git history preserves them)

---

## Keeping Things Clean

### Automatic Cleanup

- **Sprint completion**: PM agent cleans up `.wm/` files
- **Spec deletion**: Completed specs deleted (git history preserves)
- **tasks.db**: Regenerated from `tasks.sql` seeds (never committed)

### Manual Cleanup

If things get messy:

```bash
# Clean up working memory
rm -rf .wm/*

# Reset tasks.db (regenerate from seeds)
rm .pm/tasks.db
sqlite3 .pm/tasks.db < .pm/schema.sql
sqlite3 .pm/tasks.db < .pm/todo/{sprint}/tasks.sql
```

### What Stays in Git

- All specs (`.pm/todo/**/*.md`)
- All task seeds (`.pm/todo/**/tasks.sql`)
- All skills (`skills/**/*.md`)
- All code changes (normal git workflow)

### What Never Goes to Git

- `tasks.db` (local state)
- `.wm/` files (scratch)
- `.env.local` (secrets)

---

## First Time Setup

1. **Create directories:**
   ```bash
   mkdir -p .pm/todo
   mkdir -p .wm
   ```

2. **Initialize tasks.db:**
   ```bash
   sqlite3 .pm/tasks.db < .pm/schema.sql
   ```
   (Schema should be in `.pm/schema.sql`)

3. **Start planning:**
   ```
   /pm-agent create a spec for [your feature]
   ```

4. **Start implementing:**
   ```
   /tdd-agent
   ```

---

## Tips

- **Multiple tabs**: Use separate tabs for parallel tasks
- **Check status**: `sqlite3 .pm/tasks.db "SELECT * FROM available_tasks;"`
- **Clean regularly**: PM agent cleans `.wm/` on sprint completion
- **Git history**: Even deleted specs are in git history
- **No merge conflicts**: `tasks.db` is gitignored, regenerated from seeds

