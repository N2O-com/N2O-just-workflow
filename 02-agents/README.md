# Agent Skills

Workflow definitions for the three Claude agents. Each agent is invoked via
slash command and follows a structured multi-phase process.

| Agent | Invoke | Purpose |
|-------|--------|---------|
| pm-agent | `/pm-agent` | Sprint planning, spec writing, task breakdown |
| tdd-agent | `/tdd-agent` | TDD implementation with 3-subagent auditing |
| bug-workflow | `/bug-workflow` | Root cause investigation and debugging |

Each agent has a `SKILL.md` that defines its workflow and supporting files
for templates, subagent prompts, and reference material.

## Installation

Copy to your project's skills directory:
```bash
cp -r 02-agents/{agent-name} ~/.claude/skills/
```
