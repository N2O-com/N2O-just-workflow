# N2O AI Development Workflow

A Claude Code workflow that uses three AI agents to plan, build, and debug software. Achieves 4-5x developer productivity.

For why this matters and the strategic value, see [BENEFITS.md](./BENEFITS.md).

## The Three Agents

| Agent | Command | What it does |
|-------|---------|--------------|
| PM Agent | `/pm-agent` | Plans features, writes specs, creates tasks |
| TDD Agent | `/tdd-agent` | Implements code using test-driven development |
| Bug Workflow | `/bug-workflow` | Investigates and fixes bugs |

## Directory Map
```
01-getting-started/   ← Read first (setup + how it works)
02-agents/            ← The three agents (use daily)
03-patterns/          ← React/Next.js reference patterns (look up as needed)
scripts/              ← Git automation
.pm/                  ← Task database infrastructure
specs/                ← Feature specifications
```

## Quick Start

1. **Install Claude Code** — `irm https://claude.ai/install.ps1 | iex` (Windows) or `curl -fsSL https://claude.ai/install.sh | bash` (Mac/Linux)
2. **Set up your project** — See [01-getting-started/setup.md](./01-getting-started/setup.md)
3. **Start planning** — Run `/pm-agent create a spec for [your feature]`
4. **Start building** — Run `/tdd-agent`

For full details, start with [01-getting-started/overview.md](./01-getting-started/overview.md).
