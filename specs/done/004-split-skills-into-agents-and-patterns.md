# 004: Split skills/ into 02-agents/ and 03-patterns/

## Problem

The `skills/` folder contains two fundamentally different types of content under the same umbrella:

- **Agent workflows** (pm-agent, tdd-agent, bug-workflow) — define *what to do*: pick a task, write tests, audit, commit. These are invoked as slash commands and drive multi-phase workflows.
- **Coding patterns** (react-best-practices, web-design-guidelines) — define *how to write code*: avoid barrel imports, use `Promise.all`, animate SVG wrappers. These are referenced during implementation for standards compliance.

Grouping them together obscures the distinction. A new engineer looking at `skills/` sees five folders and doesn't know which ones are workflows they invoke vs. reference material they consult.

## Proposed Change

### Rename and split

```
# Before
skills/
├── pm-agent/
├── tdd-agent/
├── bug-workflow/
├── react-best-practices/
└── web-design-guidelines/

# After
02-agents/
├── README.md
├── pm-agent/
├── tdd-agent/
└── bug-workflow/
03-patterns/
├── README.md
├── react-best-practices/
└── web-design-guidelines/
```

### Add README.md to each

**02-agents/README.md**:
```markdown
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

\`\`\`bash
cp -r 02-agents/{agent-name} ~/.claude/skills/
\`\`\`
```

**03-patterns/README.md**:
```markdown
# Coding Patterns

Standards and best practices that agents reference during implementation.
These define *how* to write code, not *what* workflow to follow.

| Pattern Set | Contents |
|-------------|----------|
| react-best-practices | 45+ React/Next.js performance patterns |
| web-design-guidelines | UI/UX standards and component patterns |

## Installation

Copy to your project's skills directory:

\`\`\`bash
cp -r 03-patterns/{pattern-name} ~/.claude/skills/
\`\`\`
```

### Update CLAUDE.md

In the "Directory Structure" and "End-User Installation" sections, update the source paths:

```markdown
# Before
cp -r skills/{skill-name} ~/.claude/skills/

# After (agents)
cp -r 02-agents/{agent-name} ~/.claude/skills/

# After (patterns)
cp -r 03-patterns/{pattern-name} ~/.claude/skills/
```

Also update the directory structure example and naming conventions sections to reflect the new layout.

### Update README.md

The routing README (from change 002) already references `02-agents/` and `03-patterns/` in its directory table. No additional changes needed if 002 is implemented first.

## What Does NOT Change

- **The SKILL.md files themselves** — no content changes needed inside any skill
- **Internal `.claude/skills/` references** — all 20+ references in SKILL.md files point to the *installation destination* (`~/.claude/skills/`), not the source repo folder. These stay as-is.
- **The installation destination** — skills still get installed to `~/.claude/skills/` regardless of source folder name
- **How Claude discovers skills** — Claude Code loads skills from `~/.claude/skills/` based on YAML frontmatter, not source repo folder names
- **The `/mnt/skills/user/` path** — claude.ai platform path, unrelated to source repo structure

## Files Affected

| File | Change |
|------|--------|
| `skills/` | Rename/split into `02-agents/` and `03-patterns/` |
| `02-agents/README.md` | New |
| `03-patterns/README.md` | New |
| `CLAUDE.md` | Update directory structure and installation instructions |
| `README.md` | Update if not already handled by change 002 |

## Done When

- [ ] `skills/` directory no longer exists
- [ ] `02-agents/` exists with: `README.md`, `pm-agent/`, `tdd-agent/`, `bug-workflow/`
- [ ] `03-patterns/` exists with: `README.md`, `react-best-practices/`, `web-design-guidelines/`
- [ ] `CLAUDE.md` installation instructions reference `02-agents/` and `03-patterns/`
- [ ] `grep -r "skills/" *.md` returns no results (except historical references in changes/)
- [ ] All SKILL.md files still have correct YAML frontmatter (unchanged)

## Risk Assessment

**Low risk.** Verified that:
- No scripts reference the `skills/` path (checked all `.sh` and `.json` files)
- No config files reference it (`.claude/settings.local.json` only has permission rules)
- All `.claude/skills/` references inside SKILL.md files are installation-destination paths, not source-repo paths
- Claude Code discovers skills by installation path and YAML frontmatter, not source folder name

The only updates are documentation paths in `CLAUDE.md` and `README.md`.
