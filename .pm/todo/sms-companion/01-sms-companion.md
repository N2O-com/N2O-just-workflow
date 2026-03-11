# SMS Companion Channel for Cannons

> Phase 1 of the Student Portal SMS module — an SMS interface that lets Cannons query N2O data (tasks, time tracking, sprint health) and receive daily digest notifications, powered by Claude Opus with RBAC enforcement.

| Field | Value |
|-------|-------|
| Status | Draft |
| Owner | whsimonds |
| Last Updated | 2026-03-11 |
| Depends On | `access_role` column (added inline — shared with RBAC Foundation) |
| Enables | Student Portal SMS Module (full), proactive coaching, mobile-first Cannon experience |

---

## Recent Changes

| Date | What changed | Section |
|------|-------------|---------|
| 2026-03-11 | Incorporated all 15 adversarial review decisions: webhook auth, Express refactor, inline RBAC, AST query validation, role-scoped schema context, confirmation/pagination state tables, rate limiting, fallback handling, idempotent digests, timezone cron, credential cleanup | All sections |
| 2026-03-11 | Removed `lead` role (Phase 1 = engineer + admin only). Set Claude model to Opus. Resolved all open questions. | Design, Schema, Open Questions |
| 2026-03-11 | Aligned with RBAC Foundation (`access_role`) and Student Portal specs. | Design, Schema |
| 2026-03-11 | Initial spec | All |

---

## Goal

Cannons shouldn't need to open the dashboard to know where they stand. An SMS companion gives them ambient awareness of their progress (time, tasks, sprint health) and lets them query or act on N2O data from their phone. Claude interprets inbound messages with RBAC enforcement — engineers see their own data, admins see everything.

This is Phase 1 of the Student Portal's SMS AI module (`student-portal-spec.md` Module 4). Phase 1 covers task/time queries and daily digest. Future phases add weekly plans, scoring, schedule exceptions, the `lead` role, and the full student experience.

---

## Success Criteria

- A Cannon can text "how many hours this week?" and get an accurate answer within 10 seconds
- A Cannon can text "what's my next task?" and get an available task with context
- Outbound daily digest lands at a configured time with hours logged, tasks completed, sprint pace
- RBAC enforced: engineer queries scoped to own data; admin queries span the team
- Mutations work: "claim task 5 on capacity-planner" executes the `claimTask` mutation through the GraphQL API (backed by Supabase)
- Destructive mutations (unclaim, reassign) require SMS confirmation; non-destructive (claim, status check) execute immediately
- Prompt injection attempts are blocked by server-side AST validation before query execution

---

## Prior Art

