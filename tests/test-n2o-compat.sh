#!/bin/bash
set -uo pipefail

# =============================================================================
# E2E Tests for: n2o sync upgrade compatibility
# Simulates upgrading from a deployed version to the current version.
# Verifies: schema migration, config preservation, skill updates, db integrity.
# Usage: bash tests/test-n2o-compat.sh
# =============================================================================

N2O_DIR="$(cd "$(dirname "$0")/.." && pwd)"
N2O="$N2O_DIR/n2o"
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

assert_file_exists() {
  local path="$1"
  local msg="${2:-File should exist: $path}"
  if [[ ! -f "$path" ]]; then
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

assert_json_field_not_empty() {
  local path="$1"
  local field="$2"
  local msg="${3:-$path: .$field should not be empty}"
  local actual
  actual=$(jq -r "$field" "$path" 2>/dev/null)
  if [[ -z "$actual" || "$actual" == "null" ]]; then
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

assert_sqlite_view_exists() {
  local db="$1"
  local view="$2"
  local msg="${3:-View '$view' should exist in $db}"
  local result
  result=$(sqlite3 "$db" "SELECT name FROM sqlite_master WHERE type='view' AND name='$view';" 2>/dev/null)
  if [[ "$result" != "$view" ]]; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

assert_equals() {
  local expected="$1"
  local actual="$2"
  local msg="${3:-Expected '$expected' but got '$actual'}"
  if [[ "$expected" != "$actual" ]]; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

# -----------------------------------------------------------------------------
# Helper: create a "deployed" project snapshot
# Simulates what a team member's project looks like before an upgrade.
# -----------------------------------------------------------------------------
create_deployed_snapshot() {
  local dir="$1"

  # Init a fresh project
  "$N2O" init "$dir"

  # Simulate customization (things users do after init)
  local tmp
  tmp=$(mktemp)
  jq '.project_name = "my-custom-project" | .developer_name = "alice"' "$dir/.pm/config.json" > "$tmp"
  mv "$tmp" "$dir/.pm/config.json"

  # Add some tasks
  sqlite3 "$dir/.pm/tasks.db" "
    INSERT INTO tasks (sprint, task_num, title, type, status) VALUES ('test-sprint', 1, 'Setup auth', 'infra', 'green');
    INSERT INTO tasks (sprint, task_num, title, type, status) VALUES ('test-sprint', 2, 'Build UI', 'frontend', 'pending');
    INSERT INTO tasks (sprint, task_num, title, type, status, estimated_hours) VALUES ('test-sprint', 3, 'Add tests', 'e2e', 'red', 2.0);
  "

  # Add a custom schema extension
  cat > "$dir/.pm/schema-extensions.sql" <<'SQL'
CREATE TABLE IF NOT EXISTS custom_metrics (
    id INTEGER PRIMARY KEY,
    metric_name TEXT,
    value REAL
);
SQL
  sqlite3 "$dir/.pm/tasks.db" < "$dir/.pm/schema-extensions.sql"

  # Customize CLAUDE.md
  echo "# My Custom Project" > "$dir/CLAUDE.md"
  echo "Custom content that should be preserved." >> "$dir/CLAUDE.md"

  # Set a lower version to simulate outdated deployment
  tmp=$(mktemp)
  jq '.n2o_version = "0.9.0"' "$dir/.pm/config.json" > "$tmp"
  mv "$tmp" "$dir/.pm/config.json"
}

# -----------------------------------------------------------------------------
# Tests
# -----------------------------------------------------------------------------

test_sync_preserves_config() {
  create_deployed_snapshot "$TEST_DIR"

  "$N2O" sync "$TEST_DIR"

  # Config should keep custom fields
  assert_json_field "$TEST_DIR/.pm/config.json" ".project_name" "my-custom-project"
  assert_json_field "$TEST_DIR/.pm/config.json" ".developer_name" "alice"

  # Version should be updated
  local current_version
  current_version=$(jq -r '.version' "$N2O_DIR/n2o-manifest.json")
  assert_json_field "$TEST_DIR/.pm/config.json" ".n2o_version" "$current_version"
}

test_sync_preserves_tasks() {
  create_deployed_snapshot "$TEST_DIR"

  "$N2O" sync "$TEST_DIR"

  # Tasks should survive the upgrade
  local task_count
  task_count=$(sqlite3 "$TEST_DIR/.pm/tasks.db" "SELECT COUNT(*) FROM tasks WHERE sprint='test-sprint';")
  assert_equals "3" "$task_count" "Should have 3 tasks after sync"

  # Status should be preserved
  local green_task
  green_task=$(sqlite3 "$TEST_DIR/.pm/tasks.db" "SELECT title FROM tasks WHERE sprint='test-sprint' AND task_num=1;")
  assert_equals "Setup auth" "$green_task" "Task 1 title should be preserved"

  local task_status
  task_status=$(sqlite3 "$TEST_DIR/.pm/tasks.db" "SELECT status FROM tasks WHERE sprint='test-sprint' AND task_num=1;")
  assert_equals "green" "$task_status" "Task 1 status should be preserved"
}

test_sync_preserves_claude_md() {
  create_deployed_snapshot "$TEST_DIR"

  "$N2O" sync "$TEST_DIR"

  # CLAUDE.md should NOT be overwritten (it's a project file)
  local content
  content=$(cat "$TEST_DIR/CLAUDE.md")
  if [[ "$content" != *"Custom content"* ]]; then
    echo "    ASSERT FAILED: CLAUDE.md should contain custom content after sync" >&2
    return 1
  fi
}

test_sync_preserves_schema_extensions() {
  create_deployed_snapshot "$TEST_DIR"

  "$N2O" sync "$TEST_DIR"

  # Custom table from schema-extensions should still exist
  assert_sqlite_table_exists "$TEST_DIR/.pm/tasks.db" "custom_metrics"

  # schema-extensions.sql file should not be overwritten
  if ! grep -q "custom_metrics" "$TEST_DIR/.pm/schema-extensions.sql"; then
    echo "    ASSERT FAILED: schema-extensions.sql should be preserved" >&2
    return 1
  fi
}

test_sync_updates_skills() {
  create_deployed_snapshot "$TEST_DIR"

  # Tamper with a skill to simulate outdated version
  echo "OLD CONTENT" > "$TEST_DIR/.claude/skills/tdd-agent/SKILL.md"

  # Use --force to override checksum protection (skill was locally modified)
  "$N2O" sync "$TEST_DIR" --force

  # Skill should be updated (no longer "OLD CONTENT")
  if grep -q "^OLD CONTENT$" "$TEST_DIR/.claude/skills/tdd-agent/SKILL.md"; then
    echo "    ASSERT FAILED: tdd-agent SKILL.md should be updated by sync --force" >&2
    return 1
  fi
}

test_sync_updates_schema() {
  create_deployed_snapshot "$TEST_DIR"

  # Tamper with schema to verify sync actually replaces it
  echo "-- STALE SCHEMA" > "$TEST_DIR/.pm/schema.sql"

  "$N2O" sync "$TEST_DIR"

  # Schema file should be updated (not our stale content)
  assert_file_exists "$TEST_DIR/.pm/schema.sql"
  if grep -q "STALE SCHEMA" "$TEST_DIR/.pm/schema.sql"; then
    echo "    ASSERT FAILED: schema.sql should be replaced by sync" >&2
    return 1
  fi

  # Schema should contain current framework content
  if ! grep -q "CREATE TABLE IF NOT EXISTS tasks" "$TEST_DIR/.pm/schema.sql"; then
    echo "    ASSERT FAILED: schema.sql should contain tasks table definition" >&2
    return 1
  fi

  # Core views should still work after sync
  assert_sqlite_view_exists "$TEST_DIR/.pm/tasks.db" "available_tasks"
  assert_sqlite_view_exists "$TEST_DIR/.pm/tasks.db" "sprint_progress"
  assert_sqlite_view_exists "$TEST_DIR/.pm/tasks.db" "velocity_report"
}

test_sync_creates_backup() {
  create_deployed_snapshot "$TEST_DIR"

  "$N2O" sync "$TEST_DIR"

  # Backup directory should exist
  local backup_dir
  backup_dir=$(ls -d "$TEST_DIR/.n2o-backup/"* 2>/dev/null | head -1)
  if [[ -z "$backup_dir" || ! -d "$backup_dir" ]]; then
    echo "    ASSERT FAILED: Backup directory should exist after sync" >&2
    return 1
  fi

  # Backup should contain actual files (not be empty)
  local backup_file_count
  backup_file_count=$(find "$backup_dir" -type f 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$backup_file_count" -lt 1 ]]; then
    echo "    ASSERT FAILED: Backup directory should contain backed-up files (found $backup_file_count)" >&2
    return 1
  fi

  # Backup should include tasks.db (always backed up before migrations)
  if [[ ! -f "$backup_dir/.pm/tasks.db" ]]; then
    echo "    ASSERT FAILED: Backup should contain tasks.db" >&2
    return 1
  fi
}

test_sync_db_integrity_after_upgrade() {
  create_deployed_snapshot "$TEST_DIR"

  "$N2O" sync "$TEST_DIR"

  # Round-trip test: insert and read back
  sqlite3 "$TEST_DIR/.pm/tasks.db" "INSERT INTO tasks (sprint, task_num, title, type, status) VALUES ('post-upgrade', 1, 'New task', 'infra', 'pending');"
  local title
  title=$(sqlite3 "$TEST_DIR/.pm/tasks.db" "SELECT title FROM tasks WHERE sprint='post-upgrade' AND task_num=1;")
  assert_equals "New task" "$title" "Should be able to insert/select after upgrade"

  # available_tasks view should work
  local available
  available=$(sqlite3 "$TEST_DIR/.pm/tasks.db" "SELECT COUNT(*) FROM available_tasks WHERE sprint='test-sprint';" 2>/dev/null)
  # task_num 2 is pending — should be available
  if [[ "$available" -lt 1 ]]; then
    echo "    ASSERT FAILED: available_tasks view should return pending tasks" >&2
    return 1
  fi
}

test_sync_dry_run_no_changes() {
  create_deployed_snapshot "$TEST_DIR"

  local before_version
  before_version=$(jq -r '.n2o_version' "$TEST_DIR/.pm/config.json")

  "$N2O" sync "$TEST_DIR" --dry-run

  # Version should NOT be updated
  local after_version
  after_version=$(jq -r '.n2o_version' "$TEST_DIR/.pm/config.json")
  assert_equals "$before_version" "$after_version" "Dry run should not change version"
}

test_sync_pinned_project_skipped() {
  create_deployed_snapshot "$TEST_DIR"

  # Pin to current version
  local tmp
  tmp=$(mktemp)
  jq '.n2o_version_pinned = "0.9.0"' "$TEST_DIR/.pm/config.json" > "$tmp"
  mv "$tmp" "$TEST_DIR/.pm/config.json"

  "$N2O" sync "$TEST_DIR"

  # Version should NOT be updated (pinned)
  local version
  version=$(jq -r '.n2o_version' "$TEST_DIR/.pm/config.json")
  assert_equals "0.9.0" "$version" "Pinned project should not be updated"
}

# -----------------------------------------------------------------------------
# Run all tests
# -----------------------------------------------------------------------------

echo ""
echo -e "${BOLD}N2O Compat — Upgrade Compatibility Tests${NC}"
echo -e "${BOLD}=========================================${NC}"
echo ""

run_test "Sync preserves config customizations"     test_sync_preserves_config
run_test "Sync preserves tasks in database"          test_sync_preserves_tasks
run_test "Sync preserves CLAUDE.md"                  test_sync_preserves_claude_md
run_test "Sync preserves schema extensions"          test_sync_preserves_schema_extensions
run_test "Sync updates skills"                       test_sync_updates_skills
run_test "Sync updates schema"                       test_sync_updates_schema
run_test "Sync creates backup"                       test_sync_creates_backup
run_test "DB integrity after upgrade"                test_sync_db_integrity_after_upgrade
run_test "Dry run makes no changes"                  test_sync_dry_run_no_changes
run_test "Pinned project is skipped"                 test_sync_pinned_project_skipped

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
