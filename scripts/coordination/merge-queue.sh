#!/bin/bash
# Local merge queue: sequentially merge completed agent work into the base branch.
#
# Usage:
#   ./scripts/coordination/merge-queue.sh [OPTIONS]
#
# Options:
#   --interval N    Seconds between checks (default: 5)
#   --once          Run one cycle and exit (for testing / cron)
#   --sprint NAME   Only process tasks from this sprint
#   --dry-run       Show what would be merged without merging
#   --help          Show this help
#
# The merge queue:
# 1. Finds tasks with status='green', a worktree branch, and no merged_at timestamp
# 2. Merges each branch into the base branch sequentially
# 3. On clean merge: sets merged_at, calls cleanup-worktree.sh, logs success
# 4. On conflict: attempts auto-resolution (imports, disjoint additions), then
#    escalates unresolvable conflicts to .pm/conflicts/
# 5. After merge: reports newly unblocked dependent tasks
#
# Includes auto-resolution for common conflicts (imports, disjoint additions).
# Safe to run as a long-lived background process.

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# --- Argument parsing ---

INTERVAL=5
ONCE=false
SPRINT_FILTER=""
DRY_RUN=false

while [ $# -gt 0 ]; do
  case "$1" in
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    --once)
      ONCE=true
      shift
      ;;
    --sprint)
      SPRINT_FILTER="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      sed -n '/^# Local merge queue/,/^[^#]/{/^[^#]/d; s/^# \{0,1\}//; p;}' "$0"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}" >&2
      exit 1
      ;;
  esac
done

# --- Locate project root and scripts ---

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$PROJECT_ROOT" ]; then
  echo -e "${RED}Error: Not inside a git repository${NC}" >&2
  exit 1
fi

DB_PATH="$PROJECT_ROOT/.pm/tasks.db"
if [ ! -f "$DB_PATH" ]; then
  echo -e "${RED}Error: Database not found at $DB_PATH${NC}" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLEANUP_SCRIPT="$SCRIPT_DIR/cleanup-worktree.sh"
RESOLVE_SCRIPT="$SCRIPT_DIR/resolve-conflict.sh"
CLAIM_SCRIPT="$SCRIPT_DIR/claim-task.sh"

if [ ! -f "$CLEANUP_SCRIPT" ]; then
  echo -e "${RED}Error: cleanup-worktree.sh not found at $CLEANUP_SCRIPT${NC}" >&2
  exit 1
fi

# Source Supabase client (non-blocking, optional)
SUPABASE_CLIENT="$SCRIPT_DIR/supabase-client.sh"
if [ -f "$SUPABASE_CLIENT" ]; then
  source "$SUPABASE_CLIENT" 2>/dev/null || true
fi

# Determine base branch (main > master > HEAD)
if git -C "$PROJECT_ROOT" show-ref --verify --quiet refs/heads/main 2>/dev/null; then
  BASE_BRANCH="main"
elif git -C "$PROJECT_ROOT" show-ref --verify --quiet refs/heads/master 2>/dev/null; then
  BASE_BRANCH="master"
else
  BASE_BRANCH="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"
fi

# --- Helpers ---

log_info() {
  echo -e "${DIM}[$(date '+%H:%M:%S')]${NC} $1" >&2
}

log_success() {
  echo -e "${DIM}[$(date '+%H:%M:%S')]${NC} ${GREEN}$1${NC}" >&2
}

log_warn() {
  echo -e "${DIM}[$(date '+%H:%M:%S')]${NC} ${YELLOW}$1${NC}" >&2
}

log_error() {
  echo -e "${DIM}[$(date '+%H:%M:%S')]${NC} ${RED}$1${NC}" >&2
}

# Find tasks that are green but not yet merged and have a worktree branch
find_mergeable_tasks() {
  local sprint_clause=""
  if [ -n "$SPRINT_FILTER" ]; then
    sprint_clause="AND sprint = '$SPRINT_FILTER'"
  fi

  sqlite3 "$DB_PATH" "SELECT sprint, task_num, title FROM tasks WHERE status = 'green' AND merged_at IS NULL $sprint_clause ORDER BY completed_at ASC NULLS LAST, task_num ASC;"
}

