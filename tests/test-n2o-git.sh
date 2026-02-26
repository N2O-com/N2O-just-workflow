#!/bin/bash
set -uo pipefail

# =============================================================================
# E2E Tests for: scripts/git/commit-task.sh
# Covers: argument validation, commit creation, conventional prefix mapping,
#         commit hash recording in DB
# Pure bash — no external test frameworks required.
# Usage: bash tests/test-n2o-git.sh
# =============================================================================

N2O_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT_SCRIPT="$N2O_DIR/scripts/git/commit-task.sh"
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
  mkdir -p "$TEST_DIR/.pm"
  sqlite3 "$TEST_DIR/.pm/tasks.db" < "$SCHEMA"
  git -C "$TEST_DIR" init -q
  git -C "$TEST_DIR" config user.email "test@test.com"
  git -C "$TEST_DIR" config user.name "Test"
  # Initial commit so we have a HEAD
  echo "initial" > "$TEST_DIR/README.md"
  git -C "$TEST_DIR" add README.md
  git -C "$TEST_DIR" commit -q -m "initial"
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

# Helper: insert a task and stage a file
seed_and_stage() {
  local sprint="$1"
  local task_num="$2"
  local title="$3"
  local type="${4:-frontend}"
  sqlite3 "$TEST_DIR/.pm/tasks.db" "INSERT INTO tasks (sprint, task_num, title, type, status) VALUES ('$sprint', $task_num, '$title', '$type', 'green');"
  echo "code for $title" > "$TEST_DIR/file-$task_num.txt"
  git -C "$TEST_DIR" add "file-$task_num.txt"
}

# -----------------------------------------------------------------------------
# Argument validation tests
# -----------------------------------------------------------------------------

test_commit_missing_args() {
  local rc=0
  (cd "$TEST_DIR" && bash "$COMMIT_SCRIPT" 2>/dev/null) || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "    ASSERT FAILED: Missing args should exit non-zero" >&2
    return 1
  fi
}

test_commit_missing_task_num() {
  local rc=0
  (cd "$TEST_DIR" && bash "$COMMIT_SCRIPT" "some-sprint" 2>/dev/null) || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "    ASSERT FAILED: Missing task_num should exit non-zero" >&2
    return 1
  fi
}

test_commit_missing_db() {
  rm "$TEST_DIR/.pm/tasks.db"
  local rc=0
  (cd "$TEST_DIR" && bash "$COMMIT_SCRIPT" "test" 1 2>/dev/null) || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "    ASSERT FAILED: Missing DB should exit non-zero" >&2
    return 1
  fi
}

test_commit_no_staged_changes() {
  sqlite3 "$TEST_DIR/.pm/tasks.db" "INSERT INTO tasks (sprint, task_num, title, type, status) VALUES ('test', 1, 'Test task', 'frontend', 'green');"
  local rc=0
  (cd "$TEST_DIR" && bash "$COMMIT_SCRIPT" "test" 1 2>/dev/null) || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "    ASSERT FAILED: No staged changes should exit non-zero" >&2
    return 1
  fi
}

test_commit_missing_task() {
  echo "some code" > "$TEST_DIR/code.txt"
  git -C "$TEST_DIR" add code.txt
  local rc=0
  (cd "$TEST_DIR" && bash "$COMMIT_SCRIPT" "nonexistent" 99 2>/dev/null) || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "    ASSERT FAILED: Missing task should exit non-zero" >&2
    return 1
  fi
}

# -----------------------------------------------------------------------------
# Successful commit tests
# -----------------------------------------------------------------------------

test_commit_success() {
  seed_and_stage "auth-sprint" 1 "Add login page" "frontend"
  (cd "$TEST_DIR" && bash "$COMMIT_SCRIPT" "auth-sprint" 1)

  local msg
  msg=$(git -C "$TEST_DIR" log -1 --pretty=%s)
  assert_equals "feat(auth-sprint): Add login page (Task #1)" "$msg"
}

