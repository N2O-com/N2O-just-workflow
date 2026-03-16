# NOS Repository Extraction

> Extract platform/ and dashboard/ into a standalone "NOS" repository, leaving N2O as a pure workflow framework.

| Field | Value |
|-------|-------|
| Status | Active |
| Owner | wiley |
| Last Updated | 2026-03-12 |
| Depends On | nos-transcript-sync (completed) |
| Enables | Independent NOS deploys, framework reuse across projects |

---

## Recent Changes

| Date | What changed | Section |
|------|-------------|---------|
| 2026-03-12 | Adversarial review resolved — 10 design decisions | Open Questions |
| 2026-03-12 | Initial spec | All |

---

## Goal

The N2O repo currently contains two things that shouldn't live together: the **workflow framework** (skills, scripts, task management, agent orchestration) and the **NOS product** (a GraphQL API + Next.js dashboard for developer analytics). Extracting NOS into its own repo enables independent development, deployment, and versioning — and lets N2O be reused as a framework in other projects without carrying product code.

---

## Success Criteria

- NOS repo builds, starts, and passes all tests with zero references to N2O framework paths
- N2O framework repo functions normally after removal of platform/ and dashboard/
- Both repos can be developed independently with no cross-repo imports
- Dashboard connects to platform API via env var (not hardcoded localhost)
- Platform tests use self-contained schema files (no `../../../.pm/` paths)
- All `N2O_*` env vars and user-visible strings rebranded to `NOS`

---

## Current State

