#!/bin/bash
# Test: Supabase sync functions for all health page streams
# Verifies that bulk sync functions exist and successfully push local data
# to Supabase for: workflow_events, tasks, developer_context, skill_versions.
#
# Prerequisites: SUPABASE_URL and SUPABASE_KEY env vars (or .env file)
# Usage: bash tests/test-supabase-sync.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PATH="$PROJECT_DIR/.pm/tasks.db"
CLIENT_SCRIPT="$PROJECT_DIR/scripts/coordination/supabase-client.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASS=0
FAIL=0

assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo -e "  ${GREEN}✓${NC} $desc"
        ((PASS++))
    else
        echo -e "  ${RED}✗${NC} $desc (expected: $expected, got: $actual)"
        ((FAIL++))
    fi
}

assert_gt() {
    local desc="$1" threshold="$2" actual="$3"
    if [ "$actual" -gt "$threshold" ] 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $desc ($actual > $threshold)"
        ((PASS++))
    else
        echo -e "  ${RED}✗${NC} $desc (expected > $threshold, got: $actual)"
        ((FAIL++))
    fi
}

assert_gte() {
    local desc="$1" threshold="$2" actual="$3"
    if [ "$actual" -ge "$threshold" ] 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $desc ($actual >= $threshold)"
        ((PASS++))
    else
        echo -e "  ${RED}✗${NC} $desc (expected >= $threshold, got: $actual)"
        ((FAIL++))
    fi
}

supabase_count() {
    local table="$1"
    curl -s -X POST \
        "https://api.supabase.com/v1/projects/mktnhfbpvksnyfzipuph/database/query" \
        -H "Authorization: Bearer sbp_0432018dd9867db471847a730df45a97cc76f586" \
        -H "Content-Type: application/json" \
        -d "{\"query\": \"SELECT COUNT(*) as count FROM $table\"}" | jq -r '.[0].count'
}

supabase_max_ts() {
    local table="$1" col="$2"
    curl -s -X POST \
        "https://api.supabase.com/v1/projects/mktnhfbpvksnyfzipuph/database/query" \
        -H "Authorization: Bearer sbp_0432018dd9867db471847a730df45a97cc76f586" \
        -H "Content-Type: application/json" \
        -d "{\"query\": \"SELECT MAX($col) as latest FROM $table\"}" | jq -r '.[0].latest'
}

# Source the client
source "$CLIENT_SCRIPT"

if [ "$_SUPABASE_CONFIGURED" != "true" ]; then
    echo "Supabase not configured — skipping sync tests"
    exit 0
fi

echo "=== Supabase Sync Tests ==="
echo ""

# ── Test 1: sync functions exist ──────────────────────────
echo "1. Sync function existence"
assert_eq "supabase_sync_all_events exists" "function" "$(type -t supabase_sync_all_events 2>/dev/null || echo 'missing')"
assert_eq "supabase_sync_all_tasks_bulk exists" "function" "$(type -t supabase_sync_all_tasks_bulk 2>/dev/null || echo 'missing')"
assert_eq "supabase_sync_developer_context exists" "function" "$(type -t supabase_sync_developer_context 2>/dev/null || echo 'missing')"
assert_eq "supabase_sync_skill_versions exists" "function" "$(type -t supabase_sync_skill_versions 2>/dev/null || echo 'missing')"

# ── Test 2: workflow_events sync ──────────────────────────
echo ""
echo "2. Workflow events sync"
local_events=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM workflow_events;" 2>/dev/null)
pre_count=$(supabase_count "workflow_events")

supabase_sync_all_events "$DB_PATH" 2>/dev/null
post_count=$(supabase_count "workflow_events")

assert_gte "workflow_events remote count >= local after sync" "$local_events" "$post_count"

# ── Test 3: tasks bulk sync ───────────────────────────────
echo ""
echo "3. Tasks bulk sync"
local_tasks=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM tasks;" 2>/dev/null)
pre_count=$(supabase_count "tasks")

supabase_sync_all_tasks_bulk "$DB_PATH" 2>/dev/null
post_count=$(supabase_count "tasks")

assert_gte "tasks remote count >= local after sync" "$local_tasks" "$post_count"

# ── Test 4: developer_context sync ────────────────────────
echo ""
echo "4. Developer context sync"
local_ctx=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM developer_context;" 2>/dev/null)

supabase_sync_developer_context "$DB_PATH" 2>/dev/null
post_count=$(supabase_count "developer_context")

assert_gte "developer_context remote count >= local after sync" "$local_ctx" "$post_count"

# ── Test 5: skill_versions sync ───────────────────────────
echo ""
echo "5. Skill versions sync"
local_sv=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM skill_versions;" 2>/dev/null)

supabase_sync_skill_versions "$DB_PATH" 2>/dev/null
post_count=$(supabase_count "skill_versions")

assert_gte "skill_versions remote count >= local after sync" "$local_sv" "$post_count"

# ── Test 6: sync-all event type works ─────────────────────
echo ""
echo "6. sync-task-state.sh routes sync-all event"
bash "$PROJECT_DIR/scripts/coordination/sync-task-state.sh" sync-all "$DB_PATH" 2>/dev/null
sync_all_exit=$?
assert_eq "sync-all event exits cleanly" "0" "$sync_all_exit"

# ── Summary ───────────────────────────────────────────────
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
