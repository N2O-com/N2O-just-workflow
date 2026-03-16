# Toggl Sync & Store

> Sync time tracking data from Toggl into Supabase Postgres so the dashboard reads from local storage instead of live API calls — eliminating rate limits, adding offline resilience, and enabling unbounded historical queries.

| Field | Value |
|-------|-------|
| Status | Active |
| Owner | whsimonds |
| Last Updated | 2026-03-12 |

---

## Recent Changes

| Date | What changed | Section |
|------|-------------|---------|
| 2026-03-12 | Adversarial review complete — 16 decisions resolved, spec updated | Design, Schema, Open Questions |
| 2026-03-11 | Initial spec | All |

---

## Goal

The time tracking dashboard currently makes live Toggl API calls on every page load and every 5-minute poll. This hits Toggl's 30-request/hour free plan limit, provides no data if Toggl is down, and limits queries to 60-day windows. Syncing to local Postgres solves all three problems and enables richer analytics by joining time data with the existing `developers`, `tasks`, and `projects` tables.

---

## Success Criteria

- Dashboard time tracking page loads entirely from Postgres (zero Toggl API calls on page load)
- Sync runs automatically and keeps data fresh within 5 minutes
- Historical data extends back to the start of the Toggl workspace (not just 60 days)
- Toggl API usage drops below 10 requests/hour under normal operation
- If Toggl is unreachable, dashboard still renders the last-synced data

---

## Current State

- All time tracking resolvers (`timeTrackingEntries`, `timeTrackingMembers`, `timeTrackingProjects`, etc.) call the Toggl REST API directly
- In-memory TTL cache: 4 minutes for entries, 1 hour for reference data — resets on server restart
- `developers` table has `time_tracking_user_id` (Toggl user ID) — only local link to Toggl
- Dashboard polls `timeTrackingEntries` and `timeTrackingDashboardActivity` every 5 minutes
- Capacity planner does not currently consume time data from Postgres

---

## Ideal State

A sync daemon runs continuously, pulling Toggl data into normalized Postgres tables. All dashboard queries read from Postgres with sub-second response times. The current timer is the only live API call (it must be real-time). Historical data is unbounded and joinable with project/task tables for capacity planning, burn-down charts, and team analytics. Sync status is visible in the dashboard's data health panel.

---

## Design

### What we're building

A periodic sync job in the platform server that pulls Toggl data into four new Postgres tables. Resolvers switch from live API calls to Postgres queries. The current timer and dashboard activity remain live Toggl calls.

**Trade-offs from ideal**: No real-time streaming (polling at 5-min intervals is sufficient). No historical backfill UI — initial backfill uses chunked time windows across multiple sync cycles. No conflict resolution (Toggl is authoritative; local data is overwritten on sync).

### Tables

Four new tables in Supabase Postgres:

**`tt_entries`** — Time entries (the core data)
```sql
CREATE TABLE tt_entries (
  id BIGINT PRIMARY KEY,              -- Toggl time entry ID
  description TEXT,
  start TIMESTAMPTZ NOT NULL,
  stop TIMESTAMPTZ,
  seconds INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER NOT NULL,           -- Toggl user ID (FK → developers.time_tracking_user_id)
  project_id INTEGER,                 -- Toggl project ID (logical FK → tt_projects.id, no constraint)
  tag_ids INTEGER[] DEFAULT '{}',
  billable BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,             -- Soft-delete for reconciliation (Q9)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tt_entries_start ON tt_entries(start);
CREATE INDEX idx_tt_entries_user ON tt_entries(user_id);
CREATE INDEX idx_tt_entries_project ON tt_entries(project_id);
CREATE INDEX idx_tt_entries_synced ON tt_entries(synced_at);
CREATE INDEX idx_tt_entries_running ON tt_entries(id) WHERE stop IS NULL;  -- Partial index for dashboard activity (Q15)
```

