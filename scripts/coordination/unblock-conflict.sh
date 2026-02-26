#!/bin/bash
# Unblock a task after manual conflict resolution.
#
# Usage: ./scripts/coordination/unblock-conflict.sh <sprint> <task_num>
#
# After a developer manually resolves merge conflicts, this script:
# 1. Verifies the task branch exists and the conflict report is present
# 2. Merges the task branch into base (should be clean after manual resolution)
# 3. Removes the conflict report from .pm/conflicts/
# 4. Restores the task (status → green, clears blocked_reason)
# 5. Logs resolution to Supabase
#
# Exit codes:
#   0 — Task unblocked and merged successfully
#   1 — Merge still has conflicts or other failure
#   2 — Bad arguments or missing prerequisites

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# --- Argument parsing ---

SPRINT="${1:-}"
TASK_NUM="${2:-}"

if [ -z "$SPRINT" ] || [ -z "$TASK_NUM" ]; then
  echo -e "${RED}Usage: $0 <sprint> <task_num>${NC}" >&2
  exit 2
fi

# Validate task_num is numeric
if ! echo "$TASK_NUM" | grep -qE '^[0-9]+$'; then
  echo -e "${RED}Error: task_num must be numeric, got '$TASK_NUM'${NC}" >&2
  exit 2
fi

# --- Locate project root ---

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$PROJECT_ROOT" ]; then
  echo -e "${RED}Error: Not inside a git repository${NC}" >&2
  exit 2
fi

DB_PATH="$PROJECT_ROOT/.pm/tasks.db"
if [ ! -f "$DB_PATH" ]; then
  echo -e "${RED}Error: Database not found at $DB_PATH${NC}" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLEANUP_SCRIPT="$SCRIPT_DIR/cleanup-worktree.sh"

# Source Supabase client (non-blocking, optional)
SUPABASE_CLIENT="$SCRIPT_DIR/supabase-client.sh"
if [ -f "$SUPABASE_CLIENT" ]; then
  source "$SUPABASE_CLIENT" 2>/dev/null || true
fi

# --- Validate task exists and is blocked ---

BRANCH="task/${SPRINT}-${TASK_NUM}"
CONFLICT_FILE="$PROJECT_ROOT/.pm/conflicts/${SPRINT}-${TASK_NUM}.md"

TASK_STATUS=$(sqlite3 "$DB_PATH" "SELECT status FROM tasks WHERE sprint = '$SPRINT' AND task_num = $TASK_NUM;" 2>/dev/null)
TASK_TITLE=$(sqlite3 "$DB_PATH" "SELECT title FROM tasks WHERE sprint = '$SPRINT' AND task_num = $TASK_NUM;" 2>/dev/null)

if [ -z "$TASK_STATUS" ]; then
  echo -e "${RED}Error: Task $SPRINT #$TASK_NUM not found${NC}" >&2
  exit 2
fi

if [ "$TASK_STATUS" != "blocked" ]; then
  echo -e "${YELLOW}Warning: Task $SPRINT #$TASK_NUM status is '$TASK_STATUS', not 'blocked'${NC}" >&2
fi

# Check branch exists
if ! git -C "$PROJECT_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH" 2>/dev/null; then
  echo -e "${RED}Error: Branch $BRANCH not found${NC}" >&2
  exit 2
fi

# Determine base branch
if git -C "$PROJECT_ROOT" show-ref --verify --quiet refs/heads/main 2>/dev/null; then
  BASE_BRANCH="main"
elif git -C "$PROJECT_ROOT" show-ref --verify --quiet refs/heads/master 2>/dev/null; then
  BASE_BRANCH="master"
else
  BASE_BRANCH="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"
fi

# --- Attempt merge ---

echo -e "${DIM}Unblocking:${NC} $SPRINT #$TASK_NUM — $TASK_TITLE"
echo -e "${DIM}Branch:${NC} $BRANCH → $BASE_BRANCH"

# Ensure we're on base branch
CURRENT_BRANCH="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"
if [ "$CURRENT_BRANCH" != "$BASE_BRANCH" ]; then
  echo -e "${RED}Error: Not on base branch ($BASE_BRANCH), currently on $CURRENT_BRANCH${NC}" >&2
  exit 1
fi

# Attempt merge
MERGE_OUTPUT=""
if MERGE_OUTPUT=$(git -C "$PROJECT_ROOT" merge --no-ff "$BRANCH" -m "merge: $SPRINT task $TASK_NUM — $TASK_TITLE (conflict resolved)" 2>&1); then
  MERGE_HASH=$(git -C "$PROJECT_ROOT" rev-parse HEAD)

  # Update DB: set merged_at, restore to green (task work was already complete)
  sqlite3 "$DB_PATH" "UPDATE tasks SET status = 'green', blocked_reason = NULL, merged_at = CURRENT_TIMESTAMP, commit_hash = '$MERGE_HASH' WHERE sprint = '$SPRINT' AND task_num = $TASK_NUM;"

  # Cleanup worktree
  if [ -f "$CLEANUP_SCRIPT" ]; then
    bash "$CLEANUP_SCRIPT" "$SPRINT" "$TASK_NUM" 2>/dev/null || true
  fi

  # Remove conflict report
  if [ -f "$CONFLICT_FILE" ]; then
    rm -f "$CONFLICT_FILE"
  fi

  echo -e "${GREEN}Merged $BRANCH → $BASE_BRANCH ($MERGE_HASH)${NC}"
  echo -e "${GREEN}Task $SPRINT #$TASK_NUM unblocked${NC}"

  # Log to Supabase (non-blocking)
  if type supabase_log_event &>/dev/null; then
    supabase_log_event "merge_conflict_resolved" "manual" "$SPRINT" "$TASK_NUM" '{"resolution":"manual"}' 2>/dev/null || true
  fi

  exit 0
else
  # Merge still has conflicts — abort
  git -C "$PROJECT_ROOT" merge --abort 2>/dev/null || true

  echo -e "${RED}Merge still has conflicts. Please resolve all conflicts in the branch first.${NC}" >&2
  echo -e "${DIM}$MERGE_OUTPUT${NC}" >&2
  exit 1
fi
