#!/bin/bash
set -uo pipefail

# =============================================================================
# E2E Tests for: n2o release workflow
# Covers: bump_version, generate_changelog_entry, cmd_version_bump
# Pure bash — no external test frameworks required.
# Usage: bash tests/test-n2o-release.sh
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

# -----------------------------------------------------------------------------
# Stubs for n2o global functions used by bump_version / generate_changelog_entry
# -----------------------------------------------------------------------------

log_info()    { :; }
log_success() { :; }
log_warn()    { :; }
log_error()   { echo "$1" >&2; }

# Extract functions from n2o
eval "$(sed -n '/^bump_version() {$/,/^}$/p' "$N2O")"
eval "$(sed -n '/^generate_changelog_entry() {$/,/^}$/p' "$N2O")"

# Helper: create a test "framework" environment for release commands
setup_release_env() {
  # Create manifest with a known version
  cat > "$TEST_DIR/n2o-manifest.json" <<'JSON'
{
  "version": "1.2.3",
  "name": "n2o-test"
}
JSON
  MANIFEST="$TEST_DIR/n2o-manifest.json"
  VERSION="1.2.3"

  # Init a git repo with commits
  git -C "$TEST_DIR" init -q
  git -C "$TEST_DIR" config user.email "test@test.com"
  git -C "$TEST_DIR" config user.name "Test"
  echo "initial" > "$TEST_DIR/README.md"
  git -C "$TEST_DIR" add .
  git -C "$TEST_DIR" commit -q -m "initial commit"
  echo "feature" > "$TEST_DIR/feature.txt"
  git -C "$TEST_DIR" add .
  git -C "$TEST_DIR" commit -q -m "feat: add feature"
}

# -----------------------------------------------------------------------------
# bump_version tests
# -----------------------------------------------------------------------------

test_bump_version_patch() {
  setup_release_env
  bump_version "patch"

  local new_version
  new_version=$(jq -r '.version' "$MANIFEST")
  assert_equals "1.2.4" "$new_version" "Patch bump 1.2.3 -> 1.2.4"
  assert_equals "1.2.4" "$VERSION" "VERSION global should be updated"
}

test_bump_version_minor() {
  setup_release_env
  bump_version "minor"

  local new_version
  new_version=$(jq -r '.version' "$MANIFEST")
  assert_equals "1.3.0" "$new_version" "Minor bump 1.2.3 -> 1.3.0"
  assert_equals "1.3.0" "$VERSION" "VERSION global should be updated"
}

test_bump_version_major() {
  setup_release_env
  bump_version "major"

  local new_version
  new_version=$(jq -r '.version' "$MANIFEST")
  assert_equals "2.0.0" "$new_version" "Major bump 1.2.3 -> 2.0.0"
  assert_equals "2.0.0" "$VERSION" "VERSION global should be updated"
}

test_bump_version_invalid_level() {
  setup_release_env
  local rc=0
  bump_version "bogus" 2>/dev/null || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    echo "    ASSERT FAILED: Invalid bump level should return non-zero" >&2
    return 1
  fi
}

test_bump_version_updates_manifest_file() {
  setup_release_env
  # Verify original version
  assert_equals "1.2.3" "$(jq -r '.version' "$MANIFEST")"

  bump_version "patch"

  # File should be updated on disk
  local on_disk
  on_disk=$(jq -r '.version' "$MANIFEST")
  assert_equals "1.2.4" "$on_disk" "Manifest file on disk should have new version"

  # Other fields should be preserved
  local name
  name=$(jq -r '.name' "$MANIFEST")
  assert_equals "n2o-test" "$name" "Other manifest fields should be preserved"
}

# -----------------------------------------------------------------------------
# generate_changelog_entry tests
# -----------------------------------------------------------------------------

