#!/bin/bash
set -uo pipefail

# =============================================================================
# E2E Tests for: n2o stats
# Pure bash — no external test frameworks required.
# Usage: bash tests/test-n2o-stats.sh
# =============================================================================

N2O_DIR="$(cd "$(dirname "$0")/.." && pwd)"
N2O="$N2O_DIR/n2o"
SCHEMA="$N2O_DIR/.pm/schema.sql"
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

setup() {
  TEST_DIR=$(mktemp -d)
  # Create a test database from the schema
  mkdir -p "$TEST_DIR/.pm"
  sqlite3 "$TEST_DIR/.pm/tasks.db" < "$SCHEMA"
  # Copy n2o + manifest so N2O_DIR resolves to TEST_DIR with its own DB
  cp "$N2O" "$TEST_DIR/n2o"
  cp "$N2O_DIR/n2o-manifest.json" "$TEST_DIR/n2o-manifest.json"
  # Stub out collect-transcripts so auto-refresh doesn't fail
  mkdir -p "$TEST_DIR/scripts"
  touch "$TEST_DIR/scripts/collect-transcripts.sh"
}

# Run n2o from within TEST_DIR so N2O_DIR resolves to the test directory
run_n2o() {
  bash "$TEST_DIR/n2o" "$@"
}