# Check if the task branch exists
branch_exists() {
  local sprint="$1"
  local task_num="$2"
  local branch="task/${sprint}-${task_num}"
  git -C "$PROJECT_ROOT" show-ref --verify --quiet "refs/heads/$branch" 2>/dev/null
}

# Attempt to merge a task branch into base
merge_task() {
  local sprint="$1"
  local task_num="$2"
  local title="$3"
  local branch="task/${sprint}-${task_num}"

  log_info "Merging ${BOLD}$branch${NC} ($title)"

  if [ "$DRY_RUN" = true ]; then
    log_info "  [dry-run] Would merge $branch into $BASE_BRANCH"
    return 0
  fi

  # Make sure we're on the base branch
  local current_branch
  current_branch="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [ "$current_branch" != "$BASE_BRANCH" ]; then
    log_error "  Not on base branch ($BASE_BRANCH), currently on $current_branch — skipping"
    return 1
  fi

  # Attempt merge
  local merge_output
  if merge_output=$(git -C "$PROJECT_ROOT" merge --no-ff "$branch" -m "merge: $sprint task $task_num — $title" 2>&1); then
    # Clean merge succeeded
    local merge_hash
    merge_hash=$(git -C "$PROJECT_ROOT" rev-parse HEAD)

    # Update DB: set merged_at and commit_hash
    sqlite3 "$DB_PATH" "UPDATE tasks SET merged_at = CURRENT_TIMESTAMP, commit_hash = '$merge_hash' WHERE sprint = '$sprint' AND task_num = $task_num;"

    # Cleanup worktree
    bash "$CLEANUP_SCRIPT" "$sprint" "$task_num" 2>/dev/null || true

    log_success "  Merged $branch → $BASE_BRANCH ($merge_hash)"

    # Check for newly unblocked tasks
    report_unblocked "$sprint" "$task_num"

    # Auto-claim next task for agent continuity
    auto_claim_next_task "$sprint" "$task_num"
    return 0
  else
    # Merge conflict detected — attempt auto-resolution before escalating
    log_warn "  CONFLICT merging $branch — attempting auto-resolution"

    # Get list of conflicted files
    local conflicted_files
    conflicted_files=$(git -C "$PROJECT_ROOT" diff --name-only --diff-filter=U 2>/dev/null)

    if [ -z "$conflicted_files" ]; then
      # No conflicted files listed — abort
      git -C "$PROJECT_ROOT" merge --abort 2>/dev/null || true
      log_error "  Could not identify conflicted files"
      return 1
    fi

    # Attempt resolution with resolve-conflict.sh
    local all_resolved=true
    local resolved_files=""
    local escalated_files=""

    if [ -f "$RESOLVE_SCRIPT" ]; then
      while IFS= read -r cfile; do
        [ -z "$cfile" ] && continue
        local full_path="$PROJECT_ROOT/$cfile"
        if bash "$RESOLVE_SCRIPT" "$full_path" 2>/dev/null; then
          resolved_files="${resolved_files}${cfile} "
          git -C "$PROJECT_ROOT" add "$cfile" 2>/dev/null
          log_success "    Resolved: $cfile"
        else
          all_resolved=false
          escalated_files="${escalated_files}${cfile} "
          log_error "    Escalated: $cfile"
        fi
      done <<< "$conflicted_files"
    else
      all_resolved=false
      escalated_files="$conflicted_files"
    fi

    if [ "$all_resolved" = true ]; then
      # All conflicts resolved — complete the merge
      git -C "$PROJECT_ROOT" commit --no-edit 2>/dev/null

      local merge_hash
      merge_hash=$(git -C "$PROJECT_ROOT" rev-parse HEAD)

      sqlite3 "$DB_PATH" "UPDATE tasks SET merged_at = CURRENT_TIMESTAMP, commit_hash = '$merge_hash' WHERE sprint = '$sprint' AND task_num = $task_num;"

      bash "$CLEANUP_SCRIPT" "$sprint" "$task_num" 2>/dev/null || true

      log_success "  AI-resolved merge $branch → $BASE_BRANCH ($merge_hash)"

      report_unblocked "$sprint" "$task_num"

      # Auto-claim next task for agent continuity
      auto_claim_next_task "$sprint" "$task_num"
      return 0
    else
      # Some conflicts remain — abort and write report
      git -C "$PROJECT_ROOT" merge --abort 2>/dev/null || true

      log_error "  Could not fully resolve $branch"

      local conflict_dir="$PROJECT_ROOT/.pm/conflicts"
      mkdir -p "$conflict_dir"
      local conflict_file="$conflict_dir/${sprint}-${task_num}.md"

      {
        echo "# Merge Conflict: $sprint task $task_num"
        echo ""
        echo "**Task:** $title"
        echo "**Branch:** $branch"
        echo "**Base:** $BASE_BRANCH"
        echo "**Time:** $(date '+%Y-%m-%d %H:%M:%S')"
        echo ""
        echo "## Merge Output"
        echo '```'
        echo "$merge_output"
        echo '```'
        echo ""
        echo "## Auto-Resolved Files"
        for f in $resolved_files; do
          echo "- \`$f\` (auto-resolved)"
        done
        if [ -z "$resolved_files" ]; then
          echo "*(none)*"
        fi
        echo ""
        echo "## Escalated Files (need human review)"
        for f in $escalated_files; do
          echo "- \`$f\`"
        done
        echo ""
        echo "## Resolution"
        echo "Some files could not be auto-resolved. Manual resolution required."
      } > "$conflict_file"

      log_warn "  Conflict details saved to .pm/conflicts/${sprint}-${task_num}.md"

      # Block the task with reason
      local blocked_files
      blocked_files=$(echo "$escalated_files" | xargs | sed 's/ /, /g')
      sqlite3 "$DB_PATH" "UPDATE tasks SET status = 'blocked', blocked_reason = 'Merge conflict in: $blocked_files' WHERE sprint = '$sprint' AND task_num = $task_num;"
      log_warn "  Task $sprint #$task_num blocked: merge conflict"

      # Emit merge_conflict workflow event to local DB (Gap 4)
      local metadata_json
      metadata_json=$(printf '{"escalated_files":[%s],"resolved_files":[%s],"branch":"%s"}' \
        "$(echo "$escalated_files" | xargs -n1 | sed 's/.*/"&"/' | paste -sd, -)" \
        "$(echo "$resolved_files" | xargs -n1 | sed 's/.*/"&"/' | paste -sd, -)" \
        "$branch")
      sqlite3 "$DB_PATH" "INSERT INTO workflow_events (sprint, task_num, event_type, metadata) VALUES ('$sprint', $task_num, 'merge_conflict', '${metadata_json//\'/\'\'}');" 2>/dev/null || true

      # Log to Supabase (non-blocking)
      if type supabase_log_event &>/dev/null; then
        supabase_log_event "merge_conflict_escalated" "merge-queue" "$sprint" "$task_num" "$metadata_json" 2>/dev/null || true
      fi

      return 1
    fi
  fi
}

