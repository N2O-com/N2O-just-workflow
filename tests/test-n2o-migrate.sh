#!/bin/bash
set -uo pipefail

# =============================================================================
# E2E Tests for: n2o migrate (schema migrations)
# Pure bash — no external test frameworks required.
# Usage: bash tests/test-n2o-migrate.sh
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
# Test harness (same pattern as test-n2o-init.sh)
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
      grep "ASSERT FAILED" "$err_file" | head -3 | sed 's/^/    /'
    fi
    ((FAIL++)) || true
    FAILED_TESTS+=("$name")
  fi
  rm -f "$err_file"
}

# Assertions (reuse same patterns)

assert_file_exists() {
  local path="$1"
  local msg="${2:-File should exist: $path}"
  if [[ ! -f "$path" ]]; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

assert_dir_exists() {
  local path="$1"
  local msg="${2:-Directory should exist: $path}"
  if [[ ! -d "$path" ]]; then
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

assert_sqlite_column_exists() {
  local db="$1"
  local table="$2"
  local column="$3"
  local msg="${4:-Column '$column' should exist in table '$table'}"
  local result
  result=$(sqlite3 "$db" "SELECT COUNT(*) FROM pragma_table_info('$table') WHERE name='$column';" 2>/dev/null)
  if [[ "$result" != "1" ]]; then
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

assert_json_array_contains() {
  local path="$1"
  local field="$2"
  local value="$3"
  local msg="${4:-$path: $field should contain '$value'}"
  local found
  found=$(jq -e --arg v "$value" "$field | index(\$v)" "$path" 2>/dev/null)
  if [[ -z "$found" || "$found" == "null" ]]; then
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

# -----------------------------------------------------------------------------
# Task 1 Tests: Infrastructure (table, directory, manifest)
# -----------------------------------------------------------------------------

test_schema_has_migrations_table() {
  # Create a fresh database from schema.sql and verify _migrations table exists
  local db="$TEST_DIR/test.db"
  sqlite3 "$db" < "$N2O_DIR/.pm/schema.sql"

  assert_sqlite_table_exists "$db" "_migrations"
}

test_migrations_table_has_required_columns() {
  local db="$TEST_DIR/test.db"
  sqlite3 "$db" < "$N2O_DIR/.pm/schema.sql"

  assert_sqlite_column_exists "$db" "_migrations" "id"
  assert_sqlite_column_exists "$db" "_migrations" "name"
  assert_sqlite_column_exists "$db" "_migrations" "applied_at"
  assert_sqlite_column_exists "$db" "_migrations" "framework_version"
  assert_sqlite_column_exists "$db" "_migrations" "checksum"
}

test_migrations_table_name_is_unique() {
  # Inserting duplicate migration name should fail
  local db="$TEST_DIR/test.db"
  sqlite3 "$db" < "$N2O_DIR/.pm/schema.sql"

  sqlite3 "$db" "INSERT INTO _migrations (name, framework_version) VALUES ('001-test', '1.0.0');"
  local result
  result=$(sqlite3 "$db" "INSERT INTO _migrations (name, framework_version) VALUES ('001-test', '1.0.0');" 2>&1 || true)
  if [[ "$result" != *"UNIQUE"* ]]; then
    echo "    ASSERT FAILED: Duplicate migration name should fail with UNIQUE constraint" >&2
    return 1
  fi
}

test_migrations_directory_exists() {
  assert_dir_exists "$N2O_DIR/.pm/migrations"
}

test_manifest_includes_migrations_in_framework_files() {
  assert_json_array_contains "$N2O_DIR/n2o-manifest.json" ".framework_files" ".pm/migrations/**"
}

test_manifest_includes_migrations_in_directory_structure() {
  assert_json_array_contains "$N2O_DIR/n2o-manifest.json" ".directory_structure" ".pm/migrations"
}

test_init_creates_migrations_directory() {
  # n2o init should create .pm/migrations/ in the target project
  "$N2O" init "$TEST_DIR"

  assert_dir_exists "$TEST_DIR/.pm/migrations"
}

test_init_creates_migrations_table_in_db() {
  # n2o init should create tasks.db with _migrations table
  "$N2O" init "$TEST_DIR"

  assert_sqlite_table_exists "$TEST_DIR/.pm/tasks.db" "_migrations"
}

test_existing_init_tests_still_pass() {
  # Verify adding _migrations doesn't break existing database integrity
  "$N2O" init "$TEST_DIR"

  local db="$TEST_DIR/.pm/tasks.db"

  # All original tables still exist
  assert_sqlite_table_exists "$db" "tasks"
  assert_sqlite_table_exists "$db" "developers"
  assert_sqlite_table_exists "$db" "task_dependencies"

  # Can still insert and read tasks (basic round-trip)
  sqlite3 "$db" "INSERT INTO tasks (sprint, task_num, title, type, status) VALUES ('test', 1, 'Test task', 'frontend', 'pending');"
  local title
  title=$(sqlite3 "$db" "SELECT title FROM tasks WHERE sprint='test' AND task_num=1;")
  if [[ "$title" != "Test task" ]]; then
    echo "    ASSERT FAILED: Task round-trip failed after schema change (got '$title')" >&2
    return 1
  fi
}

# -----------------------------------------------------------------------------
# Run tests
# -----------------------------------------------------------------------------

echo ""
echo -e "${BOLD}N2O Migrate — E2E Tests (Task 1: Infrastructure)${NC}"
echo -e "${BOLD}=================================================${NC}"
echo ""

run_test "schema.sql creates _migrations table"              test_schema_has_migrations_table
run_test "_migrations table has required columns"             test_migrations_table_has_required_columns
run_test "_migrations name column has UNIQUE constraint"      test_migrations_table_name_is_unique
run_test ".pm/migrations/ directory exists in framework"      test_migrations_directory_exists
run_test "Manifest includes migrations in framework_files"    test_manifest_includes_migrations_in_framework_files
run_test "Manifest includes migrations in directory_structure" test_manifest_includes_migrations_in_directory_structure
run_test "n2o init creates .pm/migrations/ directory"         test_init_creates_migrations_directory
run_test "n2o init creates _migrations table in tasks.db"     test_init_creates_migrations_table_in_db
run_test "Existing init functionality still works"            test_existing_init_tests_still_pass

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
