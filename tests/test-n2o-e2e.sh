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

test_e2e_all_skills_deployed() {
  # After n2o init, all 6 skills should be in .claude/skills/ with valid SKILL.md
  local expected_skills=("pm-agent" "tdd-agent" "bug-workflow" "detect-project" "react-best-practices" "web-design-guidelines")

  for skill in "${expected_skills[@]}"; do
    assert_file_exists "$TEST_DIR/.claude/skills/$skill/SKILL.md" \
      "Skill $skill should have SKILL.md after init"
  done

  # Count should be exactly 6 (no extras, no missing)
  local skill_count
  skill_count=$(find "$TEST_DIR/.claude/skills" -name "SKILL.md" -type f | wc -l | tr -d ' ')
  assert_equals "6" "$skill_count" "Should have exactly 6 SKILL.md files after init"
}

test_e2e_skills_have_frontmatter() {
  # Every deployed skill must have YAML frontmatter with name and description
  local expected_skills=("pm-agent" "tdd-agent" "bug-workflow" "detect-project" "react-best-practices" "web-design-guidelines")

  for skill in "${expected_skills[@]}"; do
    local skill_file="$TEST_DIR/.claude/skills/$skill/SKILL.md"

    # Must start with ---
    local first_line
    first_line=$(head -1 "$skill_file")
    assert_equals "---" "$first_line" "$skill SKILL.md must start with YAML frontmatter delimiter"

    # Must have name field matching directory name
    assert_file_contains "$skill_file" "name: $skill" \
      "$skill SKILL.md must have name: $skill in frontmatter"

    # Must have description field with trigger phrases
    if ! grep -q '^description:' "$skill_file" 2>/dev/null; then
      echo "    ASSERT FAILED: $skill SKILL.md must have description field in frontmatter" >&2
      return 1
    fi
  done
}

test_e2e_auto_invoke_config() {
  # Config must have auto_invoke_skills: true and disabled_skills: []
  assert_json_field "$TEST_DIR/.pm/config.json" ".auto_invoke_skills" "true" \
    "config.json must have auto_invoke_skills=true"

  local disabled
  disabled=$(jq -r '.disabled_skills | length' "$TEST_DIR/.pm/config.json" 2>/dev/null)
  assert_equals "0" "$disabled" "disabled_skills should be empty array"
}

test_e2e_claude_md_auto_invocation() {
  # CLAUDE.md must contain auto-invocation instructions for Claude
  assert_file_contains "$TEST_DIR/CLAUDE.md" "auto_invoke_skills" \
    "CLAUDE.md must reference auto_invoke_skills config"

  assert_file_contains "$TEST_DIR/CLAUDE.md" "INVOKE skills automatically" \
    "CLAUDE.md must instruct Claude to invoke skills automatically"

  assert_file_contains "$TEST_DIR/CLAUDE.md" "Pattern skills" \
    "CLAUDE.md must describe pattern skills as ambient"

  # Must list all agent skills
  assert_file_contains "$TEST_DIR/CLAUDE.md" "/pm-agent" "CLAUDE.md must list pm-agent"
  assert_file_contains "$TEST_DIR/CLAUDE.md" "/tdd-agent" "CLAUDE.md must list tdd-agent"
  assert_file_contains "$TEST_DIR/CLAUDE.md" "/bug-workflow" "CLAUDE.md must list bug-workflow"
}

test_e2e_session_hooks_registered() {
  local settings="$TEST_DIR/.claude/settings.json"

  # SessionStart hook must reference n2o-session-hook.sh
  local start_cmd
  start_cmd=$(jq -r '.hooks.SessionStart[0].hooks[0].command' "$settings" 2>/dev/null)
  assert_output_contains "$start_cmd" "n2o-session-hook.sh" \
    "SessionStart hook must call n2o-session-hook.sh"

  # SessionEnd hook must reference collect-transcripts.sh
  local end_cmd
  end_cmd=$(jq -r '.hooks.SessionEnd[0].hooks[0].command' "$settings" 2>/dev/null)
  assert_output_contains "$end_cmd" "collect-transcripts.sh" \
    "SessionEnd hook must call collect-transcripts.sh"

  # Both hook scripts must actually exist and be executable
  assert_file_exists "$TEST_DIR/scripts/n2o-session-hook.sh" "Session hook script must exist"
  assert_file_exists "$TEST_DIR/scripts/collect-transcripts.sh" "Collect script must exist"

  if [[ ! -x "$TEST_DIR/scripts/n2o-session-hook.sh" ]]; then
    echo "    ASSERT FAILED: n2o-session-hook.sh must be executable" >&2
    return 1
  fi
}