**`tt_projects`** — Toggl projects
```sql
CREATE TABLE tt_projects (
  id INTEGER PRIMARY KEY,             -- Toggl project ID
  name TEXT NOT NULL,
  client_id INTEGER,                  -- FK → tt_clients.id
  color TEXT,
  active BOOLEAN DEFAULT TRUE,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
```

**`tt_clients`** — Toggl clients
```sql
CREATE TABLE tt_clients (
  id INTEGER PRIMARY KEY,             -- Toggl client ID
  name TEXT NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
```

**`tt_tags`** — Toggl tags
```sql
CREATE TABLE tt_tags (
  id INTEGER PRIMARY KEY,             -- Toggl tag ID
  name TEXT NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
```

**`tt_sync_log`** — Tracks sync runs for observability
```sql
CREATE TABLE tt_sync_log (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  entries_upserted INTEGER DEFAULT 0,
  entries_failed INTEGER DEFAULT 0,   -- Per-batch failure tracking (Q11/Q16)
  projects_upserted INTEGER DEFAULT 0,
  clients_upserted INTEGER DEFAULT 0,
  tags_upserted INTEGER DEFAULT 0,
  error TEXT,
  sync_type TEXT NOT NULL DEFAULT 'incremental', -- 'full', 'incremental', or 'reconciliation'
  backfill_cursor TIMESTAMPTZ,        -- Tracks chunked backfill progress (Q8)
  backfill_complete BOOLEAN DEFAULT FALSE
);
```

**No foreign key constraints** between `tt_entries.project_id` and `tt_projects.id` — the Supabase Management API has no transaction support, so FK ordering would cause insert failures on partial syncs. Referential integrity is enforced in code by syncing reference data first and aborting entry sync if reference sync fails. Dashboard queries use `LEFT JOIN` as a safety net (Q14).

### Sync Logic

**Service**: `platform/src/services/toggl-sync.ts`

**Concurrency**: An in-memory `isSyncing` mutex prevents overlapping sync cycles. If the `setInterval` fires while a sync is running, the cycle is skipped. The `triggerTimeTrackingSync` mutation respects the same lock and returns `{ status: "already_syncing" }` if busy (Q3, Q4).

**Error handling**: Every sync run is wrapped in try/catch/finally. The `tt_sync_log` row is always finalized with `completed_at`, and on failure, the `error` column is populated (Q6).

**Sync order**: Reference data (projects, clients, tags) syncs first. If reference sync fails, entry sync is skipped for that cycle (Q14).

1. **Reference data sync** (projects, clients, tags): Full replace every sync. These are small lists (<100 items).

2. **Entry sync (incremental)**: Query Toggl Reports API for entries modified since `MAX(synced_at)` from `tt_entries`, using `>=` comparison (not `>`) to avoid losing entries modified in the same second. `ON CONFLICT DO UPDATE` makes the overlap harmless (Q5).

3. **Entry sync (chunked backfill)**: On first run (empty `tt_entries`), backfill in 3-month time chunks. Track `backfill_cursor` in `tt_sync_log` so subsequent cycles resume where the last left off. If a 429 is received mid-backfill, stop cleanly, record progress, and retry next cycle. Once cursor reaches present, set `backfill_complete = TRUE` and switch to incremental mode (Q8).

4. **Batch upserts**: Entries are upserted in batches of 200 rows using multi-row `INSERT ... VALUES ... ON CONFLICT DO UPDATE`. SQL length is validated under 500 KB before sending; if exceeded, the batch is split further. If a batch fails, it is logged and remaining batches continue. The next sync cycle's `>=` cursor re-fetches missed entries (self-healing) (Q11, Q16).

5. **Reconciliation**: Once daily, fetch all entries for the past 7 days from Toggl. Any local entries not present in Toggl's response are soft-deleted (`deleted_at = NOW()`). All resolvers filter `WHERE deleted_at IS NULL` (Q9).

