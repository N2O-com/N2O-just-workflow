## Development Workflow Overview

A multi-agent system for planning, implementing, and debugging. Three agents work together:

### The Three Agents

```
pm-agent:     spec → tasks
bug-workflow:  bug → tasks  
tdd-agent:     task → code
```

### 1. PM Agent (Planning Phase)

**Purpose**: Feature planning and task breakdown

**Workflow**:
```
Ideas (.wm/) → Backlog → Specs (.pm/todo/) → Tasks (tasks.db) → Implementation
```

**Key Steps**:
1. **Ideation**: Capture ideas in `.wm/` or `.pm/backlog/`
2. **Code Audit**: Check existing code before speccing
3. **Spec Writing**: Create feature specs in `.pm/todo/{sprint}/`
4. **Pre-Task Verification**: Audit specs for patterns, MECE, completeness
5. **Task Breakdown**: Convert specs to tasks in SQLite (`tasks.db`)
6. **Post-Load Audit**: Verify dependencies, check for orphans/cycles
7. **Monitor Sprint**: Track progress, unblock tasks
8. **Sprint Completion**: Verify, clean up, close sprint

**Output**: Tasks in `tasks.db` ready for implementation

---

### 2. TDD Agent (Implementation Phase)

**Purpose**: Implement tasks using Test-Driven Development

**Workflow**:
```
Pick Task → RED → GREEN → REFACTOR → AUDIT → FIX → CODIFY → COMMIT → Next Task
```

**Key Phases**:
1. **RED**: Write failing tests (with Litmus Test to prevent fake tests)
2. **GREEN**: Implement minimal code to pass tests
3. **REFACTOR**: Clean up code without changing behavior
4. **AUDIT**: 
   - Quality checks (`pnpm typecheck`, `pnpm check`)
   - 3 parallel subagent audits (Pattern Compliance, Gap Analysis, Testing Posture)
5. **FIX AUDIT**: Loop until Testing Posture grade is A (required)
6. **CODIFY**: Report new patterns found (user reviews before documenting)
7. **COMMIT**: Conventional commit with task reference
8. **REPORT**: Final summary of work done

**Special Features**:
- **Parallel Execution**: Multiple tabs can work on different tasks simultaneously
- **Subagents**: 3 Sonnet subagents run audits in parallel (auditing only, not implementation)
- **Database Tracking**: Updates `tasks.db` with status, audit results, patterns found
- **Pattern Documentation**: Identifies reusable patterns for future tasks

**Escalation**: If can't reproduce bug → escalates to `bug-workflow`

---

### 3. Bug Workflow (Debugging Phase)

**Purpose**: Investigate bugs and find root cause

**Workflow**:
```
Reproduce → Investigate → Scope → Hypothesis → Task → Back to tdd-agent
```

**Key Phases**:
1. **REPRODUCE**: Confirm bug exists, document steps
2. **INVESTIGATE**: 
   - Code reading
   - Database queries (Neon)
   - Temp E2E tests with screenshots/console capture
3. **SCOPE**: Identify affected files, test strategy
4. **HYPOTHESIS**: Confirm root cause theory
5. **TASK**: Generate task in `tasks.db` (sprint: `hotfix`)

**Capabilities**:
- Browser debugging via temp E2E tests
- Database query investigation
- Multi-service log correlation
- Deep debugging that tdd-agent doesn't do

**Output**: Task with root cause hypothesis → tdd-agent implements fix

---

### How They Work Together

```
┌─────────────────────────────────────────────────────────────┐
│                    PM AGENT (Planning)                      │
│  .wm/ → backlog/ → todo/ → VERIFY → tasks.db                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
              ┌─────────────────┐
              │   tasks.db      │
              │  (SQLite)       │
              └────────┬────────┘
                       │
        ┌──────────────┼──────────────┐
        │                             │
        ↓                             ↓
┌───────────────┐            ┌──────────────────┐
│  TDD AGENT    │            │  BUG WORKFLOW    │
│Implementation │            │   Debugging      │
│               │            │                  │
│ RED → GREEN → │            │ Reproduce →      │
│ REFACTOR →    │            │ Investigate →    │
│ AUDIT →       │◄───────────│ Task             │
│ COMMIT        │  escalates │                  │
└───────────────┘            └──────────────────┘
        │
        ↓
   (Next Task)
```

### Typical Flow Example

**Scenario**: Adding a new feature

1. **PM Agent**:
   - User: "I want to add user profile editing"
   - PM creates spec: `.pm/todo/user-profiles/01-profile-editing.md`
   - Breaks into tasks: "Create form", "Add validation", "Save to database"
   - Loads tasks into `tasks.db`

2. **TDD Agent** (multiple tabs can work in parallel):
   - Tab 1: Picks "Create form" task
   - RED: Writes failing test for form component
   - GREEN: Implements form
   - REFACTOR: Cleans up
   - AUDIT: Runs quality checks + 3 subagent audits
   - FIX: Improves tests until grade A
   - COMMIT: `feat(user-profiles): create profile form (Task #1)`
   - Moves to next task

3. **If Bug Found**:
   - TDD Agent: "Can't reproduce this bug in tests"
   - Escalates to Bug Workflow
   - Bug Workflow: Investigates with database queries, temp E2E tests
   - Finds root cause: "Missing validation on email field"
   - Creates hotfix task
   - Back to TDD Agent to implement fix

4. **Sprint Completion**:
   - PM Agent verifies all tasks complete
   - Runs E2E verification
   - Cleans up `.wm/` files
   - Closes sprint

### Key Principles

- **Separation of Concerns**: PM plans, TDD implements, Bug Workflow debugs
- **TDD Discipline**: Always write failing test first
- **Quality Gates**: Can't commit without A grade in Testing Posture
- **Pattern Learning**: Systematically documents reusable patterns
- **Database-Driven**: Task state in SQLite, not just markdown
- **Parallel Execution**: Multiple agents can work simultaneously on different tasks

This workflow enforces TDD, maintains quality through audits, and scales by allowing parallel work while keeping everything tracked in a database.