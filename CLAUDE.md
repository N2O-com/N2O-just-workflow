# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Cursor, Copilot, etc.) when working with code in this repository.

## Repository Overview

A multi-agent development workflow for Claude Code. Contains agent skills (workflows you invoke) and coding patterns (standards agents reference).

## Directory Structure
```
02-agents/                # Workflow agents (invoke via slash command)
  {agent-name}/
    SKILL.md              # Required: workflow definition
    templates/            # Report and spec templates
    subagent-prompts/     # Prompts for audit subagents
03-patterns/              # Coding standards (referenced during implementation)
  {pattern-name}/
    SKILL.md              # Required: pattern index
    rules/                # Individual pattern files
```

### Naming Conventions

- **Agent directory**: `kebab-case` (e.g. `pm-agent`, `tdd-agent`)
- **Pattern directory**: `kebab-case` (e.g. `react-best-practices`)
- **SKILL.md**: Always uppercase, always this exact filename
- **Scripts**: `kebab-case.sh` (e.g., `commit-task.sh`)

### SKILL.md Format
```markdown
---
name: {skill-name}
description: {One sentence describing when to use this skill. Include trigger phrases like "create spec", "implement task", etc.}
---

# {Skill Title}

{Brief description of what the skill does.}

## How It Works

{Numbered list explaining the skill's workflow}

## Usage

{Slash command and natural language triggers}

## Output

{What the agent produces}
```

### Best Practices for Context Efficiency

Skills are loaded on-demand — only the skill name and description are loaded at startup. The full `SKILL.md` loads into context only when the agent decides the skill is relevant. To minimize context usage:

- **Keep SKILL.md under 500 lines** — put detailed reference material in separate files
- **Write specific descriptions** — helps the agent know exactly when to activate the skill
- **Use progressive disclosure** — reference supporting files that get read only when needed
- **Prefer scripts over inline code** — script execution doesn't consume context (only output does)
- **File references work one level deep** — link directly from SKILL.md to supporting files

### Script Requirements

- Use `#!/bin/bash` shebang
- Use `set -e` for fail-fast behavior
- Write status messages to stderr: `echo "Message" >&2`
- Write machine-readable output (JSON) to stdout
- Include a cleanup trap for temp files

### End-User Installation

**Agents:**
```bash
cp -r 02-agents/{agent-name} ~/.claude/skills/
```

**Patterns:**
```bash
cp -r 03-patterns/{pattern-name} ~/.claude/skills/
```

**claude.ai:**
Add the skill to project knowledge or paste SKILL.md contents into the conversation.