6. **Schedule**: `setInterval` in the platform server at 5-minute intervals. No external cron needed.

7. **Cache invalidation**: After each sync cycle completes, call `pool.clearCache()` to bust the 30-second `SupabasePool` query cache so resolvers immediately return fresh data (Q10).

8. **Graceful shutdown**: On `SIGTERM`/`SIGINT`, clear the `setInterval`, await any in-progress sync with a 10-second timeout, and finalize the `tt_sync_log` row on timeout (Q7).

9. **Rate limit budget**: Each incremental sync cycle uses ~5-6 API calls. Backfill chunks stay under ~10 calls per cycle. Well within the 30/hr limit.

### Prerequisite: `escapeParam` array support

The `SupabasePool.escapeParam` function in `db.ts` must be extended to handle `Array.isArray(val)` and produce Postgres array literals (e.g., `'{123,456}'`). Without this, `tag_ids INTEGER[]` inserts will fail (Q1).

### Prerequisite: `SupabasePool.clearCache()`

Add a public `clearCache()` method to `SupabasePool` (the class already has `this.cache.clear()` in its `end()` method — just expose it) (Q10).

### GraphQL Changes

- **`TimeTrackingEntry.id`**: Change from `Int` to `ID!` (Toggl IDs exceed 2^31) (Q2)
- **`TimeTrackingEntry.billable`**: Add `billable: Boolean` (capture now, expose in UI later) (Q15 from generator)
- **`timeTrackingEntries`**: Add optional `limit: Int` and `offset: Int` arguments, default limit 5000 (Q13)
- **`triggerTimeTrackingSync` mutation**: Returns `TogglSyncStatus { status: String!, lastSyncAt: String, entriesUpserted: Int }` (Q4)

### Resolver Changes

| Resolver | Before | After |
|----------|--------|-------|
| `timeTrackingEntries` | Toggl Reports API | `SELECT FROM tt_entries WHERE deleted_at IS NULL` with limit/offset |
| `timeTrackingProjects` | Toggl API | `SELECT FROM tt_projects` |
| `timeTrackingClients` | Toggl API | `SELECT FROM tt_clients` |
| `timeTrackingTags` | Toggl API | `SELECT FROM tt_tags` |
| `timeTrackingMembers` | Toggl API + DB | Toggl API + DB (unchanged — member list is small, 1 call) |
| `timeTrackingDashboardActivity` | Toggl API | **Stays live** — different data contract than Reports API; 1 call/4min is cheap (Q12) |
| `timeTrackingCurrentTimer` | Toggl API | **Stays live** (must be real-time) |
| `timeTrackingMe` | Toggl API | Toggl API (unchanged — 1 call, cached 1hr) |
| `timeTrackingWorkspace` | Toggl API | Toggl API (unchanged — 1 call, cached 1hr) |

### Data Health Integration

Add `tt_entries` and `tt_sync_log` to the existing `dataHealth` query so the dashboard's health panel shows sync freshness.

### What stays live

- **Current timer** (`timeTrackingCurrentTimer`): Must reflect real-time state
- **Dashboard activity** (`timeTrackingDashboardActivity`): Different data contract from Reports API, cheap to keep live
- **Me / Workspace**: Cached 1hr already, minimal API usage
- **Members**: Small list, merged with DB roles — keep live for now

---

## Schema

See table definitions in Design section above.

---

## Implementation Plan