test_e2e_skill_checksums_seeded() {
  # After init, .pm/.skill-checksums.json should exist with entries for all skills
  assert_file_exists "$TEST_DIR/.pm/.skill-checksums.json" \
    "Skill checksums file must exist after init"

  local checksum_count
  checksum_count=$(jq 'length' "$TEST_DIR/.pm/.skill-checksums.json" 2>/dev/null)
  assert_equals "6" "$checksum_count" "Should have 6 checksum entries (one per SKILL.md)"

  # Each entry should be a 64-char hex SHA256
  local first_checksum
  first_checksum=$(jq -r 'to_entries[0].value' "$TEST_DIR/.pm/.skill-checksums.json" 2>/dev/null)
  local checksum_len=${#first_checksum}
  assert_equals "64" "$checksum_len" "Checksums should be 64-char SHA256 hex strings"

  # Checksums file must be in .gitignore
  assert_file_contains "$TEST_DIR/.gitignore" ".pm/.skill-checksums.json" \
    "Checksums file must be gitignored"
}

test_e2e_transcript_linkage() {
  local db="$TEST_DIR/.pm/tasks.db"
  local session_id="linkage-session-001"

  # Create a task claimed by this session
  sqlite3 "$db" "INSERT INTO tasks (sprint, task_num, title, status, session_id) VALUES ('link-sprint', 1, 'Linked task', 'red', '$session_id');"

  # Create a transcript for that session
  create_e2e_transcript "$CLAUDE_TEST_DIR" "$session_id"
  (cd "$TEST_DIR" && bash "$COLLECT" --quiet) > /dev/null 2>&1

  # Verify transcript has sprint/task_num populated
  local sprint
  sprint=$(sqlite3 "$db" "SELECT sprint FROM transcripts WHERE session_id = '$session_id';")
  assert_equals "link-sprint" "$sprint" "Transcript sprint should be linked"

  local task_num
  task_num=$(sqlite3 "$db" "SELECT task_num FROM transcripts WHERE session_id = '$session_id';")
  assert_equals "1" "$task_num" "Transcript task_num should be linked"

  # Verify workflow events also have sprint/task_num
  local event_sprint
  event_sprint=$(sqlite3 "$db" "SELECT sprint FROM workflow_events WHERE session_id = '$session_id' LIMIT 1;")
  assert_equals "link-sprint" "$event_sprint" "Workflow events should have sprint linkage"

  local event_task
  event_task=$(sqlite3 "$db" "SELECT task_num FROM workflow_events WHERE session_id = '$session_id' LIMIT 1;")
  assert_equals "1" "$event_task" "Workflow events should have task_num linkage"
}

test_e2e_task_trajectory_view() {
  local db="$TEST_DIR/.pm/tasks.db"

  # Insert phase_entered workflow events simulating a TDD cycle
  sqlite3 "$db" "
    INSERT INTO tasks (sprint, task_num, title, status) VALUES ('traj-sprint', 1, 'Trajectory test', 'green');
    INSERT INTO workflow_events (sprint, task_num, event_type, phase, timestamp) VALUES ('traj-sprint', 1, 'phase_entered', 'RED', '2025-02-20T10:00:00Z');
    INSERT INTO workflow_events (sprint, task_num, event_type, phase, timestamp) VALUES ('traj-sprint', 1, 'phase_entered', 'GREEN', '2025-02-20T10:10:00Z');
    INSERT INTO workflow_events (sprint, task_num, event_type, phase, timestamp) VALUES ('traj-sprint', 1, 'phase_entered', 'REFACTOR', '2025-02-20T10:15:00Z');
    INSERT INTO workflow_events (sprint, task_num, event_type, phase, timestamp) VALUES ('traj-sprint', 1, 'phase_entered', 'AUDIT', '2025-02-20T10:20:00Z');
    INSERT INTO workflow_events (sprint, task_num, event_type, phase, timestamp) VALUES ('traj-sprint', 1, 'phase_entered', 'FIX_AUDIT', '2025-02-20T10:25:00Z');
    INSERT INTO workflow_events (sprint, task_num, event_type, phase, timestamp) VALUES ('traj-sprint', 1, 'phase_entered', 'COMMIT', '2025-02-20T10:30:00Z');
  "

  # Verify task_trajectory view
  local total_phases
  total_phases=$(sqlite3 "$db" "SELECT total_phases FROM task_trajectory WHERE sprint='traj-sprint' AND task_num=1;")
  assert_equals "6" "$total_phases" "task_trajectory should show 6 total phases"

  local audit_reversions
  audit_reversions=$(sqlite3 "$db" "SELECT audit_reversions FROM task_trajectory WHERE sprint='traj-sprint' AND task_num=1;")
  assert_equals "1" "$audit_reversions" "task_trajectory should count 1 FIX_AUDIT reversion"

  local first_red
  first_red=$(sqlite3 "$db" "SELECT first_red FROM task_trajectory WHERE sprint='traj-sprint' AND task_num=1;")
  assert_equals "2025-02-20T10:00:00Z" "$first_red" "task_trajectory first_red should match"

  local completed_at
  completed_at=$(sqlite3 "$db" "SELECT completed_at FROM task_trajectory WHERE sprint='traj-sprint' AND task_num=1;")
  assert_equals "2025-02-20T10:30:00Z" "$completed_at" "task_trajectory completed_at should be COMMIT timestamp"

  local trajectory
  trajectory=$(sqlite3 "$db" "SELECT trajectory FROM task_trajectory WHERE sprint='traj-sprint' AND task_num=1;")
  assert_output_contains "$trajectory" "RED" "Trajectory should contain RED"
  assert_output_contains "$trajectory" "COMMIT" "Trajectory should contain COMMIT"
}

test_e2e_cache_tokens_in_transcript() {
  setup_with_transcript
  local db="$TEST_DIR/.pm/tasks.db"

  # The e2e fixture doesn't have cache tokens, so verify the column exists and defaults
  local cache_read
  cache_read=$(sqlite3 "$db" "SELECT cache_read_tokens FROM transcripts LIMIT 1;")
  assert_equals "0" "$cache_read" "cache_read_tokens should default to 0 for fixture without cache"

  local cache_creation
  cache_creation=$(sqlite3 "$db" "SELECT cache_creation_tokens FROM transcripts LIMIT 1;")
  assert_equals "0" "$cache_creation" "cache_creation_tokens should default to 0 for fixture without cache"

  local user_content_len
  user_content_len=$(sqlite3 "$db" "SELECT total_user_content_length FROM transcripts LIMIT 1;")
  # "Implement the CSV parser" (24) + "Looks good, continue" (20) = 44
  assert_equals "44" "$user_content_len" "total_user_content_length should be 24+20=44"
}

test_e2e_session_health_view() {
  local db="$TEST_DIR/.pm/tasks.db"

  # Insert a transcript with comprehensive JSONL data
  sqlite3 "$db" "INSERT INTO transcripts (
    session_id, file_path, file_size_bytes, message_count, user_message_count,
    assistant_message_count, tool_call_count, total_input_tokens, total_output_tokens,
    model, system_error_count, system_retry_count, compaction_count,
    tool_result_error_count, thinking_message_count, thinking_total_length,
    has_sidechain, avg_turn_duration_ms, service_tier,
    stop_reason_counts
  ) VALUES (
    'health-session-001', '/tmp/test.jsonl', 1000, 10, 3, 5, 8, 500, 200,
    'claude-sonnet-4-20250514', 2, 1, 1, 3, 2, 500, 0, 4000, 'standard',
    '{\"end_turn\": 3, \"tool_use\": 2}'
  );"

  # Verify session_health view
  local health_status
  health_status=$(sqlite3 "$db" "SELECT health_status FROM session_health WHERE session_id = 'health-session-001';")
  assert_equals "context_pressure" "$health_status" "Session with compactions should be context_pressure"

  local total_errors
  total_errors=$(sqlite3 "$db" "SELECT total_errors FROM session_health WHERE session_id = 'health-session-001';")
  assert_equals "6" "$total_errors" "total_errors = 2 errors + 1 retry + 3 tool_result_errors = 6"

  local thinking
  thinking=$(sqlite3 "$db" "SELECT thinking_message_count FROM session_health WHERE session_id = 'health-session-001';")
  assert_equals "2" "$thinking" "session_health should expose thinking_message_count"
}

