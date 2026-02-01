# N2O AI Development Workflows

**A core competency that N2O is investing tens of thousands of hours into developing.**

This repository contains our systematized AI-powered development workflow, derived from proven methodologies that achieve **4-5x developer productivity gains** at a cost of **$400/month**.

---

## Why This Matters

### Strategic Value for N2O

1. **Compounding returns across the organization.** A 10% efficiency gain compounds across every engineer, every project, every sprint. We can push workflow improvements quickly across our entire team.

2. **$50k+ of value to every Cannon on Day 1.** We hand new engineers this system and make them 2x+ more effective per hour. They show up to their first engagement outperforming peers. Winners win. Better outcomes reflect on N2O and attract more talent.

3. **Customer-facing asset.** Lead magnet, expertise demonstration, potential consulting offering. Shows we're not another body shop—we have institutional knowledge about 4-5x developer output.

### The Core Insight

> "If Claude makes any decision as a developer, I want to know what decision it is. And I want 95% of those decisions to already be documented in the codebase. And wherever it makes those 5% of other decisions due to a new application, I want to review what decision it made and document it for the future."

This is **context management at scale**. Every pattern documented means less time debugging, less time reviewing, and more time shipping.

---

## Repository Contents

### Core Agent Skills

| Skill | Purpose | Status |
|-------|---------|--------|
| **pm-agent** | Sprint planning, spec writing, task breakdown into SQLite | Complete |
| **tdd-agent** | Test-driven implementation with 3-subagent auditing | Complete |
| **bug-workflow** | Root cause investigation with browser debugging | Complete |

### Supporting Skills

| Skill | Purpose | Status |
|-------|---------|--------|
| **react-best-practices** | 50+ React/Next.js performance patterns | Complete |
| **web-design-guidelines** | UI/UX standards and component patterns | Complete |

---

## How It Works

### The Three-Agent System

```
pm-agent:     spec → tasks (planning)
tdd-agent:    task → code  (implementation)
bug-workflow: bug  → task  (debugging)
```

### Sprint Cycle (~2 days)

1. **Planning Phase** (few hours)
   - Create sprint folder with 5-10 spec files
   - Break specs into atomic tasks (4-10 per spec)
   - Load tasks into SQLite with dependency graph
   - ~8 unblocked tasks available at any time

2. **Implementation Phase** (few hours)
   - Open 8-10 terminal windows in parallel
   - Each window runs TDD workflow: RED → GREEN → REFACTOR → AUDIT → COMMIT
   - 3 concurrent subagents audit each task (Pattern Compliance, Gap Analysis, Testing Posture)
   - New patterns flagged for review, then codified into skills

3. **Verification Phase** (few hours)
   - E2E tests run in background
   - Code review via pattern recognition (not line-by-line)
   - Visual QA via Storybook screenshots
   - Sprint completion report

### Key Innovations

**SQLite Task Database** — Tasks stored in queryable database instead of markdown checklists. Saves context, enables parallel execution, tracks dependencies.

**Progressive Disclosure** — Skills organized in folders of 4-10 markdown files. Claude chooses which to invoke based on the problem. Only relevant context loaded.

**3-Subagent Auditing** — Every task audited by parallel Sonnet subagents checking patterns, gaps, and test quality. Can't commit without passing audit.

**Pattern Codification** — New patterns discovered during implementation are reviewed and added to skills. Knowledge compounds over time.

---

## Cost Model

| Metric | Value |
|--------|-------|
| Monthly cost | $400 (2x Claude Max subscriptions) |
| Productivity gain | 4-5x vs. pre-LLM baseline |
| Subscription vs API savings | 5x cheaper |
| Sprint cycle | ~2 days |

> "If you pay for $200 a month plan, that's equivalent to $1,000 of API."

---

## Getting Started

See [QUICKSTART.md](./QUICKSTART.md) for invocation patterns.

See [WORKFLOW.md](./WORKFLOW.md) for the complete workflow overview.

### Prerequisites

1. **Claude Max subscription** ($200/month recommended)
2. **Terminal with tabs** (iTerm2, Windows Terminal)
3. **SQLite** (for task database)

### First Sprint

```bash
# 1. Create directories
mkdir -p .pm/todo
mkdir -p .wm

# 2. Initialize task database
sqlite3 .pm/tasks.db < .pm/schema.sql

# 3. Start planning
/pm-agent create a spec for [your feature]

# 4. Start implementing
/tdd-agent
```

---

## Gaps & Roadmap

### Currently Missing

| Component | Description | Priority |
|-----------|-------------|----------|
| **SQLite Schema** | `.pm/schema.sql` file defining tasks table, dependencies, views | High |
| **Storybook Visual Workflow** | Screenshot-based visual iteration for UI components | High |
| **Playwright Screenshot Scripts** | Automated visual capture for debugging | High |
| **Stack-Specific Patterns** | Zustand, TanStack Query, shadcn patterns (project-specific) | Medium |
| **Terminal Configuration** | Keybindings for 10-window parallel workflow | Low |

### Adaptation Questions

- How do we adapt for multi-engineer teams? (pattern sharing, conflict avoidance)
- How do we handle different tech stacks? (separate pattern docs per stack)
- What's the onboarding path for a new engineer? (learning curve)

---

## Architecture

```
skills/
├── pm-agent/                 # Planning agent
│   ├── SKILL.md              # Main workflow (1000+ lines)
│   └── templates/            # Spec and report templates
├── tdd-agent/                # Implementation agent
│   ├── SKILL.md              # TDD workflow (1200+ lines)
│   ├── codify/               # Pattern codification rules
│   ├── subagent-prompts/     # Audit subagent prompts
│   └── templates/            # Completion report templates
├── bug-workflow/             # Debugging agent
│   ├── SKILL.md              # Investigation workflow
│   ├── debugging/            # Debug techniques by type
│   ├── building/             # Environment setup
│   └── testing/              # Verification patterns
├── react-best-practices/     # React/Next.js patterns
│   ├── SKILL.md              # Pattern index
│   └── rules/                # 50+ individual patterns
└── web-design-guidelines/    # UI/UX standards
    └── SKILL.md
```

### Design Principles

1. **Progressive Disclosure** — Only load context when needed. Skills are 4-10 files each, not monolithic documents.

2. **Database-Driven** — Task state in SQLite, not markdown. Enables queries, parallel work, no merge conflicts.

3. **Audit-Gated** — Can't commit without A-grade testing posture. Quality enforced by subagents, not discipline.

4. **Pattern Compounding** — Every sprint adds 5-10 patterns to skills. Knowledge compounds over time.

---

## Contributing

This is a core competency. We are investing heavily in improving these workflows.

### Adding Patterns

When you discover a reusable pattern during implementation:

1. Check if it passes codification criteria (reusable, non-obvious, framework-specific)
2. Add to the appropriate skill file (10-30 lines per pattern)
3. Include: Problem, Solution, When to Use, Example

### Improving Workflows

When you find friction in the workflow:

1. Document the issue in `.wm/`
2. Propose a change to the relevant SKILL.md
3. Test the change over 2-3 sprints
4. Merge if it improves velocity

---

## References

- [CLAUDE.md](./CLAUDE.md) — Instructions for AI agents working in this repo
- [QUICKSTART.md](./QUICKSTART.md) — How to invoke each agent
- [WORKFLOW.md](./WORKFLOW.md) — Complete workflow overview

---

## License

Proprietary. N2O internal use only.