| # | Task | Done When |
|---|------|-----------|
| 1 | Migration + prerequisites: create tt_entries, tt_projects, tt_clients, tt_tags, tt_sync_log tables; add array handling to `escapeParam`; add `clearCache()` to SupabasePool | Migration runs on Supabase, tables exist with indexes, `escapeParam` handles arrays, `clearCache()` is available |
| 2 | Sync service + server integration: toggl-sync.ts with chunked backfill + incremental sync + reconciliation + mutex + graceful shutdown + `triggerTimeTrackingSync` admin mutation | Sync runs on server start, entries appear in tt_entries, sync_log records success, mutation triggers sync on demand, shutdown awaits in-progress sync |
| 3 | Switch resolvers from live API to Postgres reads + GraphQL schema updates (ID!, limit/offset, billable) + data health integration + manual sync button in dashboard | Dashboard loads time tracking data from Postgres, dataHealth shows tt_entries freshness, sync button calls mutation and shows last sync time |
| 4 | E2E verification: dashboard renders from synced data, live resolvers still work, sync log visible in data health | Full page load with zero Toggl API calls (except live resolvers), historical data beyond 60 days queryable, deleted entries reconciled |

---

## Open Questions

1. ~~Should we sync `timeTrackingMembers` to a local table too, or keep it live?~~ **Resolved**: Keep live. Only ~10 members, 1 call/hr, already merges with `developers` table. No value duplicating.
2. ~~Should the initial backfill be time-bounded (e.g., last 1 year) or pull everything?~~ **Resolved**: Full history via chunked backfill (3-month windows per sync cycle).
3. ~~Should we expose a manual "sync now" mutation for admins, or is automatic-only sufficient?~~ **Resolved**: Both. Add a `triggerTimeTrackingSync` admin mutation and a manual sync button in the time tracking dashboard.
4. ~~Should `escapeParam` handle arrays for `tag_ids INTEGER[]`?~~ **Resolved**: Yes. Add `Array.isArray` branch to produce Postgres array literals. (Adversarial Q1)
5. ~~GraphQL `Int` overflow for Toggl entry IDs?~~ **Resolved**: Change `TimeTrackingEntry.id` to `ID!` scalar. (Adversarial Q2)
6. ~~How to prevent overlapping sync cycles?~~ **Resolved**: In-memory `isSyncing` mutex, shared by auto-sync and manual trigger. (Adversarial Q3, Q4)
7. ~~Cursor comparison loses same-second entries?~~ **Resolved**: Use `>=` with `ON CONFLICT` deduplication. (Adversarial Q5)
8. ~~Partial sync failure leaves orphaned sync_log rows?~~ **Resolved**: try/catch/finally guarantees `completed_at` and `error` are always set. (Adversarial Q6)
9. ~~Shutdown during sync?~~ **Resolved**: Clear interval + await with 10s timeout + finalize sync_log. (Adversarial Q7)
10. ~~Backfill rate-limit blow-out?~~ **Resolved**: Chunked backfill in 3-month windows with resumable cursor. (Adversarial Q8)
11. ~~Deleted entries diverge from Toggl?~~ **Resolved**: Daily reconciliation of past 7 days with soft-delete. (Adversarial Q9)
12. ~~SupabasePool cache serves stale data after sync?~~ **Resolved**: Add public `clearCache()` method, call after each sync. (Adversarial Q10)
13. ~~Non-atomic batches via Management API?~~ **Resolved**: Idempotent 200-row batches with per-batch error tracking; self-healing via `>=` cursor. (Adversarial Q11)
14. ~~Dashboard activity resolver contract differences?~~ **Resolved**: Keep live — different data shape, 1 call/4min is cheap. (Adversarial Q12)
15. ~~Unbounded result sets from Postgres?~~ **Resolved**: Add `limit`/`offset` args to `timeTrackingEntries`, default 5000. (Adversarial Q13)
16. ~~Orphan references on partial sync?~~ **Resolved**: No FK constraints; sync ref data first, abort entries if ref fails; use `LEFT JOIN`. (Adversarial Q14)
17. ~~Missing index for `OR stop IS NULL` queries?~~ **Resolved**: Add partial index `idx_tt_entries_running`. (Adversarial Q15)
18. ~~Management API body size limits?~~ **Resolved**: Conservative 200-row batch size + SQL length validation under 500 KB. (Adversarial Q16)