# Report tasks that became unblocked after a merge
report_unblocked() {
  local sprint="$1"
  local task_num="$2"

  # Find tasks that depend on the just-merged task
  local dependents
  dependents=$(sqlite3 "$DB_PATH" "SELECT d.sprint || ' #' || d.task_num || ' — ' || t.title FROM task_dependencies d JOIN tasks t ON t.sprint = d.sprint AND t.task_num = d.task_num WHERE d.depends_on_sprint = '$sprint' AND d.depends_on_task = $task_num AND t.status = 'pending';")

  if [ -n "$dependents" ]; then
    log_info "  Dependent tasks that may now be unblocked:"
    echo "$dependents" | while IFS= read -r line; do
      log_info "    → $line"
    done
  fi
}

# Auto-claim next available task after successful merge (agent continuity)
auto_claim_next_task() {
  local sprint="$1"
  local task_num="$2"

  if [ ! -f "$CLAIM_SCRIPT" ]; then
    log_warn "  claim-task.sh not found — skipping auto-claim"
    return 0
  fi

  # Propagate session_id from completed task for agent continuity
  local session_id
  session_id=$(sqlite3 "$DB_PATH" "SELECT COALESCE(session_id, '') FROM tasks WHERE sprint = '$sprint' AND task_num = $task_num;" 2>/dev/null)

  local claim_args=""
  if [ -n "$session_id" ]; then
    claim_args="--session-id $session_id"
  fi

  # Claim failure must NOT block the merge queue
  local claim_json
  claim_json=$(cd "$PROJECT_ROOT" && bash "$CLAIM_SCRIPT" $claim_args 2>/dev/null) || true

  if [ -n "$claim_json" ]; then
    local next_title next_sprint next_task_num worktree_path
    next_title=$(echo "$claim_json" | jq -r '.title // ""' 2>/dev/null)
    next_sprint=$(echo "$claim_json" | jq -r '.sprint // ""' 2>/dev/null)
    next_task_num=$(echo "$claim_json" | jq -r '.task_num // ""' 2>/dev/null)
    worktree_path=$(echo "$claim_json" | jq -r '.worktree_path // ""' 2>/dev/null)

    if [ -n "$next_title" ]; then
      log_success "  Auto-claimed: ${next_sprint}#${next_task_num} — ${next_title}"
      log_info "    Worktree: ${worktree_path}"
    fi
  else
    log_info "  No more tasks available — agent idle"
  fi
}

