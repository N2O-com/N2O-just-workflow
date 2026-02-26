#!/bin/bash
set -uo pipefail

# =============================================================================
# E2E Tests for: scripts/lint-file-size.sh
# Covers: threshold, extensions, excludes, JSON output, exit codes, edge cases
# Pure bash — no external test frameworks required.
# Usage: bash tests/test-lint-file-size.sh
# =============================================================================

N2O_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LINT_SCRIPT="$N2O_DIR/scripts/lint-file-size.sh"
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

assert_output_not_contains() {
  local output="$1"
  local pattern="$2"
  local msg="${3:-Output should NOT contain: $pattern}"
  if [[ "$output" == *"$pattern"* ]]; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

# -----------------------------------------------------------------------------
# Helper: create files with known line counts
# -----------------------------------------------------------------------------

create_file() {
  local path="$1"
  local lines="$2"
  mkdir -p "$(dirname "$path")"
  local i=0
  while [ $i -lt "$lines" ]; do
    echo "line $i"
    i=$((i + 1))
  done > "$path"
}

# =============================================================================
# Tests: Basic behavior
# =============================================================================

test_no_violations_exit_0() {
  # All files under threshold → exit 0
  create_file "$TEST_DIR/small.sh" 50
  create_file "$TEST_DIR/medium.sh" 100
  assert_exit_code 0 bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR"
}

test_violations_exit_1() {
  # File over threshold → exit 1
  create_file "$TEST_DIR/big.sh" 250
  assert_exit_code 1 bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR"
}

test_exact_threshold_no_violation() {
  # Exactly at threshold is NOT a violation (> not >=)
  create_file "$TEST_DIR/exact.sh" 200
  assert_exit_code 0 bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR"
}

test_one_over_threshold_is_violation() {
  # One over threshold IS a violation
  create_file "$TEST_DIR/just_over.sh" 201
  assert_exit_code 1 bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR"
}

# =============================================================================
# Tests: Terminal output
# =============================================================================

test_terminal_shows_file_and_line_count() {
  create_file "$TEST_DIR/big.sh" 300
  local output
  output=$(bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR" 2>&1) || true
  assert_output_contains "$output" "300"
  assert_output_contains "$output" "big.sh"
}

test_terminal_shows_summary() {
  create_file "$TEST_DIR/small.sh" 50
  local output
  output=$(bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR" 2>&1) || true
  assert_output_contains "$output" "Files scanned:"
  assert_output_contains "$output" "Threshold:"
  assert_output_contains "$output" "Violations:"
}

test_clean_run_shows_all_clear() {
  create_file "$TEST_DIR/ok.sh" 100
  local output
  output=$(bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR" 2>&1) || true
  assert_output_contains "$output" "All files are within the 200-line threshold"
}

test_violation_shows_tip() {
  create_file "$TEST_DIR/big.sh" 300
  local output
  output=$(bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR" 2>&1) || true
  assert_output_contains "$output" "Break large files into smaller"
}

# =============================================================================
# Tests: JSON output
# =============================================================================

test_json_valid() {
  create_file "$TEST_DIR/big.sh" 300
  create_file "$TEST_DIR/small.sh" 50
  local output
  output=$(bash "$LINT_SCRIPT" --json --threshold 200 "$TEST_DIR" 2>&1) || true
  # Validate with python json module (more portable than jq requirement)
  echo "$output" | python3 -c "import sys,json; json.load(sys.stdin)"
}

test_json_has_violations_array() {
  create_file "$TEST_DIR/big.sh" 300
  local output
  output=$(bash "$LINT_SCRIPT" --json --threshold 200 "$TEST_DIR" 2>&1) || true
  local count
  count=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['violations']))")
  assert_equals "1" "$count"
}

test_json_has_summary() {
  create_file "$TEST_DIR/big.sh" 300
  create_file "$TEST_DIR/small.sh" 50
  local output
  output=$(bash "$LINT_SCRIPT" --json --threshold 200 "$TEST_DIR" 2>&1) || true
  local scanned
  scanned=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['summary']['files_scanned'])")
  assert_equals "2" "$scanned"
  local violations
  violations=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['summary']['violations'])")
  assert_equals "1" "$violations"
  local threshold
  threshold=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['summary']['threshold'])")
  assert_equals "200" "$threshold"
}

test_json_violation_fields() {
  create_file "$TEST_DIR/big.sh" 300
  local output
  output=$(bash "$LINT_SCRIPT" --json --threshold 200 "$TEST_DIR" 2>&1) || true
  local file
  file=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['violations'][0]['file'])")
  assert_equals "big.sh" "$file"
  local lines
  lines=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['violations'][0]['lines'])")
  assert_equals "300" "$lines"
}

