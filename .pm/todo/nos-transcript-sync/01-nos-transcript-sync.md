# NOS Transcript Sync

> Decouple the transcript pipeline so the framework pushes all session data (transcripts, messages, tool_calls) to Supabase, and NOS reads exclusively from Supabase — enabling platform+dashboard extraction into a separate repo.

| Field | Value |
|-------|-------|
| Status | Active |
| Owner | wiley |
| Last Updated | 2026-03-12 |
| Depends On | full-transcript-sync (completed) |
| Enables | NOS repo extraction (platform+dashboard as separate repo) |

---

## Recent Changes

| Date | What changed | Section |
|------|-------------|---------|
| 2026-03-12 | Adversarial review decisions applied (12 questions resolved) | Design, Open Questions |
| 2026-03-12 | Added testing strategy with per-handoff + E2E chain approach | Verification, Implementation Plan |
| 2026-03-12 | Initial spec | All |

---

## Goal

We're splitting the monorepo into two: the **N2O framework** (skills, task management, `n2o` CLI) and **NOS** (platform API + dashboard). Today the platform reads conversation data from local JSONL files and `.pm/tasks.db` — both of which live on the same machine. Once NOS is a separate repo, those local files won't exist.

The framework already syncs transcript metadata to Supabase, but full message content and tool calls only get written to local SQLite when someone views a conversation in the dashboard (`conversation.ts`). This is the wrong direction — the framework should push data up, and NOS should pull it down from Supabase.

---

## Success Criteria

- `collect-transcripts.sh` writes messages + tool_calls to local SQLite (not just transcript metadata and workflow_events)
- All three tables (transcripts, messages, tool_calls) reliably sync to Supabase via the existing pipeline
- `conversation.ts` reads from Supabase Postgres — zero local JSONL or SQLite reads
- Platform can run on a different machine from the framework with no loss of functionality
- `n2o stats` and local analytics queries still work (local SQLite unchanged)

---

## Current State

- **Done**: `messages` + `tool_calls` tables exist in both SQLite and Supabase (full-transcript-sync sprint, tasks 1-4)
- **Done**: `supabase-client.sh` has `supabase_sync_session_messages` and `supabase_sync_session_tool_calls` functions
- **Done**: `conversation.ts` reads from local SQLite `messages`/`tool_calls` with JSONL fallback
- **Gap**: `collect-transcripts.sh` does NOT write messages/tool_calls — only `conversation.ts` does (on-demand). Sessions nobody views in the dashboard never get their messages synced
- **Gap**: `conversation.ts` reads JSONL files directly and accesses `.pm/tasks.db` via filesystem — breaks when platform runs from a different repo
- **Gap**: Message/tool_call extraction logic lives in TypeScript (`conversation.ts`) inside `platform/` — when NOS moves out, the framework loses this capability

---

## Design

Three changes, each addressing one gap:

### 1. Move message extraction into collect-transcripts.sh

The JSONL parsing in `collect-transcripts.sh` already extracts tool call metadata for `workflow_events`. Extend the same `jq` pass to also extract full messages and tool call inputs, writing them to the local `messages` and `tool_calls` SQLite tables.

This means every session gets its messages/tool_calls written to SQLite at collection time (SessionEnd hook), regardless of whether anyone views the conversation in the dashboard. The existing sync pipeline then pushes them to Supabase.

**What to extract per message:**
- `role` (user/assistant/system)
- `content` (full text, assembled from content blocks)
- `timestamp`
- `model`, `input_tokens`, `output_tokens`, `stop_reason` (assistant messages)

**What to extract per tool call:**
- `tool_name`, `tool_use_id`
- `input` (full JSON — the Edit diffs, Bash commands, etc. — no truncation, store full diffs)
- `timestamp`
- `message_index`, `tool_index` (position tracking)
- `output` and `is_error` are left NULL for now (deferred — tool results require cross-message correlation via tool_use_id, which is Phase 2 work)

**Session_id normalization**: Subagent session IDs must use the same recomposition logic (`${parent_session_id}/${agent_id}`) as the transcripts table. Normalize before writing to messages/tool_calls to prevent orphaned rows on join.

**UPDATE_MODE (growing sessions)**: When a session's JSONL file has grown since last collection, DELETE all existing messages and tool_calls for that session_id and re-insert from scratch. Reset `synced_at = NULL` so the sync pipeline re-pushes. This matches the existing workflow_events pattern.

**`--reparse` flag**: Extend to also clear messages and tool_calls tables (`DELETE FROM messages; DELETE FROM tool_calls;`) alongside the existing transcript/workflow_events clearing.