test_e2e_brain_cycles_view() {
  local db="$TEST_DIR/.pm/tasks.db"

  # Insert a task and transcript with linkage
  sqlite3 "$db" "
    INSERT INTO tasks (sprint, task_num, title, status, complexity) VALUES ('bc-sprint', 1, 'Brain cycles test', 'green', 'medium');
    INSERT INTO transcripts (
      session_id, file_path, file_size_bytes, message_count, user_message_count,
      assistant_message_count, tool_call_count, total_input_tokens, total_output_tokens,
      sprint, task_num, total_user_content_length, compaction_count,
      stop_reason_counts
    ) VALUES (
      'brain-session-001', '/tmp/test.jsonl', 1000, 8, 4, 4, 5, 400, 200,
      'bc-sprint', 1, 120, 0, '{\"end_turn\": 2, \"tool_use\": 2}'
    );
  "

  local brain_cycles
  brain_cycles=$(sqlite3 "$db" "SELECT brain_cycles FROM brain_cycles_per_task WHERE sprint = 'bc-sprint' AND task_num = 1;")
  assert_equals "4" "$brain_cycles" "brain_cycles should equal user_message_count (4)"

  local avg_chars
  avg_chars=$(sqlite3 "$db" "SELECT avg_chars_per_prompt FROM brain_cycles_per_task WHERE sprint = 'bc-sprint' AND task_num = 1;")
  assert_equals "30.0" "$avg_chars" "avg_chars_per_prompt should be 120/4 = 30.0"
}