test_json_no_violations() {
  create_file "$TEST_DIR/small.sh" 50
  local output
  output=$(bash "$LINT_SCRIPT" --json --threshold 200 "$TEST_DIR" 2>&1) || true
  local count
  count=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['violations']))")
  assert_equals "0" "$count"
}

# =============================================================================
# Tests: --threshold option
# =============================================================================

test_custom_threshold() {
  create_file "$TEST_DIR/medium.sh" 150
  # Under default 200 → pass
  assert_exit_code 0 bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR"
  # Over custom 100 → fail
  assert_exit_code 1 bash "$LINT_SCRIPT" --threshold 100 "$TEST_DIR"
}

test_invalid_threshold_exits_1() {
  local output
  local rc=0
  output=$(bash "$LINT_SCRIPT" --threshold abc "$TEST_DIR" 2>&1) || rc=$?
  assert_equals "1" "$rc"
  assert_output_contains "$output" "must be a positive integer"
}

# =============================================================================
# Tests: --extensions option
# =============================================================================

test_default_extensions_match_sh() {
  create_file "$TEST_DIR/big.sh" 300
  assert_exit_code 1 bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR"
}

test_extensions_filter() {
  # .sh file exists and is big, but we only scan .py
  create_file "$TEST_DIR/big.sh" 300
  create_file "$TEST_DIR/small.py" 50
  assert_exit_code 0 bash "$LINT_SCRIPT" --extensions "py" --threshold 200 "$TEST_DIR"
}

test_extensions_multiple() {
  create_file "$TEST_DIR/big.ts" 300
  create_file "$TEST_DIR/big.py" 300
  create_file "$TEST_DIR/small.rs" 50
  # Only scan ts,py → 2 violations
  local output
  output=$(bash "$LINT_SCRIPT" --json --extensions "ts,py" --threshold 200 "$TEST_DIR" 2>&1) || true
  local count
  count=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['summary']['violations'])")
  assert_equals "2" "$count"
}

test_unmatched_extension_no_files() {
  create_file "$TEST_DIR/big.sh" 300
  local output
  output=$(bash "$LINT_SCRIPT" --extensions "rb" --threshold 200 "$TEST_DIR" 2>&1) || true
  assert_output_contains "$output" "No source files found"
}

# =============================================================================
# Tests: --exclude option
# =============================================================================

test_excludes_node_modules_by_default() {
  create_file "$TEST_DIR/node_modules/dep/index.js" 500
  create_file "$TEST_DIR/small.js" 50
  assert_exit_code 0 bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR"
}

test_excludes_git_by_default() {
  create_file "$TEST_DIR/.git/objects/pack.sh" 500
  create_file "$TEST_DIR/small.sh" 50
  assert_exit_code 0 bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR"
}

test_excludes_vendor_by_default() {
  create_file "$TEST_DIR/vendor/lib/big.go" 500
  create_file "$TEST_DIR/small.go" 50
  assert_exit_code 0 bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR"
}

test_custom_exclude() {
  create_file "$TEST_DIR/generated/big.ts" 500
  create_file "$TEST_DIR/src/small.ts" 50
  # Without custom exclude, "generated" is scanned → violation
  assert_exit_code 1 bash "$LINT_SCRIPT" --threshold 200 --extensions "ts" "$TEST_DIR"
  # With custom exclude, "generated/" is skipped → no violation
  assert_exit_code 0 bash "$LINT_SCRIPT" --exclude "generated,.git" --threshold 200 --extensions "ts" "$TEST_DIR"
}

# =============================================================================
# Tests: Path argument
# =============================================================================

test_scan_specific_directory() {
  create_file "$TEST_DIR/src/big.ts" 300
  create_file "$TEST_DIR/tests/big.ts" 300
  # Scanning only src/ → 1 violation
  local output
  output=$(bash "$LINT_SCRIPT" --json --extensions "ts" --threshold 200 "$TEST_DIR/src" 2>&1) || true
  local count
  count=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['summary']['violations'])")
  assert_equals "1" "$count"
}

# =============================================================================
# Tests: Edge cases
# =============================================================================

