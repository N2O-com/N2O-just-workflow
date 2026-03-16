# Usage Tracking via Audit Logs

> Log every GraphQL operation and login event with page context so Ask AI can answer "who uses the platform, what do they check, and when?"

| Field | Value |
|-------|-------|
| Status | Active |
| Owner | — |
| Last Updated | 2026-03-11 |
| Depends On | RBAC Foundation (`rbac-v1/01-rbac-foundation.md`) |
| Enables | Ask AI usage analytics, admin visibility into platform adoption |

---

## Recent Changes

| Date | What changed | Section |
|------|-------------|---------|
| 2026-03-11 | Applied adversarial review decisions (Q1-Q15) | Design, Open Questions |
| 2026-03-11 | Initial spec | All |

---

## Goal

We want to understand how engineers use the N2O dashboard: who logs in, how often, what pages they visit, what data they query. This data should be queryable through the Ask AI so a manager can ask natural-language questions like "who's checking the platform the most?" and get real answers.

## Success Criteria

- Every GraphQL operation (query + mutation) is logged with: who, what operation, which page, when
- Every login event is logged
- Ask AI can answer: "who uses the platform most?", "what pages does Luke visit?", "who logged in this week?", "when do people typically check the platform?"
- No new tables — reuses existing `audit_logs` table with one added column

## Current State

- `audit_logs` table exists in Supabase (from RBAC migration 001) with: id, table_name, record_id, action, old_data, new_data, performed_by, performed_at
- Apollo audit-log plugin (`platform/src/plugins/audit-log.ts`) logs mutations only — skips queries entirely
- Plugin logs operation name as both `record_id` and `action`, stores variables as `new_data`
- Auth callback (`dashboard/src/app/auth/callback/route.ts`) does not log login events
- Dashboard Apollo client (`dashboard/src/lib/apollo-wrapper.tsx`) sends auth header but no page context
- Ask AI has no awareness of `audit_logs` — can't answer usage questions
- No `auditLogs` GraphQL query exists

## Design

**Approach**: Widen the existing audit-log plugin to capture all operations (not just mutations), add a `page` column via migration, send page context from the dashboard via an `X-Page-Route` request header, log logins in the auth callback, expose audit data via GraphQL, and teach the Ask AI about it.

**This spec covers:**
- Migration: add `page` column + composite index to `audit_logs`, add 90-day retention cron
- Plugin: expand to log queries + mutations with page context, skip meta-queries, skip dev mode, NULL variables for queries
- Dashboard: send `X-Page-Route` header (with SSR guard) with every GraphQL request
- Auth callback: log login events using service-role key, look up developer name from email
- GraphQL: add `auditLogs` query (admin-only, default limit 500, ISO 8601 validation)
- Ask AI: add schema awareness + example query + visit-counting guidance

**Out of scope:**
- Client-side analytics (click tracking, scroll depth, etc.)
- Engineer-facing audit trail ("your manager viewed your data") — can add later if desired
- Field-level change tracking on mutations
- Audit log viewer dashboard page (Ask AI covers the query need)

### How it works end-to-end

1. Engineer visits `/velocity` page in dashboard
2. Dashboard's Apollo client fires a `sprintVelocity` query with header `X-Page-Route: /velocity`
3. Express context factory reads the header and sets `contextValue.pageRoute = "/velocity"` (Q2)
4. Apollo Server audit plugin intercepts the response, reads `contextValue.pageRoute`, and inserts:
   ```
   table_name='graphql', record_id='sprintVelocity', action='query',
   new_data=NULL, performed_by='luke', page='/velocity'
   ```
   (`new_data` is NULL for queries per Q11; meta-queries like `auditLogs`, `me`, `IntrospectionQuery` are skipped per Q9)
5. Manager asks Ask AI: "What pages does Luke visit most?"
6. Ask AI queries `auditLogs(performer: "luke")`, uses `COUNT(DISTINCT)` guidance to deduplicate multiple queries per page load (Q10), returns answer

### Schema change

```sql
-- Migration 002: Audit logging enhancements
ALTER TABLE audit_logs ADD COLUMN page TEXT;
CREATE INDEX idx_audit_logs_page ON audit_logs(page);
CREATE INDEX idx_audit_logs_user_time ON audit_logs(performed_by, performed_at);

-- 90-day retention cron (Q13)
SELECT cron.schedule('audit-cleanup', '0 3 * * 0',
  $$DELETE FROM audit_logs WHERE performed_at < NOW() - INTERVAL '90 days'$$);
```

### Context interface change (Q2)

```typescript
// platform/src/context.ts — add pageRoute
export interface Context {
  db: SupabasePool;
  loaders: Loaders;
  currentUser: CurrentUser | null;
  pageRoute: string | null;  // NEW: from X-Page-Route header
}
```

In `platform/src/index.ts` context factory, read `req.headers['x-page-route']` and set `pageRoute`.

### Plugin changes

```
- Remove the mutation-only gate (line 9)
- Skip meta-queries: ["auditLogs", "IntrospectionQuery", "me"] (Q9)
- Skip dev mode: early return when dev-mode sentinel detected (Q5)
- Read page from contextValue.pageRoute (Q2), NOT request.http.headers
- Log operation type (query/mutation) as `action`
- Log operation name as `record_id`
- Set new_data to NULL for queries; for mutations, keep variables with deny-list redaction for sensitive keys (Q11)
- Store page in new column
```

