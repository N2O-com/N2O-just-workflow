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
| [`01-getting-started/`](./01-getting-started/) | Overview, workflow, quickstart, setup |
| [`02-agents/`](./02-agents/) | Agent skill definitions (pm, tdd, bug) |
| [`03-patterns/`](./03-patterns/) | Coding standards (React, web design) |
| [`scripts/`](./scripts/) | Git commit automation |
| [`.pm/`](./.pm/) | SQLite schema, sprint specs, task seeds |
| [`specs/`](./specs/) | Product specifications |

## For AI Agents

See [CLAUDE.md](./CLAUDE.md) for agent instructions.

## License

Proprietary. N2O internal use only.