- **platform/** has zero runtime coupling to N2O — all imports stay within `platform/src/`, production reads from Supabase
- **dashboard/** has zero code coupling — connects to platform via HTTP GraphQL only
- **Test coupling**: `platform/src/__tests__/test-helpers.ts` reads `../../../.pm/schema.sql` and `../../../.pm/migrations/004-data-platform.sql`
- **E2E test coupling**: `conversation-e2e.test.ts` has 3 N2O references — `collect-transcripts.sh`, `.pm/schema.sql`, and `test-n2o-transcripts.sh`
- **Stale scripts**: `platform/package.json` has a `migrate` script pointing to `../.pm/tasks.db`
- **Hardcoded URL**: `apollo-wrapper.tsx` hardcodes `http://localhost:4000/graphql`; `schema-context.ts` and `execute-query.ts` already use env vars but with different patterns
- **N2O branding**: `NEXT_PUBLIC_N2O_DEVELOPER`, `N2O_DEV_MODE`, `auth@n2o.com`, "Sign in to N2O", `n2o-ask-panel-open` sessionStorage key
- **Framework references**: `code-health` skill includes `platform/**` and `dashboard/**` in scan scope
- **Migration split**: `.pm/migrations/` has 14 files (some NOS-specific), `platform/migrations/` has 3 Supabase files
- **Dead code**: `N2O_CLI` constant in `conversation-e2e.test.ts` declared but never used
- **Seed data**: Migration 004 hardcodes `'n2o-just-workflow'` project row

---

## Design

**This is a surgical extraction, not a rewrite.** The coupling is already minimal — the work is mostly moving files, fixing a handful of paths, rebranding env vars, and creating the new repo structure.

**Trade-offs from ideal**: We won't set up CI/CD, Docker, or production deployment. The `.pm/migrations/` split is accepted as permanent (N2O keeps its full migration history, including orphaned NOS-specific migrations). No monorepo tooling — simple independent package.jsons.

**This spec covers**:
- Creating the NOS repo with platform + dashboard
- Fixing all coupling points (test paths, URLs, dead code, seed data)
- Rebranding N2O references to NOS across all code
- Splitting `conversation-e2e.test.ts` (resolver tests → NOS, bash collector tests → N2O)
- Extracting only NOS-relevant tables into test fixture schema
- Cleaning up N2O after extraction

**Out of scope**:
- CI/CD pipeline for NOS
- Docker/deployment configuration
- Supabase migration management tooling
- Migration consolidation (accepted as permanent split)
- N2O framework changes beyond removing platform/dashboard

### Coupling Points to Fix

| # | What | Where | Fix |
|---|------|-------|-----|
| 1 | Test schema path | `test-helpers.ts` lines 17-28 | Extract NOS-relevant tables into `platform/test-fixtures/nos-schema.sql`, update paths |
| 2 | Stale migrate script | `platform/package.json` line 10 | Remove |
| 3 | Hardcoded GraphQL URL | `apollo-wrapper.tsx`, `schema-context.ts`, `execute-query.ts` | Consolidate all 3 to use `NEXT_PUBLIC_GRAPHQL_URL` / `GRAPHQL_URL` consistently |
| 4 | E2E test split | `conversation-e2e.test.ts` | Golden-fixture resolver tests stay in NOS; bash collector + `test-n2o-transcripts.sh` tests stay in N2O |
| 5 | Dead code | `conversation-e2e.test.ts` line 23 | Delete unused `N2O_CLI` constant |
| 6 | Seed data pollution | Migration 004 `INSERT` | Remove `'n2o-just-workflow'` project row from NOS test fixture |
| 7 | N2O branding | ~10 locations across dashboard + platform | Rename all `N2O_*` env vars to `NOS_*`, update user-visible strings |
| 8 | Code-health scan scope | `.claude/skills/code-health` | Remove `platform/**` and `dashboard/**` |
| 9 | Backlog path references | `.pm/backlog/data-explorer.md`, `tasks-views.md` | Update/remove |
| 10 | `platform/reference/` | Capacity planner prototype files | Move to NOS |
| 11 | `supabase-schema.sql` | `platform/supabase-schema.sql` | Stays in NOS (already in platform/) |

### New Repo Setup

- Fresh initial commit referencing source SHA (no history preservation)
- Root `package.json` as convenience wrapper (no monorepo tool)
- Root `.env.example` documenting all env vars for both platform and dashboard
- `CLAUDE.md` with NOS-specific project context
- `platform/test-fixtures/nos-schema.sql` — only tables NOS tests need

---

## Implementation Plan

| # | Task | Done When |
|---|------|-----------|
| 1 | Decouple platform tests + split E2E + rebrand to NOS | `test-helpers.ts` reads from `platform/test-fixtures/nos-schema.sql` (NOS-only tables, no `n2o-just-workflow` seed row), `conversation-e2e.test.ts` split (golden-fixture tests stay, bash collector tests removed), all `N2O_*` env vars renamed to `NOS_*` across platform + dashboard, user-visible "N2O" strings updated, stale `migrate` script removed, dead `N2O_CLI` constant deleted, GraphQL URL consolidated across all 3 files, all platform tests pass, dashboard builds |
| 2 | Create NOS repo + scaffold + verify | NOS GitHub repo created with platform/ + dashboard/ + reference/, root package.json + .env.example + CLAUDE.md, `npm install && npm run build` succeeds in both subdirs, all platform tests pass in NOS context |
| 3 | Clean up N2O framework after extraction + E2E verify | platform/ + dashboard/ removed from N2O, code-health skill updated, backlog specs updated, CLAUDE.md updated, bash collector tests from conversation-e2e.test.ts moved to N2O test suite, N2O scripts still work (collect-transcripts.sh, sync, n2o CLI), no cross-repo references remain in either repo |

---

## Open Questions

1. ~~Should NOS use a monorepo tool (turborepo, nx)?~~ **Resolved**: No — simple independent package.jsons. Not enough complexity to justify tooling.
2. ~~Should we preserve git history?~~ **Resolved**: No — fresh initial commit with reference to source SHA. History interleaves framework + product too heavily.
3. Should the NOS repo be public or private?
4. ~~Where should Supabase migrations live?~~ **Resolved**: `platform/migrations/` in NOS. The `.pm/migrations/` split is accepted as permanent.
5. ~~E2E test coupling (3 points)?~~ **Resolved**: Split — golden-fixture resolver tests → NOS, bash collector tests → N2O.
6. ~~Schema copy strategy?~~ **Resolved**: Extract only NOS-relevant tables into `platform/test-fixtures/nos-schema.sql`.
7. ~~supabase-schema.sql?~~ **Resolved**: Stays in `platform/` — NOS owns it.
8. ~~Migration 004 seed data?~~ **Resolved**: Remove `'n2o-just-workflow'` project INSERT from NOS test fixture.
9. ~~N2O_CLI dead code?~~ **Resolved**: Delete.
10. ~~Migration ownership split?~~ **Resolved**: Accept as permanent. Document but don't consolidate.
11. ~~N2O branding?~~ **Resolved**: Rename everything to NOS — env vars programmatically, user-visible strings manually.

---

## References

- Completed sprint: `nos-transcript-sync` (decoupled conversation.ts from filesystem)
- Platform test helpers: `platform/src/__tests__/test-helpers.ts`
- Dashboard Apollo config: `dashboard/src/lib/apollo-wrapper.tsx`
- Framework schema: `.pm/schema.sql`
- N2O branding locations: `chat-adapter.ts`, `shell.tsx`, `login/page.tsx`, `index.ts`, `.env.local`