test_empty_directory() {
  # No files at all
  local output
  output=$(bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR" 2>&1) || true
  assert_output_contains "$output" "No source files found"
}

test_help_flag() {
  local output
  output=$(bash "$LINT_SCRIPT" --help 2>&1) || true
  assert_output_contains "$output" "Usage:"
  assert_output_contains "$output" "--threshold"
  assert_output_contains "$output" "--extensions"
  assert_output_contains "$output" "--exclude"
  assert_output_contains "$output" "--json"
}

test_unknown_option_exits_1() {
  assert_exit_code 1 bash "$LINT_SCRIPT" --bad-flag
}

test_empty_file_no_violation() {
  # 0-line file should not be a violation
  touch "$TEST_DIR/empty.sh"
  assert_exit_code 0 bash "$LINT_SCRIPT" --threshold 200 "$TEST_DIR"
}

test_multiple_violations_all_reported() {
  create_file "$TEST_DIR/a.sh" 300
  create_file "$TEST_DIR/b.sh" 400
  create_file "$TEST_DIR/c.sh" 500
  local output
  output=$(bash "$LINT_SCRIPT" --json --threshold 200 "$TEST_DIR" 2>&1) || true
  local count
  count=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['summary']['violations'])")
  assert_equals "3" "$count"
}

test_nested_directory_scanning() {
  create_file "$TEST_DIR/src/components/Button.tsx" 300
  create_file "$TEST_DIR/src/utils/helpers.ts" 50
  local output
  output=$(bash "$LINT_SCRIPT" --json --extensions "tsx,ts" --threshold 200 "$TEST_DIR" 2>&1) || true
  local count
  count=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['summary']['violations'])")
  assert_equals "1" "$count"
  local file
  file=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['violations'][0]['file'])")
  assert_output_contains "$file" "Button.tsx"
}

# =============================================================================
# Run all tests
# =============================================================================

echo ""
echo -e "${BOLD}lint-file-size.sh${NC}"
echo -e "  ${YELLOW}E2E tests for file size linter${NC}"
echo ""

echo -e "${BOLD}Basic behavior${NC}"
run_test "No violations → exit 0" test_no_violations_exit_0
run_test "Violations → exit 1" test_violations_exit_1
run_test "Exact threshold → no violation" test_exact_threshold_no_violation
run_test "One over threshold → violation" test_one_over_threshold_is_violation

echo ""
echo -e "${BOLD}Terminal output${NC}"
run_test "Shows file name and line count" test_terminal_shows_file_and_line_count
run_test "Shows summary section" test_terminal_shows_summary
run_test "Clean run shows all clear" test_clean_run_shows_all_clear
run_test "Violation shows tip" test_violation_shows_tip

echo ""
echo -e "${BOLD}JSON output${NC}"
run_test "JSON is valid" test_json_valid
run_test "JSON has violations array" test_json_has_violations_array
run_test "JSON has summary fields" test_json_has_summary
run_test "JSON violation has file/lines fields" test_json_violation_fields
run_test "JSON with no violations" test_json_no_violations

echo ""
echo -e "${BOLD}--threshold option${NC}"
run_test "Custom threshold changes behavior" test_custom_threshold
run_test "Invalid threshold exits 1" test_invalid_threshold_exits_1

echo ""
echo -e "${BOLD}--extensions option${NC}"
run_test "Default extensions match .sh" test_default_extensions_match_sh
run_test "Extensions filter limits scan" test_extensions_filter
run_test "Multiple extensions" test_extensions_multiple
run_test "Unmatched extension → no files found" test_unmatched_extension_no_files

echo ""
echo -e "${BOLD}--exclude option${NC}"
run_test "Excludes node_modules by default" test_excludes_node_modules_by_default
run_test "Excludes .git by default" test_excludes_git_by_default
run_test "Excludes vendor by default" test_excludes_vendor_by_default
run_test "Custom exclude dirs" test_custom_exclude

echo ""
echo -e "${BOLD}Path argument${NC}"
run_test "Scan specific directory" test_scan_specific_directory

echo ""
echo -e "${BOLD}Edge cases${NC}"
run_test "Empty directory → no files found" test_empty_directory
run_test "--help shows usage" test_help_flag
run_test "Unknown option exits 1" test_unknown_option_exits_1
run_test "Empty file → no violation" test_empty_file_no_violation
run_test "Multiple violations all reported" test_multiple_violations_all_reported
run_test "Nested directory scanning" test_nested_directory_scanning

# =============================================================================
# Summary
# =============================================================================

echo ""
printf '  '
printf '%0.s-' $(seq 1 56)
echo ""
echo -e "  Total:   $TOTAL"
echo -e "  ${GREEN}Passed:${NC}  $PASS"
if [[ $FAIL -gt 0 ]]; then
  echo -e "  ${RED}Failed:${NC}  $FAIL"
  echo ""
  echo -e "  ${RED}Failed tests:${NC}"
  for t in "${FAILED_TESTS[@]}"; do
    echo -e "    - $t"
  done
  echo ""
  exit 1
else
  echo -e "  Failed:  0"
  echo ""
  echo -e "  ${GREEN}All tests passed.${NC}"
fi
