#!/bin/bash
set -uo pipefail

# =============================================================================
# E2E Tests for: n2o helper functions
# Covers: version_compare, format_number, file_checksum, check_deps
# Pure bash — no external test frameworks required.
# Usage: bash tests/test-n2o-helpers.sh
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

assert_equals() {
  local expected="$1"
  local actual="$2"
  local msg="${3:-Expected '$expected', got '$actual'}"
  if [[ "$expected" != "$actual" ]]; then
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

assert_output_contains() {
  local output="$1"
  local pattern="$2"
  local msg="${3:-Output should contain: $pattern}"
  if [[ "$output" != *"$pattern"* ]]; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

# -----------------------------------------------------------------------------
# Extract functions from n2o for direct testing
# -----------------------------------------------------------------------------

# version_compare: no external deps
eval "$(sed -n '/^version_compare() {$/,/^}$/p' "$N2O")"

# format_number: no external deps (uses printf + awk)
eval "$(sed -n '/^format_number() {$/,/^}$/p' "$N2O")"

# file_checksum: uses shasum (available on macOS/Linux)
eval "$(sed -n '/^file_checksum() {$/,/^}$/p' "$N2O")"

# -----------------------------------------------------------------------------
# version_compare tests
# -----------------------------------------------------------------------------

test_version_compare_equal() {
  local rc=0
  version_compare "1.0.0" "1.0.0" || rc=$?
  assert_equals "1" "$rc" "Equal versions should return 1"
}

test_version_compare_greater_major() {
  local rc=0
  version_compare "2.0.0" "1.0.0" || rc=$?
  assert_equals "0" "$rc" "Greater major version should return 0"
}

test_version_compare_lesser_major() {
  local rc=0
  version_compare "1.0.0" "2.0.0" || rc=$?
  assert_equals "2" "$rc" "Lesser major version should return 2"
}

test_version_compare_greater_minor() {
  local rc=0
  version_compare "1.2.0" "1.1.0" || rc=$?
  assert_equals "0" "$rc" "Greater minor version should return 0"
}

test_version_compare_lesser_minor() {
  local rc=0
  version_compare "1.1.0" "1.2.0" || rc=$?
  assert_equals "2" "$rc" "Lesser minor version should return 2"
}

test_version_compare_greater_patch() {
  local rc=0
  version_compare "1.0.2" "1.0.1" || rc=$?
  assert_equals "0" "$rc" "Greater patch version should return 0"
}

test_version_compare_lesser_patch() {
  local rc=0
  version_compare "1.0.1" "1.0.2" || rc=$?
  assert_equals "2" "$rc" "Lesser patch version should return 2"
}

test_version_compare_mixed() {
  # Higher minor beats higher patch
  local rc=0
  version_compare "1.2.0" "1.1.9" || rc=$?
  assert_equals "0" "$rc" "1.2.0 should be greater than 1.1.9"
}

test_version_compare_zero_parts() {
  local rc=0
  version_compare "0.0.1" "0.0.0" || rc=$?
  assert_equals "0" "$rc" "0.0.1 should be greater than 0.0.0"
}

# -----------------------------------------------------------------------------
# format_number tests
# -----------------------------------------------------------------------------

test_format_number_zero() {
  local result
  result=$(format_number "0")
  assert_equals "0" "$result" "format_number 0 should return 0"
}

test_format_number_small() {
  local result
  result=$(format_number "42")
  assert_equals "42" "$result" "format_number 42 should return 42 (no commas)"
}

test_format_number_hundreds() {
  local result
  result=$(format_number "999")
  assert_equals "999" "$result" "format_number 999 should return 999"
}

test_format_number_thousands() {
  local result
  result=$(format_number "1234")
  assert_equals "1,234" "$result" "format_number 1234 should return 1,234"
}

test_format_number_millions() {
  local result
  result=$(format_number "1234567")
  assert_equals "1,234,567" "$result" "format_number 1234567 should return 1,234,567"
}

test_format_number_empty() {
  local result
  result=$(format_number "")
  assert_equals "0" "$result" "format_number empty should return 0"
}

test_format_number_null() {
  local result
  result=$(format_number "null")
  assert_equals "0" "$result" "format_number null should return 0"
}

# -----------------------------------------------------------------------------
# file_checksum tests
# -----------------------------------------------------------------------------

test_file_checksum_produces_sha256() {
  echo "test content" > "$TEST_DIR/test.txt"
  local checksum
  checksum=$(file_checksum "$TEST_DIR/test.txt")
  # SHA256 is 64 hex characters
  if [[ ! "$checksum" =~ ^[0-9a-f]{64}$ ]]; then
    echo "    ASSERT FAILED: Checksum should be 64 hex chars (SHA256), got '$checksum'" >&2
    return 1
  fi
}

test_file_checksum_deterministic() {
  echo "deterministic" > "$TEST_DIR/test.txt"
  local checksum1 checksum2
  checksum1=$(file_checksum "$TEST_DIR/test.txt")
  checksum2=$(file_checksum "$TEST_DIR/test.txt")
  assert_equals "$checksum1" "$checksum2" "Same file should produce same checksum"
}

test_file_checksum_differs_with_content() {
  echo "content A" > "$TEST_DIR/a.txt"
  echo "content B" > "$TEST_DIR/b.txt"
  local checksum_a checksum_b
  checksum_a=$(file_checksum "$TEST_DIR/a.txt")
  checksum_b=$(file_checksum "$TEST_DIR/b.txt")
  if [[ "$checksum_a" == "$checksum_b" ]]; then
    echo "    ASSERT FAILED: Different files should produce different checksums" >&2
    return 1
  fi
}

# -----------------------------------------------------------------------------
# check_deps tests
# -----------------------------------------------------------------------------

test_check_deps_succeeds() {
  # n2o runs check_deps at startup — if n2o help works, deps are OK
  local exit_code=0
  "$N2O" help > /dev/null 2>&1 || exit_code=$?
  assert_equals "0" "$exit_code" "n2o help should succeed (check_deps passes)"
}

test_check_deps_jq_available() {
  # Verify jq is available (required by n2o)
  if ! command -v jq &>/dev/null; then
    echo "    ASSERT FAILED: jq should be available" >&2
    return 1
  fi
}

test_check_deps_sqlite3_available() {
  # Verify sqlite3 is available (required by n2o)
  if ! command -v sqlite3 &>/dev/null; then
    echo "    ASSERT FAILED: sqlite3 should be available" >&2
    return 1
  fi
}

# =============================================================================
# Run tests
# =============================================================================

echo ""
echo -e "${BOLD}N2O Helpers — E2E Tests${NC}"
echo -e "${BOLD}=======================${NC}"

echo ""
echo -e "${BOLD}version_compare${NC}"
run_test "Equal versions return 1"                    test_version_compare_equal
run_test "Greater major returns 0"                    test_version_compare_greater_major
run_test "Lesser major returns 2"                     test_version_compare_lesser_major
run_test "Greater minor returns 0"                    test_version_compare_greater_minor
run_test "Lesser minor returns 2"                     test_version_compare_lesser_minor
run_test "Greater patch returns 0"                    test_version_compare_greater_patch
run_test "Lesser patch returns 2"                     test_version_compare_lesser_patch
run_test "Mixed: 1.2.0 > 1.1.9"                      test_version_compare_mixed
run_test "Zero parts: 0.0.1 > 0.0.0"                 test_version_compare_zero_parts

echo ""
echo -e "${BOLD}format_number${NC}"
run_test "Format 0"                                   test_format_number_zero
run_test "Format small number (no commas)"            test_format_number_small
run_test "Format hundreds (no commas)"                test_format_number_hundreds
run_test "Format thousands (with commas)"             test_format_number_thousands
run_test "Format millions (with commas)"              test_format_number_millions
run_test "Format empty string returns 0"              test_format_number_empty
run_test "Format null string returns 0"               test_format_number_null

echo ""
echo -e "${BOLD}file_checksum${NC}"
run_test "Produces 64-char hex (SHA256)"              test_file_checksum_produces_sha256
run_test "Same file produces same checksum"           test_file_checksum_deterministic
run_test "Different files produce different checksums" test_file_checksum_differs_with_content

echo ""
echo -e "${BOLD}check_deps${NC}"
run_test "n2o help succeeds (check_deps passes)"      test_check_deps_succeeds
run_test "jq is available"                            test_check_deps_jq_available
run_test "sqlite3 is available"                       test_check_deps_sqlite3_available

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