test_generate_changelog_creates_file() {
  setup_release_env
  # Override N2O_DIR to point to our test dir
  local saved_n2o_dir="$N2O_DIR"
  N2O_DIR="$TEST_DIR"

  generate_changelog_entry "1.2.4"

  assert_file_exists "$TEST_DIR/CHANGELOG.md"
  assert_file_contains "$TEST_DIR/CHANGELOG.md" "## 1.2.4"

  N2O_DIR="$saved_n2o_dir"
}

test_generate_changelog_prepends_to_existing() {
  setup_release_env
  echo "# N2O Changelog

## 1.2.3

- Old entry" > "$TEST_DIR/CHANGELOG.md"

  local saved_n2o_dir="$N2O_DIR"
  N2O_DIR="$TEST_DIR"

  generate_changelog_entry "1.2.4"

  # New entry should appear before old
  assert_file_contains "$TEST_DIR/CHANGELOG.md" "## 1.2.4"
  assert_file_contains "$TEST_DIR/CHANGELOG.md" "## 1.2.3"

  # Verify ordering: 1.2.4 comes before 1.2.3
  local first_version
  first_version=$(grep -m1 '^## ' "$TEST_DIR/CHANGELOG.md" | head -1)
  if [[ "$first_version" != *"1.2.4"* ]]; then
    echo "    ASSERT FAILED: New version should appear before old (first heading: $first_version)" >&2
    N2O_DIR="$saved_n2o_dir"
    return 1
  fi

  N2O_DIR="$saved_n2o_dir"
}

test_generate_changelog_includes_commits() {
  setup_release_env
  # Tag the initial commit so we get a range
  git -C "$TEST_DIR" tag "v1.2.3" HEAD~1

  local saved_n2o_dir="$N2O_DIR"
  N2O_DIR="$TEST_DIR"

  generate_changelog_entry "1.2.4"

  # Should include the "feat: add feature" commit as a bullet point
  assert_file_contains "$TEST_DIR/CHANGELOG.md" "- feat: add feature"

  N2O_DIR="$saved_n2o_dir"
}

test_generate_changelog_no_prior_tag() {
  setup_release_env
  local saved_n2o_dir="$N2O_DIR"
  N2O_DIR="$TEST_DIR"

  generate_changelog_entry "1.2.4"

  # Without a tag, should include all commits as bullets
  assert_file_contains "$TEST_DIR/CHANGELOG.md" "- "
  assert_file_contains "$TEST_DIR/CHANGELOG.md" "## 1.2.4"

  N2O_DIR="$saved_n2o_dir"
}

# -----------------------------------------------------------------------------
# CLI smoke tests (via n2o help, since version bump modifies real files)
# -----------------------------------------------------------------------------

test_version_bump_appears_in_help() {
  local output
  output=$("$N2O" help 2>&1)
  if [[ "$output" != *"version"* ]]; then
    echo "    ASSERT FAILED: Help should mention 'version' command" >&2
    return 1
  fi
}

# =============================================================================
# Run tests
# =============================================================================

echo ""
echo -e "${BOLD}N2O Release — E2E Tests${NC}"
echo -e "${BOLD}=======================${NC}"

echo ""
echo -e "${BOLD}bump_version${NC}"
run_test "Patch bump increments patch"                test_bump_version_patch
run_test "Minor bump increments minor, resets patch"  test_bump_version_minor
run_test "Major bump increments major, resets all"    test_bump_version_major
run_test "Invalid level returns error"                test_bump_version_invalid_level
run_test "Updates manifest file on disk"              test_bump_version_updates_manifest_file

echo ""
echo -e "${BOLD}generate_changelog_entry${NC}"
run_test "Creates CHANGELOG.md if missing"            test_generate_changelog_creates_file
run_test "Prepends to existing changelog"             test_generate_changelog_prepends_to_existing
run_test "Includes commit messages as bullets"        test_generate_changelog_includes_commits
run_test "Works without prior git tag"                test_generate_changelog_no_prior_tag

echo ""
echo -e "${BOLD}CLI${NC}"
run_test "Help mentions version command"              test_version_bump_appears_in_help

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