# --- Main loop ---

run_cycle() {
  local merged=0
  local conflicts=0
  local skipped=0

  local tasks
  tasks=$(find_mergeable_tasks)

  if [ -z "$tasks" ]; then
    return 0
  fi

  while IFS='|' read -r sprint task_num title; do
    [ -z "$sprint" ] && continue

    # Check if branch exists
    if ! branch_exists "$sprint" "$task_num"; then
      # No branch — task was completed without a worktree (e.g., direct commit)
      # Mark as merged since work is already on the base branch
      if [ "$DRY_RUN" = false ]; then
        sqlite3 "$DB_PATH" "UPDATE tasks SET merged_at = CURRENT_TIMESTAMP WHERE sprint = '$sprint' AND task_num = $task_num AND merged_at IS NULL;"
      fi
      log_info "No branch for $sprint #$task_num — marking as merged (direct commit)"
      skipped=$((skipped + 1))
      continue
    fi

    if merge_task "$sprint" "$task_num" "$title"; then
      merged=$((merged + 1))
    else
      conflicts=$((conflicts + 1))
    fi
  done <<< "$tasks"

  if [ $((merged + conflicts + skipped)) -gt 0 ]; then
    log_info "Cycle complete: ${GREEN}$merged merged${NC}, ${RED}$conflicts conflicts${NC}, $skipped skipped"
  fi

  return 0
}

# --- Entry point ---

echo -e "${BOLD}N2O Merge Queue${NC}" >&2
echo -e "${DIM}Base branch: $BASE_BRANCH | Interval: ${INTERVAL}s | Mode: $([ "$ONCE" = true ] && echo "single-run" || echo "daemon")${NC}" >&2
echo "" >&2

if [ "$ONCE" = true ]; then
  run_cycle
else
  # Trap SIGINT/SIGTERM for clean shutdown
  RUNNING=true
  trap 'RUNNING=false; log_info "Shutting down merge queue..."; exit 0' INT TERM

  while [ "$RUNNING" = true ]; do
    run_cycle
    sleep "$INTERVAL"
  done
fi
