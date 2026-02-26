#!/bin/bash
set -uo pipefail

# =============================================================================
# Tests for: auto-sync framework on session start + setup assistant
# Covers: n2o setup, --quiet sync, checksum protection, auto-sync hook
# Pure bash — no external test frameworks required.
# Usage: bash tests/test-n2o-auto-sync.sh
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
ORIGINAL_GLOBAL_CONFIG="$HOME/.n2o/config.json"
SAVED_GLOBAL_CONFIG=""

setup() {
  TEST_DIR=$(mktemp -d)
  # Save existing global config if present
  if [[ -f "$ORIGINAL_GLOBAL_CONFIG" ]]; then
    SAVED_GLOBAL_CONFIG=$(mktemp)
    cp "$ORIGINAL_GLOBAL_CONFIG" "$SAVED_GLOBAL_CONFIG"
  fi
  # Init a project for tests
  "$N2O" init "$TEST_DIR" &>/dev/null
}

teardown() {
  if [[ -n "$TEST_DIR" && -d "$TEST_DIR" ]]; then
    rm -rf "$TEST_DIR"
  fi
  TEST_DIR=""
  # Restore global config
  if [[ -n "$SAVED_GLOBAL_CONFIG" && -f "$SAVED_GLOBAL_CONFIG" ]]; then
    mkdir -p "$(dirname "$ORIGINAL_GLOBAL_CONFIG")"
    mv "$SAVED_GLOBAL_CONFIG" "$ORIGINAL_GLOBAL_CONFIG"
    SAVED_GLOBAL_CONFIG=""
  elif [[ -z "$SAVED_GLOBAL_CONFIG" ]]; then
    rm -f "$ORIGINAL_GLOBAL_CONFIG"
  fi
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
      grep "ASSERT FAILED" "$err_file" | head -3 | sed 's/^/    /'
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

assert_output_contains() {
  local output="$1"
  local pattern="$2"
  local msg="${3:-Output should contain: $pattern}"
  if ! echo "$output" | grep -qF "$pattern"; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

assert_output_not_contains() {
  local output="$1"
  local pattern="$2"
  local msg="${3:-Output should NOT contain: $pattern}"
  if echo "$output" | grep -qF "$pattern"; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

assert_equals() {
  local actual="$1"
  local expected="$2"
  local msg="${3:-Expected '$expected' but got '$actual'}"
  if [[ "$actual" != "$expected" ]]; then
    echo "    ASSERT FAILED: $msg" >&2
    return 1
  fi
}

# =============================================================================
# Tests
# =============================================================================

# --- Setup command ---

test_setup_creates_global_config() {
  setup
  rm -f "$ORIGINAL_GLOBAL_CONFIG"

  "$N2O" setup --framework-path "$N2O_DIR" --name "TestDev" --no-auto-sync &>/dev/null

  assert_file_exists "$ORIGINAL_GLOBAL_CONFIG" "Global config should be created"
  assert_json_field "$ORIGINAL_GLOBAL_CONFIG" ".framework_path" "$N2O_DIR"
  assert_json_field "$ORIGINAL_GLOBAL_CONFIG" ".developer_name" "TestDev"
  assert_json_field "$ORIGINAL_GLOBAL_CONFIG" ".auto_sync" "false"
  assert_json_field "$ORIGINAL_GLOBAL_CONFIG" ".auto_pull" "false"

  teardown
}

test_setup_auto_pull_flag() {
  setup
  rm -f "$ORIGINAL_GLOBAL_CONFIG"

  "$N2O" setup --framework-path "$N2O_DIR" --name "Dev2" --auto-pull &>/dev/null

  assert_json_field "$ORIGINAL_GLOBAL_CONFIG" ".auto_pull" "true"
  assert_json_field "$ORIGINAL_GLOBAL_CONFIG" ".auto_sync" "true"

  teardown
}

test_setup_validates_framework_path() {
  setup
  rm -f "$ORIGINAL_GLOBAL_CONFIG"

  local bad_dir
  bad_dir=$(mktemp -d)
  local result=0
  "$N2O" setup --framework-path "$bad_dir" --name "Dev" --no-auto-sync &>/dev/null || result=$?

  assert_equals "$result" "1" "Should fail with bad framework path"
  assert_file_not_exists "$ORIGINAL_GLOBAL_CONFIG" "Config should not be created on failure"

  rm -rf "$bad_dir"
  teardown
}

test_setup_reconfigure_overwrites() {
  setup
  rm -f "$ORIGINAL_GLOBAL_CONFIG"

  # First setup
  "$N2O" setup --framework-path "$N2O_DIR" --name "First" --no-auto-sync &>/dev/null
  assert_json_field "$ORIGINAL_GLOBAL_CONFIG" ".developer_name" "First"

  # Reconfigure
  "$N2O" setup --framework-path "$N2O_DIR" --name "Second" --no-auto-sync &>/dev/null
  assert_json_field "$ORIGINAL_GLOBAL_CONFIG" ".developer_name" "Second"

  teardown
}

# --- Quiet sync ---

test_quiet_sync_no_output_when_current() {
  setup

  # Sync once to bring up to date
  "$N2O" sync "$TEST_DIR" &>/dev/null

  # Quiet sync should produce no output when already current
  local output
  output=$("$N2O" sync "$TEST_DIR" --quiet 2>/dev/null)

  assert_equals "$output" "" "Quiet sync should produce no output when up-to-date"

  teardown
}

test_quiet_sync_summary_line_on_changes() {
  setup

  # Downgrade the project version to force a "change" in the sync
  local tmp
  tmp=$(mktemp)
  jq '.n2o_version = "0.0.1"' "$TEST_DIR/.pm/config.json" > "$tmp"
  mv "$tmp" "$TEST_DIR/.pm/config.json"

  # Modify a framework file so diff detects a change
  echo "# modified" >> "$TEST_DIR/.pm/schema.sql"

  local output
  output=$("$N2O" sync "$TEST_DIR" --quiet 2>/dev/null)

  assert_output_contains "$output" "N2O auto-synced:" "Should show auto-synced summary"
  assert_output_contains "$output" "files updated" "Should mention files updated"

  teardown
}

test_quiet_sync_suppresses_verbose_output() {
  setup

  # Downgrade and modify to trigger changes
  local tmp
  tmp=$(mktemp)
  jq '.n2o_version = "0.0.1"' "$TEST_DIR/.pm/config.json" > "$tmp"
  mv "$tmp" "$TEST_DIR/.pm/config.json"
  echo "# modified" >> "$TEST_DIR/.pm/schema.sql"

  local output
  output=$("$N2O" sync "$TEST_DIR" --quiet 2>&1)

  # Should NOT contain verbose markers
  assert_output_not_contains "$output" "Syncing:" "Should not show 'Syncing:' header"
  assert_output_not_contains "$output" "Framework files" "Should not show section headers"

  teardown
}

# --- Checksum protection ---

test_init_seeds_checksums() {
  setup

  assert_file_exists "$TEST_DIR/.pm/.skill-checksums.json" "Checksums file should exist after init"

  # Should have at least one entry for a SKILL.md
  local count
  count=$(jq 'length' "$TEST_DIR/.pm/.skill-checksums.json" 2>/dev/null)
  if [[ "$count" -lt 1 ]]; then
    echo "    ASSERT FAILED: Should have at least 1 checksum entry (got $count)" >&2
    return 1
  fi

  teardown
}

test_sync_skips_locally_modified_skill() {
  setup

  # Modify a skill locally (append something)
  echo "# local customization" >> "$TEST_DIR/.claude/skills/tdd-agent/SKILL.md"

  # Sync — should skip the modified skill
  local output
  output=$("$N2O" sync "$TEST_DIR" 2>&1)

  assert_output_contains "$output" "Skipping" "Should mention skipping locally modified skill"
  assert_output_contains "$output" "locally modified" "Should explain why it was skipped"

  # The local modification should still be there
  assert_file_contains "$TEST_DIR/.claude/skills/tdd-agent/SKILL.md" "# local customization" \
    "Local modification should be preserved"

  teardown
}

test_sync_force_overwrites_modified_skill() {
  setup

  # Modify a skill locally
  echo "# local customization" >> "$TEST_DIR/.claude/skills/tdd-agent/SKILL.md"

  # Force sync — should overwrite
  "$N2O" sync "$TEST_DIR" --force &>/dev/null

  # The local modification should be gone
  assert_file_not_contains "$TEST_DIR/.claude/skills/tdd-agent/SKILL.md" "# local customization" \
    "Force sync should overwrite local modifications"

  teardown
}

test_sync_updates_unmodified_skill() {
  setup

  # Sync normally — skills that haven't been locally modified should update fine
  # Simulate by verifying the checksum file gets updated
  local output
  output=$("$N2O" sync "$TEST_DIR" 2>&1)

  # Should not skip any skills when nothing is locally modified
  assert_output_not_contains "$output" "Skipping" "Should not skip anything when skills are unmodified"

  teardown
}

test_gitignore_includes_checksums() {
  setup

  assert_file_contains "$TEST_DIR/.gitignore" ".pm/.skill-checksums.json" \
    "Gitignore should include checksums file"

  teardown
}

# --- Session hook auto-sync ---

test_session_hook_auto_syncs() {
  setup
  rm -f "$ORIGINAL_GLOBAL_CONFIG"

  # Set up global config pointing to framework
  "$N2O" setup --framework-path "$N2O_DIR" --name "HookTest" &>/dev/null

  # Downgrade project version to trigger sync
  local tmp
  tmp=$(mktemp)
  jq '.n2o_version = "0.0.1"' "$TEST_DIR/.pm/config.json" > "$tmp"
  mv "$tmp" "$TEST_DIR/.pm/config.json"

  # Modify a framework file so the sync actually changes something
  echo "# stale" >> "$TEST_DIR/.pm/schema.sql"

  # Simulate session start
  local hook_output
  hook_output=$(echo '{"source":"startup","cwd":"'"$TEST_DIR"'"}' | bash "$N2O_DIR/scripts/n2o-session-hook.sh" 2>/dev/null) || true

  # The hook should have triggered auto-sync
  assert_output_contains "$hook_output" "N2O auto-synced:" "Hook should auto-sync and show summary"

  teardown
}

test_session_hook_skips_when_auto_sync_disabled() {
  setup
  rm -f "$ORIGINAL_GLOBAL_CONFIG"

  # Set up global config with auto_sync=false
  "$N2O" setup --framework-path "$N2O_DIR" --name "HookTest" --no-auto-sync &>/dev/null

  # Downgrade project version
  local tmp
  tmp=$(mktemp)
  jq '.n2o_version = "0.0.1"' "$TEST_DIR/.pm/config.json" > "$tmp"
  mv "$tmp" "$TEST_DIR/.pm/config.json"

  # Simulate session start
  local hook_output
  hook_output=$(echo '{"source":"startup","cwd":"'"$TEST_DIR"'"}' | bash "$N2O_DIR/scripts/n2o-session-hook.sh" 2>/dev/null) || true

  # Should NOT auto-sync
  assert_output_not_contains "$hook_output" "N2O auto-synced:" "Hook should not auto-sync when disabled"

  teardown
}

test_session_hook_skips_pinned_project() {
  setup
  rm -f "$ORIGINAL_GLOBAL_CONFIG"

  # Set up global config with auto_sync=true
  "$N2O" setup --framework-path "$N2O_DIR" --name "HookTest" &>/dev/null

  # Pin the project
  "$N2O" pin "$TEST_DIR" &>/dev/null

  # Simulate session start
  local hook_output
  hook_output=$(echo '{"source":"startup","cwd":"'"$TEST_DIR"'"}' | bash "$N2O_DIR/scripts/n2o-session-hook.sh" 2>/dev/null) || true

  # Should NOT auto-sync
  assert_output_not_contains "$hook_output" "N2O auto-synced:" "Hook should not sync pinned projects"

  teardown
}

test_session_hook_skips_when_versions_match() {
  setup
  rm -f "$ORIGINAL_GLOBAL_CONFIG"

  # Set up global config
  "$N2O" setup --framework-path "$N2O_DIR" --name "HookTest" &>/dev/null

  # Project version matches framework — no sync needed
  # (init already sets project to current version)

  # Simulate session start
  local hook_output
  hook_output=$(echo '{"source":"startup","cwd":"'"$TEST_DIR"'"}' | bash "$N2O_DIR/scripts/n2o-session-hook.sh" 2>/dev/null) || true

  # Should NOT auto-sync
  assert_output_not_contains "$hook_output" "N2O auto-synced:" "Hook should not sync when versions match"

  teardown
}

# =============================================================================
# Run all tests
# =============================================================================

echo ""
echo -e "${BOLD}test-n2o-auto-sync${NC}"
echo -e "${BOLD}==================${NC}"

echo ""
echo -e "${BOLD}Setup Command${NC}"
run_test "setup creates global config with all fields" test_setup_creates_global_config
run_test "setup --auto-pull sets auto_pull=true" test_setup_auto_pull_flag
run_test "setup rejects invalid framework path" test_setup_validates_framework_path
run_test "setup reconfigure overwrites existing config" test_setup_reconfigure_overwrites

echo ""
echo -e "${BOLD}Quiet Sync${NC}"
run_test "quiet sync produces no output when current" test_quiet_sync_no_output_when_current
run_test "quiet sync shows summary line on changes" test_quiet_sync_summary_line_on_changes
run_test "quiet sync suppresses verbose output" test_quiet_sync_suppresses_verbose_output

echo ""
echo -e "${BOLD}Checksum Protection${NC}"
run_test "init seeds skill checksums" test_init_seeds_checksums
run_test "sync skips locally modified skill" test_sync_skips_locally_modified_skill
run_test "sync --force overwrites modified skill" test_sync_force_overwrites_modified_skill
run_test "sync updates unmodified skills normally" test_sync_updates_unmodified_skill
run_test "gitignore includes checksums file" test_gitignore_includes_checksums

echo ""
echo -e "${BOLD}Session Hook Auto-Sync${NC}"
run_test "session hook auto-syncs outdated project" test_session_hook_auto_syncs
run_test "session hook skips when auto_sync=false" test_session_hook_skips_when_auto_sync_disabled
run_test "session hook skips pinned project" test_session_hook_skips_pinned_project
run_test "session hook skips when versions match" test_session_hook_skips_when_versions_match

# Summary
echo ""
echo -e "${BOLD}=== Results ===${NC}"
echo -e "  ${PASS} passed, ${FAIL} failed, ${TOTAL} total"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo -e "${RED}Failed tests:${NC}"
  for t in "${FAILED_TESTS[@]}"; do
    echo -e "  ${RED}-${NC} $t"
  done
  exit 1
fi

echo ""
exit 0
