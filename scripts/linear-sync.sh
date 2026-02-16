#!/bin/bash
set -e

# =============================================================================
# linear-sync.sh — Sync adapter for Linear
# Reads task state from SQLite, pushes updates to Linear via GraphQL API.
#
# Usage:
#   ./scripts/sync/linear-sync.sh claim <sprint> <task_num>
#   ./scripts/sync/linear-sync.sh complete <sprint> <task_num>
#   ./scripts/sync/linear-sync.sh blocked <sprint> <task_num>
#   ./scripts/sync/linear-sync.sh sprint-summary <sprint>
#
# Requires:
#   - LINEAR_API_KEY env var (or in .env.local)
#   - jq, sqlite3, curl
# =============================================================================

DB=".pm/tasks.db"
LINEAR_API="https://api.linear.app/graphql"

# Load env if present
if [[ -f .env.local ]]; then
  set -a
  source .env.local
  set +a
fi

if [[ -z "$LINEAR_API_KEY" ]]; then
  echo "Error: LINEAR_API_KEY not set. Add it to .env.local or export it." >&2
  exit 1
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_ok()   { echo -e "${GREEN}✓${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1" >&2; }
log_err()  { echo -e "${RED}✗${NC} $1" >&2; }

# -----------------------------------------------------------------------------
# GraphQL helper
# -----------------------------------------------------------------------------

gql() {
  local query="$1"
  local response
  response=$(curl -s -X POST "$LINEAR_API" \
    -H "Content-Type: application/json" \
    -H "Authorization: $LINEAR_API_KEY" \
    -d "{\"query\": $(echo "$query" | jq -Rs .)}")

  local errors
  errors=$(echo "$response" | jq -r '.errors // empty')
  if [[ -n "$errors" && "$errors" != "null" ]]; then
    log_err "Linear API error: $errors"
    return 1
  fi

  echo "$response"
}

# Get task data from SQLite
get_task() {
  local sprint="$1"
  local task_num="$2"
  sqlite3 -json "$DB" \
    "SELECT * FROM tasks WHERE sprint = '$sprint' AND task_num = $task_num;" \
    | jq '.[0]'
}

# Update last_synced_at in SQLite
mark_synced() {
  local sprint="$1"
  local task_num="$2"
  sqlite3 "$DB" \
    "UPDATE tasks SET last_synced_at = datetime('now') WHERE sprint = '$sprint' AND task_num = $task_num;"
}

# -----------------------------------------------------------------------------
# Commands
# -----------------------------------------------------------------------------

cmd_claim() {
  local sprint="$1"
  local task_num="$2"
  local task
  task=$(get_task "$sprint" "$task_num")

  local external_id
  external_id=$(echo "$task" | jq -r '.external_id // empty')
  local owner
  owner=$(echo "$task" | jq -r '.owner // empty')

  if [[ -z "$external_id" ]]; then
    log_warn "No external_id for $sprint/$task_num — skipping Linear sync"
    return 0
  fi

  # Find the "In Progress" state for this issue's team
  local state_query='
    query {
      workflowStates(filter: { name: { eq: "In Progress" } }) {
        nodes { id name }
      }
    }'
  local state_id
  state_id=$(gql "$state_query" | jq -r '.data.workflowStates.nodes[0].id // empty')

  if [[ -z "$state_id" ]]; then
    log_warn "Could not find 'In Progress' state in Linear"
    return 0
  fi

  # Update issue state to In Progress
  local mutation="
    mutation {
      issueUpdate(id: \"$external_id\", input: { stateId: \"$state_id\" }) {
        success
        issue { id identifier title }
      }
    }"
  local result
  result=$(gql "$mutation")

  local success
  success=$(echo "$result" | jq -r '.data.issueUpdate.success')
  local identifier
  identifier=$(echo "$result" | jq -r '.data.issueUpdate.issue.identifier // "unknown"')

  if [[ "$success" == "true" ]]; then
    log_ok "Linear $identifier → In Progress (claimed by $owner)"
    mark_synced "$sprint" "$task_num"
  else
    log_err "Failed to update Linear issue $external_id"
  fi
}