- **Slack bots (Standuply, Geekbot)**: Async standups via conversational interface. Good: natural language, scheduled prompts. Bad: requires Slack, rigid question format, no real data integration.
- **Twilio + GPT integrations**: Various SMS-to-AI demos. Good: universal reach, no app install. Bad: most are generic chatbots, no RBAC, no structured data access.
- **Linear notifications**: Push notifications for issue changes. Good: event-driven, low noise. Bad: pull-only (can't query back), app-dependent.

**Our differentiator**: Claude as an RBAC-aware query layer over structured project data — not a generic chatbot, but a scoped interface to real task/time/sprint state.

---

## Current State

- **RBAC Foundation spec** (`rbac-v1/01-rbac-foundation.md`) defines auth plumbing: Supabase Auth magic links, `access_role` column (`admin` | `engineer`), scoped resolvers, nav filtering. Status: Draft, not yet implemented.
- **Student Portal spec** (`student-portal-spec.md`) defines the full vision including SMS AI (Module 4) with Student/Lead/Admin permission model, weekly plans, scoring, comp. Status: Backlog.
- **Developers table** exists with `name`, `full_name`, `role` (frontend/backend/fullstack), skills, `time_tracking_user_id`. No phone number, no `access_role` yet.
- **Time tracking** is live via Toggl API with caching. Per-developer: hours today/week/last week, 3-week avg, on-target %, sparkline trends. Role-based targets (Leadership 25hr, Developer 35hr, Non-developer 30hr).
- **Task database** has 27+ analytics views: sprint_progress, developer_velocity, estimation_accuracy, developer_quality, available_tasks, etc. All tables referenced in this spec are in **Supabase**. The `.pm/schema.sql` file defines the schema shape but the runtime store is Supabase via HTTP.
- **Platform API** is Apollo Server 5 standalone (no Express routes, uses `startStandaloneServer`). All data access is GraphQL. Toggl service (`toggl-api.ts`) provides a good pattern for external service integration.
- **Credential issue**: `db.ts` has a hardcoded Supabase Management API token committed to version control. Must be remediated before adding a new HTTP endpoint.
- **Twilio**: n2olabs.com has Privacy Policy, Terms of Service, and SMS Policy. Toll-free number verification in progress; will eventually migrate to a 202 number.
- **No notification infrastructure** exists — no SMS, email, push, or webhook inbound handling.

---

## Ideal State

A Cannon's relationship with N2O is ambient. They get a morning text: "You have 3 tasks left on capacity-planner. You logged 6.2 hrs yesterday, on pace for 35 this week." They reply "what's next?" and get their top unblocked task with description and done_when. At end of week they get a digest: tasks completed, hours logged, estimation accuracy, sprint progress. Admins text "team status" and see who's on pace, who's blocked, and sprint completion percentages. Everything is conversational, not menu-driven. Claude understands context and scopes responses to the Cannon's role.

---

## Design

### Relationship to Other Specs

This spec adds the `access_role` and `phone_number` columns to the `developers` table inline — no dependency on RBAC Foundation shipping first. If RBAC Foundation has already added `access_role` when this ships, the migration is a no-op for that column. SMS uses phone number as identity (no Supabase Auth sessions needed for the SMS path). RBAC Foundation later adds dashboard auth on top of the same `access_role` column.

| Spec | Provides | This spec uses |
|------|----------|---------------|
| RBAC Foundation | `access_role` column (shared), Supabase Auth, scoped resolvers | Same `access_role` column; SMS adds it inline if not yet present |
| Student Portal | Full SMS AI vision (7 modules) | Architecture and permission model; we build the foundation here |

### Architecture

```
Cannon's phone
    ↕ SMS
Twilio (existing toll-free → 202 number)
    ↕ webhook POST (X-Twilio-Signature validated)
Express server (replaces startStandaloneServer)
    ├── /graphql (Apollo expressMiddleware)
    └── /sms/inbound (SMS webhook handler)
            ↓
        Rate limiter (10 msgs / 5 min per number)
            ↓
        Twilio signature validation
            ↓
        Check for "YES" → pending_confirmations lookup
        Check for "MORE" → sms_context pagination lookup
            ↓
        Identity Resolution (phone → developer → access_role)
            ↓
        Claude Opus (role-scoped schema context + RBAC rules)
            ↓
        AST validation (query allowlist per role)
            ↓
        GraphQL execution (against Supabase via existing resolvers)
            ↓
        Response formatted for SMS (<=320 chars, or paginated)
            ↕
        Twilio send response
            ↓
        Log to sms_log (best-effort)
```

### Trade-offs from ideal

- **No conversation memory across SMS sessions** (defer) — each inbound message is stateless. Exception: minimal state for confirmation flow and MORE pagination (5-10 min TTL).
- **No relay/forwarding between Cannons** (defer) — Cannons can't message each other through the system.
- **Outbound is cron-based, not event-driven** (Phase 1) — daily digest via cron. Event-driven (task unblocked, sprint completed) is Phase 2.
- **Admin-registered enrollment only** (Phase 1) — no self-registration. Admins add phone numbers via mutation or direct DB update.
- **Two roles only** (Phase 1) — `engineer` and `admin`. The `lead` role is deferred to Phase 2.

### This spec covers

- Prerequisite: credential cleanup in `db.ts`
- Express migration (replace `startStandaloneServer`)
- Twilio SMS send/receive with signature validation
- Inbound message handling with Claude Opus + RBAC
- Server-side AST query validation (allowlist per role)
- Role-scoped schema context builder
- Identity resolution (phone → developer → permissions)
- Confirmation flow with pending state and expiry
- MORE pagination with shared state table
- Per-number rate limiting
- API failure fallback (retry + static message)
- Outbound daily digest (minute-resolution cron with timezone support)
- Idempotent digest sends via sms_log deduplication
- Schema changes (access_role, phone_number, notification_preferences, sms_log, sms_context)

### Out of scope

- RBAC Foundation dashboard auth (login, sessions, middleware) → `rbac-v1/01-rbac-foundation.md`
- Weekly plans, scoring, comp, schedule exceptions → `student-portal-spec.md` (future phases)
- `lead` role (Phase 2)
- Event-driven notifications (Phase 2)
- Multi-turn conversation memory (beyond confirmation/pagination)
- Cannon-to-Cannon relay
- Dashboard admin UI for notification preferences
- International SMS / WhatsApp fallback

---

### Component 0: Prerequisite — Credential Cleanup

**Before adding any new HTTP endpoint**, remove the hardcoded Supabase Management API token from `db.ts`. The token (`sbp_0432...`) is committed to version control. Adding an Express route expands the attack surface.

**Actions**:
- Remove hardcoded fallbacks in `db.ts` lines 4-7
- Require `SUPABASE_REF` and `SUPABASE_ACCESS_TOKEN` from environment variables
- Throw on startup if either is missing (matches `toggl-api.ts` pattern)
- Rotate the compromised token in the Supabase dashboard
- Add both vars to a `.env.example` file

---

### Component 1: Express Migration + Twilio Infrastructure

**Express migration**: Replace `startStandaloneServer` with Express + `expressMiddleware` from `@apollo/server/express4`. This is a **moderate refactor** of `index.ts` — not a small plumbing change. Changes:

- Create Express app
- Mount Apollo via `app.use('/graphql', expressMiddleware(server, { context }))`
- Mount SMS webhook via `app.post('/sms/inbound', smsHandler)`
- Replace `startStandaloneServer` with `http.createServer(app).listen(PORT)`
- Update graceful shutdown to call `server.stop()` and `httpServer.close()`

**Twilio number**: Existing toll-free number (verification in progress), migrating to 202 number. Identity resolved by `From` phone number.

**Webhook authentication**: Validate every inbound request using `twilio.webhook()` Express middleware, which checks the `X-Twilio-Signature` header against `TWILIO_AUTH_TOKEN`. Requests failing validation return 403 before identity resolution runs. This prevents forged `From` numbers from being used for privilege escalation.

**Outbound**: Twilio REST API via new `twilio-api.ts` service (follows `toggl-api.ts` pattern — error handling, retry logic).

**SMS compliance**: n2olabs.com Privacy Policy, ToS, and SMS Policy already exist. Twilio handles STOP/START keywords automatically at the carrier level.

**Required environment variables** (new):
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `ANTHROPIC_API_KEY`

---

### Component 2: Identity Resolution & RBAC

**Phone → Developer mapping**: Add `phone_number` column (UNIQUE, E.164 format) to `developers` table in Supabase. When SMS arrives, look up developer by phone number. Unknown numbers get: "This number isn't registered with N2O. Contact your admin."

**E.164 validation**: The `registerPhone` mutation validates format with regex `^\+[1-9]\d{1,14}$`. Rejects invalid formats. Returns clear error if number is already registered to another developer.

**Enrollment**: Admin-registered. Admins add phone numbers via `registerPhone` GraphQL mutation or direct DB update. No self-registration in Phase 1.

**RBAC roles** — added inline (same `access_role` column RBAC Foundation will use):

| Role | Can see | Can mutate | Example queries |
|------|---------|------------|-----------------|
| `engineer` | Own tasks, own time data, sprint progress (aggregate) | Claim own tasks (immediate), unclaim own tasks (confirmed) | "my hours", "my next task", "sprint status" |
| `admin` | Everything, all engineers' data | Everything (destructive mutations confirmed) | "team status", "who's blocked?", "assign task 5 to luke" |

**Mutation confirmation**: Non-destructive mutations (claim task, check status) execute immediately. Destructive mutations (unclaim, reassign, role changes) create a `pending_confirmations` entry with 5-minute TTL and prompt: "Unclaim task 5 on capacity-planner? Reply YES within 5 min to confirm."

**Enforcement — three layers (defense in depth)**:
1. **Role-scoped schema context**: Claude only sees queries/mutations allowed for the role (Component 3)
2. **AST query validation**: Server-side allowlist validates every Claude-generated query before execution (Component 3)
3. **Resolver-level RBAC**: Even if layers 1-2 fail, resolvers enforce `owner` scoping for engineers

---

### Component 3: Claude Query Layer

**Rate limiting**: Before any processing, check per-number rate limit. Track message timestamps per phone number in memory (`Map<string, number[]>`). Allow max 10 messages per 5-minute window. If exceeded, respond with static SMS: "You've sent too many messages. Please wait a few minutes." Do not call Claude. Log the rate-limited event.

**Special keyword handling** (before Claude):
- `YES` → Look up most recent unexpired entry in `sms_context` where `context_type = 'confirmation'` for this developer. If found, execute the stored mutation and mark as `executed`. If expired or none found, respond: "No pending action. Please resend your request."
- `MORE` → Look up most recent unexpired entry in `sms_context` where `context_type = 'pagination'` for this developer. If found, send next 320-char chunk and increment `page_index`. If expired or none found, respond: "Nothing to continue. Send a new question."
- `STOP` / `START` → Handled by Twilio at carrier level (never reaches our webhook).

**Inbound flow** (after rate limit + keyword checks):

1. Twilio webhook hits `/sms/inbound` with `From`, `Body` (signature already validated by middleware)
2. Resolve `From` → developer record (name, access_role, time_tracking_user_id)
3. Build Claude system prompt:
   - Developer identity and access_role
   - RBAC rules (what they can see/do)
   - **Role-scoped** schema context from `buildSmsSchemaContext(accessRole)` — engineers see only own-data queries; admins see all
   - Available mutations and their constraints
   - Response format rules (plain text, <=320 chars, no markdown)
4. Call Claude Opus to interpret the message and generate a GraphQL query or mutation
   - **On failure**: retry once with 5-second timeout. If both attempts fail, send static SMS: "N2O is temporarily unable to process your request. Try again in a few minutes." Log to `sms_log` with `status = 'failed'`. Return.
5. **AST validation**: Parse Claude's generated query with `graphql/language` `parse()`. Extract operation type and field names. Validate against per-role allowlist. If query contains unauthorized fields/mutations, reject and respond: "That request isn't available for your role." Log the attempt.
6. Execute the validated query against the GraphQL API (Supabase-backed resolvers)
7. Claude formats the result as a concise SMS response
   - If response exceeds 320 chars: store full text in `sms_context` (type: `pagination`, 10-min TTL), send first 300 chars + "\nReply MORE for details."
   - If mutation requires confirmation: store in `sms_context` (type: `confirmation`, 5-min TTL), send confirmation prompt instead of executing.
8. Send response via Twilio
9. Log to `sms_log` (best-effort — if log write fails, log error to stderr, do not suppress the SMS response)

**Claude model**: Opus. Quality of reasoning and RBAC adherence matters more than latency. Cannons are texting, not expecting instant responses.

**Role-scoped schema context** (`buildSmsSchemaContext(fields, accessRole)`):

| Role | Allowed queries | Allowed mutations |
|------|----------------|-------------------|
| `engineer` | `task`, `tasks` (own), `availableTasks`, `developer` (self), `sprint`, `sprints`, `timeTrackingEntries` (own userId), `timeTrackingCurrentTimer`, `timeTrackingProjects` | `claimTask`, `unclaimTask` (own, confirmed) |
| `admin` | All engineer queries + `developers`, `sprintVelocity`, `developerVelocity`, `developerQuality`, `estimationAccuracy`, `commonAuditFindings`, `timeTrackingMembers`, `timeTrackingEntries` (all) | All engineer mutations + `assignTask`, `updateTimeTrackingMember` |

**AST validation allowlist** (`sms-query-validator.ts`):
```typescript
function validateSmsQuery(query: string, role: 'admin' | 'engineer'): { valid: boolean; reason?: string }
```
Uses `parse()` from `graphql`, walks the AST, checks field names against the role's allowlist. Called between steps 4 and 6.

**System prompt structure**:
```
You are the N2O SMS assistant. You help {developer.full_name} (role: {access_role})
check their project status via text.

IDENTITY:
- Developer: {name}
- Role: {access_role}
- Toggl User ID: {time_tracking_user_id}

RULES:
- {RBAC rules based on access_role}
- Respond in plain text, max 320 characters
- No markdown, no emojis unless asked
- If the request is unclear, ask a clarifying question
- If the request is outside their permissions, say so politely
- For destructive mutations, output a confirmation prompt (do not execute directly)

AVAILABLE QUERIES:
{role-scoped schema context from buildSmsSchemaContext()}

AVAILABLE MUTATIONS:
{scoped list based on access_role}
```

---

### Component 4: Outbound Notifications (Daily Digest)

**Cron**: Runs **every minute** using `node-cron` with `'* * * * *'` schedule. On each tick:
1. Query `notification_preferences` for developers where `enabled = true` and current day of week matches `digest_days`
2. For each matching developer, check if current time in their `timezone` matches their `digest_time` (use `luxon` or `date-fns-tz` for timezone-aware comparison)
3. **Idempotency check**: Before sending, query `sms_log` for an outbound message where `developer = $1 AND message_type = 'digest' AND direction = 'outbound' AND created_at::date = CURRENT_DATE`. Skip if already sent.
4. Send digest via Twilio with 1-2 second stagger between messages

Minute-resolution handles DST automatically — digest times are local and evaluated at runtime against the IANA timezone.

**Digest content for engineers**:
```
Morning, {name}. Yesterday: {hours}hrs logged, {tasks_completed} tasks done.
This week: {week_hours}/{target}hrs ({pace_delta}).
Sprint {sprint}: {pct}% complete, {available} tasks ready.
```

**Digest content for admins** (adds team summary):
```
Team: {total_hours}hrs logged, {total_tasks} tasks done yesterday.
{blocked_count} blocked tasks. Sprint {sprint}: {pct}% complete.
Pacing: {on_pace_names} on track, {behind_names} behind.
```

---

### Component 5: SMS Response Formatting

SMS constraints:
- 160 chars per segment (multi-segment OK but adds cost)
- No rich formatting (no markdown, no HTML)
- Target: 1-2 segments (<=320 chars) for most responses

**Formatting rules for Claude**:
- Use abbreviations: "hrs", "wk", "avg"
- Use newlines sparingly (they count as chars)
- Numbers over descriptions: "3/5 done" not "three out of five tasks completed"
- If response exceeds 320 chars, first 300 chars + "\nReply MORE for details" (full text stored in `sms_context`)

---

## Schema

All tables live in **Supabase** (shared state). The `.pm/schema.sql` file defines the schema shape but the runtime store is Supabase via HTTP.

### Developers table changes

```sql
-- access_role: shared with RBAC Foundation (if already added, this is a no-op)
ALTER TABLE developers ADD COLUMN IF NOT EXISTS access_role TEXT
  DEFAULT 'engineer'
  CHECK (access_role IN ('admin', 'engineer'));

-- phone_number: E.164 format, unique (identity factor for SMS)
ALTER TABLE developers ADD COLUMN phone_number TEXT UNIQUE;
```

### New table: notification_preferences

```sql
CREATE TABLE IF NOT EXISTS notification_preferences (
    developer TEXT PRIMARY KEY REFERENCES developers(name),
    enabled BOOLEAN DEFAULT false,
    digest_time TEXT DEFAULT '08:00',              -- HH:MM local time
    digest_days TEXT DEFAULT 'Mon,Tue,Wed,Thu,Fri',
    quiet_start TEXT,                              -- HH:MM
    quiet_end TEXT,                                -- HH:MM
    timezone TEXT DEFAULT 'America/New_York',      -- IANA timezone
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### New table: sms_log

```sql
CREATE TABLE IF NOT EXISTS sms_log (
    id SERIAL PRIMARY KEY,
    developer TEXT REFERENCES developers(name),
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    message_type TEXT CHECK (message_type IN ('query_response', 'digest',
                            'confirmation', 'pagination', 'test', 'fallback',
                            'rate_limited')),
    message_body TEXT NOT NULL,
    twilio_sid TEXT,
    phone_number TEXT,                             -- E.164 format
    status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered',
                                     'failed', 'received')),
    claude_model TEXT,
    claude_query TEXT,                             -- GraphQL query Claude generated
    response_body TEXT,
    latency_ms INTEGER,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### New table: sms_context (confirmations + pagination)

