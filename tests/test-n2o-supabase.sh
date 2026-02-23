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