cmd_complete() {
  local sprint="$1"
  local task_num="$2"
  local task
  task=$(get_task "$sprint" "$task_num")

  local external_id
  external_id=$(echo "$task" | jq -r '.external_id // empty')

  if [[ -z "$external_id" ]]; then
    log_warn "No external_id for $sprint/$task_num — skipping Linear sync"
    return 0
  fi

  # Find the "Done" state
  local state_query='
    query {
      workflowStates(filter: { name: { eq: "Done" } }) {
        nodes { id name }
      }
    }'
  local state_id
  state_id=$(gql "$state_query" | jq -r '.data.workflowStates.nodes[0].id // empty')

  if [[ -z "$state_id" ]]; then
    log_warn "Could not find 'Done' state in Linear"
    return 0
  fi

  # Calculate hours spent
  local hours
  hours=$(sqlite3 "$DB" \
    "SELECT ROUND((julianday(completed_at) - julianday(started_at)) * 24, 1)
     FROM tasks WHERE sprint = '$sprint' AND task_num = $task_num;")

  # Update issue state to Done + post comment with time
  local mutation="
    mutation {
      issueUpdate(id: \"$external_id\", input: { stateId: \"$state_id\" }) {
        success
        issue { id identifier title }
      }
    }"
  local result
  result=$(gql "$mutation")

  local success
  success=$(echo "$result" | jq -r '.data.issueUpdate.success')
  local identifier
  identifier=$(echo "$result" | jq -r '.data.issueUpdate.issue.identifier // "unknown"')

  if [[ "$success" == "true" ]]; then
    log_ok "Linear $identifier → Done (${hours}h)"

    # Post completion comment
    if [[ -n "$hours" && "$hours" != "null" ]]; then
      local comment_mutation="
        mutation {
          commentCreate(input: {
            issueId: \"$external_id\",
            body: \"✅ Completed via N2O workflow. Time spent: ${hours} hours.\"
          }) { success }
        }"
      gql "$comment_mutation" > /dev/null
    fi

    mark_synced "$sprint" "$task_num"
  else
    log_err "Failed to update Linear issue $external_id"
  fi
}

cmd_blocked() {
  local sprint="$1"
  local task_num="$2"
  local task
  task=$(get_task "$sprint" "$task_num")

  local external_id
  external_id=$(echo "$task" | jq -r '.external_id // empty')
  local blocked_reason
  blocked_reason=$(echo "$task" | jq -r '.blocked_reason // "No reason provided"')

  if [[ -z "$external_id" ]]; then
    log_warn "No external_id for $sprint/$task_num — skipping Linear sync"
    return 0
  fi

  # Find the "Blocked" or "Backlog" state (Linear doesn't have a universal "blocked" state)
  # Try "Blocked" first, fall back to adding a label
  local state_query='
    query {
      workflowStates(filter: { name: { in: ["Blocked", "blocked"] } }) {
        nodes { id name }
      }
    }'
  local state_id
  state_id=$(gql "$state_query" | jq -r '.data.workflowStates.nodes[0].id // empty')

  if [[ -n "$state_id" ]]; then
    local mutation="
      mutation {
        issueUpdate(id: \"$external_id\", input: { stateId: \"$state_id\" }) {
          success
          issue { id identifier title }
        }
      }"
    gql "$mutation" > /dev/null
  fi

  # Always post a comment with the blocked reason
  local escaped_reason
  escaped_reason=$(echo "$blocked_reason" | sed 's/"/\\"/g')
  local comment_mutation="
    mutation {
      commentCreate(input: {
        issueId: \"$external_id\",
        body: \"🚫 Blocked: ${escaped_reason}\"
      }) { success }
    }"
  local result
  result=$(gql "$comment_mutation")

  local success
  success=$(echo "$result" | jq -r '.data.commentCreate.success')
  local identifier
  identifier=$(sqlite3 "$DB" "SELECT external_id FROM tasks WHERE sprint='$sprint' AND task_num=$task_num;")

  if [[ "$success" == "true" ]]; then
    log_ok "Linear $external_id → Blocked: $blocked_reason"
    mark_synced "$sprint" "$task_num"
  else
    log_err "Failed to post blocked comment to Linear"
  fi
}

cmd_sprint_summary() {
  local sprint="$1"

  # Get sprint progress from SQLite
  local progress
  progress=$(sqlite3 -json "$DB" \
    "SELECT * FROM sprint_progress WHERE sprint = '$sprint';" | jq '.[0]')

  local total green red blocked pending pct
  total=$(echo "$progress" | jq -r '.total_tasks // 0')
  green=$(echo "$progress" | jq -r '.green // 0')
  red=$(echo "$progress" | jq -r '.red // 0')
  blocked=$(echo "$progress" | jq -r '.blocked // 0')
  pending=$(echo "$progress" | jq -r '.pending // 0')
  pct=$(echo "$progress" | jq -r '.percent_complete // 0')

  # Get velocity data
  local velocity
  velocity=$(sqlite3 -json "$DB" \
    "SELECT * FROM sprint_velocity WHERE sprint = '$sprint';" | jq '.[0] // {}')
  local avg_hours total_hours
  avg_hours=$(echo "$velocity" | jq -r '.avg_hours_per_task // "N/A"')
  total_hours=$(echo "$velocity" | jq -r '.total_hours // "N/A"')

  local summary="## Sprint Summary: $sprint

**Progress**: $green/$total complete ($pct%)
- ✅ Green: $green
- 🔴 Red: $red
- 🚫 Blocked: $blocked
- ⏳ Pending: $pending

**Velocity**: $avg_hours hrs/task avg, $total_hours hrs total"

  echo "$summary" >&2

  # If there are Linear issues linked, post as a project update
  local linked_count
  linked_count=$(sqlite3 "$DB" \
    "SELECT COUNT(*) FROM tasks WHERE sprint='$sprint' AND external_id IS NOT NULL;")

  if [[ "$linked_count" -gt 0 ]]; then
    log_ok "Sprint has $linked_count tasks linked to Linear"
    # Post summary as comments on each linked issue is noisy.
    # Better: post to a parent issue or project if configured.
    # For now, output the summary for manual posting.
    echo "$summary"
  else
    log_warn "No tasks linked to Linear — summary printed locally only"
  fi
}

# =============================================================================
# Main
# =============================================================================

COMMAND="${1:-}"
shift 2>/dev/null || true

case "$COMMAND" in
  claim)
    [[ $# -ge 2 ]] || { log_err "Usage: linear-sync.sh claim <sprint> <task_num>"; exit 1; }
    cmd_claim "$1" "$2"
    ;;
  complete)
    [[ $# -ge 2 ]] || { log_err "Usage: linear-sync.sh complete <sprint> <task_num>"; exit 1; }
    cmd_complete "$1" "$2"
    ;;
  blocked)
    [[ $# -ge 2 ]] || { log_err "Usage: linear-sync.sh blocked <sprint> <task_num>"; exit 1; }
    cmd_blocked "$1" "$2"
    ;;
  sprint-summary)
    [[ $# -ge 1 ]] || { log_err "Usage: linear-sync.sh sprint-summary <sprint>"; exit 1; }
    cmd_sprint_summary "$1"
    ;;
  *)
    echo "Usage: linear-sync.sh {claim|complete|blocked|sprint-summary} <args>" >&2
    exit 1
    ;;
esac