```sql
CREATE TABLE IF NOT EXISTS sms_context (
    id SERIAL PRIMARY KEY,
    developer TEXT NOT NULL REFERENCES developers(name),
    context_type TEXT NOT NULL CHECK (context_type IN ('confirmation', 'pagination')),
    payload JSONB NOT NULL,                        -- mutation details or full response text
    page_index INTEGER DEFAULT 0,                  -- current page for pagination
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'expired')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Index for fast lookup by developer + type + status
CREATE INDEX idx_sms_context_lookup
  ON sms_context (developer, context_type, status)
  WHERE status = 'pending';
```

### GraphQL schema additions

```graphql
extend type Developer {
  phoneNumber: String
  accessRole: String!
  notificationPreferences: NotificationPreferences
}

type NotificationPreferences {
  enabled: Boolean!
  digestTime: String!
  digestDays: String!
  quietStart: String
  quietEnd: String
  timezone: String!
}

extend type Mutation {
  """Register phone number for SMS (admin-only). Validates E.164 format."""
  registerPhone(developer: String!, phoneNumber: String!): Developer

  """Update notification preferences (admin or self)"""
  updateNotificationPreferences(
    developer: String!
    enabled: Boolean
    digestTime: String
    digestDays: String
    quietStart: String
    quietEnd: String
    timezone: String
  ): NotificationPreferences

  """Send a test SMS to verify setup (admin-only)"""
  sendTestSms(developer: String!): Boolean
}
```

