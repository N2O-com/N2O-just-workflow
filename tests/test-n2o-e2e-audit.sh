#!/bin/bash
set -uo pipefail

# =============================================================================
# Meta-Test Audit for: tests/test-n2o-e2e.sh
# Validates that e2e tests are not fake — applies the tdd-agent litmus test:
# "If I break the functionality, will this test fail?"
#
# Parses the source code of the e2e test file and programmatically detects
# weak or fake test patterns.
#
# Usage: bash tests/test-n2o-e2e-audit.sh
# =============================================================================

N2O_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_FILE="$N2O_DIR/tests/test-n2o-e2e.sh"
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

CURRENT_TEST=""

run_test() {
  local name="$1"
  local func="$2"
  CURRENT_TEST="$name"
  ((TOTAL++)) || true

  local result=0
  local err_file
  err_file=$(mktemp)

  (
    set -e
    "$func"
  ) > /dev/null 2>"$err_file" || result=$?

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

# -----------------------------------------------------------------------------
# Helpers: extract test function bodies from source
# -----------------------------------------------------------------------------

# List all test function names in the target file
list_test_functions() {
  grep -oE '^test_[a-zA-Z0-9_]+\(\)' "$TARGET_FILE" | sed 's/()//'
}

# Extract the body of a named function (everything between opening { and closing })
# Uses awk brace-depth tracking for reliable extraction
extract_function_body() {
  local func_name="$1"
  awk -v fn="$func_name" '
    $0 ~ "^"fn"\\(\\)" { inside=1; depth=0 }
    inside {
      for(i=1; i<=length($0); i++) {
        c = substr($0,i,1)
        if(c == "{") depth++
        if(c == "}") depth--
      }
      # Print lines inside the function body (depth > 0), skip the declaration line
      if(depth > 0 && !($0 ~ "^"fn"\\(\\)")) print
      # Stop when we close back to depth 0 (after being inside)
      if(depth <= 0 && NR > 1 && inside) { inside=0 }
    }
  ' "$TARGET_FILE"
}

# Count lines matching a pattern in a function body
count_in_body() {
  local func_name="$1"
  local pattern="$2"
  extract_function_body "$func_name" | grep -cE "$pattern" 2>/dev/null || echo "0"
}

# -----------------------------------------------------------------------------
# Audit tests
# -----------------------------------------------------------------------------

audit_every_test_has_assertions() {
  # Every test function must have at least one assertion.
  # Assertions are: assert_* function calls OR inline "ASSERT FAILED" strings.
  local functions
  functions=$(list_test_functions)
  local empty_tests=()

  local func
  for func in $functions; do
    local assertion_count
    assertion_count=$(count_in_body "$func" 'assert_|ASSERT FAILED')
    if [[ "$assertion_count" -eq 0 ]]; then
      empty_tests+=("$func")
    fi
  done

  if [[ ${#empty_tests[@]} -gt 0 ]]; then
    echo "    ASSERT FAILED: Tests with no assertions: ${empty_tests[*]}" >&2
    return 1
  fi
}

audit_no_existence_only_tests() {
  # No test should ONLY check that files/tables exist without checking content.
  # If a test has assert_file_exists or assert_sqlite_table_exists, it must also
  # have content-checking assertions (assert_equals, assert_json_field,
  # assert_file_contains, assert_output_contains).
  local functions
  functions=$(list_test_functions)
  local weak_tests=()

  local func
  for func in $functions; do
    local body
    body=$(extract_function_body "$func")

    # Count existence-only assertions
    local existence_count
    existence_count=$(echo "$body" | grep -cE 'assert_file_exists|assert_sqlite_table_exists' 2>/dev/null || echo "0")

    if [[ "$existence_count" -gt 0 ]]; then
      # Must also have content-checking assertions
      local content_count
      content_count=$(echo "$body" | grep -cE 'assert_equals|assert_json_field|assert_file_contains|assert_output_contains|ASSERT FAILED' 2>/dev/null || echo "0")

      if [[ "$content_count" -eq 0 ]]; then
        weak_tests+=("$func")
      fi
    fi
  done

  if [[ ${#weak_tests[@]} -gt 0 ]]; then
    echo "    ASSERT FAILED: Existence-only tests (no content checks): ${weak_tests[*]}" >&2
    return 1
  fi
}

audit_no_exit_code_only_tests() {
  # If a test captures command output into a variable, it must assert on
  # that output's content — not just check the exit code.
  local functions
  functions=$(list_test_functions)
  local weak_tests=()

  local func
  for func in $functions; do
    local body
    body=$(extract_function_body "$func")

    # Check if function captures output (output=$(...))
    local captures_output
    captures_output=$(echo "$body" | grep -cE 'output=\$\(' 2>/dev/null || echo "0")

    if [[ "$captures_output" -gt 0 ]]; then
      # Must assert on the output content (not just exit code)
      local content_assertions
      content_assertions=$(echo "$body" | grep -cE 'assert_output_contains|assert_equals.*\$output|assert_file_contains.*\$output|echo.*\$output.*jq' 2>/dev/null || echo "0")

      if [[ "$content_assertions" -eq 0 ]]; then
        weak_tests+=("$func")
      fi
    fi
  done

  if [[ ${#weak_tests[@]} -gt 0 ]]; then
    echo "    ASSERT FAILED: Exit-code-only tests (capture output but don't check content): ${weak_tests[*]}" >&2
    return 1
  fi
}

audit_assertions_check_specific_values() {
  # No test should rely solely on "not empty" or "greater than zero" checks.
  # Tests that only use -n/-z tests or assert_gt 0 are weak.
  local functions
  functions=$(list_test_functions)
  local weak_tests=()

  local func
  for func in $functions; do
    local body
    body=$(extract_function_body "$func")

    # Count total assertions
    local total_assertions
    total_assertions=$(echo "$body" | grep -cE 'assert_' 2>/dev/null || echo "0")

    if [[ "$total_assertions" -eq 0 ]]; then
      continue  # Caught by audit_every_test_has_assertions
    fi

    # Count specific-value assertions (assert_equals with literal, assert_json_field,
    # assert_file_contains, assert_output_contains)
    local specific_count
    specific_count=$(echo "$body" | grep -cE 'assert_equals|assert_json_field|assert_file_contains|assert_output_contains' 2>/dev/null || echo "0")

    # Count weak-only assertions (only -n/-z or assert_gt with 0)
    local weak_only_count
    weak_only_count=$(echo "$body" | grep -cE '\[\[ -n |\[\[ -z |assert_gt.*0[^0-9]' 2>/dev/null || echo "0")

    # Fail if there are NO specific assertions and ONLY weak ones
    if [[ "$specific_count" -eq 0 && "$weak_only_count" -gt 0 ]]; then
      weak_tests+=("$func")
    fi
  done

  if [[ ${#weak_tests[@]} -gt 0 ]]; then
    echo "    ASSERT FAILED: Tests with only non-specific assertions: ${weak_tests[*]}" >&2
    return 1
  fi
}

audit_assert_equals_uses_literals() {
  # assert_equals should use hardcoded expected values (quoted strings/numbers),
  # not variables that could hold any value.
  # Pattern: assert_equals "$some_var" ... is suspicious
  # OK: assert_equals "3" ... or assert_equals "$current_version" where
  #     current_version is set from a known source (manifest)
  local functions
  functions=$(list_test_functions)
  local weak_tests=()

  # Known safe variable patterns: these are set from trusted framework sources
  local safe_vars='current_version'

  local func
  for func in $functions; do
    local body
    body=$(extract_function_body "$func")

    # Find assert_equals calls where first arg is a $variable
    local dynamic_expected
    dynamic_expected=$(echo "$body" | grep -oE 'assert_equals "\$[a-zA-Z_]+"' 2>/dev/null || echo "")

    if [[ -n "$dynamic_expected" ]]; then
      # Check each against safe list
      local line
      while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        local var_name
        var_name=$(echo "$line" | grep -oE '\$[a-zA-Z_]+' | head -1 | sed 's/\$//')
        # Skip if it's a known-safe variable
        if echo "$safe_vars" | grep -qw "$var_name"; then
          continue
        fi
        weak_tests+=("$func (uses \$$var_name as expected)")
        break  # Only report once per function
      done <<< "$dynamic_expected"
    fi
  done

  if [[ ${#weak_tests[@]} -gt 0 ]]; then
    echo "    ASSERT FAILED: assert_equals uses dynamic expected values: ${weak_tests[*]}" >&2
    return 1
  fi
}

audit_no_commented_out_assertions() {
  # No test function should have commented-out assertions.
  # This catches cases where someone weakened a test by disabling checks.
  local functions
  functions=$(list_test_functions)
  local weak_tests=()

  local func
  for func in $functions; do
    local commented_count
    commented_count=$(count_in_body "$func" '^\s*#\s*assert_')

    if [[ "$commented_count" -gt 0 ]]; then
      weak_tests+=("$func ($commented_count commented assertions)")
    fi
  done

  if [[ ${#weak_tests[@]} -gt 0 ]]; then
    echo "    ASSERT FAILED: Tests with commented-out assertions: ${weak_tests[*]}" >&2
    return 1
  fi
}

audit_minimum_assertion_density() {
  # Complex tests (transcript, workflow, stats, sync) need >= 3 assertions.
  # Simple error-case tests (check_detects_broken, session_hook) need >= 1.
  local functions
  functions=$(list_test_functions)
  local shallow_tests=()

  # Tests that need >= 3 assertions (complex behavior verification)
  local complex_pattern="transcript|workflow|cost|idempotent|stats|sync|init|seed"

  local func
  for func in $functions; do
    local assertion_count
    assertion_count=$(count_in_body "$func" 'assert_|ASSERT FAILED')

    # Determine minimum threshold
    local min_required=1
    if echo "$func" | grep -qE "$complex_pattern"; then
      min_required=3
    fi

    if [[ "$assertion_count" -lt "$min_required" ]]; then
      shallow_tests+=("$func (has $assertion_count, needs >= $min_required)")
    fi
  done

  if [[ ${#shallow_tests[@]} -gt 0 ]]; then
    echo "    ASSERT FAILED: Tests below minimum assertion density: ${shallow_tests[*]}" >&2
    return 1
  fi
}

# -----------------------------------------------------------------------------
# Sanity checks on the audit itself
# -----------------------------------------------------------------------------

audit_target_file_exists() {
  # The target file must exist for the audit to be meaningful
  if [[ ! -f "$TARGET_FILE" ]]; then
    echo "    ASSERT FAILED: Target file $TARGET_FILE does not exist" >&2
    return 1
  fi

  # Must have test functions
  local func_count
  func_count=$(list_test_functions | wc -l | tr -d ' ')
  if [[ "$func_count" -lt 5 ]]; then
    echo "    ASSERT FAILED: Expected >= 5 test functions, found $func_count" >&2
    return 1
  fi
  assert_equals "27" "$func_count" "Should have exactly 27 test functions"
}

audit_extract_function_body_works() {
  # Verify our extraction helper actually works — extract a known function
  # and check it contains expected content
  local body
  body=$(extract_function_body "test_e2e_init")

  # Should contain assertions (not be empty)
  local assertion_count
  assertion_count=$(echo "$body" | grep -cE 'assert_' 2>/dev/null || echo "0")

  if [[ "$assertion_count" -lt 3 ]]; then
    echo "    ASSERT FAILED: extract_function_body should find >= 3 assertions in test_e2e_init, found $assertion_count" >&2
    return 1
  fi

  # Should contain specific known content from test_e2e_init
  if ! echo "$body" | grep -q "rates.json"; then
    echo "    ASSERT FAILED: test_e2e_init body should mention rates.json" >&2
    return 1
  fi
}

# -----------------------------------------------------------------------------
# Run all audits
# -----------------------------------------------------------------------------

echo ""
echo -e "${BOLD}N2O E2E Audit — Meta-Test Validator${NC}"
echo -e "${BOLD}====================================${NC}"
echo ""

echo -e "${BOLD}Sanity Checks${NC}"
run_test "Target file exists with expected test count"   audit_target_file_exists
run_test "Function body extraction works correctly"      audit_extract_function_body_works

echo ""
echo -e "${BOLD}Fake Test Detection${NC}"
run_test "Every test has assertions"                     audit_every_test_has_assertions
run_test "No existence-only tests"                       audit_no_existence_only_tests
run_test "No exit-code-only tests"                       audit_no_exit_code_only_tests
run_test "Assertions check specific values"              audit_assertions_check_specific_values
run_test "assert_equals uses literal expected values"    audit_assert_equals_uses_literals
run_test "No commented-out assertions"                   audit_no_commented_out_assertions
run_test "Minimum assertion density met"                 audit_minimum_assertion_density

# Summary
echo ""
echo -e "${BOLD}Results: $PASS passed, $FAIL failed, $TOTAL total${NC}"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo -e "${RED}Failed audits:${NC}"
  for t in "${FAILED_TESTS[@]}"; do
    echo -e "  ${RED}-${NC} $t"
  done
  echo ""
  exit 1
fi

echo ""
echo -e "${GREEN}All audits passed — e2e tests are not fake.${NC}"
echo ""
