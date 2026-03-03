# Team Quickstart
> Zero to productive in one command.

## Prerequisites

macOS or Linux with `git`, `jq`, `sqlite3`, and [Claude Code](https://claude.com/claude-code) (`claude` CLI).
Run `n2o check <project-path>` to verify.

## First-Time Setup

If this is your first time using N2O on any machine, run `n2o setup` first. This configures auto-sync so the framework stays up to date automatically on every Claude Code session start.

```bash
/path/to/n2o setup
```

## Project Setup

```bash
/path/to/n2o init <your-project-path> --interactive --register
```

This creates directories, detects your project, asks your name, initializes the task DB, installs session hooks, and runs a health check.

## First Task

```bash
cd <your-project-path> && claude
```

On startup the session hook auto-claims the next available task and tells you which skill to invoke (`/tdd-agent`, `/bug-workflow`, etc.).

For implementation tasks, follow the TDD cycle:
**RED** -> **GREEN** -> **REFACTOR** -> **AUDIT** -> **COMMIT**

## What Gets Tracked

Every session automatically captures:
- Tokens used + estimated dollar cost
- Tool calls and skill invocations with versions
- User message count (brain cycles)
- Time to complete and testing posture grade

View metrics: `n2o stats`

## Updating

```bash
/path/to/n2o sync <your-project-path>
```

Config, CLAUDE.md, schema extensions, and task data are never overwritten.