teardown() {
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

assert_output_contains() {
  local output="$1"
  local pattern="$2"
  local msg="${3:-Output should contain: $pattern}"
  if [[ "$output" != *"$pattern"* ]]; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

assert_exit_code() {
  local expected="$1"
  shift
  local actual=0
  "$@" > /dev/null 2>&1 || actual=$?
  if [[ "$actual" -ne "$expected" ]]; then
    echo "    ASSERT FAILED: Expected exit code $expected, got $actual" >&2
    return 1
  fi
}

# Helper: populate test DB with known data
seed_test_data() {
  local db="$1"
  sqlite3 "$db" <<'SQL'
    INSERT INTO tasks (sprint, task_num, title, status, type, complexity, priority,
                       estimated_hours, owner, started_at, completed_at)
    VALUES
      ('test-sprint', 1, 'Set up infrastructure', 'green', 'infra', 'low', 1.0,
       2.0, 'dev1', '2025-02-20 10:00:00', '2025-02-20 12:00:00'),
      ('test-sprint', 2, 'Implement feature', 'green', 'frontend', 'medium', 2.0,
       4.0, 'dev1', '2025-02-20 13:00:00', '2025-02-20 18:00:00'),
      ('test-sprint', 3, 'Write tests', 'pending', 'e2e', 'low', 3.0,
       1.5, NULL, NULL, NULL);
SQL
}

# -----------------------------------------------------------------------------
# CLI smoke tests (run against real framework DB)
# -----------------------------------------------------------------------------

test_stats_smoke() {
  local output
  output=$("$N2O" stats 2>&1) || true
  # Just verify it doesn't crash — exit 0 or produces output
  if [[ -z "$output" ]]; then
    echo "    ASSERT FAILED: n2o stats produced no output" >&2
    return 1
  fi
}

test_stats_json_smoke() {
  local output
  output=$("$N2O" stats --json 2>&1)
  # Verify it's valid JSON
  echo "$output" | jq . > /dev/null 2>&1
  if [[ $? -ne 0 ]]; then
    echo "    ASSERT FAILED: n2o stats --json did not produce valid JSON" >&2
    return 1
  fi
}

test_stats_json_has_required_keys() {
  local output
  output=$("$N2O" stats --json 2>&1)

  local has_sessions has_tools has_sprints has_available has_quality
  has_sessions=$(echo "$output" | jq 'has("sessions")' 2>/dev/null)
  has_tools=$(echo "$output" | jq 'has("tool_usage")' 2>/dev/null)
  has_sprints=$(echo "$output" | jq 'has("sprint_progress")' 2>/dev/null)
  has_available=$(echo "$output" | jq 'has("available_tasks")' 2>/dev/null)
  has_quality=$(echo "$output" | jq 'has("skill_quality")' 2>/dev/null)

  assert_equals "true" "$has_sessions" "JSON should have 'sessions' key"
  assert_equals "true" "$has_tools" "JSON should have 'tool_usage' key"
  assert_equals "true" "$has_sprints" "JSON should have 'sprint_progress' key"
  assert_equals "true" "$has_available" "JSON should have 'available_tasks' key"
  assert_equals "true" "$has_quality" "JSON should have 'skill_quality' key"
}

test_stats_terminal_has_sections() {
  local output
  output=$("$N2O" stats 2>&1)

  assert_output_contains "$output" "Session Summary"
  assert_output_contains "$output" "Tool Usage"
  assert_output_contains "$output" "Sprint Progress"
  assert_output_contains "$output" "Available Tasks"
  assert_output_contains "$output" "Skill Quality"
}

test_stats_unknown_option() {
  assert_exit_code 1 "$N2O" stats --bad
}

# -----------------------------------------------------------------------------
# SQL query tests (against purpose-built test DB)
# -----------------------------------------------------------------------------

test_stats_query_sprint_progress() {
  local db="$TEST_DIR/.pm/tasks.db"
  seed_test_data "$db"

  local total
  total=$(sqlite3 "$db" "SELECT total_tasks FROM sprint_progress WHERE sprint='test-sprint';")
  assert_equals "3" "$total" "Sprint should have 3 total tasks"

  local green
  green=$(sqlite3 "$db" "SELECT green FROM sprint_progress WHERE sprint='test-sprint';")
  assert_equals "2" "$green" "Sprint should have 2 green tasks"

  local pending
  pending=$(sqlite3 "$db" "SELECT pending FROM sprint_progress WHERE sprint='test-sprint';")
  assert_equals "1" "$pending" "Sprint should have 1 pending task"

  local pct
  pct=$(sqlite3 "$db" "SELECT percent_complete FROM sprint_progress WHERE sprint='test-sprint';")
  # 2/3 = 66.7%
  assert_equals "66.7" "$pct" "Sprint should be 66.7% complete"
}

test_stats_query_velocity() {
  local db="$TEST_DIR/.pm/tasks.db"
  seed_test_data "$db"

  local avg_hours
  avg_hours=$(sqlite3 "$db" "SELECT avg_hours_per_task FROM sprint_velocity WHERE sprint='test-sprint';")
  # Task 1: 2h, Task 2: 5h → avg = 3.5
  assert_equals "3.5" "$avg_hours" "Average hours per task should be 3.5"

  local total_hours
  total_hours=$(sqlite3 "$db" "SELECT total_hours FROM sprint_velocity WHERE sprint='test-sprint';")
  assert_equals "7.0" "$total_hours" "Total hours should be 7.0"
}

test_stats_query_estimation_accuracy() {
  local db="$TEST_DIR/.pm/tasks.db"
  seed_test_data "$db"

  local blow_up
  blow_up=$(sqlite3 "$db" "SELECT blow_up_ratio FROM estimation_accuracy WHERE owner='dev1';")
  # Estimated avg: (2+4)/2 = 3h, Actual avg: (2+5)/2 = 3.5h → ratio = 3.5/3 = 1.17
  assert_equals "1.17" "$blow_up" "Blow-up ratio should be 1.17"
}

# Helper: seed workflow_events for --compare tests
# Creates two versions (1.0.0 and 2.0.0) of tdd-agent with known token/duration data.
# v1.0.0: 1 task, 2 tool_calls (Read + Edit), 1 skill_invoked + task_completed pair (120s apart)
# v2.0.0: 1 task, 2 tool_calls (Read + Edit), 1 skill_invoked + task_completed pair (60s apart)
seed_compare_data() {
  local db="$1"
  # Need tasks for FK references
  sqlite3 "$db" <<'SQL'
    INSERT INTO tasks (sprint, task_num, title, status) VALUES
      ('cmp', 1, 'Task v1', 'green'),
      ('cmp', 2, 'Task v2', 'green');

    -- v1.0.0: tool_calls with tokens (for skill_version_token_usage view)
    INSERT INTO workflow_events (session_id, sprint, task_num, event_type, tool_name, skill_name, skill_version, input_tokens, output_tokens, tool_calls_in_msg, metadata, timestamp) VALUES
      ('s1', 'cmp', 1, 'tool_call', 'Read',  'tdd-agent', '1.0.0', 500,  100, 1, '{"file_path":"/src/a.ts"}',   '2025-02-20 10:00:00'),
      ('s1', 'cmp', 1, 'tool_call', 'Edit',  'tdd-agent', '1.0.0', 800,  200, 1, '{"file_path":"/src/b.ts"}',   '2025-02-20 10:00:10');

    -- v1.0.0: skill_invoked + task_completed pair (for skill_version_duration view, 120s apart)
    INSERT INTO workflow_events (session_id, sprint, task_num, event_type, tool_name, skill_name, skill_version, timestamp) VALUES
      ('s1', 'cmp', 1, 'skill_invoked',   'Skill', 'tdd-agent', '1.0.0', '2025-02-20 10:00:00'),
      ('s1', 'cmp', 1, 'task_completed',  'Skill', 'tdd-agent', '1.0.0', '2025-02-20 10:02:00');

    -- v2.0.0: tool_calls with tokens (improved — fewer tokens)
    INSERT INTO workflow_events (session_id, sprint, task_num, event_type, tool_name, skill_name, skill_version, input_tokens, output_tokens, tool_calls_in_msg, metadata, timestamp) VALUES
      ('s2', 'cmp', 2, 'tool_call', 'Read',  'tdd-agent', '2.0.0', 300,  80,  1, '{"file_path":"/src/c.ts"}',   '2025-02-20 11:00:00'),
      ('s2', 'cmp', 2, 'tool_call', 'Edit',  'tdd-agent', '2.0.0', 400,  90,  1, '{"file_path":"/src/d.ts"}',   '2025-02-20 11:00:10');

    -- v2.0.0: skill_invoked + task_completed pair (faster — 60s apart)
    INSERT INTO workflow_events (session_id, sprint, task_num, event_type, tool_name, skill_name, skill_version, timestamp) VALUES
      ('s2', 'cmp', 2, 'skill_invoked',   'Skill', 'tdd-agent', '2.0.0', '2025-02-20 11:00:00'),
      ('s2', 'cmp', 2, 'task_completed',  'Skill', 'tdd-agent', '2.0.0', '2025-02-20 11:01:00');
SQL
}

# -----------------------------------------------------------------------------
# --compare tests (against purpose-built test DB)
# -----------------------------------------------------------------------------

test_stats_compare_json_structure() {
  local db="$TEST_DIR/.pm/tasks.db"
  seed_compare_data "$db"

  local output
  output=$(run_n2o stats --compare tdd-agent --json 2>&1)

  # Must be valid JSON
  echo "$output" | jq . > /dev/null 2>&1
  if [[ $? -ne 0 ]]; then
    echo "    ASSERT FAILED: --compare --json did not produce valid JSON" >&2
    return 1
  fi

  # Must have required top-level keys
  local skill
  skill=$(echo "$output" | jq -r '.skill' 2>/dev/null)
  assert_equals "tdd-agent" "$skill" "JSON .skill should be 'tdd-agent'"

  local has_token has_duration has_precision
  has_token=$(echo "$output" | jq 'has("comparison") and (.comparison | has("token_usage"))' 2>/dev/null)
  has_duration=$(echo "$output" | jq 'has("comparison") and (.comparison | has("duration"))' 2>/dev/null)
  has_precision=$(echo "$output" | jq 'has("comparison") and (.comparison | has("precision"))' 2>/dev/null)

  assert_equals "true" "$has_token" "JSON should have comparison.token_usage"
  assert_equals "true" "$has_duration" "JSON should have comparison.duration"
  assert_equals "true" "$has_precision" "JSON should have comparison.precision"
}

test_stats_compare_json_token_values() {
  local db="$TEST_DIR/.pm/tasks.db"
  seed_compare_data "$db"

  local output
  output=$(run_n2o stats --compare tdd-agent --json 2>&1)

  # Should have 2 version entries in token_usage
  local token_count
  token_count=$(echo "$output" | jq '.comparison.token_usage | length' 2>/dev/null)
  assert_equals "2" "$token_count" "token_usage should have 2 version entries"

  # v1.0.0: input=500+800=1300, output=100+200=300, avg=(600+1000)/2=800
  local v1_input v1_output
  v1_input=$(echo "$output" | jq '.comparison.token_usage[] | select(.skill_version=="1.0.0") | .total_input_tokens' 2>/dev/null)
  v1_output=$(echo "$output" | jq '.comparison.token_usage[] | select(.skill_version=="1.0.0") | .total_output_tokens' 2>/dev/null)
  assert_equals "1300" "$v1_input" "v1.0.0 total_input_tokens should be 1300"
  assert_equals "300" "$v1_output" "v1.0.0 total_output_tokens should be 300"

  # v2.0.0: input=300+400=700, output=80+90=170
  local v2_input v2_output
  v2_input=$(echo "$output" | jq '.comparison.token_usage[] | select(.skill_version=="2.0.0") | .total_input_tokens' 2>/dev/null)
  v2_output=$(echo "$output" | jq '.comparison.token_usage[] | select(.skill_version=="2.0.0") | .total_output_tokens' 2>/dev/null)
  assert_equals "700" "$v2_input" "v2.0.0 total_input_tokens should be 700"
  assert_equals "170" "$v2_output" "v2.0.0 total_output_tokens should be 170"
}

test_stats_compare_json_duration_values() {
  local db="$TEST_DIR/.pm/tasks.db"
  seed_compare_data "$db"

  local output
  output=$(run_n2o stats --compare tdd-agent --json 2>&1)

  # Should have 2 version entries in duration
  local dur_count
  dur_count=$(echo "$output" | jq '.comparison.duration | length' 2>/dev/null)
  assert_equals "2" "$dur_count" "duration should have 2 version entries"

  # v1.0.0: 120 seconds (10:00:00 → 10:02:00)
  local v1_avg
  v1_avg=$(echo "$output" | jq '.comparison.duration[] | select(.skill_version=="1.0.0") | .avg_seconds' 2>/dev/null)
  assert_equals "120.0" "$v1_avg" "v1.0.0 avg_seconds should be 120.0"

  # v2.0.0: 60 seconds (11:00:00 → 11:01:00)
  local v2_avg
  v2_avg=$(echo "$output" | jq '.comparison.duration[] | select(.skill_version=="2.0.0") | .avg_seconds' 2>/dev/null)
  assert_equals "60.0" "$v2_avg" "v2.0.0 avg_seconds should be 60.0"
}

test_stats_compare_json_precision_values() {
  local db="$TEST_DIR/.pm/tasks.db"
  seed_compare_data "$db"

  local output
  output=$(run_n2o stats --compare tdd-agent --json 2>&1)

  # Should have 2 version entries in precision
  local prec_count
  prec_count=$(echo "$output" | jq '.comparison.precision | length' 2>/dev/null)
  assert_equals "2" "$prec_count" "precision should have 2 version entries"

  # Each version has 1 Read + 1 Edit per task → exploration_ratio = 1 - (1/1) = 0.0
  local v1_ratio
  v1_ratio=$(echo "$output" | jq '.comparison.precision[] | select(.skill_version=="1.0.0") | .avg_exploration_ratio' 2>/dev/null)
  assert_equals "0.0" "$v1_ratio" "v1.0.0 exploration ratio should be 0.0 (1 read, 1 edit)"
}

test_stats_compare_terminal_sections() {
  local db="$TEST_DIR/.pm/tasks.db"
  seed_compare_data "$db"

  local output
  output=$(run_n2o stats --compare tdd-agent 2>&1)

  assert_output_contains "$output" "Version Comparison: tdd-agent" "Should show comparison header"
  assert_output_contains "$output" "Token Usage:" "Should show Token Usage section"
  assert_output_contains "$output" "Duration" "Should show Duration section"
  assert_output_contains "$output" "Exploration Ratio:" "Should show Exploration Ratio section"

  # Versions should appear in the output
  assert_output_contains "$output" "1.0.0" "Should show v1.0.0"
  assert_output_contains "$output" "2.0.0" "Should show v2.0.0"
}

test_stats_compare_no_data_terminal() {
  # Compare a skill with no events — should show "No ... data" messages, not crash
  local output
  output=$(run_n2o stats --compare nonexistent-skill 2>&1)

  assert_output_contains "$output" "No token data" "Should show 'No token data' for missing skill"
  assert_output_contains "$output" "No duration data" "Should show 'No duration data' for missing skill"
  assert_output_contains "$output" "No precision data" "Should show 'No precision data' for missing skill"
}

test_stats_compare_no_data_json() {
  local output
  output=$(run_n2o stats --compare nonexistent-skill --json 2>&1)

  # Must be valid JSON with empty arrays
  local token_len duration_len precision_len
  token_len=$(echo "$output" | jq '.comparison.token_usage | length' 2>/dev/null)
  duration_len=$(echo "$output" | jq '.comparison.duration | length' 2>/dev/null)
  precision_len=$(echo "$output" | jq '.comparison.precision | length' 2>/dev/null)

  assert_equals "0" "$token_len" "Empty skill token_usage should be empty array"
  assert_equals "0" "$duration_len" "Empty skill duration should be empty array"
  assert_equals "0" "$precision_len" "Empty skill precision should be empty array"
}

test_stats_empty_db() {
  local db="$TEST_DIR/.pm/tasks.db"

  # Sprint progress should return no rows (not crash)
  local count
  count=$(sqlite3 "$db" "SELECT COUNT(*) FROM sprint_progress;")
  assert_equals "0" "$count" "Empty DB sprint_progress should have 0 rows"

  # Velocity should return no rows
  count=$(sqlite3 "$db" "SELECT COUNT(*) FROM sprint_velocity;")
  assert_equals "0" "$count" "Empty DB sprint_velocity should have 0 rows"

  # Available tasks should return no rows
  count=$(sqlite3 "$db" "SELECT COUNT(*) FROM available_tasks;")
  assert_equals "0" "$count" "Empty DB available_tasks should have 0 rows"

  # Skill usage should return no rows
  count=$(sqlite3 "$db" "SELECT COUNT(*) FROM skill_usage;")
  assert_equals "0" "$count" "Empty DB skill_usage should have 0 rows"
}

# =============================================================================
# Run tests
# =============================================================================

echo ""
echo -e "${BOLD}N2O Stats — E2E Tests${NC}"
echo -e "${BOLD}=====================${NC}"
echo ""

echo -e "${BOLD}CLI Smoke Tests${NC}"
run_test "Stats runs without error"                test_stats_smoke
run_test "Stats --json produces valid JSON"        test_stats_json_smoke
run_test "Stats --json has required keys"          test_stats_json_has_required_keys
run_test "Stats terminal has all sections"         test_stats_terminal_has_sections
run_test "Stats unknown option exits 1"            test_stats_unknown_option

echo ""
echo -e "${BOLD}--compare Tests${NC}"
run_test "Compare JSON has correct structure"        test_stats_compare_json_structure
run_test "Compare JSON token values match seeds"     test_stats_compare_json_token_values
run_test "Compare JSON duration values match seeds"  test_stats_compare_json_duration_values
run_test "Compare JSON precision values match seeds" test_stats_compare_json_precision_values
run_test "Compare terminal shows all sections"       test_stats_compare_terminal_sections
run_test "Compare no-data terminal shows fallbacks"  test_stats_compare_no_data_terminal
run_test "Compare no-data JSON returns empty arrays" test_stats_compare_no_data_json

echo ""
echo -e "${BOLD}SQL Query Tests${NC}"
run_test "Sprint progress with known data"         test_stats_query_sprint_progress
run_test "Sprint velocity with known data"         test_stats_query_velocity
run_test "Estimation accuracy with known data"     test_stats_query_estimation_accuracy
run_test "Empty DB queries don't crash"            test_stats_empty_db

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
