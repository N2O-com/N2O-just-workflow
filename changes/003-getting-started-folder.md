# 003: Consolidate Docs into 01-getting-started/

## Problem

Onboarding documentation is split across three root-level files (`README.md`, `QUICKSTART.md`, `WORKFLOW.md`) with significant overlap:

- Both `QUICKSTART.md` and `WORKFLOW.md` explain the three agents
- Both describe the file structure and what's gitignored
- Both walk through a sprint cycle example
- Setup instructions are scattered between `README.md` (prerequisites, first sprint) and `QUICKSTART.md` (first time setup, tips)

A new engineer reads the same information 2-3 times in different files before getting started.

## Proposed Change

### Create `01-getting-started/` with four files

```
01-getting-started/
├── overview.md     — what the system is
├── workflow.md     — how the agents work together
├── quickstart.md   — commands to run, session examples
└── setup.md        — prerequisites and first-time setup
```

### File scope definitions

**overview.md** — Conceptual understanding (read once)
- What the three-agent system is and why it exists
- Sprint timing and cadence (~2 days)
- Key concepts: SQLite task tracking, pattern codification, progressive disclosure
- When to create new patterns (the codify criteria from current README)
- Design principles (database-driven, audit-gated, pattern compounding)

**workflow.md** — How the pieces connect (reference)
- The three-agent workflow diagram (from current `WORKFLOW.md`)
- Phase-by-phase breakdown (planning → implementation → verification)
- How agents hand off to each other (pm → tdd, tdd → bug-workflow → tdd)
- File structure: what's in git vs. gitignored (from current `QUICKSTART.md`)
- The typical flow example (from current `WORKFLOW.md`)

**quickstart.md** — What to type (action-oriented)
- How to invoke each agent (slash commands + natural language triggers)
- Example sessions showing real usage
- Parallel execution: how to use multiple tabs
- Common queries (`SELECT * FROM available_tasks`, `SELECT * FROM sprint_progress`)
- Tips section (from current `QUICKSTART.md`)

**setup.md** — One-time setup (do once, never read again)
- Prerequisites (Claude Max subscription, terminal with tabs, SQLite)
- First-time setup commands:
  ```bash
  mkdir -p .pm/todo .wm
  sqlite3 .pm/tasks.db < .pm/schema.sql
  ```
- How to verify it's working (run a query, invoke an agent)
- Table of what goes where:
  | Item | Location | In Git? |
  |------|----------|---------|
  | Task database | `.pm/tasks.db` | No |
  | Sprint specs | `.pm/todo/{sprint}/` | Yes |
  | Task seeds | `.pm/todo/{sprint}/tasks.sql` | Yes |
  | Working memory | `.wm/` | No |
  | Skills | `02-agents/`, `03-patterns/` | Yes |
- Manual cleanup instructions (reset tasks.db, clear .wm/)

### Delete root-level files

- Delete `QUICKSTART.md` (content moves to `01-getting-started/quickstart.md` and `setup.md`)
- Delete `WORKFLOW.md` (content moves to `01-getting-started/workflow.md` and `overview.md`)
- Update `README.md` links to point to `01-getting-started/`

## Files Affected

| File | Change |
|------|--------|
| `01-getting-started/overview.md` | New — conceptual content from README + WORKFLOW |
| `01-getting-started/workflow.md` | New — workflow detail from WORKFLOW.md |
| `01-getting-started/quickstart.md` | New — practical content from QUICKSTART.md |
| `01-getting-started/setup.md` | New — setup content from README + QUICKSTART |
| `QUICKSTART.md` | Delete |
| `WORKFLOW.md` | Delete |
| `README.md` | Update links |

## Done When

- [ ] `01-getting-started/` directory exists with four files: `overview.md`, `workflow.md`, `quickstart.md`, `setup.md`
- [ ] Root-level `QUICKSTART.md` deleted
- [ ] Root-level `WORKFLOW.md` deleted
- [ ] `README.md` links point to `01-getting-started/` (not root-level files)
- [ ] No duplicate content across the four files (grep for repeated paragraphs)
- [ ] Each file has a clear scope header explaining what it covers

## Notes

- The key discipline is keeping each file's scope distinct. The main risk is `quickstart.md` and `setup.md` overlapping — the line is: setup = things you do once to prepare the environment, quickstart = things you do every time you start working.
- The numbered prefix (`01-`) gives a clear reading order when browsing the repo. It also groups these files visually before `02-agents/` and `03-patterns/`.
- Content should be deduplicated during the move, not just copy-pasted. The current files have ~40% overlap.