**Performance**: The jq pass already handles large sessions. Full Edit diffs are stored without truncation — if large payloads exceed Supabase's POST limit during sync, the existing chunking (100 rows) and retry logic in `supabase-client.sh` handles it. If needed, chunk size can be reduced dynamically.

**Trade-off**: The jq extraction stores raw message content without stripping system tags (`<system-reminder>`, etc.). Tag stripping happens at query time in the GraphQL resolver via the existing `stripSystemTags()` function. Raw content in the DB is more faithful and enables future analysis of system prompts.

### 2. Make conversation.ts read from Supabase

Replace the local SQLite/JSONL reading in `conversation.ts` with queries against the platform's existing Supabase Postgres connection (`ctx.db`). The `conversationFeed` resolver becomes a standard database query — no filesystem access, no JSONL parsing, no local SQLite.

The session metadata (session list, timestamps, model) comes from the `transcripts` table. The message content comes from the `messages` table. Tool call summaries come from `tool_calls`.

**What gets removed:**
- `getLocalDb()` — local SQLite connection
- `parseJSONL()` — JSONL file reader
- `persistToSqlite()` — local SQLite writer
- `scanSessionMeta()` — JSONL metadata scanner
- `getClaudeProjectDir()` — local filesystem path resolution
- `readMessagesFromSqlite()` — local SQLite reader

**What replaces it:**
- `SELECT * FROM transcripts ORDER BY started_at DESC LIMIT $1` for session list
- `SELECT * FROM messages WHERE session_id IN (...) ORDER BY message_index` for content (batched across all sessions)
- `SELECT * FROM tool_calls WHERE session_id IN (...) ORDER BY message_index, tool_index` for tools (batched)

**Batched queries**: Use `IN (session_ids)` to fetch messages/tool_calls for all sessions in a single query each, rather than N per-session queries. This keeps the resolver to 3 total DB queries regardless of limit, avoiding rate-limit issues with the Supabase REST API.

**SQL compatibility**: Resolver SQL must stay within the SQLite-compatible subset (no `ANY()`, no JSONB operators, no `NULLS LAST`) so that `wrapDbAsPool()` tests remain valid. Use `IN (?,?,?)` with parameter expansion instead.

**System tag stripping**: Keep `stripSystemTags()` in the resolver. Apply it when assembling the GraphQL response so raw content stays in the DB but clean content reaches the API consumer.

### 3. Remove the conversation.ts JSONL parser dependency

Once collect-transcripts.sh handles message extraction and conversation.ts reads from Supabase, the TypeScript JSONL parser in conversation.ts is dead code. Remove it entirely. The framework owns JSONL parsing; NOS owns display.

---

## Verification

The pipeline has three handoff points, each of which can silently break:

```
JSONL → [collect-transcripts.sh] → SQLite → [sync-task-state.sh] → Supabase → [conversation.ts] → GraphQL
         ^                                   ^                                  ^
         can we extract messages?             do they arrive in Supabase?        does the resolver read them?
```

### Testing strategy: per-handoff + E2E chain

| Test | Layer | How | Verifies |
|------|-------|-----|----------|
| Handoff 1 | collect → SQLite | Extend `test-n2o-transcripts.sh` with message/tool_call assertions | jq extraction writes correct rows to messages + tool_calls tables |
| Handoff 2 | SQLite → Supabase | Already covered by `test-n2o-supabase.sh` (mock curl) | HTTP payloads are well-formed, synced_at updated, retry logic works |
| Handoff 3 | Supabase → GraphQL | New `conversation.test.ts` using existing test helpers | Resolver reads from DB, returns correct shape, no filesystem access |
| E2E chain | Full pipeline | New test: fixture JSONL → collect → seed DB → query resolver | Data matches end-to-end from JSONL source to GraphQL response |

**Handoff 1 — collect → SQLite** (extend existing `test-n2o-transcripts.sh`):
- Create a JSONL fixture with known messages (user + assistant + tool_use blocks)
- Run `collect-transcripts.sh`
- Assert `messages` table has correct row count, roles, content, timestamps
- Assert `tool_calls` table has correct tool names, full JSON input (including Edit diffs), message_index/tool_index positioning
- Assert idempotency: re-running doesn't duplicate message/tool_call rows
- Assert UPDATE mode: appending to JSONL updates messages (growing session)

**Handoff 2 — SQLite → Supabase** (already covered):
- `test-n2o-supabase.sh` already tests `supabase_sync_session_messages` and `supabase_sync_session_tool_calls` with mock curl
- Verifies chunking at 100 rows, TEXT→JSONB conversion for tool_call input, synced_at marking, retry/failure tracking

