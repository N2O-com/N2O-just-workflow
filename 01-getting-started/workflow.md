# Workflow

## How the Three Agents Connect
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  pm-agent   │────▶│  tdd-agent  │────▶│    done     │
│  (planning) │     │   (build)   │     │             │
└─────────────┘     └──────┬──────┘     └─────────────┘
                          │
                          ▼ bug found
                   ┌─────────────┐
                   │bug-workflow │
                   │  (debug)    │
                   └──────┬──────┘
                          │ creates hotfix task
                          ▼
                   ┌─────────────┐
                   │  tdd-agent  │
                   │   (fix)     │
                   └─────────────┘
```

## Phase 1: Planning (PM Agent)

**Input**: Ideas in `.wm/` or backlog  
**Output**: Specs in `.pm/todo/{sprint}/`, tasks in SQLite

1. Capture ideas in `.wm/` or `.pm/backlog/`
2. Run `/pm-agent` to create feature specs
3. PM Agent writes specs to `.pm/todo/{sprint}/`
4. PM Agent breaks specs into atomic tasks (4-10 per spec)
5. Tasks loaded into SQLite with dependency graph
6. ~8 unblocked tasks become available

## Phase 2: Implementation (TDD Agent)

**Input**: Available task from SQLite  
**Output**: Tested code, committed
```
Pick task → RED → GREEN → REFACTOR → AUDIT → COMMIT
              │                         │
              │                         ▼
              │                   3 subagents:
              │                   • Pattern Compliance
              │                   • Gap Analysis
              │                   • Testing Posture
              │                         │
              │         ┌───────────────┤
              │         ▼               ▼
              │     Grade A         Grade B/C/F
              │         │               │
              │         ▼               │
              │      COMMIT ◀───────────┘
              │                    (loop back)
              ▼
         Write failing test
```

**Parallel work**: Open 8-10 terminals, each running `/tdd-agent` on different unblocked tasks.

## Phase 3: Verification

1. E2E tests run in background (Playwright)
2. Code review via pattern recognition — if it matches a pattern, it's good
3. Sprint completion report generated
4. Unknown tech debt → new spec for future sprint

## Phase 4: Debugging (Bug Workflow)

**When**: Bug found during implementation or testing  
**Output**: Hotfix task in SQLite, back to TDD Agent

1. Run `/bug-workflow` with bug description
2. Investigate (database queries, temp E2E tests, console logs)
3. Find root cause
4. Create hotfix task in `tasks.db`
5. Return to `/tdd-agent` to implement fix

## File Structure

### In Git (shared)
```
.pm/
├── schema.sql              # Database structure
└── todo/
    └── {sprint}/
        ├── feature-spec.md # Feature specification
        └── tasks.sql       # Task seed data

02-agents/                  # Agent SKILL.md files
03-patterns/                # Coding standards
scripts/git/                # Commit automation
```

### NOT in Git (local only)
```
.pm/tasks.db               # Live SQLite database
.wm/                       # Scratch files, working memory
.env.local                 # Secrets
```

**Key principle**: `tasks.sql` seeds are in git (diffable, reviewable). `tasks.db` is gitignored (no merge conflicts).

## Typical Flow Example
```bash
# Morning: Plan the sprint
/pm-agent create specs for user authentication feature

# Review the specs in .pm/todo/auth-sprint/
# Load tasks into database

# Afternoon: Implement in parallel
# Terminal 1:
/tdd-agent

# Terminal 2:
/tdd-agent

# Terminal 3:
/tdd-agent

# ... (up to 8-10 terminals)

# Bug shows up in terminal 2:
/bug-workflow login redirect failing after OAuth

# Bug workflow creates hotfix task, back to TDD:
/tdd-agent

# End of day: Verify
/pm-agent verify sprint completion
```
