#!/bin/bash
set -uo pipefail

# =============================================================================
# E2E Tests for: scripts/coordination/supabase-client.sh
#                scripts/coordination/supabase-schema.sql
# Covers: configuration, task sync, agent registry, activity logging,
#         claim verification, working sets, developer twins, error handling
#
# Uses a mock curl to simulate Supabase responses without requiring
# a live Supabase instance.
#
# Pure bash — no external test frameworks required.
# Usage: bash tests/test-n2o-supabase.sh
# =============================================================================

N2O_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_SCRIPT="$N2O_DIR/scripts/coordination/supabase-client.sh"
SCHEMA="$N2O_DIR/.pm/schema.sql"
SUPABASE_SCHEMA="$N2O_DIR/scripts/coordination/supabase-schema.sql"
PASS=0
FAIL=0
TOTAL=0
FAILED_TESTS=()

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# -----------------------------------------------------------------------------
# Test harness
# -----------------------------------------------------------------------------

TEST_DIR=""
CURRENT_TEST=""
MOCK_CURL_LOG=""

setup() {
  TEST_DIR=$(cd "$(mktemp -d)" && pwd -P)
  mkdir -p "$TEST_DIR/.pm" "$TEST_DIR/bin"

  # Create local tasks.db with schema + test data
  sqlite3 "$TEST_DIR/.pm/tasks.db" < "$SCHEMA"
  sqlite3 "$TEST_DIR/.pm/tasks.db" "
    INSERT INTO tasks (sprint, task_num, title, type, status, priority, description, done_when, owner, session_id)
    VALUES
    ('test-sprint', 1, 'Task One', 'infra', 'red', 1.0, 'Do thing one', 'Tests pass', 'agent-1', 'sess-1'),
    ('test-sprint', 2, 'Task Two', 'frontend', 'pending', 2.0, 'Do thing two', 'UI renders', NULL, NULL),
    ('test-sprint', 3, 'Task Three', 'database', 'green', 3.0, 'Do thing three', 'Migration runs', 'agent-2', 'sess-2');
  "

  # Create config.json with supabase settings
  cat > "$TEST_DIR/.pm/config.json" <<'CONF'
{
  "n2o_version": "1.0.0",
  "project_name": "test",
  "supabase": {
    "url": "https://test-project.supabase.co",
    "key_env": "SUPABASE_KEY"
  }
}
CONF

  # Create mock curl that logs calls and returns configurable responses
  MOCK_CURL_LOG="$TEST_DIR/curl_calls.log"
  cat > "$TEST_DIR/bin/curl" <<'MOCKCURL'
#!/bin/bash
# Mock curl — logs all calls, returns configurable responses
LOG_FILE="${MOCK_CURL_LOG:-/tmp/mock_curl.log}"
MOCK_RESPONSE_FILE="${MOCK_RESPONSE_FILE:-}"
MOCK_HTTP_CODE="${MOCK_HTTP_CODE:-200}"

# Parse args to extract useful info
method="GET"
url=""
data=""
for arg in "$@"; do
  case "$prev" in
    -X) method="$arg" ;;
    -d) data="$arg" ;;
  esac
  prev="$arg"
  # Last positional arg is the URL
  if [[ "$arg" =~ ^https?:// ]]; then
    url="$arg"
  fi
done

# Log the call
echo "$method $url" >> "$LOG_FILE"
if [ -n "$data" ]; then
  echo "  DATA: $data" >> "$LOG_FILE"
fi

# Check for -w flag (write-out format)
if [[ "$*" == *"-w"* ]]; then
  # Return response + http code on separate lines
  if [ -n "$MOCK_RESPONSE_FILE" ] && [ -f "$MOCK_RESPONSE_FILE" ]; then
    cat "$MOCK_RESPONSE_FILE"
  else
    echo '[{"ok":true}]'
  fi
  echo ""
  echo "$MOCK_HTTP_CODE"
else
  # Return just the response
  if [ -n "$MOCK_RESPONSE_FILE" ] && [ -f "$MOCK_RESPONSE_FILE" ]; then
    cat "$MOCK_RESPONSE_FILE"
  else
    echo '[{"ok":true}]'
  fi
fi
MOCKCURL
  chmod +x "$TEST_DIR/bin/curl"

  export MOCK_CURL_LOG
  export MOCK_HTTP_CODE="200"
  export MOCK_RESPONSE_FILE=""
  export SUPABASE_URL="https://test-project.supabase.co"
  export SUPABASE_KEY="test-service-role-key-123"
}

teardown() {
  unset SUPABASE_URL SUPABASE_KEY MOCK_CURL_LOG MOCK_HTTP_CODE MOCK_RESPONSE_FILE
  if [[ -n "$TEST_DIR" && -d "$TEST_DIR" ]]; then
    rm -rf "$TEST_DIR"
  fi
  TEST_DIR=""
}

run_test() {
  local name="$1"
  local func="$2"
  CURRENT_TEST="$name"
  ((TOTAL++)) || true

  setup
  local result=0
  local err_file
  err_file=$(mktemp)

  (
    set -e
    "$func"
  ) > /dev/null 2>"$err_file" || result=$?
  teardown

  if [[ $result -eq 0 ]]; then
    echo -e "  ${GREEN}PASS${NC}  $name"
    ((PASS++)) || true
  else
    echo -e "  ${RED}FAIL${NC}  $name"
    if [[ -s "$err_file" ]]; then
      grep "ASSERT FAILED" "$err_file" | head -1 | sed 's/^/    /'
    fi
    ((FAIL++)) || true
    FAILED_TESTS+=("$name")
  fi
  rm -f "$err_file"
}

# Assertions

assert_equals() {
  local expected="$1"
  local actual="$2"
  local msg="${3:-Expected '$expected', got '$actual'}"
  if [[ "$expected" != "$actual" ]]; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local msg="${3:-Output should contain '$needle'}"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

assert_file_contains() {
  local file="$1"
  local needle="$2"
  local msg="${3:-File should contain '$needle'}"
  if ! grep -q "$needle" "$file" 2>/dev/null; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

assert_curl_called() {
  local method="$1"
  local url_fragment="$2"
  local msg="${3:-curl should have been called with $method $url_fragment}"
  if ! grep -q "$method.*$url_fragment" "$MOCK_CURL_LOG" 2>/dev/null; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

# Helper: source the client in the test directory with mock curl on PATH
source_client() {
  cd "$TEST_DIR"
  export PATH="$TEST_DIR/bin:$PATH"
  source "$CLIENT_SCRIPT"
}

# -----------------------------------------------------------------------------
# Schema validation tests
# -----------------------------------------------------------------------------

test_schema_valid_sql() {
  # The schema should be valid SQL (parseable, no syntax errors)
  # Test by loading it into a local SQLite just for syntax validation
  # (Supabase uses Postgres, but basic SQL syntax is shared)
  # We check that required tables/keywords are present
  local schema
  schema=$(cat "$SUPABASE_SCHEMA")
  assert_contains "$schema" "CREATE TABLE IF NOT EXISTS tasks" "Schema should define tasks table"
  assert_contains "$schema" "CREATE TABLE IF NOT EXISTS agents" "Schema should define agents table"
  assert_contains "$schema" "CREATE TABLE IF NOT EXISTS activity_log" "Schema should define activity_log table"
  assert_contains "$schema" "CREATE TABLE IF NOT EXISTS developer_twins" "Schema should define developer_twins table"
  assert_contains "$schema" "CREATE TABLE IF NOT EXISTS transcripts" "Schema should define transcripts table"
}

test_schema_has_realtime() {
  local schema
  schema=$(cat "$SUPABASE_SCHEMA")
  assert_contains "$schema" "supabase_realtime" "Schema should enable real-time on tables"
}

test_schema_has_rls() {
  local schema
  schema=$(cat "$SUPABASE_SCHEMA")
  assert_contains "$schema" "ENABLE ROW LEVEL SECURITY" "Schema should enable RLS"
}

test_schema_has_indexes() {
  local schema
  schema=$(cat "$SUPABASE_SCHEMA")
  assert_contains "$schema" "idx_tasks_status" "Schema should index tasks.status"
  assert_contains "$schema" "idx_agents_developer" "Schema should index agents.developer"
  assert_contains "$schema" "idx_activity_event_type" "Schema should index activity_log.event_type"
}

# -----------------------------------------------------------------------------
# Configuration tests
# -----------------------------------------------------------------------------

test_init_from_env() {
  source_client
  supabase_init
  assert_equals "true" "$_SUPABASE_CONFIGURED" "Should configure from env vars"
}

test_init_from_config() {
  unset SUPABASE_URL
  export SUPABASE_KEY="key-from-env"
  source_client
  supabase_init
  assert_equals "true" "$_SUPABASE_CONFIGURED" "Should configure from config.json + env key"
}

test_init_missing_url() {
  unset SUPABASE_URL SUPABASE_KEY
  # Remove supabase config
  echo '{}' > "$TEST_DIR/.pm/config.json"
  source_client
  local rc=0
  supabase_init || rc=$?
  assert_equals 1 "$rc" "Should fail without URL"
  assert_equals "false" "$_SUPABASE_CONFIGURED" "Should not be configured"
}

test_init_missing_key() {
  unset SUPABASE_KEY
  source_client
  local rc=0
  supabase_init || rc=$?
  assert_equals 1 "$rc" "Should fail without key"
}

# -----------------------------------------------------------------------------
# Task sync tests
# -----------------------------------------------------------------------------

test_upsert_task() {
  source_client
  local result
  result=$(supabase_upsert_task "test-sprint" 1 "$TEST_DIR/.pm/tasks.db")
  assert_curl_called "POST" "rest/v1/tasks" "Should POST to tasks endpoint"
  assert_file_contains "$MOCK_CURL_LOG" "Task One" "Request should contain task title"
}

test_upsert_task_not_found() {
  source_client
  local rc=0
  supabase_upsert_task "fake" 99 "$TEST_DIR/.pm/tasks.db" 2>/dev/null || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "    ASSERT FAILED: Should fail for nonexistent task" >&2
    return 1
  fi
}

test_sync_all_tasks() {
  source_client
  local result
  result=$(supabase_sync_all_tasks "test-sprint" "$TEST_DIR/.pm/tasks.db")
  assert_curl_called "POST" "rest/v1/tasks" "Should POST to tasks endpoint"
  # Should contain all 3 tasks
  assert_file_contains "$MOCK_CURL_LOG" "Task One" "Should sync task 1"
  assert_file_contains "$MOCK_CURL_LOG" "Task Two" "Should sync task 2"
  assert_file_contains "$MOCK_CURL_LOG" "Task Three" "Should sync task 3"
}

test_sync_empty_sprint() {
  source_client
  local rc=0
  supabase_sync_all_tasks "nonexistent" "$TEST_DIR/.pm/tasks.db" 2>/dev/null || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "    ASSERT FAILED: Should fail for empty sprint" >&2
    return 1
  fi
}

# -----------------------------------------------------------------------------
# Agent registry tests
# -----------------------------------------------------------------------------

test_register_agent() {
  source_client
  local result
  result=$(supabase_register_agent "agent-test-1" "machine-a" "developer-1" "test-sprint" "1")
  assert_curl_called "POST" "rest/v1/agents" "Should POST to agents endpoint"
  assert_file_contains "$MOCK_CURL_LOG" "agent-test-1" "Should contain agent_id"
  assert_file_contains "$MOCK_CURL_LOG" "machine-a" "Should contain machine_id"
}

test_heartbeat() {
  source_client
  local result
  result=$(supabase_heartbeat "agent-test-1" '["src/main.ts","src/utils.ts"]')
  assert_curl_called "PATCH" "agents?agent_id=eq.agent-test-1" "Should PATCH agent record"
}

test_deregister_agent() {
  source_client
  local result
  result=$(supabase_deregister_agent "agent-test-1")
  assert_curl_called "PATCH" "agents?agent_id=eq.agent-test-1" "Should PATCH agent record"
  assert_file_contains "$MOCK_CURL_LOG" "stopped" "Should set status to stopped"
}

test_get_agents() {
  source_client
  local result
  result=$(supabase_get_agents)
  assert_curl_called "GET" "agents?status=eq.active" "Should GET active agents"
}

test_get_agents_filtered() {
  source_client
  local result
  result=$(supabase_get_agents "developer-1")
  assert_curl_called "GET" "agents?status=eq.active&developer=eq.developer-1" "Should filter by developer"
}

# -----------------------------------------------------------------------------
# Activity log tests
# -----------------------------------------------------------------------------

test_log_event() {
  source_client
  local result
  result=$(supabase_log_event "task_claimed" "agent-1" "test-sprint" "1" '{"source":"session_hook"}')
  assert_curl_called "POST" "rest/v1/activity_log" "Should POST to activity_log"
  assert_file_contains "$MOCK_CURL_LOG" "task_claimed" "Should contain event_type"
  assert_file_contains "$MOCK_CURL_LOG" "agent-1" "Should contain agent_id"
}

test_log_event_minimal() {
  source_client
  local result
  result=$(supabase_log_event "heartbeat" "agent-1")
  assert_curl_called "POST" "rest/v1/activity_log" "Should POST even with minimal args"
}

# -----------------------------------------------------------------------------
# Claim verification tests
# -----------------------------------------------------------------------------

test_claim_verify_success() {
  # Mock: return the updated row (claim succeeded)
  echo '[{"sprint":"test-sprint","task_num":1,"owner":"agent-1"}]' > "$TEST_DIR/mock_response.json"
  export MOCK_RESPONSE_FILE="$TEST_DIR/mock_response.json"
  source_client
  local rc=0
  supabase_claim_verify "test-sprint" 1 "agent-1" || rc=$?
  assert_equals 0 "$rc" "Should succeed when claim is accepted"
  assert_curl_called "PATCH" "tasks?sprint=eq.test-sprint&task_num=eq.1&owner=is.null" "Should attempt atomic claim"
}

test_claim_verify_rejected() {
  # Mock: return empty array (no rows updated — someone else claimed)
  echo '[]' > "$TEST_DIR/mock_response.json"
  export MOCK_RESPONSE_FILE="$TEST_DIR/mock_response.json"
  source_client
  local rc=0
  supabase_claim_verify "test-sprint" 1 "agent-1" 2>/dev/null || rc=$?
  assert_equals 1 "$rc" "Should fail when claim is rejected"
}

# -----------------------------------------------------------------------------
# Working set tests
# -----------------------------------------------------------------------------

test_get_working_sets() {
  # Mock: return a realistic working sets response
  cat > "$TEST_DIR/mock_response.json" <<'RESP'
[{"developer":"dev-1","files_touched":["src/auth.ts","src/login.tsx"]},{"developer":"dev-2","files_touched":["src/api.ts"]}]
RESP
  export MOCK_RESPONSE_FILE="$TEST_DIR/mock_response.json"
  source_client
  local result
  result=$(supabase_get_active_working_sets)
  assert_curl_called "GET" "active_working_sets" "Should query active_working_sets view"
  # Verify the function returns the response (not just that curl was called)
  assert_contains "$result" "dev-1" "Should return first developer's working set"
  assert_contains "$result" "src/auth.ts" "Should return file paths in working set"
  assert_contains "$result" "dev-2" "Should return second developer's working set"
}

# -----------------------------------------------------------------------------
# Developer twin tests
# -----------------------------------------------------------------------------

test_update_twin() {
  source_client
  local result
  result=$(supabase_update_twin "developer-1" "loaded_context" '{"files":["src/auth.ts"],"modules":["auth"]}')
  assert_curl_called "PATCH" "developer_twins?developer=eq.developer-1" "Should PATCH twin record"
}

test_get_twin() {
  source_client
  local result
  result=$(supabase_get_twin "developer-1")
  assert_curl_called "GET" "developer_twins?developer=eq.developer-1" "Should GET twin record"
}

# -----------------------------------------------------------------------------
# Error handling tests
# -----------------------------------------------------------------------------

test_request_without_init() {
  cd "$TEST_DIR"
  unset SUPABASE_URL SUPABASE_KEY
  echo '{}' > "$TEST_DIR/.pm/config.json"
  export PATH="$TEST_DIR/bin:$PATH"
  source "$CLIENT_SCRIPT"
  local rc=0
  supabase_get_agents 2>/dev/null || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "    ASSERT FAILED: Should fail when not configured" >&2
    return 1
  fi
}

test_ping_success() {
  # Mock curl to return 200 for the ping check
  # supabase_ping uses curl -s -o /dev/null -w "%{http_code}" which bypasses our standard mock
  # Override with a simple mock that returns "200" for -w usage
  cat > "$TEST_DIR/bin/curl" <<'PINGMOCK'
#!/bin/bash
# If -o /dev/null is present, this is a ping request — return http code
if [[ "$*" == *"-o /dev/null"* ]]; then
  echo "200"
else
  echo '[{"ok":true}]'
  echo ""
  echo "200"
fi
PINGMOCK
  chmod +x "$TEST_DIR/bin/curl"
  source_client
  local rc=0
  supabase_ping || rc=$?
  assert_equals "0" "$rc" "Ping should return 0 when Supabase returns 200"
}

test_ping_failure() {
  # Mock curl to return non-200 for the ping check
  cat > "$TEST_DIR/bin/curl" <<'PINGMOCK'
#!/bin/bash
if [[ "$*" == *"-o /dev/null"* ]]; then
  echo "503"
else
  echo '{"error":"service unavailable"}'
  echo ""
  echo "503"
fi
PINGMOCK
  chmod +x "$TEST_DIR/bin/curl"
  source_client
  local rc=0
  supabase_ping || rc=$?
  assert_equals "1" "$rc" "Ping should return 1 when Supabase returns non-200"
}

test_http_error_handling() {
  export MOCK_HTTP_CODE="401"
  source_client
  local rc=0
  supabase_get_agents 2>/dev/null || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "    ASSERT FAILED: Should fail on HTTP 401" >&2
    return 1
  fi
}

# -----------------------------------------------------------------------------
# Transcript sync tests
# -----------------------------------------------------------------------------

# Helper: insert a test transcript into local SQLite
insert_test_transcript() {
  local db_path="$1"
  local session_id="${2:-test-session-001}"
  sqlite3 "$db_path" "
    INSERT INTO transcripts (
      session_id, file_path, message_count, user_message_count,
      assistant_message_count, tool_call_count, total_input_tokens,
      total_output_tokens, cache_read_tokens, cache_creation_tokens,
      estimated_cost_usd, model, started_at, ended_at,
      sprint, task_num, total_user_content_length,
      stop_reason_counts, thinking_message_count, thinking_total_length,
      has_sidechain, system_error_count, system_retry_count,
      tool_result_error_count, compaction_count,
      cwd, git_branch, background_task_count, web_search_count
    ) VALUES (
      '$session_id', '/tmp/test.jsonl', 20, 8,
      12, 15, 50000,
      25000, 30000, 5000,
      0.475, 'claude-sonnet-4-5-20250929', '2025-06-01T10:00:00Z', '2025-06-01T10:30:00Z',
      'test-sprint', 1, 1200,
      '{\"end_turn\":8,\"tool_use\":4}', 3, 5000,
      0, 1, 0,
      2, 0,
      '/home/dev/project', 'task/test-sprint-1', 1, 0
    );
  "
}

test_upsert_transcript() {
  source_client
  insert_test_transcript "$TEST_DIR/.pm/tasks.db"
  local result
  result=$(supabase_upsert_transcript "test-session-001" "$TEST_DIR/.pm/tasks.db" "test-developer")
  assert_curl_called "POST" "rest/v1/transcripts" "Should POST to transcripts endpoint"
  assert_file_contains "$MOCK_CURL_LOG" "test-session-001" "Request should contain session_id"
  assert_file_contains "$MOCK_CURL_LOG" "test-developer" "Request should contain developer"
}

test_upsert_transcript_sets_synced_at() {
  source_client
  insert_test_transcript "$TEST_DIR/.pm/tasks.db"

  # Before sync: synced_at should be NULL
  local before
  before=$(sqlite3 "$TEST_DIR/.pm/tasks.db" "SELECT synced_at FROM transcripts WHERE session_id='test-session-001';")
  assert_equals "" "$before" "synced_at should be NULL before sync"

  supabase_upsert_transcript "test-session-001" "$TEST_DIR/.pm/tasks.db" "dev" >/dev/null

  # After sync: synced_at should be populated
  local after
  after=$(sqlite3 "$TEST_DIR/.pm/tasks.db" "SELECT synced_at FROM transcripts WHERE session_id='test-session-001';")
  if [[ -z "$after" ]]; then
    echo "    ASSERT FAILED: synced_at should be set after sync" >&2
    return 1
  fi
}

test_upsert_transcript_not_found() {
  source_client
  local rc=0
  supabase_upsert_transcript "nonexistent-session" "$TEST_DIR/.pm/tasks.db" 2>/dev/null || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "    ASSERT FAILED: Should fail for nonexistent transcript" >&2
    return 1
  fi
}

test_sync_all_transcripts_diff() {
  source_client
  # Insert 3 transcripts, mark 1 as already synced
  insert_test_transcript "$TEST_DIR/.pm/tasks.db" "session-a"
  insert_test_transcript "$TEST_DIR/.pm/tasks.db" "session-b"
  insert_test_transcript "$TEST_DIR/.pm/tasks.db" "session-c"
  sqlite3 "$TEST_DIR/.pm/tasks.db" "UPDATE transcripts SET synced_at = datetime('now') WHERE session_id = 'session-a';"

  supabase_sync_all_transcripts "$TEST_DIR/.pm/tasks.db" "dev" 2>/dev/null

  # session-a was already synced, so only session-b and session-c should be POSTed
  # All 3 should now have synced_at set
  local synced_count
  synced_count=$(sqlite3 "$TEST_DIR/.pm/tasks.db" "SELECT COUNT(*) FROM transcripts WHERE synced_at IS NOT NULL;")
  assert_equals "3" "$synced_count" "All transcripts should be synced after bulk sync"

  # The curl log should contain session-b and session-c but not necessarily session-a again
  assert_file_contains "$MOCK_CURL_LOG" "session-b" "Should sync unsynced session-b"
  assert_file_contains "$MOCK_CURL_LOG" "session-c" "Should sync unsynced session-c"
}

test_sync_all_transcripts_nothing_to_sync() {
  source_client
  # Insert 1 transcript already synced
  insert_test_transcript "$TEST_DIR/.pm/tasks.db" "session-synced"
  sqlite3 "$TEST_DIR/.pm/tasks.db" "UPDATE transcripts SET synced_at = datetime('now') WHERE session_id = 'session-synced';"

  local output
  output=$(supabase_sync_all_transcripts "$TEST_DIR/.pm/tasks.db" "dev" 2>&1)
  assert_contains "$output" "already synced" "Should report nothing to sync"
}

test_schema_has_transcripts_columns() {
  local schema
  schema=$(cat "$SUPABASE_SCHEMA")
  assert_contains "$schema" "developer TEXT" "Supabase transcripts should have developer column"
  assert_contains "$schema" "machine_id TEXT" "Supabase transcripts should have machine_id column"
  assert_contains "$schema" "stop_reason_counts JSONB" "Supabase transcripts should have stop_reason_counts"
  assert_contains "$schema" "idx_transcripts_developer" "Should index transcripts by developer"
}

test_schema_has_developer_summary_view() {
  local schema
  schema=$(cat "$SUPABASE_SCHEMA")
  assert_contains "$schema" "developer_session_summary" "Should have developer_session_summary view"
}

test_upsert_transcript_records_failure() {
  # Mock: return HTTP 400 to simulate Supabase rejection
  export MOCK_HTTP_CODE="400"
  source_client
  insert_test_transcript "$TEST_DIR/.pm/tasks.db" "session-bad"

  local rc=0
  supabase_upsert_transcript "session-bad" "$TEST_DIR/.pm/tasks.db" "dev" 2>/dev/null || rc=$?

  # Should fail
  if [[ "$rc" -eq 0 ]]; then
    echo "    ASSERT FAILED: Should fail on HTTP 400" >&2
    return 1
  fi

  # sync_attempts should be incremented
  local attempts
  attempts=$(sqlite3 "$TEST_DIR/.pm/tasks.db" "SELECT sync_attempts FROM transcripts WHERE session_id='session-bad';")
  assert_equals "1" "$attempts" "sync_attempts should be 1 after first failure"

  # sync_error should be populated
  local error
  error=$(sqlite3 "$TEST_DIR/.pm/tasks.db" "SELECT sync_error FROM transcripts WHERE session_id='session-bad';")
  if [[ -z "$error" ]]; then
    echo "    ASSERT FAILED: sync_error should be populated after failure" >&2
    return 1
  fi
}

test_sync_skips_permanently_failed() {
  source_client
  insert_test_transcript "$TEST_DIR/.pm/tasks.db" "session-stuck"
  # Set sync_attempts to 5 (max) to simulate permanently failed row
  sqlite3 "$TEST_DIR/.pm/tasks.db" "UPDATE transcripts SET sync_attempts = 5, sync_error = 'bad data' WHERE session_id = 'session-stuck';"

  local output
  output=$(supabase_sync_all_transcripts "$TEST_DIR/.pm/tasks.db" "dev" 2>&1)
  assert_contains "$output" "permanently failed" "Should report permanently failed rows"

  # Should NOT have been synced
  local synced
  synced=$(sqlite3 "$TEST_DIR/.pm/tasks.db" "SELECT synced_at FROM transcripts WHERE session_id='session-stuck';")
  assert_equals "" "$synced" "Permanently failed row should not be synced"
}

test_sync_batch_fallback_to_individual() {
  # Mock: batch POST returns 400 (simulating one bad row in batch)
  # Then individual POSTs return 200 (default mock behavior)
  # We can't easily simulate "batch fails, individual succeeds" with the mock,
  # but we can verify the fallback path is exercised by checking that
  # individual sync attempts are made after batch failure
  export MOCK_HTTP_CODE="400"
  source_client
  insert_test_transcript "$TEST_DIR/.pm/tasks.db" "session-fb-1"
  insert_test_transcript "$TEST_DIR/.pm/tasks.db" "session-fb-2"

  local output
  output=$(supabase_sync_all_transcripts "$TEST_DIR/.pm/tasks.db" "dev" 2>&1)
  assert_contains "$output" "falling back" "Should report falling back to individual sync"

  # Both rows should have sync_attempts incremented (batch failed, then individual failed too since mock returns 400)
  local total_attempts
  total_attempts=$(sqlite3 "$TEST_DIR/.pm/tasks.db" "SELECT SUM(sync_attempts) FROM transcripts WHERE session_id IN ('session-fb-1','session-fb-2');")
  if [[ "$total_attempts" -lt 2 ]]; then
    echo "    ASSERT FAILED: sync_attempts should be incremented on both rows (got $total_attempts)" >&2
    return 1
  fi
}

# -----------------------------------------------------------------------------
# Task pull tests
# -----------------------------------------------------------------------------

# Helper: set mock curl to return specific task state JSON
set_mock_task_response() {
  local response_file="$TEST_DIR/mock_response.json"
  echo "$1" > "$response_file"
  export MOCK_RESPONSE_FILE="$response_file"
}

test_pull_updates_unowned_tasks() {
  source_client
  local db="$TEST_DIR/.pm/tasks.db"

  # Task 2 is pending locally, no owner
  # Supabase says someone else claimed it
  set_mock_task_response '[{"sprint":"test-sprint","task_num":2,"status":"red","owner":"other-agent","started_at":"2026-02-25T10:00:00Z","completed_at":null,"merged_at":null}]'

  supabase_pull_tasks "test-sprint" "$db" "my-agent" 2>/dev/null || true

  local status owner
  status=$(sqlite3 "$db" "SELECT status FROM tasks WHERE sprint='test-sprint' AND task_num=2;")
  owner=$(sqlite3 "$db" "SELECT owner FROM tasks WHERE sprint='test-sprint' AND task_num=2;")
  assert_equals "red" "$status" "Unowned task should be updated to red"
  assert_equals "other-agent" "$owner" "Unowned task should get other agent's owner"
}

test_pull_skips_own_tasks() {
  source_client
  local db="$TEST_DIR/.pm/tasks.db"

  # Task 1 is owned by agent-1 locally (status=red)
  # Supabase also shows it as red/agent-1 — should skip
  set_mock_task_response '[{"sprint":"test-sprint","task_num":1,"status":"red","owner":"agent-1","started_at":"2026-02-25T10:00:00Z","completed_at":null,"merged_at":null}]'

  supabase_pull_tasks "test-sprint" "$db" "agent-1" 2>/dev/null || true

  local status
  status=$(sqlite3 "$db" "SELECT status FROM tasks WHERE sprint='test-sprint' AND task_num=1;")
  assert_equals "red" "$status" "Own task should remain unchanged"
}

test_pull_status_never_regresses() {
  source_client
  local db="$TEST_DIR/.pm/tasks.db"

  # Task 3 is green locally (completed)
  # Supabase shows it as red — should NOT regress
  set_mock_task_response '[{"sprint":"test-sprint","task_num":3,"status":"red","owner":"agent-2","started_at":"2026-02-25T10:00:00Z","completed_at":null,"merged_at":null}]'

  supabase_pull_tasks "test-sprint" "$db" "my-agent" 2>/dev/null || true

  local status
  status=$(sqlite3 "$db" "SELECT status FROM tasks WHERE sprint='test-sprint' AND task_num=3;")
  assert_equals "green" "$status" "Status should never regress from green to red"
}

test_pull_definitions_untouched() {
  source_client
  local db="$TEST_DIR/.pm/tasks.db"

  # Get original title
  local orig_title
  orig_title=$(sqlite3 "$db" "SELECT title FROM tasks WHERE sprint='test-sprint' AND task_num=2;")

  # Pull with status update — title is NOT in the select (no title field from Supabase)
  set_mock_task_response '[{"sprint":"test-sprint","task_num":2,"status":"red","owner":"other-agent","started_at":"2026-02-25T10:00:00Z","completed_at":null,"merged_at":null}]'

  supabase_pull_tasks "test-sprint" "$db" "my-agent" 2>/dev/null || true

  local new_title
  new_title=$(sqlite3 "$db" "SELECT title FROM tasks WHERE sprint='test-sprint' AND task_num=2;")
  assert_equals "$orig_title" "$new_title" "Title (definition field) should be untouched after pull"
}

test_pull_handles_supabase_down() {
  # Simulate Supabase being unreachable
  export MOCK_HTTP_CODE="500"
  source_client
  local db="$TEST_DIR/.pm/tasks.db"

  local result=0
  supabase_pull_tasks "test-sprint" "$db" "my-agent" 2>/dev/null || result=$?

  # Should return non-zero but not crash
  assert_equals "1" "$result" "Should return 1 when Supabase is unreachable"

  # Local state should be unchanged
  local status
  status=$(sqlite3 "$db" "SELECT status FROM tasks WHERE sprint='test-sprint' AND task_num=2;")
  assert_equals "pending" "$status" "Local state should be unchanged when Supabase is down"
}

test_pull_supersession_resets_local() {
  source_client
  local db="$TEST_DIR/.pm/tasks.db"

  # Task 2: set up as locally claimed by my-agent (red)
  sqlite3 "$db" "UPDATE tasks SET status='red', owner='my-agent' WHERE sprint='test-sprint' AND task_num=2;"

  # Supabase says a DIFFERENT agent completed it (green)
  set_mock_task_response '[{"sprint":"test-sprint","task_num":2,"status":"green","owner":"other-agent","started_at":"2026-02-25T09:00:00Z","completed_at":"2026-02-25T10:00:00Z","merged_at":null}]'

  local output
  output=$(supabase_pull_tasks "test-sprint" "$db" "my-agent" 2>&1) || true

  local status owner
  status=$(sqlite3 "$db" "SELECT status FROM tasks WHERE sprint='test-sprint' AND task_num=2;")
  owner=$(sqlite3 "$db" "SELECT owner FROM tasks WHERE sprint='test-sprint' AND task_num=2;")

  assert_equals "pending" "$status" "Superseded task should be reset to pending"
  assert_equals "" "$owner" "Superseded task owner should be cleared"
  assert_contains "$output" "completed by other-agent" "Should log supersession warning"
}

test_pull_merged_at_sticky() {
  source_client
  local db="$TEST_DIR/.pm/tasks.db"

  # Set merged_at locally
  sqlite3 "$db" "UPDATE tasks SET merged_at='2026-02-25T12:00:00Z' WHERE sprint='test-sprint' AND task_num=3;"

  # Supabase has no merged_at but more advanced status (same rank, won't update but testing stickiness)
  set_mock_task_response '[{"sprint":"test-sprint","task_num":3,"status":"green","owner":"agent-2","started_at":"2026-02-25T10:00:00Z","completed_at":"2026-02-25T11:00:00Z","merged_at":null}]'

  supabase_pull_tasks "test-sprint" "$db" "my-agent" 2>/dev/null || true

  local merged
  merged=$(sqlite3 "$db" "SELECT merged_at FROM tasks WHERE sprint='test-sprint' AND task_num=3;")
  assert_equals "2026-02-25T12:00:00Z" "$merged" "merged_at should be sticky (never unset)"
}

test_pull_empty_response() {
  source_client
  local db="$TEST_DIR/.pm/tasks.db"

  # Empty array response
  set_mock_task_response '[]'

  local result=0
  supabase_pull_tasks "test-sprint" "$db" "my-agent" 2>/dev/null || result=$?
  assert_equals "0" "$result" "Empty response should return 0 (no tasks to pull)"
}

# =============================================================================
# Run tests
# =============================================================================

echo ""
echo -e "${BOLD}N2O Supabase Client — E2E Tests${NC}"
echo -e "${BOLD}================================${NC}"

echo ""
echo -e "${BOLD}Schema Validation${NC}"
run_test "Schema defines all required tables"           test_schema_valid_sql
run_test "Schema enables real-time subscriptions"       test_schema_has_realtime
run_test "Schema enables row-level security"            test_schema_has_rls
run_test "Schema has required indexes"                  test_schema_has_indexes

echo ""
echo -e "${BOLD}Configuration${NC}"
run_test "Initializes from environment variables"       test_init_from_env
run_test "Initializes from config.json + env key"       test_init_from_config
run_test "Fails gracefully without URL"                 test_init_missing_url
run_test "Fails gracefully without key"                 test_init_missing_key

echo ""
echo -e "${BOLD}Task Sync${NC}"
run_test "Upserts single task to Supabase"              test_upsert_task
run_test "Handles nonexistent task"                     test_upsert_task_not_found
run_test "Syncs all tasks in sprint"                    test_sync_all_tasks
run_test "Handles empty sprint"                         test_sync_empty_sprint

echo ""
echo -e "${BOLD}Agent Registry${NC}"
run_test "Registers agent"                              test_register_agent
run_test "Sends heartbeat with files"                   test_heartbeat
run_test "Deregisters agent"                            test_deregister_agent
run_test "Gets active agents"                           test_get_agents
run_test "Filters agents by developer"                  test_get_agents_filtered

echo ""
echo -e "${BOLD}Activity Log${NC}"
run_test "Logs coordination event"                      test_log_event
run_test "Logs with minimal args"                       test_log_event_minimal

echo ""
echo -e "${BOLD}Claim Verification${NC}"
run_test "Accepts successful claim"                     test_claim_verify_success
run_test "Rejects contested claim"                      test_claim_verify_rejected

echo ""
echo -e "${BOLD}Working Sets${NC}"
run_test "Gets active working sets"                     test_get_working_sets

echo ""
echo -e "${BOLD}Developer Twins${NC}"
run_test "Updates twin state"                           test_update_twin
run_test "Gets twin state"                              test_get_twin

echo ""
echo -e "${BOLD}Connectivity${NC}"
run_test "Ping returns success on 200"                  test_ping_success
run_test "Ping returns failure on error"                test_ping_failure

echo ""
echo -e "${BOLD}Transcript Sync${NC}"
run_test "Upserts transcript to Supabase"               test_upsert_transcript
run_test "Sets synced_at after upsert"                  test_upsert_transcript_sets_synced_at
run_test "Handles nonexistent transcript"               test_upsert_transcript_not_found
run_test "Diff-based sync skips already-synced"         test_sync_all_transcripts_diff
run_test "Reports nothing when all synced"              test_sync_all_transcripts_nothing_to_sync
run_test "Supabase schema has transcript columns"       test_schema_has_transcripts_columns
run_test "Supabase schema has developer summary view"   test_schema_has_developer_summary_view
run_test "Records sync failure with attempt count"      test_upsert_transcript_records_failure
run_test "Skips permanently failed rows (>=5 attempts)" test_sync_skips_permanently_failed
run_test "Batch failure falls back to individual sync"  test_sync_batch_fallback_to_individual

echo ""
echo -e "${BOLD}Task Pull${NC}"
run_test "Pull updates unowned tasks from Supabase"     test_pull_updates_unowned_tasks
run_test "Pull skips tasks owned by local agent"        test_pull_skips_own_tasks
run_test "Pull status never regresses"                  test_pull_status_never_regresses
run_test "Pull leaves definition fields untouched"      test_pull_definitions_untouched
run_test "Pull handles Supabase down gracefully"        test_pull_handles_supabase_down
run_test "Pull supersession resets local claim"         test_pull_supersession_resets_local
run_test "Pull preserves sticky merged_at"              test_pull_merged_at_sticky
run_test "Pull handles empty response"                  test_pull_empty_response

echo ""
echo -e "${BOLD}Error Handling${NC}"
run_test "Fails without configuration"                  test_request_without_init
run_test "Handles HTTP errors"                          test_http_error_handling

echo ""
echo -e "${BOLD}Results: $PASS passed, $FAIL failed, $TOTAL total${NC}"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo -e "${RED}Failed tests:${NC}"
  for t in "${FAILED_TESTS[@]}"; do
    echo -e "  ${RED}-${NC} $t"
  done
  echo ""
  exit 1
fi

echo ""
echo -e "${GREEN}All tests passed.${NC}"
echo ""
