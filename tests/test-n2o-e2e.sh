#!/bin/bash
set -uo pipefail

# =============================================================================
# E2E Tests for: Full N2O User Journey
# Walks through: init → transcript collection → stats → sync → check
# Usage: bash tests/test-n2o-e2e.sh
# =============================================================================

N2O_DIR="$(cd "$(dirname "$0")/.." && pwd)"
N2O="$N2O_DIR/n2o"
COLLECT="$N2O_DIR/scripts/collect-transcripts.sh"
HOOK="$N2O_DIR/scripts/n2o-session-hook.sh"
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
# Test harness (same pattern as test-n2o-transcripts.sh)
# -----------------------------------------------------------------------------

TEST_DIR=""
CLAUDE_TEST_DIR=""
CURRENT_TEST=""

setup() {
  TEST_DIR=$(mktemp -d)
  "$N2O" init "$TEST_DIR" > /dev/null 2>&1

  # Encode project path for Claude dir (same logic as collect-transcripts.sh)
  local encoded="${TEST_DIR//\//-}"
  encoded="${encoded#-}"
  CLAUDE_TEST_DIR="$HOME/.claude/projects/-${encoded}"
  mkdir -p "$CLAUDE_TEST_DIR"
}

teardown() {
  if [[ -n "$TEST_DIR" && -d "$TEST_DIR" ]]; then
    rm -rf "$TEST_DIR"
  fi
  if [[ -n "$CLAUDE_TEST_DIR" && -d "$CLAUDE_TEST_DIR" ]]; then
    rm -rf "$CLAUDE_TEST_DIR"
  fi
  TEST_DIR=""
  CLAUDE_TEST_DIR=""
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
      grep "ASSERT FAILED" "$err_file" | head -3 | sed 's/^/    /'
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

assert_file_exists() {
  local path="$1"
  local msg="${2:-File should exist: $path}"
  if [[ ! -f "$path" ]]; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

assert_file_contains() {
  local path="$1"
  local pattern="$2"
  local msg="${3:-File $path should contain: $pattern}"
  if ! grep -qF "$pattern" "$path" 2>/dev/null; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

assert_output_contains() {
  local output="$1"
  local pattern="$2"
  local msg="${3:-Output should contain: $pattern}"
  if [[ "$output" != *"$pattern"* ]]; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

assert_sqlite_table_exists() {
  local db="$1"
  local table="$2"
  local msg="${3:-Table '$table' should exist in $db}"
  local result
  result=$(sqlite3 "$db" "SELECT name FROM sqlite_master WHERE type='table' AND name='$table';" 2>/dev/null)
  if [[ "$result" != "$table" ]]; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

assert_json_field() {
  local path="$1"
  local field="$2"
  local expected="$3"
  local msg="${4:-$path: .$field should be '$expected'}"
  local actual
  actual=$(jq -r "$field" "$path" 2>/dev/null)
  if [[ "$actual" != "$expected" ]]; then
    echo "    ASSERT FAILED: $msg (got '$actual')" >&2
    return 1
  fi
}

# -----------------------------------------------------------------------------
# Fixture: realistic JSONL transcript
# 7 lines, 2 user + 4 assistant + 1 system = 7 messages
# Token sums: 2600 input, 1050 output
# Tool calls: Read, Grep, Skill(tdd-agent), Edit, Write, Task = 6 total
# -----------------------------------------------------------------------------

create_e2e_transcript() {
  local dir="$1"
  local session_id="${2:-e2e-session-001}"
  mkdir -p "$dir"
  cat > "$dir/${session_id}.jsonl" <<JSONL
{"type":"system","sessionId":"$session_id","timestamp":"2025-02-20T10:00:00Z","message":{"role":"system","content":"System init"}}
{"type":"user","sessionId":"$session_id","timestamp":"2025-02-20T10:00:01Z","message":{"role":"user","content":[{"type":"text","text":"Implement the CSV parser"}]}}
{"type":"assistant","sessionId":"$session_id","timestamp":"2025-02-20T10:00:10Z","message":{"role":"assistant","model":"claude-sonnet-4-20250514","content":[{"type":"tool_use","id":"toolu_read1","name":"Read","input":{"file_path":"/tmp/src/parser.ts"}},{"type":"tool_use","id":"toolu_grep1","name":"Grep","input":{"path":"/tmp/src","pattern":"export"}}],"usage":{"input_tokens":500,"output_tokens":200}}}
{"type":"assistant","sessionId":"$session_id","timestamp":"2025-02-20T10:00:20Z","message":{"role":"assistant","model":"claude-sonnet-4-20250514","content":[{"type":"tool_use","id":"toolu_skill1","name":"Skill","input":{"skill":"tdd-agent"}}],"usage":{"input_tokens":1000,"output_tokens":400}}}
{"type":"user","sessionId":"$session_id","timestamp":"2025-02-20T10:00:30Z","message":{"role":"user","content":[{"type":"text","text":"Looks good, continue"}]}}
{"type":"assistant","sessionId":"$session_id","timestamp":"2025-02-20T10:00:40Z","message":{"role":"assistant","model":"claude-sonnet-4-20250514","content":[{"type":"tool_use","id":"toolu_edit1","name":"Edit","input":{"file_path":"/tmp/src/parser.ts","old_string":"a","new_string":"b"}},{"type":"tool_use","id":"toolu_write1","name":"Write","input":{"file_path":"/tmp/src/test.ts","content":"test"}}],"usage":{"input_tokens":800,"output_tokens":350}}}
{"type":"assistant","sessionId":"$session_id","timestamp":"2025-02-20T10:00:50Z","message":{"role":"assistant","model":"claude-sonnet-4-20250514","content":[{"type":"tool_use","id":"toolu_task1","name":"Task","input":{"description":"explore codebase","prompt":"find files"}}],"usage":{"input_tokens":300,"output_tokens":100}}}
JSONL
}

# Helper: init + create transcript + collect
setup_with_transcript() {
  create_e2e_transcript "$CLAUDE_TEST_DIR" "e2e-session-001"
  (cd "$TEST_DIR" && bash "$COLLECT" --quiet) > /dev/null 2>&1
}

# -----------------------------------------------------------------------------
# Tests
# -----------------------------------------------------------------------------

test_e2e_init() {
  # Verify n2o init created all required structure
  local db="$TEST_DIR/.pm/tasks.db"

  assert_file_exists "$db" "tasks.db should be created by init"
  assert_file_exists "$TEST_DIR/.pm/config.json" "config.json should be created by init"
  assert_file_exists "$TEST_DIR/.pm/schema.sql" "schema.sql should be created by init"
  assert_file_exists "$TEST_DIR/.pm/rates.json" "rates.json should be copied by init"
  assert_file_exists "$TEST_DIR/CLAUDE.md" "CLAUDE.md should be created by init"

  # Verify specific table existence AND content schema
  assert_sqlite_table_exists "$db" "tasks" "tasks table must exist"
  assert_sqlite_table_exists "$db" "transcripts" "transcripts table must exist"
  assert_sqlite_table_exists "$db" "workflow_events" "workflow_events table must exist"
  assert_sqlite_table_exists "$db" "_migrations" "migrations table must exist"

  # Verify config has correct version (not just "exists")
  local current_version
  current_version=$(jq -r '.version' "$N2O_DIR/n2o-manifest.json")
  assert_json_field "$TEST_DIR/.pm/config.json" ".n2o_version" "$current_version"

  # Verify rates.json has the expected model structure
  assert_json_field "$TEST_DIR/.pm/rates.json" ".models.sonnet.output" "15"
}

test_e2e_seed_tasks() {
  local db="$TEST_DIR/.pm/tasks.db"

  # Insert tasks with specific statuses
  sqlite3 "$db" "
    INSERT INTO tasks (sprint, task_num, title, type, status) VALUES ('e2e-sprint', 1, 'Build parser', 'frontend', 'green');
    INSERT INTO tasks (sprint, task_num, title, type, status) VALUES ('e2e-sprint', 2, 'Add tests', 'e2e', 'pending');
    INSERT INTO tasks (sprint, task_num, title, type, status) VALUES ('e2e-sprint', 3, 'Deploy', 'infra', 'red');
  "

  # Verify sprint_progress view returns exact counts
  local total
  total=$(sqlite3 "$db" "SELECT total_tasks FROM sprint_progress WHERE sprint='e2e-sprint';")
  assert_equals "3" "$total" "sprint_progress should show 3 total tasks"

  local green
  green=$(sqlite3 "$db" "SELECT green FROM sprint_progress WHERE sprint='e2e-sprint';")
  assert_equals "1" "$green" "sprint_progress should show 1 green task"

  local pending
  pending=$(sqlite3 "$db" "SELECT pending FROM sprint_progress WHERE sprint='e2e-sprint';")
  assert_equals "1" "$pending" "sprint_progress should show 1 pending task"

  local red
  red=$(sqlite3 "$db" "SELECT red FROM sprint_progress WHERE sprint='e2e-sprint';")
  assert_equals "1" "$red" "sprint_progress should show 1 red task"

  # Verify available_tasks view (only pending + no owner + active horizon)
  local available_title
  available_title=$(sqlite3 "$db" "SELECT title FROM available_tasks WHERE sprint='e2e-sprint';")
  assert_equals "Add tests" "$available_title" "available_tasks should return the pending task"
}

test_e2e_transcript_collection() {
  setup_with_transcript
  local db="$TEST_DIR/.pm/tasks.db"

  # Verify exact transcript metadata
  local count
  count=$(sqlite3 "$db" "SELECT COUNT(*) FROM transcripts;")
  assert_equals "1" "$count" "Should have exactly 1 transcript"

  local msg_count
  msg_count=$(sqlite3 "$db" "SELECT message_count FROM transcripts LIMIT 1;")
  assert_equals "7" "$msg_count" "Should have 7 messages (1 system + 2 user + 4 assistant)"

  local user_count
  user_count=$(sqlite3 "$db" "SELECT user_message_count FROM transcripts LIMIT 1;")
  assert_equals "2" "$user_count" "Should have 2 user messages"

  local assistant_count
  assistant_count=$(sqlite3 "$db" "SELECT assistant_message_count FROM transcripts LIMIT 1;")
  assert_equals "4" "$assistant_count" "Should have 4 assistant messages"

  local tool_count
  tool_count=$(sqlite3 "$db" "SELECT tool_call_count FROM transcripts LIMIT 1;")
  assert_equals "6" "$tool_count" "Should have 6 tool calls (Read+Grep+Skill+Edit+Write+Task)"

  local input_tokens
  input_tokens=$(sqlite3 "$db" "SELECT total_input_tokens FROM transcripts LIMIT 1;")
  assert_equals "2600" "$input_tokens" "Input tokens should be 500+1000+800+300=2600"

  local output_tokens
  output_tokens=$(sqlite3 "$db" "SELECT total_output_tokens FROM transcripts LIMIT 1;")
  assert_equals "1050" "$output_tokens" "Output tokens should be 200+400+350+100=1050"

  local model
  model=$(sqlite3 "$db" "SELECT model FROM transcripts LIMIT 1;")
  assert_equals "claude-sonnet-4-20250514" "$model" "Model should be claude-sonnet-4-20250514"
}

test_e2e_workflow_events() {
  setup_with_transcript
  local db="$TEST_DIR/.pm/tasks.db"

  # Verify total event count
  local total_events
  total_events=$(sqlite3 "$db" "SELECT COUNT(*) FROM workflow_events;")
  assert_equals "6" "$total_events" "Should have 6 workflow events"

  # Verify event type breakdown
  local tool_calls
  tool_calls=$(sqlite3 "$db" "SELECT COUNT(*) FROM workflow_events WHERE event_type='tool_call';")
  assert_equals "4" "$tool_calls" "Should have 4 tool_call events (Read, Grep, Edit, Write)"

  local skill_invoked
  skill_invoked=$(sqlite3 "$db" "SELECT COUNT(*) FROM workflow_events WHERE event_type='skill_invoked';")
  assert_equals "1" "$skill_invoked" "Should have 1 skill_invoked event"

  local subagent_spawn
  subagent_spawn=$(sqlite3 "$db" "SELECT COUNT(*) FROM workflow_events WHERE event_type='subagent_spawn';")
  assert_equals "1" "$subagent_spawn" "Should have 1 subagent_spawn event"

  # Verify the skill name was extracted correctly
  local skill_name
  skill_name=$(sqlite3 "$db" "SELECT skill_name FROM workflow_events WHERE event_type='skill_invoked';")
  assert_equals "tdd-agent" "$skill_name" "Skill invocation should capture skill_name='tdd-agent'"

  # Verify the subagent tool name
  local spawn_tool
  spawn_tool=$(sqlite3 "$db" "SELECT tool_name FROM workflow_events WHERE event_type='subagent_spawn';")
  assert_equals "Task" "$spawn_tool" "Subagent spawn tool_name should be 'Task'"
}

test_e2e_cost_estimation() {
  setup_with_transcript
  local db="$TEST_DIR/.pm/tasks.db"

  # Expected cost: sonnet rates from rates.json: input=3, output=15 per million
  # (2600 * 3 + 1050 * 15) / 1000000 = (7800 + 15750) / 1000000 = 0.023550
  local cost
  cost=$(sqlite3 "$db" "SELECT estimated_cost_usd FROM transcripts LIMIT 1;")
  assert_equals "0.02355" "$cost" "Cost should be (2600*3 + 1050*15)/1000000 = 0.02355"

  # Verify cost is not NULL (rate card was actually loaded)
  if [[ "$cost" == "NULL" || "$cost" == "" ]]; then
    echo "    ASSERT FAILED: Cost should not be NULL — rates.json not loaded" >&2
    return 1
  fi

  # Verify rates.json was used (exists in project)
  assert_file_exists "$TEST_DIR/.pm/rates.json" "rates.json must exist for cost calculation"
}

test_e2e_idempotent_collection() {
  setup_with_transcript
  local db="$TEST_DIR/.pm/tasks.db"

  # Verify initial state before re-run
  local initial_count
  initial_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM transcripts;")
  assert_equals "1" "$initial_count" "Should have 1 transcript before re-run"

  # Run collection again
  (cd "$TEST_DIR" && bash "$COLLECT" --quiet) > /dev/null 2>&1

  # Should still have exactly 1 transcript (not 2)
  local count
  count=$(sqlite3 "$db" "SELECT COUNT(*) FROM transcripts;")
  assert_equals "1" "$count" "Idempotent: should still have 1 transcript after re-run"

  # Events should also not be duplicated
  local events
  events=$(sqlite3 "$db" "SELECT COUNT(*) FROM workflow_events;")
  assert_equals "6" "$events" "Idempotent: should still have 6 events after re-run"

  # Token sums should be unchanged (not doubled)
  local input_tokens
  input_tokens=$(sqlite3 "$db" "SELECT total_input_tokens FROM transcripts LIMIT 1;")
  assert_equals "2600" "$input_tokens" "Idempotent: input tokens should still be 2600"
}

test_e2e_stats_json() {
  local output
  output=$("$N2O" stats --json 2>/dev/null)

  # Must be valid JSON
  echo "$output" | jq . > /dev/null 2>&1
  assert_equals "0" "$?" "stats --json should produce valid JSON"

  # Verify all required top-level keys exist
  local keys
  keys=$(echo "$output" | jq -r 'keys[]' 2>/dev/null | sort | tr '\n' ',')
  assert_output_contains "$keys" "sessions" "JSON should have 'sessions' key"
  assert_output_contains "$keys" "leadership_metrics" "JSON should have 'leadership_metrics' key"
  assert_output_contains "$keys" "sprint_progress" "JSON should have 'sprint_progress' key"
  assert_output_contains "$keys" "tool_usage" "JSON should have 'tool_usage' key"
  assert_output_contains "$keys" "available_tasks" "JSON should have 'available_tasks' key"
  assert_output_contains "$keys" "skill_quality" "JSON should have 'skill_quality' key"
  assert_output_contains "$keys" "skill_versions" "JSON should have 'skill_versions' key"
}

test_e2e_stats_terminal() {
  local output
  output=$("$N2O" stats 2>&1)

  # Verify section headers appear in terminal output
  assert_output_contains "$output" "Session Summary" "Stats should show Session Summary section"
  assert_output_contains "$output" "Leadership Metrics" "Stats should show Leadership Metrics section"
  assert_output_contains "$output" "Sprint Progress" "Stats should show Sprint Progress section"
  assert_output_contains "$output" "Available Tasks" "Stats should show Available Tasks section"
  assert_output_contains "$output" "Skill Quality" "Stats should show Skill Quality section"
}

test_e2e_check_passes() {
  local output
  local exit_code=0
  output=$("$N2O" check "$TEST_DIR" 2>&1) || exit_code=$?

  assert_equals "0" "$exit_code" "n2o check should pass on a freshly-inited project"
  assert_output_contains "$output" "passed" "Check output should say 'passed'"
}

test_e2e_check_detects_broken() {
  # Break the project by removing config
  rm -f "$TEST_DIR/.pm/config.json"

  local output
  local exit_code=0
  output=$("$N2O" check "$TEST_DIR" 2>&1) || exit_code=$?

  assert_equals "1" "$exit_code" "n2o check should fail on broken project"
  assert_output_contains "$output" "missing" "Check output should mention missing config"
}

test_e2e_sync_restores_schema() {
  # Truncate schema to simulate corruption
  echo "-- CORRUPTED" > "$TEST_DIR/.pm/schema.sql"

  "$N2O" sync "$TEST_DIR" > /dev/null 2>&1

  # Schema should be restored with actual content
  assert_file_contains "$TEST_DIR/.pm/schema.sql" "CREATE TABLE IF NOT EXISTS tasks" \
    "schema.sql should contain tasks table definition after sync"
  assert_file_contains "$TEST_DIR/.pm/schema.sql" "CREATE VIEW" \
    "schema.sql should contain views after sync"

  # The corruption should be gone
  if grep -q "CORRUPTED" "$TEST_DIR/.pm/schema.sql"; then
    echo "    ASSERT FAILED: schema.sql should not contain corruption marker after sync" >&2
    return 1
  fi
}

test_e2e_sync_preserves_config() {
  # Customize config with multiple fields
  local tmp
  tmp=$(mktemp)
  jq '.project_name = "my-special-project" | .developer_name = "test-dev"' "$TEST_DIR/.pm/config.json" > "$tmp"
  mv "$tmp" "$TEST_DIR/.pm/config.json"

  "$N2O" sync "$TEST_DIR" > /dev/null 2>&1

  # Custom project_name should survive sync
  assert_json_field "$TEST_DIR/.pm/config.json" ".project_name" "my-special-project" \
    "Config project_name should survive sync"

  # Custom developer_name should survive sync
  assert_json_field "$TEST_DIR/.pm/config.json" ".developer_name" "test-dev" \
    "Config developer_name should survive sync"

  # Version should be updated though
  local current_version
  current_version=$(jq -r '.version' "$N2O_DIR/n2o-manifest.json")
  assert_json_field "$TEST_DIR/.pm/config.json" ".n2o_version" "$current_version" \
    "Config n2o_version should be updated by sync"
}

test_e2e_session_hook_fires() {
  # The session hook reads from .pm/config.json in cwd
  local output
  output=$(cd "$TEST_DIR" && echo '{"source":"startup","cwd":"'"$TEST_DIR"'"}' | bash "$HOOK" 2>/dev/null) || true

  # Hook should output developer context info
  assert_output_contains "$output" "Developer:" "Session hook should output developer info"
}

test_e2e_session_end_hook_registered() {
  # After n2o init, .claude/settings.json should have a SessionEnd hook
  # that calls collect-transcripts.sh
  local settings="$TEST_DIR/.claude/settings.json"
  assert_file_exists "$settings" "settings.json should exist after init"

  # Must have SessionEnd key
  local has_session_end
  has_session_end=$(jq -e '.hooks.SessionEnd' "$settings" 2>/dev/null && echo "yes" || echo "no")
  assert_equals "yes" "$has_session_end" "settings.json should have SessionEnd hook"

  # The command must reference collect-transcripts.sh
  local cmd
  cmd=$(jq -r '.hooks.SessionEnd[0].hooks[0].command' "$settings" 2>/dev/null)
  assert_output_contains "$cmd" "collect-transcripts.sh" "SessionEnd hook should call collect-transcripts.sh"
}

test_e2e_concurrent_sessions_persisted() {
  # Pipe a startup event to the session hook and verify developer_context gets a row
  local db="$TEST_DIR/.pm/tasks.db"

  # Ensure developer_context table exists (init should have created it via schema)
  assert_sqlite_table_exists "$db" "developer_context" "developer_context table must exist after init"

  # Fire the session hook
  (cd "$TEST_DIR" && echo '{"source":"startup","cwd":"'"$TEST_DIR"'"}' | bash "$HOOK" 2>/dev/null) || true

  # Check that a row was inserted with concurrent_sessions >= 1
  local row_count
  row_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM developer_context WHERE concurrent_sessions >= 1;" 2>/dev/null)
  assert_equals "1" "$row_count" "developer_context should have 1 row after session hook fires"

  # Verify the developer name was captured
  local dev_name
  dev_name=$(sqlite3 "$db" "SELECT developer FROM developer_context LIMIT 1;" 2>/dev/null)
  if [[ -z "$dev_name" || "$dev_name" == "NULL" ]]; then
    echo "    ASSERT FAILED: developer_context.developer should not be empty" >&2
    return 1
  fi

  # Verify hour_of_day is a valid hour (0-23)
  local hour
  hour=$(sqlite3 "$db" "SELECT hour_of_day FROM developer_context LIMIT 1;" 2>/dev/null)
  if [[ "$hour" -lt 0 || "$hour" -gt 23 ]]; then
    echo "    ASSERT FAILED: hour_of_day should be 0-23, got '$hour'" >&2
    return 1
  fi
}

# -----------------------------------------------------------------------------
# Run all tests
# -----------------------------------------------------------------------------

echo ""
echo -e "${BOLD}N2O E2E — Full User Journey Tests${NC}"
echo -e "${BOLD}===================================${NC}"
echo ""

echo -e "${BOLD}Init & Scaffolding${NC}"
run_test "Init creates complete project structure"       test_e2e_init
run_test "Task seeding + views return correct data"      test_e2e_seed_tasks

echo ""
echo -e "${BOLD}Transcript Collection${NC}"
run_test "JSONL parsing extracts exact metadata"         test_e2e_transcript_collection
run_test "Workflow events classified correctly"          test_e2e_workflow_events
run_test "Cost estimation uses rate card math"           test_e2e_cost_estimation
run_test "Collection is idempotent"                      test_e2e_idempotent_collection

echo ""
echo -e "${BOLD}Stats${NC}"
run_test "Stats JSON has all required keys"              test_e2e_stats_json
run_test "Stats terminal shows all sections"             test_e2e_stats_terminal

echo ""
echo -e "${BOLD}Health Check${NC}"
run_test "Check passes on healthy project"               test_e2e_check_passes
run_test "Check detects broken project"                  test_e2e_check_detects_broken

echo ""
echo -e "${BOLD}Sync${NC}"
run_test "Sync restores corrupted schema"                test_e2e_sync_restores_schema
run_test "Sync preserves config customizations"          test_e2e_sync_preserves_config

echo ""
echo -e "${BOLD}Session Hook${NC}"
run_test "Session hook outputs developer context"        test_e2e_session_hook_fires
run_test "SessionEnd hook registered after init"         test_e2e_session_end_hook_registered
run_test "Concurrent sessions persisted to DB"           test_e2e_concurrent_sessions_persisted

# Summary
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