---

## Open Questions

1. ~~**Enrollment flow**~~ **Resolved**: Admin-registered.
2. ~~**Claude model choice**~~ **Resolved**: Opus.
3. ~~**Supabase vs SQLite**~~ **Resolved**: Supabase for all SMS tables.
4. ~~**Cost budgeting**~~ **Resolved**: No budget constraint.
5. ~~**Twilio number**~~ **Resolved**: Existing toll-free, migrating to 202.
6. ~~**Express migration**~~ **Resolved**: Replace `startStandaloneServer` with Express + `expressMiddleware`. Moderate refactor of `index.ts`.
7. ~~**Mutation safety**~~ **Resolved**: Confirm destructive only via `sms_context` table with 5-min TTL.
8. ~~**Opt-in compliance**~~ **Resolved**: n2olabs.com SMS Policy + Twilio carrier-level STOP/START.
9. ~~**Webhook authentication**~~ **Resolved**: Validate `X-Twilio-Signature` via `twilio.webhook()` middleware.
10. ~~**Prompt injection**~~ **Resolved**: Three-layer defense: role-scoped schema context, AST query allowlist validation, resolver-level RBAC.
11. ~~**Confirmation state**~~ **Resolved**: `sms_context` table with 5-min TTL for confirmations, 10-min for pagination.
12. ~~**Schema exposure**~~ **Resolved**: `buildSmsSchemaContext(accessRole)` returns filtered query/mutation subset per role.
13. ~~**API failure**~~ **Resolved**: Retry once + static fallback message. Log failure.
14. ~~**Digest deduplication**~~ **Resolved**: `message_type` column on `sms_log`, idempotency check before send.
15. ~~**Timezone handling**~~ **Resolved**: Minute-resolution cron with `luxon`/`date-fns-tz` timezone evaluation.
16. ~~**Rate limiting**~~ **Resolved**: In-memory per-number limit (10 msgs / 5 min). Static response when exceeded.
17. ~~**Data residency**~~ **Resolved**: All tables in Supabase. "tasks.db" reference removed.
18. ~~**Cross-store consistency**~~ **Resolved**: Accept eventual consistency. SMS log writes are best-effort.
19. ~~**Hardcoded credentials**~~ **Resolved**: Prerequisite cleanup — move to env vars, rotate compromised token.
20. ~~**RBAC dependency**~~ **Resolved**: Add `access_role` inline. No hard dependency on RBAC Foundation shipping first.

---

## References

- RBAC Foundation: `.pm/todo/rbac-v1/01-rbac-foundation.md`
- Student Portal (full vision): `.pm/backlog/student-portal/student-portal-spec.md`
- Toggl service pattern: `platform/src/services/toggl-api.ts`
- Schema context builder: `platform/src/schema-context.ts`
- Platform server entry: `platform/src/index.ts`
- DB connection (credential cleanup target): `platform/src/db.ts`
- Developer table: `.pm/schema.sql` (line 76)
- Time tracking resolvers: `platform/src/resolvers/time-tracking.ts`
- n2olabs.com: SMS Policy, Privacy Policy, Terms of Service
