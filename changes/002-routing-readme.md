# 002: Routing README + BENEFITS.md

## Problem

The current `README.md` is 320 lines and tries to be everything at once: pitch, technical overview, architecture diagram, pattern writing guide, cost model, roadmap, and contributing guide. A new engineer has to read the whole thing to find what they need. The strategic/pitch content also drowns out the practical "how do I use this" information.

## Proposed Change

### 1. Slim down README.md to a routing document

The README becomes a short entry point that tells you what this is and where to go. It should include:

- 2-3 sentence description of what the system is
- Early reference to `BENEFITS.md` for why this matters
- 3-agent table (pm-agent, tdd-agent, bug-workflow)
- Directory map pointing to numbered folders
- 4-step quickstart snippet
- Link to `BENEFITS.md` for strategic context

Example structure:

```markdown
# N2O AI Development Workflows

A multi-agent development system that coordinates planning, implementation, and debugging
through a shared SQLite task database. Achieves 4-5x productivity gains — see
[BENEFITS.md](./BENEFITS.md) for why N2O is investing in this.

## The Three Agents

| Agent | Purpose | Invoke |
|-------|---------|--------|
| **pm-agent** | Sprint planning, spec writing, task breakdown | `/pm-agent` |
| **tdd-agent** | TDD implementation with automated auditing | `/tdd-agent` |
| **bug-workflow** | Root cause investigation and debugging | `/bug-workflow` |

## Repository Structure

| Directory | What's in it |
|-----------|-------------|
| `01-getting-started/` | Overview, workflow, quickstart, setup |
| `02-agents/` | Agent skill definitions (pm, tdd, bug) |
| `03-patterns/` | Coding standards (React, web design) |
| `scripts/` | Git commit automation |
| `.pm/` | SQLite schema, sprint specs, task seeds |
| `specs/` | Product specifications |

## Quick Start

\`\`\`bash
# 1. Create directories
mkdir -p .pm/todo .wm

# 2. Initialize task database
sqlite3 .pm/tasks.db < .pm/schema.sql

# 3. Start planning
/pm-agent create a spec for [your feature]

# 4. Start implementing
/tdd-agent
\`\`\`

See `01-getting-started/` for detailed setup and workflow guides.

## For AI Agents

See [CLAUDE.md](./CLAUDE.md) for agent instructions.

## License

Proprietary. N2O internal use only.
```

### 2. Create BENEFITS.md

Move the strategic/pitch content from the current README into `BENEFITS.md`. This includes:

- "Why This Matters" section (compounding returns, $50k+ value, customer-facing asset)
- The quote about documenting 95% of Claude's decisions
- Cost model ($400/month for 4-5x productivity)
- The "When to Create a New Pattern" guidance (codify criteria, format, examples)
- Gaps & Roadmap
- Adaptation Questions

This content is valuable but doesn't belong in the first thing someone reads when trying to use the tool.

## Files Affected

| File | Change |
|------|--------|
| `README.md` | Replace with routing document (~50 lines) |
| `BENEFITS.md` | New file with strategic content from current README |

## Done When

- [ ] `README.md` is under 80 lines and contains: description, agent table, directory map, quickstart, link to BENEFITS.md
- [ ] `BENEFITS.md` exists with strategic content (why this matters, cost model, roadmap)
- [ ] README references BENEFITS.md in the first 5 lines
- [ ] All internal links in both files resolve correctly

## Notes

- Keeping the file as `README.md` (not `START-HERE.md`) preserves GitHub's automatic rendering.
- The benefits reference appears early in the README (second line) so it's not buried.
- The "When to Create a New Pattern" section could alternatively go in `01-getting-started/overview.md` since it's operational guidance. Ella can decide based on what flows better.
