# Overview

## What This Is

A three-agent system that coordinates planning, implementation, and debugging through a shared SQLite task database. Claude Code runs each agent by reading its SKILL.md file and following the workflow.
```
pm-agent     →  spec → tasks    (planning)
tdd-agent    →  task → code     (implementation)
bug-workflow →  bug  → task     (debugging)
```

## Why It Works

> "If Claude makes any decision as a developer, I want 95% of those decisions to already be documented in the codebase."

This is context management at scale. Every pattern documented means less time debugging, less time reviewing, and more time shipping.

## Sprint Cycle (~2 days)

| Phase | Duration | What happens |
|-------|----------|--------------|
| Planning | Few hours | Create 5-10 specs, break into atomic tasks, load into SQLite |
| Implementation | Few hours | Run 8-10 parallel terminals, each executing TDD workflow |
| Verification | Few hours | E2E tests, code review via pattern recognition, sprint report |

## Key Concepts

**SQLite Task Database** — Tasks stored in a queryable database instead of markdown checklists. Saves context, enables parallel execution, tracks dependencies. ~8 unblocked tasks available at any time.

**Progressive Disclosure** — Skills organized in folders of 4-10 markdown files. Claude chooses which to invoke based on the problem. Only relevant context loaded.

**3-Subagent Auditing** — Every task audited by parallel subagents checking patterns, gaps, and test quality. Can't commit without passing audit.

**Pattern Codification** — New patterns discovered during implementation are reviewed and added to skills. Knowledge compounds over time.

## Design Principles

1. **Database-Driven** — Task state in SQLite, not markdown. Enables queries, parallel work, no merge conflicts.

2. **Audit-Gated** — Can't commit without A-grade testing posture. Quality enforced by subagents, not discipline.

3. **Pattern Compounding** — Every sprint adds 5-10 patterns to skills. Knowledge compounds over time.

4. **Progressive Disclosure** — Only load context when needed. Skills are 4-10 files each, not monolithic documents.

## When to Create a New Pattern

A typical app has **50-250 patterns**. You should understand all of them.

### Codify When:

| Criteria | Example |
|----------|---------|
| **Reusable** (3+ future tasks) | "Mock TanStack Query hooks in component tests" |
| **Non-obvious** | "Test React Server Components with async data" |
| **Framework-specific** | "Zustand store with localStorage persistence" |
| **Architectural** | "RLS policy pattern for company-scoped data" |
| **Error-prone** | Common gotchas others will hit |

### Do NOT Codify When:

| Criteria | Example |
|----------|---------|
| **One-off** | Specific to single feature |
| **Trivial** | "Use ESLint", "add error handling" |
| **Library docs** | "PapaParse has a streaming mode" |
| **Too specific** | "Escape pipes in markdown tables for CSV preview" |
| **Implementation detail** | Business logic, not reusable pattern |

> **Rule of thumb**: If you debate whether to codify for >1 minute, skip it. Truly valuable patterns are obvious.

See `02-agents/tdd-agent/codify/antipatterns.md` for detailed examples of what NOT to document.

## Contributing

This is a core competency. We are investing heavily in improving these workflows.

### Adding Patterns

When you discover a reusable pattern during implementation:

1. Apply the criteria above (reusable, non-obvious, framework-specific)
2. Add to the appropriate skill file (10-30 lines per pattern)
3. Include: Problem, Solution, When to Use, Example

### Improving Workflows

When you find friction in the workflow:

1. Document the issue in `.wm/`
2. Propose a change to the relevant SKILL.md
3. Test the change over 2-3 sprints
4. Merge if it improves velocity
