#!/bin/bash
set -uo pipefail

# =============================================================================
# E2E Tests for: framework-polish sprint
# Covers: version pinning, selective sync, changelogs, health check, session hook
# Pure bash — no external test frameworks required.
# Usage: bash tests/test-n2o-sync.sh
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
# Test harness (same as test-n2o-init.sh)
# -----------------------------------------------------------------------------

TEST_DIR=""
CURRENT_TEST=""

setup() {
  TEST_DIR=$(mktemp -d)
  # Init a project for sync tests
  "$N2O" init "$TEST_DIR" &>/dev/null
}

setup_bare() {
  TEST_DIR=$(mktemp -d)
  # No init — bare directory
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

assert_file_not_exists() {
  local path="$1"
  local msg="${2:-File should not exist: $path}"
  if [[ -f "$path" ]]; then
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

assert_file_not_contains() {
  local path="$1"
  local pattern="$2"
  local msg="${3:-File $path should NOT contain: $pattern}"
  if grep -qF "$pattern" "$path" 2>/dev/null; then
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

assert_json_field_missing() {
  local path="$1"
  local field="$2"
  local msg="${3:-$path: .$field should be absent or null}"
  local actual
  actual=$(jq -r "$field // \"__MISSING__\"" "$path" 2>/dev/null)
  if [[ "$actual" != "__MISSING__" && "$actual" != "null" ]]; then
    echo "    ASSERT FAILED: $msg (got '$actual')" >&2
    return 1
  fi
}

assert_output_contains() {
  local output="$1"
  local pattern="$2"
  local msg="${3:-Output should contain: $pattern}"
  if ! echo "$output" | grep -qF "$pattern" 2>/dev/null; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

assert_output_not_contains() {
  local output="$1"
  local pattern="$2"
  local msg="${3:-Output should NOT contain: $pattern}"
  if echo "$output" | grep -qF "$pattern" 2>/dev/null; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

assert_exit_code() {
  local expected="$1"
  local actual="$2"
  local msg="${3:-Exit code should be $expected}"
  if [[ "$actual" -ne "$expected" ]]; then
    echo "    ASSERT FAILED: $msg (got $actual)" >&2
    return 1
  fi
}

# =============================================================================
# TASK 1: Version Pinning Tests
# =============================================================================

test_pin_default() {
  setup
  "$N2O" pin "$TEST_DIR"
  assert_json_field "$TEST_DIR/.pm/config.json" ".n2o_version_pinned" "1.0.0"
  teardown
}

test_pin_specific_version() {
  setup
  "$N2O" pin "$TEST_DIR" "2.0.0"
  assert_json_field "$TEST_DIR/.pm/config.json" ".n2o_version_pinned" "2.0.0"
  teardown
}

test_unpin() {
  setup
  "$N2O" pin "$TEST_DIR"
  assert_json_field "$TEST_DIR/.pm/config.json" ".n2o_version_pinned" "1.0.0"
  "$N2O" pin "$TEST_DIR" --unpin
  assert_json_field_missing "$TEST_DIR/.pm/config.json" ".n2o_version_pinned"
  teardown
}

test_sync_respects_pin() {
  setup
  # Pin to an older version so framework version (1.0.0) looks newer
  local tmp
  tmp=$(mktemp)
  jq '.n2o_version = "0.9.0" | .n2o_version_pinned = "0.9.0"' "$TEST_DIR/.pm/config.json" > "$tmp"
  mv "$tmp" "$TEST_DIR/.pm/config.json"

  local output
  output=$("$N2O" sync "$TEST_DIR" 2>&1 || true)
  assert_output_contains "$output" "pinned to v0.9.0"

  # Version should NOT have been updated
  assert_json_field "$TEST_DIR/.pm/config.json" ".n2o_version" "0.9.0"
  teardown
}

test_sync_force_overrides_pin() {
  setup
  local tmp
  tmp=$(mktemp)
  jq '.n2o_version = "0.9.0" | .n2o_version_pinned = "0.9.0"' "$TEST_DIR/.pm/config.json" > "$tmp"
  mv "$tmp" "$TEST_DIR/.pm/config.json"

  "$N2O" sync "$TEST_DIR" --force

  # Version should be updated
  assert_json_field "$TEST_DIR/.pm/config.json" ".n2o_version" "1.0.0"
  # Pin should be updated to match
  assert_json_field "$TEST_DIR/.pm/config.json" ".n2o_version_pinned" "1.0.0"
  teardown
}

# =============================================================================
# TASK 2: Selective Sync Tests
# =============================================================================

test_sync_only_agents() {
  setup
  # Modify a pattern SKILL.md to detect if it gets updated
  echo "CUSTOM" > "$TEST_DIR/.claude/skills/react-best-practices/SKILL.md"

  "$N2O" sync "$TEST_DIR" --only=agents

  # Agent skills should be synced (original content restored)
  assert_file_not_contains "$TEST_DIR/.claude/skills/pm-agent/SKILL.md" "CUSTOM"

  # Pattern file should still have custom content (not synced)
  assert_file_contains "$TEST_DIR/.claude/skills/react-best-practices/SKILL.md" "CUSTOM"
  teardown
}

test_sync_only_schema() {
  setup
  # Modify schema.sql in the project
  echo "-- CUSTOM" >> "$TEST_DIR/.pm/schema.sql"

  "$N2O" sync "$TEST_DIR" --only=schema

  # Schema should be restored (custom removed)
  assert_file_not_contains "$TEST_DIR/.pm/schema.sql" "CUSTOM"
  teardown
}

test_sync_only_combined() {
  setup
  "$N2O" sync "$TEST_DIR" --only=agents,schema
  # Should not error — just verifying it parses combined categories
  assert_json_field "$TEST_DIR/.pm/config.json" ".n2o_version" "1.0.0"
  teardown
}

test_sync_invalid_category() {
  setup
  local result=0
  "$N2O" sync "$TEST_DIR" --only=foobar 2>/dev/null || result=$?
  assert_exit_code 1 "$result"
  teardown
}

# =============================================================================
# TASK 3: Changelogs + Auto Version Bump Tests
# =============================================================================

test_version_bump_patch() {
  setup_bare
  # We test the version_compare function indirectly through the bump command
  # Just verify help text includes version bump
  local output
  output=$("$N2O" help 2>&1)
  assert_output_contains "$output" "version bump"
  teardown
}

test_changelog_exists() {
  # Verify CHANGELOG.md exists in the framework
  assert_file_exists "$N2O_DIR/CHANGELOG.md"
  assert_file_contains "$N2O_DIR/CHANGELOG.md" "1.0.0"
}

test_changelog_in_manifest() {
  # Verify CHANGELOG.md is in framework_files (so it gets synced)
  local in_manifest
  in_manifest=$(jq -r '.framework_files | index("CHANGELOG.md") // -1' "$N2O_DIR/n2o-manifest.json")
  if [[ "$in_manifest" == "-1" ]]; then
    echo "    ASSERT FAILED: CHANGELOG.md should be in framework_files" >&2
    return 1
  fi
}

test_sync_shows_changelog() {
  setup
  # Set project to older version so sync shows changelog
  local tmp
  tmp=$(mktemp)
  jq '.n2o_version = "0.9.0"' "$TEST_DIR/.pm/config.json" > "$tmp"
  mv "$tmp" "$TEST_DIR/.pm/config.json"

  local output
  output=$("$N2O" sync "$TEST_DIR" 2>&1)
  # Should show "Current version: X → Y"
  assert_output_contains "$output" "0.9.0"
  teardown
}

# =============================================================================
# TASK 4: Health Check Tests
# =============================================================================

test_check_pass() {
  setup
  local result=0
  local output
  output=$("$N2O" check "$TEST_DIR" 2>&1) || result=$?
  assert_exit_code 0 "$result" "Health check should pass on fresh init"
  assert_output_contains "$output" "All 17 checks passed"
  teardown
}

test_check_fail_missing_db() {
  setup
  rm "$TEST_DIR/.pm/tasks.db"
  local result=0
  local output
  output=$("$N2O" check "$TEST_DIR" 2>&1) || result=$?
  assert_exit_code 1 "$result" "Health check should fail with missing DB"
  assert_output_contains "$output" "FAIL"
  teardown
}

test_check_fail_bad_config() {
  setup
  echo "NOT JSON" > "$TEST_DIR/.pm/config.json"
  local result=0
  local output
  output=$("$N2O" check "$TEST_DIR" 2>&1) || result=$?
  assert_exit_code 1 "$result" "Health check should fail with invalid config"
  assert_output_contains "$output" "FAIL"
  teardown
}

test_check_integrated_in_init() {
  setup_bare
  local output
  output=$("$N2O" init "$TEST_DIR" 2>&1)
  assert_output_contains "$output" "Health Check"
  assert_output_contains "$output" "PASS"
  teardown
}

test_check_in_help() {
  local output
  output=$("$N2O" help 2>&1)
  assert_output_contains "$output" "n2o check"
}

# =============================================================================
# TASK 5: SessionStart Hook Tests
# =============================================================================

test_hook_registered_on_init() {
  setup_bare
  "$N2O" init "$TEST_DIR" &>/dev/null
  assert_file_exists "$TEST_DIR/.claude/settings.json"
  assert_json_field "$TEST_DIR/.claude/settings.json" \
    '.hooks.SessionStart[0].hooks[0].command' \
    "bash scripts/n2o-session-hook.sh"
  teardown
}

test_hook_script_exists() {
  setup
  assert_file_exists "$TEST_DIR/scripts/n2o-session-hook.sh"
  if [[ ! -x "$TEST_DIR/scripts/n2o-session-hook.sh" ]]; then
    echo "    ASSERT FAILED: Hook script should be executable" >&2
    return 1
  fi
  teardown
}

test_hook_skips_non_startup() {
  setup
  local output
  output=$(echo '{"source":"resume","session_id":"test","cwd":"'"$TEST_DIR"'"}' | bash "$TEST_DIR/scripts/n2o-session-hook.sh" 2>/dev/null)
  if [[ -n "$output" ]]; then
    echo "    ASSERT FAILED: Hook should produce no output for source=resume" >&2
    return 1
  fi
  teardown
}

test_hook_shows_version_notification() {
  setup
  local output
  output=$(echo '{"source":"startup","session_id":"test","cwd":"'"$TEST_DIR"'"}' | bash "$TEST_DIR/scripts/n2o-session-hook.sh" 2>/dev/null)
  assert_output_contains "$output" "N2O framework updated"
  # Should create .last_seen_version marker
  assert_file_exists "$TEST_DIR/.pm/.last_seen_version"
  teardown
}

test_hook_silent_on_repeat() {
  setup
  # First run — shows version notification
  echo '{"source":"startup","session_id":"test1","cwd":"'"$TEST_DIR"'"}' | bash "$TEST_DIR/scripts/n2o-session-hook.sh" &>/dev/null
  # Second run — version notification should NOT appear (developer info line is OK)
  local output
  output=$(echo '{"source":"startup","session_id":"test2","cwd":"'"$TEST_DIR"'"}' | bash "$TEST_DIR/scripts/n2o-session-hook.sh" 2>/dev/null)
  if echo "$output" | grep -q "N2O framework updated"; then
    echo "    ASSERT FAILED: Version notification should not repeat on second run" >&2
    return 1
  fi
  teardown
}

test_hook_merge_preserves_settings() {
  setup_bare
  # Create settings with existing model config
  mkdir -p "$TEST_DIR/.claude"
  echo '{"model":"sonnet"}' > "$TEST_DIR/.claude/settings.json"
  "$N2O" init "$TEST_DIR" &>/dev/null
  # Model setting should still be there
  assert_json_field "$TEST_DIR/.claude/settings.json" ".model" "sonnet"
  # Hook should also be there
  assert_json_field "$TEST_DIR/.claude/settings.json" \
    '.hooks.SessionStart[0].hooks[0].command' \
    "bash scripts/n2o-session-hook.sh"
  teardown
}

test_hook_no_duplicate_on_sync() {
  setup
  "$N2O" sync "$TEST_DIR" &>/dev/null
  # Count how many SessionStart entries exist — should be exactly 1
  local count
  count=$(jq '.hooks.SessionStart | length' "$TEST_DIR/.claude/settings.json" 2>/dev/null)
  if [[ "$count" -ne 1 ]]; then
    echo "    ASSERT FAILED: Should have exactly 1 SessionStart entry (got $count)" >&2
    return 1
  fi
  teardown
}

test_gitignore_has_last_seen() {
  setup
  assert_file_contains "$TEST_DIR/.gitignore" ".pm/.last_seen_version"
  teardown
}

test_sync_equal_versions() {
  setup
  # Pin to current version (same as framework)
  "$N2O" pin "$TEST_DIR"
  # Sync should proceed (not blocked) since versions are equal
  local output exit_code=0
  output=$("$N2O" sync "$TEST_DIR" 2>&1) || exit_code=$?
  # Should NOT contain the "pinned" warning
  if [[ "$output" == *"pinned to v"* ]]; then
    echo "    ASSERT FAILED: Equal version sync should not show pinned warning" >&2
    teardown
    return 1
  fi
  teardown
}

test_sync_dry_run_no_modifications() {
  setup
  # Set project to an older version so sync has something to do
  local tmp
  tmp=$(mktemp)
  jq '.n2o_version = "0.1.0"' "$TEST_DIR/.pm/config.json" > "$tmp"
  mv "$tmp" "$TEST_DIR/.pm/config.json"

  # Capture config checksum before dry-run
  local before_checksum
  before_checksum=$(shasum "$TEST_DIR/.pm/config.json" | cut -d' ' -f1)

  "$N2O" sync "$TEST_DIR" --dry-run &>/dev/null || true

  # Config version should NOT have changed
  local after_checksum
  after_checksum=$(shasum "$TEST_DIR/.pm/config.json" | cut -d' ' -f1)
  if [[ "$before_checksum" != "$after_checksum" ]]; then
    echo "    ASSERT FAILED: --dry-run should not modify config.json" >&2
    teardown
    return 1
  fi

  # n2o_version should still be 0.1.0
  assert_json_field "$TEST_DIR/.pm/config.json" ".n2o_version" "0.1.0"
  teardown
}

test_sync_older_framework_than_pinned() {
  setup
  # Pin to a version higher than the framework (e.g., 99.0.0)
  "$N2O" pin "$TEST_DIR" "99.0.0"
  # Framework is 1.0.0 which is OLDER than pin — sync should proceed (not blocked)
  local output
  output=$("$N2O" sync "$TEST_DIR" 2>&1) || true
  # Should NOT show the pinned warning (only fires when framework > pinned)
  if [[ "$output" == *"pinned to v99.0.0"* && "$output" == *"Use 'n2o sync --force'"* ]]; then
    echo "    ASSERT FAILED: Sync with older framework should not be blocked by pin" >&2
    teardown
    return 1
  fi
  teardown
}

test_sync_creates_backup() {
  setup
  # Modify a framework-managed file so it differs from the framework source.
  # .pm/schema.sql is a framework file that gets synced.
  echo "-- modified by test" >> "$TEST_DIR/.pm/schema.sql"

  # Sync should create a backup of the changed file
  "$N2O" sync "$TEST_DIR" &>/dev/null || true

  # Check that .n2o-backup directory was created with at least one file
  local backup_count
  backup_count=$(find "$TEST_DIR/.n2o-backup" -type f 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$backup_count" -eq 0 ]]; then
    echo "    ASSERT FAILED: sync should create .n2o-backup with backed-up files (found $backup_count)" >&2
    teardown
    return 1
  fi
  teardown
}

test_sync_adds_new_files() {
  setup
  # Remove a synced file from the project
  rm -f "$TEST_DIR/.pm/schema.sql"

  # Sync should restore it
  "$N2O" sync "$TEST_DIR" &>/dev/null || true

  if [[ ! -f "$TEST_DIR/.pm/schema.sql" ]]; then
    echo "    ASSERT FAILED: sync should restore missing framework files" >&2
    teardown
    return 1
  fi
  teardown
}

test_sync_all_no_projects_file() {
  # sync --all should fail if no projects are registered
  # Temporarily ensure .n2o-projects.json doesn't exist
  local projects_file="$N2O_DIR/.n2o-projects.json"
  local had_file=false
  local backup=""
  if [[ -f "$projects_file" ]]; then
    had_file=true
    backup=$(mktemp)
    cp "$projects_file" "$backup"
    rm "$projects_file"
  fi

  local rc=0
  "$N2O" sync --all 2>/dev/null || rc=$?

  # Restore if needed
  if $had_file; then
    mv "$backup" "$projects_file"
  fi

  if [[ "$rc" -eq 0 ]]; then
    echo "    ASSERT FAILED: sync --all without projects file should exit non-zero (got $rc)" >&2
    return 1
  fi
}

test_sync_changelog_missing_graceful() {
  setup
  # Set project to older version so show_changelog gets called
  local tmp
  tmp=$(mktemp)
  jq '.n2o_version = "0.1.0"' "$TEST_DIR/.pm/config.json" > "$tmp"
  mv "$tmp" "$TEST_DIR/.pm/config.json"

  # Temporarily rename CHANGELOG.md if it exists
  local changelog_backup=""
  if [[ -f "$N2O_DIR/CHANGELOG.md" ]]; then
    changelog_backup=$(mktemp)
    cp "$N2O_DIR/CHANGELOG.md" "$changelog_backup"
    mv "$N2O_DIR/CHANGELOG.md" "$N2O_DIR/CHANGELOG.md.bak"
  fi

  # Sync should not crash even without CHANGELOG.md
  local exit_code=0
  "$N2O" sync "$TEST_DIR" &>/dev/null || exit_code=$?

  # Restore CHANGELOG.md
  if [[ -n "$changelog_backup" ]]; then
    mv "$N2O_DIR/CHANGELOG.md.bak" "$N2O_DIR/CHANGELOG.md"
    rm -f "$changelog_backup"
  fi

  if [[ "$exit_code" -ne 0 ]]; then
    echo "    ASSERT FAILED: Sync should not crash with missing CHANGELOG.md (exit code $exit_code)" >&2
    teardown
    return 1
  fi
  teardown
}

# =============================================================================
# Run all tests
# =============================================================================

echo ""
echo -e "${BOLD}N2O Framework-Polish — E2E Tests${NC}"
echo -e "${BOLD}=================================${NC}"

echo ""
echo -e "${BOLD}Version Pinning${NC}"
run_test "Pin defaults to current version"        test_pin_default
run_test "Pin to specific version"                test_pin_specific_version
run_test "Unpin removes version pin"              test_unpin
run_test "Sync respects version pin"              test_sync_respects_pin
run_test "Sync --force overrides pin"             test_sync_force_overrides_pin

echo ""
echo -e "${BOLD}Selective Sync${NC}"
run_test "Sync --only=agents skips patterns"      test_sync_only_agents
run_test "Sync --only=schema updates schema"      test_sync_only_schema
run_test "Sync --only=agents,schema combined"     test_sync_only_combined
run_test "Sync --only=invalid errors"             test_sync_invalid_category

echo ""
echo -e "${BOLD}Changelogs${NC}"
run_test "Help shows version bump command"        test_version_bump_patch
run_test "CHANGELOG.md exists in framework"       test_changelog_exists
run_test "CHANGELOG.md in manifest framework_files" test_changelog_in_manifest
run_test "Sync shows version transition"          test_sync_shows_changelog

echo ""
echo -e "${BOLD}Health Check${NC}"
run_test "Check passes on fresh init"             test_check_pass
run_test "Check fails with missing DB"            test_check_fail_missing_db
run_test "Check fails with bad config"            test_check_fail_bad_config
run_test "Check runs during init"                 test_check_integrated_in_init
run_test "Check appears in help"                  test_check_in_help

echo ""
echo -e "${BOLD}SessionStart Hook${NC}"
run_test "Hook registered on init"                test_hook_registered_on_init
run_test "Hook script exists and executable"      test_hook_script_exists
run_test "Hook skips non-startup events"          test_hook_skips_non_startup
run_test "Hook shows version notification"        test_hook_shows_version_notification
run_test "Hook silent on repeat"                  test_hook_silent_on_repeat
run_test "Hook merge preserves existing settings" test_hook_merge_preserves_settings
run_test "Hook not duplicated on sync"            test_hook_no_duplicate_on_sync
run_test "Gitignore has .last_seen_version"       test_gitignore_has_last_seen

echo ""
echo -e "${BOLD}Edge Cases${NC}"
run_test "Sync with equal pinned version"         test_sync_equal_versions
run_test "Dry-run makes no modifications"         test_sync_dry_run_no_modifications
run_test "Older framework not blocked by pin"     test_sync_older_framework_than_pinned
run_test "Missing CHANGELOG.md handled gracefully" test_sync_changelog_missing_graceful

echo ""
echo -e "${BOLD}Backup & Sync Directory${NC}"
run_test "Sync creates backup of changed files"      test_sync_creates_backup
run_test "Sync adds new framework files"             test_sync_adds_new_files
run_test "sync --all without projects file exits 1"  test_sync_all_no_projects_file

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