### Apollo client changes (Q1)

```typescript
// In authLink (apollo-wrapper.tsx), add pathname header with SSR guard:
const authLink = setContext(async (_, { headers }) => {
  // ... existing auth logic ...
  return {
    headers: {
      ...headers,
      authorization: `Bearer ${token}`,
      "x-page-route": typeof window !== "undefined" ? window.location.pathname : "ssr",
    },
  };
});
```

### Login logging (Q3, Q4, Q12)

In `auth/callback/route.ts`, after successful `exchangeCodeForSession`:
- Create a service-role Supabase client (`SUPABASE_SERVICE_ROLE_KEY`) for the INSERT (Q4)
- Look up developer name from session email: `SELECT name FROM developers WHERE email = $1` (Q3)
- INSERT: `table_name='auth', record_id='login', action='login', performed_by=<developer_name>, page='/login'`
- Wrap in try/catch — fire-and-forget, log failures to console.error (Q12)

### GraphQL query (Q6, Q7, Q8)

```graphql
type AuditLog {
  id: Int!
  tableName: String!
  recordId: String!
  action: String!
  page: String
  performedBy: String
  performedAt: String!
}

# On Query type (admin-only, Q6):
auditLogs(limit: Int, performer: String, action: String, page: String, since: String): [AuditLog!]!
```

- Admin-only: `requireAdmin(ctx)` guard in resolver (Q6)
- Default limit 500, hard cap 5000: `Math.min(args.limit ?? 500, 5000)` (Q7)
- Validate `since` as ISO 8601: reject with clear error if `isNaN(new Date(since))` (Q8)

### Ask AI awareness (Q10, Q15)

Add to `schema-context.ts` categorization:
```typescript
if (["auditLogs"].includes(name)) return "Usage";
```

Add example query to schema context:
```graphql
# Platform usage: who visits which pages
{
  auditLogs(performer: "luke", since: "2026-03-01T00:00:00Z", limit: 100) {
    action recordId page performedBy performedAt
  }
}
```

Add to Ask system prompt query selection guide:
```
| "Who uses the platform?" / usage / logins / page visits | `auditLogs` — usage tracking: logins, page visits, query frequency per user. Rows = individual GraphQL operations, NOT page visits. For visit counts, use COUNT(DISTINCT (performed_by, page, DATE(performed_at))). | `activityLog` |
```

## Implementation Plan

| # | Task | Done When |
|---|------|-----------|
| 1 | Migration + plugin + header: Add `page` column, composite index, retention cron, expand plugin with skip-list/dev-guard/context-based page route, send `X-Page-Route` from dashboard with SSR guard | `audit_logs` rows appear for both queries and mutations with correct page values. Meta-queries (`me`, `auditLogs`) are NOT logged. Dev mode produces no audit rows. Manual verification: visit `/velocity`, check audit_logs table shows a row with `page='/velocity'` and `action='query'`. |
| 2 | Login logging + GraphQL query + Ask AI: Log login events via service-role client with name lookup, add admin-only `auditLogs` query with limit/validation, add Ask AI example + visit-counting guidance | Login creates audit_logs row with `performed_by=<developer_name>`. `auditLogs` query returns filtered results, rejects non-admins, validates `since` format. Ask AI answers "who logged in this week?" correctly. |

## Open Questions

1. ~~Separate table or reuse `audit_logs`?~~ **Resolved**: Reuse `audit_logs` — already has the right shape, just needs a `page` column.
2. ~~How to capture page context?~~ **Resolved**: `X-Page-Route` header from dashboard Apollo client — lightest approach, no new endpoints. Page route passed through Context interface, not plugin request object (Q2).
3. ~~Should we add a retention policy?~~ **Resolved**: Yes, 90-day retention via pg_cron weekly cleanup (Q13A). Trivial to add now, avoids unbounded growth.
4. ~~SSR safety for `window.location`?~~ **Resolved**: `typeof window` guard, falls back to `"ssr"` (Q1A).
5. ~~Who can query audit logs?~~ **Resolved**: Admin-only via `requireAdmin` guard (Q6A).
6. ~~Recursive logging of `auditLogs` query?~~ **Resolved**: Skip-list of meta-queries in plugin (Q9A).
7. ~~Identity consistency?~~ **Resolved**: Always use developer `name` as `performed_by`. Auth callback looks up name from email (Q3A).
8. ~~Variable logging for queries?~~ **Resolved**: `new_data = NULL` for queries, redacted for mutations (Q11A).
9. ~~Visit counting semantics?~~ **Resolved**: Rows = operations, not visits. Ask AI prompt includes `COUNT(DISTINCT)` guidance (Q10B).

## References

- Existing audit plugin: `platform/src/plugins/audit-log.ts`
- RBAC migration (audit_logs table): `platform/migrations/001-rbac-foundation.sql`
- Auth callback: `dashboard/src/app/auth/callback/route.ts`
- Apollo wrapper: `dashboard/src/lib/apollo-wrapper.tsx`
- Platform context: `platform/src/context.ts`
- Platform server setup: `platform/src/index.ts`
- Schema context: `platform/src/schema-context.ts`
- Ask route: `dashboard/src/app/api/ask/route.ts`
- Core types: `platform/src/schema/core-types.ts`