**Handoff 3 — Supabase → GraphQL** (new `conversation.test.ts`):
- Use `createTestDb()` + `wrapDbAsPool()` from existing test helpers
- Seed messages + tool_calls + transcripts into the in-memory DB
- Call `conversationFeed` resolver
- Assert: returns correct session list, message content, tool call summaries
- Assert: no filesystem access (no imports from fs, path, child_process in the rewritten resolver)
- Assert: respects limit param, developer filter, ordering by started_at DESC

**E2E chain** (new test or extension of `test-n2o-e2e.sh`):
1. Create a **golden test fixture** JSONL file covering all edge cases: string content, array content, empty content, nested tool_use blocks, missing fields, Unicode, large Edit diffs, subagent sessions
2. Run `collect-transcripts.sh` against a temp SQLite DB
3. Query the SQLite DB to extract messages + tool_calls rows
4. Load those rows into the platform test DB (via `wrapDbAsPool()`)
5. Call `conversationFeed` resolver against that DB
6. Assert: output messages match the original JSONL fixture content
7. Assert: tool call summaries match the original tool_use blocks
8. Assert: subagent session messages join correctly via normalized session_id
9. This tests the real data path without needing network access

---

## Implementation Plan

| # | Task | Done When |
|---|------|-----------|
| 1 | Extend collect-transcripts.sh to extract and write messages + tool_calls to local SQLite | After running collect-transcripts.sh on a session, `SELECT COUNT(*) FROM messages WHERE session_id = '...'` returns > 0; tool_calls rows exist with full JSON input; new tests in test-n2o-transcripts.sh pass (message count, content, tool names, idempotency, UPDATE mode) |
| 2 | Rewrite conversation.ts resolver to read from Supabase instead of local SQLite/JSONL | `conversationFeed` query returns data from DB; all local filesystem code removed (getLocalDb, parseJSONL, scanSessionMeta, getClaudeProjectDir, persistToSqlite, readMessagesFromSqlite); new conversation.test.ts passes with seeded DB data; platform starts and serves conversations with no `.pm/tasks.db` or JSONL files present |
| 3 | E2E verification: fixture JSONL → collect → seed DB → query resolver → assert data matches | E2E test passes: creates fixture JSONL, runs collector, loads extracted data into platform test DB, queries conversationFeed, asserts output matches fixture; all existing tests in test-n2o-transcripts.sh and test-n2o-supabase.sh still pass |

---

## Open Questions

1. ~~Should `collect-transcripts.sh` strip system tags from user message content, or store raw content and strip at display time?~~ **Resolved**: Store raw content. Strip at query time in the GraphQL resolver via `stripSystemTags()`. Raw content is more faithful and enables future analysis.
2. Should we add `developer` column to messages/tool_calls in Supabase for easier cross-developer queries, or always join through transcripts?
3. ~~Should we extract tool call `output` and `is_error` in this sprint?~~ **Resolved**: No. Leave NULL. Tool results require cross-message correlation via tool_use_id — deferring to Phase 2 (consistent with prior spec decision).
4. ~~What happens with large Edit diffs — truncate or store full?~~ **Resolved**: Store full diffs, no truncation. Accept the storage cost. Existing sync chunking (100 rows) and retry logic handles large payloads.
5. ~~How does UPDATE_MODE handle messages/tool_calls for growing sessions?~~ **Resolved**: DELETE + re-insert all for the session. Reset `synced_at = NULL`. Matches existing workflow_events pattern.
6. ~~Does --reparse clear messages/tool_calls?~~ **Resolved**: Yes. Extend --reparse to also `DELETE FROM messages; DELETE FROM tool_calls;`.
7. ~~Real-time visibility of mid-session conversations?~~ **Resolved**: Collection already triggers at SessionStart (for sibling sessions) and SessionEnd. With 12 concurrent sessions, collection runs frequently. Conversations appear after the next collection trigger, not only after session ends.
8. ~~How to ensure parity between TypeScript and jq message extractors?~~ **Resolved**: Create a golden test fixture covering all edge cases (string content, array content, empty content, nested tool_use, missing fields, Unicode). Run both extractors, diff outputs. Part of the E2E verification task.

---

## References

- Prior spec: `specs/active/full-transcript-sync.md` (completed sprint)
- Current JSONL parser: `platform/src/resolvers/conversation.ts`
- Transcript collector: `scripts/collect-transcripts.sh`
- Sync pipeline: `scripts/coordination/supabase-client.sh`
- Sync trigger: `scripts/coordination/sync-task-state.sh`
- Supabase schema: `platform/supabase-schema.sql`
- Local schema: `.pm/schema.sql`