test_e2e_context_loading_view() {
  local db="$TEST_DIR/.pm/tasks.db"

  # Insert a task and tool call events (reads before first write)
  sqlite3 "$db" "
    INSERT INTO tasks (sprint, task_num, title, status) VALUES ('ctx-sprint', 1, 'Context loading test', 'green');
    INSERT INTO workflow_events (sprint, task_num, event_type, tool_name, timestamp) VALUES ('ctx-sprint', 1, 'tool_call', 'Read', '2025-02-20T10:00:00Z');
    INSERT INTO workflow_events (sprint, task_num, event_type, tool_name, timestamp) VALUES ('ctx-sprint', 1, 'tool_call', 'Glob', '2025-02-20T10:00:01Z');
    INSERT INTO workflow_events (sprint, task_num, event_type, tool_name, timestamp) VALUES ('ctx-sprint', 1, 'tool_call', 'Grep', '2025-02-20T10:00:02Z');
    INSERT INTO workflow_events (sprint, task_num, event_type, tool_name, timestamp) VALUES ('ctx-sprint', 1, 'tool_call', 'Edit', '2025-02-20T10:00:03Z');
    INSERT INTO workflow_events (sprint, task_num, event_type, tool_name, timestamp) VALUES ('ctx-sprint', 1, 'tool_call', 'Read', '2025-02-20T10:00:04Z');
    INSERT INTO workflow_events (sprint, task_num, event_type, tool_name, timestamp) VALUES ('ctx-sprint', 1, 'tool_call', 'Write', '2025-02-20T10:00:05Z');
  "

  local reads_before
  reads_before=$(sqlite3 "$db" "SELECT reads_before_first_write FROM context_loading_time WHERE sprint = 'ctx-sprint' AND task_num = 1;")
  assert_equals "3" "$reads_before" "Should have 3 reads before first write"

  local total_reads
  total_reads=$(sqlite3 "$db" "SELECT total_reads FROM context_loading_time WHERE sprint = 'ctx-sprint' AND task_num = 1;")
  assert_equals "4" "$total_reads" "Should have 4 total reads (3 before + 1 after)"

  local total_writes
  total_writes=$(sqlite3 "$db" "SELECT total_writes FROM context_loading_time WHERE sprint = 'ctx-sprint' AND task_num = 1;")
  assert_equals "2" "$total_writes" "Should have 2 total writes (Edit + Write)"

  local ratio
  ratio=$(sqlite3 "$db" "SELECT context_load_ratio FROM context_loading_time WHERE sprint = 'ctx-sprint' AND task_num = 1;")
  assert_equals "1.5" "$ratio" "context_load_ratio should be 3/2 = 1.5"
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
echo -e "${BOLD}Skill Auto-Invocation Pipeline${NC}"
run_test "All 6 skills deployed to .claude/skills/"      test_e2e_all_skills_deployed
run_test "Every skill has valid YAML frontmatter"        test_e2e_skills_have_frontmatter
run_test "Config enables auto-invocation"                test_e2e_auto_invoke_config
run_test "CLAUDE.md has auto-invocation instructions"    test_e2e_claude_md_auto_invocation
run_test "Both session hooks registered + executable"    test_e2e_session_hooks_registered
run_test "Skill checksums seeded for protection"         test_e2e_skill_checksums_seeded

echo ""
echo -e "${BOLD}Data Completeness${NC}"
run_test "Transcript-to-task linkage"                    test_e2e_transcript_linkage
run_test "Task trajectory view"                          test_e2e_task_trajectory_view
run_test "Cache tokens and user content length"          test_e2e_cache_tokens_in_transcript
run_test "Session health view"                           test_e2e_session_health_view
run_test "Brain cycles per task view"                    test_e2e_brain_cycles_view
run_test "Context loading time view"                     test_e2e_context_loading_view

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
