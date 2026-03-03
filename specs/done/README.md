# Completed Work

Historical archive of shipped specs and implemented change proposals.

## Shipped Specs

| Spec | Description |
|------|-------------|
| [observability.md](observability.md) | workflow_events table, n2o stats CLI, 11 analytics views |

## Change Proposals

| # | Title | Summary |
|---|-------|---------|
| 001 | Internal READMEs | Added READMEs inside `scripts/` and `.pm/` |
| 002 | Routing README | Replaced 320-line README with a short routing document + `BENEFITS.md` |
| 003 | Getting-Started Folder | Consolidated `QUICKSTART.md` and `WORKFLOW.md` into `01-getting-started/` |
| 004 | Skills Split | Split `skills/` into `02-agents/` and `03-patterns/` |
| 005 | Task Claiming | Added `AND owner IS NULL` to `available_tasks` view + claim step |
| 006 | Reusability and Sync | `n2o init` bootstrapping, `n2o sync` updates, `.pm/config.json` |
| 007 | Developer Tracking | Developer skill ratings, estimation tracking, performance views |
| 008 | Online Task Database | Supabase hybrid sync (SQLite for agents, Supabase for humans) |
