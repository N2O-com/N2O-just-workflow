#!/bin/bash
set -uo pipefail

# =============================================================================
# run-all.sh — Run all N2O test suites and aggregate results
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

SUITE_PASS=0
SUITE_FAIL=0
SUITE_TOTAL=0
FAILED_SUITES=()

echo ""
echo -e "${BOLD}N2O — Full Test Suite${NC}"
echo -e "${BOLD}=====================${NC}"
echo ""

for test_file in "$SCRIPT_DIR"/test-*.sh; do
  [[ -f "$test_file" ]] || continue
  suite_name=$(basename "$test_file" .sh)
  ((SUITE_TOTAL++)) || true

  echo -e "${BOLD}Running: $suite_name${NC}"
  if bash "$test_file"; then
    ((SUITE_PASS++)) || true
  else
    ((SUITE_FAIL++)) || true
    FAILED_SUITES+=("$suite_name")
  fi
  echo ""
done

echo -e "${BOLD}=== Suite Summary ===${NC}"
echo -e "  Suites: ${SUITE_PASS} passed, ${SUITE_FAIL} failed, ${SUITE_TOTAL} total"

if [[ $SUITE_FAIL -gt 0 ]]; then
  echo ""
  echo -e "${RED}Failed suites:${NC}"
  for s in "${FAILED_SUITES[@]}"; do
    echo -e "  ${RED}-${NC} $s"
  done
  exit 1
fi

echo ""
echo -e "${GREEN}All suites passed.${NC}"
echo ""