test_commit_records_hash() {
  seed_and_stage "auth-sprint" 1 "Add login page" "frontend"
  (cd "$TEST_DIR" && bash "$COMMIT_SCRIPT" "auth-sprint" 1)

  local hash
  hash=$(sqlite3 "$TEST_DIR/.pm/tasks.db" "SELECT commit_hash FROM tasks WHERE sprint='auth-sprint' AND task_num=1;")
  if [[ -z "$hash" ]]; then
    echo "    ASSERT FAILED: commit_hash should be recorded in DB" >&2
    return 1
  fi

  # Hash should match HEAD
  local head_hash
  head_hash=$(git -C "$TEST_DIR" rev-parse HEAD)
  assert_equals "$head_hash" "$hash" "Recorded hash should match HEAD"
}

# -----------------------------------------------------------------------------
# Conventional commit prefix mapping
# -----------------------------------------------------------------------------

test_commit_prefix_infra() {
  seed_and_stage "infra-sprint" 1 "Set up CI" "infra"
  (cd "$TEST_DIR" && bash "$COMMIT_SCRIPT" "infra-sprint" 1)
  local msg
  msg=$(git -C "$TEST_DIR" log -1 --pretty=%s)
  assert_output_contains "$msg" "chore("
}

test_commit_prefix_e2e() {
  seed_and_stage "test-sprint" 1 "Add E2E tests" "e2e"
  (cd "$TEST_DIR" && bash "$COMMIT_SCRIPT" "test-sprint" 1)
  local msg
  msg=$(git -C "$TEST_DIR" log -1 --pretty=%s)
  assert_output_contains "$msg" "test("
}

test_commit_prefix_docs() {
  seed_and_stage "docs-sprint" 1 "Update README" "docs"
  (cd "$TEST_DIR" && bash "$COMMIT_SCRIPT" "docs-sprint" 1)
  local msg
  msg=$(git -C "$TEST_DIR" log -1 --pretty=%s)
  assert_output_contains "$msg" "docs("
}

test_commit_prefix_frontend() {
  seed_and_stage "ui-sprint" 1 "Add button" "frontend"
  (cd "$TEST_DIR" && bash "$COMMIT_SCRIPT" "ui-sprint" 1)
  local msg
  msg=$(git -C "$TEST_DIR" log -1 --pretty=%s)
  assert_output_contains "$msg" "feat("
}

test_commit_prefix_database() {
  seed_and_stage "db-sprint" 1 "Add table" "database"
  (cd "$TEST_DIR" && bash "$COMMIT_SCRIPT" "db-sprint" 1)
  local msg
  msg=$(git -C "$TEST_DIR" log -1 --pretty=%s)
  assert_output_contains "$msg" "feat("
}

# =============================================================================
# Run tests
# =============================================================================

echo ""
echo -e "${BOLD}N2O Git (commit-task.sh) — E2E Tests${NC}"
echo -e "${BOLD}=====================================${NC}"

echo ""
echo -e "${BOLD}Argument Validation${NC}"
run_test "Missing all args exits non-zero"            test_commit_missing_args
run_test "Missing task_num exits non-zero"            test_commit_missing_task_num
run_test "Missing DB exits non-zero"                  test_commit_missing_db
run_test "No staged changes exits non-zero"           test_commit_no_staged_changes
run_test "Non-existent task exits non-zero"           test_commit_missing_task

echo ""
echo -e "${BOLD}Successful Commit${NC}"
run_test "Creates conventional commit message"        test_commit_success
run_test "Records commit hash in tasks.db"            test_commit_records_hash

echo ""
echo -e "${BOLD}Conventional Prefix Mapping${NC}"
run_test "infra type maps to chore()"                 test_commit_prefix_infra
run_test "e2e type maps to test()"                    test_commit_prefix_e2e
run_test "docs type maps to docs()"                   test_commit_prefix_docs
run_test "frontend type maps to feat()"               test_commit_prefix_frontend
run_test "database type maps to feat()"               test_commit_prefix_database

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
