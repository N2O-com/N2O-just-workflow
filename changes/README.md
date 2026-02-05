# Changes

Proposed changes to the N2O workflow system, handed off to Ella for implementation. Numbered in execution order.

## Summary

| # | File | TLDR | Priority |
|---|------|------|----------|
| 001 | `001-internal-readmes.md` | Add READMEs inside `scripts/` and `.pm/` so you can understand what's in each folder without reading other docs. | Optional |
| 002 | `002-routing-readme.md` | Replace the 320-line README with a short routing document (what is this, where to go, 4-step quickstart). Move the pitch/strategy content to a separate `BENEFITS.md`, referenced early in the README. | Optional |
| 003 | `003-getting-started-folder.md` | Consolidate `QUICKSTART.md` and `WORKFLOW.md` (which overlap ~40%) into `01-getting-started/` with four scoped files: overview, workflow, quickstart, setup. Delete the root-level originals. | Optional |
| 004 | `004-split-skills-into-agents-and-patterns.md` | Split `skills/` into `02-agents/` (pm-agent, tdd-agent, bug-workflow) and `03-patterns/` (react-best-practices, web-design-guidelines). Separates "what to do" from "how to write code." No technical risk — the folder name isn't load-bearing. | Optional |
| 005 | `005-task-claiming.md` | Add `AND owner IS NULL` to the `available_tasks` view and a claim step in the tdd-agent workflow. Prevents two parallel agents from picking the same task. Uses the existing `owner` column. | Optional |
| 006 | `006-reusability-and-sync.md` | Make the framework reusable across projects. `n2o init` bootstraps a new project (creates directories, copies skills, inits DB, scaffolds config). `n2o sync` pushes framework updates to all registered projects. Config file (`.pm/config.json`) stores project-specific commands so skills don't hardcode `pnpm typecheck`. | Later |
| 007 | `007-developer-tracking.md` | Developer "baseball cards" (skill ratings, strengths, growth areas), estimation tracking (`estimated_hours` vs actual), complexity classification, reversion counting, and per-person performance views. | Later |
| 008 | `008-online-task-database.md` | Connect to Linear (and eventually Asana/Jira) for multiplayer visibility. Hybrid architecture: SQLite for agents (fast, local), Linear for humans (dashboards, assignments). Direct API sync at task boundaries — not MCP in the hot path. | Later |

## Effort vs Impact

| # | Change | Effort | Impact | Bang for Buck |
|---|--------|--------|--------|---------------|
| 001 | Internal READMEs | Very low | Low | Decent |
| 002 | Routing README | Low | Medium — first thing everyone sees | **High** |
| 003 | Getting-started folder | Medium — dedup ~400 lines into four files | Medium | Moderate |
| 004 | Skills split | Low — move folders, update doc refs | Medium — structure becomes self-explanatory | **High** |
| 005 | Task claiming | Very low — one SQL line, few SKILL.md lines | High — fixes the only actual bug (parallel agents can duplicate work) | **Highest** |
| 006 | Reusability and sync | Medium — init script, sync script, config file, template updates | High — enables multi-project use without manual setup each time | **High** (when scaling) |
| 007 | Developer tracking | Medium — new table, columns, views, trigger | High long-term, low short-term — needs data to accumulate | Low near-term |
| 008 | Online task database | High — sync script, API integration, workflow redesign | High — unlocks multiplayer | Moderate |

## Execution Order

```
001 Internal READMEs ─────────────────────── (standalone)
002 Routing README ───────────────────────── (standalone)
003 Getting-Started Folder ───────────────── (depends on 002)
004 Skills Split ─────────────────────────── (depends on 002)
005 Task Claiming ────────────────────────── (standalone)
006 Reusability and Sync ─────────────────── (standalone) — LATER
007 Developer Tracking ───────────────────── (depends on 005) — LATER
008 Online Task Database ─────────────────── (depends on 005, 007) — LATER
```

001-005 are near-term. 006-008 are deferred but documented.

## Quick Wins

**Start here.** These four changes are low effort, standalone (no dependencies), and can be done in any order:

| # | Change | Why it's a quick win |
|---|--------|---------------------|
| 001 | Internal READMEs | Very low effort — just write two small files |
| 002 | Routing README | Low effort — restructure existing content, high visibility |
| 004 | Skills split | Low effort — move folders, update doc refs |
| 005 | Task claiming | Very low effort — one SQL line fixes the only actual bug |

003 depends on 002 and requires careful deduplication, so tackle it after 002.

## Notes on Later Items

**006 (Reusability and Sync):** The foundational change for multi-project use. Creates `n2o init` to bootstrap new projects and `n2o sync` to push framework updates. Should be done before 007 and 008 since it establishes the config file structure that those build on. Prioritize this when scaling beyond 2-3 projects.

**007 (Developer Tracking):** Before building this, Ella should research existing tools that handle developer performance tracking and estimation calibration — there may be something off-the-shelf that's better than a custom SQLite solution. Also worth checking whether Claude Code Team accounts offer any relevant shared analytics or tracking features. Note that personal Claude Code accounts are usually cheaper than Team accounts, so the team features would need to justify the cost difference.

**008 (Online Task Database):** Depends on 006 (needs config file for PM tool selection) and 007 (needs developer tracking for per-person sync). The proposal recommends hybrid architecture (SQLite for agents, Linear for humans, direct API sync at boundaries) over MCP in the hot path. See the full doc for the seven reasons why MCP shouldn't be in the execution loop.
