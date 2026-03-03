#!/bin/bash
# Atomically claim the next available task for this agent.
#
# Usage: ./scripts/coordination/claim-task.sh [--sprint <sprint>] [--agent-id <id>] [--session-id <id>] [--no-verify]
# Example: ./scripts/coordination/claim-task.sh --sprint coordination
#
# This script:
# 1. Generates an agent ID (or uses the one provided)
# 2. Queries available_tasks for the best task (priority-ordered)
# 3. Atomically claims it: UPDATE ... WHERE owner IS NULL
# 4. Verifies claim with changes() — retries with next task if contention
# 5. Calls create-worktree.sh for the claimed task
# 6. Outputs task details as JSON on stdout
# 7. (Optional) Verifies claim with Supabase in background — rollback if rejected
#
# Exit codes:
#   0 — task claimed successfully (JSON on stdout)
#   1 — error (missing db, invalid args, etc.)
#   2 — no available tasks

set -e

# Colors (stderr only)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# --- Helpers ---

# Sanitize a string for safe use in SQL single-quoted values.
# Escapes single quotes and rejects dangerous characters.
sanitize_sql() {
    local val="$1"
    # Reject semicolons (statement termination) and double-dashes (SQL comments)
    if echo "$val" | grep -qE '[;]|--' 2>/dev/null; then
        echo -e "${RED}Error: Invalid characters in argument: $val${NC}" >&2
        exit 1
    fi
    # Escape single quotes for SQL
    echo "${val//\'/\'\'}"
}

# --- Parse arguments ---

SPRINT_FILTER=""
AGENT_ID=""
SESSION_ID=""
NO_VERIFY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --sprint)
            SPRINT_FILTER="$2"
            shift 2
            ;;
        --agent-id)
            AGENT_ID="$2"
            shift 2
            ;;
        --session-id)
            SESSION_ID="$2"
            shift 2
            ;;
        --no-verify)
            NO_VERIFY=true
            shift
            ;;
        *)
            echo -e "${RED}Error: Unknown argument: $1${NC}" >&2
            echo "Usage: $0 [--sprint <sprint>] [--agent-id <id>] [--session-id <id>] [--no-verify]" >&2
            exit 1
            ;;
    esac
done

# Sanitize all user-provided inputs before SQL use
if [ -n "$SPRINT_FILTER" ]; then
    SPRINT_FILTER=$(sanitize_sql "$SPRINT_FILTER")
fi
if [ -n "$AGENT_ID" ]; then
    AGENT_ID=$(sanitize_sql "$AGENT_ID")
fi
if [ -n "$SESSION_ID" ]; then
    SESSION_ID=$(sanitize_sql "$SESSION_ID")
fi

# --- Locate project root ---

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

# Find create-worktree.sh relative to this script's location (sibling in same dir)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CREATE_WORKTREE="$SCRIPT_DIR/create-worktree.sh"
if [ ! -f "$CREATE_WORKTREE" ]; then
    echo -e "${RED}Error: create-worktree.sh not found at $CREATE_WORKTREE${NC}" >&2
    exit 1
fi

CLEANUP_WORKTREE="$SCRIPT_DIR/cleanup-worktree.sh"

# Source Supabase client for background verification (non-fatal if missing)
SUPABASE_CLIENT="$SCRIPT_DIR/supabase-client.sh"
if [ -f "$SUPABASE_CLIENT" ]; then
    source "$SUPABASE_CLIENT"
fi

# --- Generate agent ID if not provided ---

if [ -z "$AGENT_ID" ]; then
    HOSTNAME_SHORT=$(hostname -s 2>/dev/null || echo "local")
    AGENT_ID="agent-${HOSTNAME_SHORT}-$$-$(date +%s)"
fi

# --- Pull fresh task state from Supabase (blocking) ---

if [ "${_SUPABASE_CONFIGURED:-false}" = "true" ]; then
    # Pull all active sprints so we see what others have claimed
    if [ -n "$SPRINT_FILTER" ]; then
        supabase_pull_tasks "$SPRINT_FILTER" "$DB_PATH" "$AGENT_ID" 2>/dev/null || true
    else
        # Pull all sprints that have pending tasks
        _pull_sprints=$(sqlite3 "$DB_PATH" "SELECT DISTINCT sprint FROM tasks WHERE status='pending';" 2>/dev/null)
        while IFS= read -r _ps; do
            [ -z "$_ps" ] && continue
            supabase_pull_tasks "$_ps" "$DB_PATH" "$AGENT_ID" 2>/dev/null || true
        done <<< "$_pull_sprints"
    fi
fi

# --- Get available tasks ---

SPRINT_WHERE=""
if [ -n "$SPRINT_FILTER" ]; then
    SPRINT_WHERE="AND sprint = '$SPRINT_FILTER'"
fi

# Get candidates ordered by priority (available_tasks view already filters)
CANDIDATES=$(sqlite3 -json "$DB_PATH" "
    SELECT sprint, task_num, title, description, done_when, type, skills, priority
    FROM available_tasks
    WHERE 1=1 $SPRINT_WHERE
    ORDER BY priority ASC NULLS LAST, task_num ASC
    LIMIT 10;
" 2>/dev/null)

if [ -z "$CANDIDATES" ] || [ "$CANDIDATES" = "[]" ]; then
    echo -e "${YELLOW}No available tasks found.${NC}" >&2
    exit 2
fi

# --- Attempt atomic claim ---

CLAIMED=false
CLAIMED_SPRINT=""
CLAIMED_TASK_NUM=""
CLAIMED_TITLE=""
CLAIMED_DESCRIPTION=""
CLAIMED_DONE_WHEN=""
CLAIMED_TYPE=""
CLAIMED_SKILLS=""
CLAIMED_INDEX=0

# Parse candidates and try each one
COUNT=$(echo "$CANDIDATES" | jq 'length')
for i in $(seq 0 $((COUNT - 1))); do
    SPRINT=$(echo "$CANDIDATES" | jq -r ".[$i].sprint")
    TASK_NUM=$(echo "$CANDIDATES" | jq -r ".[$i].task_num")
    TITLE=$(echo "$CANDIDATES" | jq -r ".[$i].title")

    echo -e "Attempting to claim: ${SPRINT}#${TASK_NUM} — ${TITLE}" >&2

    # Atomic claim: UPDATE only if still unclaimed
    SESSION_SET=""
    if [ -n "$SESSION_ID" ]; then
        SESSION_SET=", session_id = '$SESSION_ID'"
    fi

    sqlite3 "$DB_PATH" "
        UPDATE tasks
        SET owner = '$AGENT_ID',
            status = 'red',
            started_at = datetime('now')
            $SESSION_SET
        WHERE sprint = '$SPRINT'
          AND task_num = $TASK_NUM
          AND owner IS NULL
          AND status = 'pending';
    "

    # Verify the claim succeeded (check if the row was actually updated)
    ACTUAL_OWNER=$(sqlite3 "$DB_PATH" "
        SELECT owner FROM tasks
        WHERE sprint = '$SPRINT' AND task_num = $TASK_NUM;
    ")

    if [ "$ACTUAL_OWNER" = "$AGENT_ID" ]; then
        CLAIMED=true
        CLAIMED_SPRINT="$SPRINT"
        CLAIMED_TASK_NUM="$TASK_NUM"
        CLAIMED_TITLE="$TITLE"
        CLAIMED_DESCRIPTION=$(echo "$CANDIDATES" | jq -r ".[$i].description // \"\"")
        CLAIMED_DONE_WHEN=$(echo "$CANDIDATES" | jq -r ".[$i].done_when // \"\"")
        CLAIMED_TYPE=$(echo "$CANDIDATES" | jq -r ".[$i].type // \"\"")
        CLAIMED_SKILLS=$(echo "$CANDIDATES" | jq -r ".[$i].skills // \"\"")
        CLAIMED_INDEX=$i
        echo -e "${GREEN}Claimed: ${SPRINT}#${TASK_NUM} — ${TITLE}${NC}" >&2
        break
    else
        echo -e "${YELLOW}Contention on ${SPRINT}#${TASK_NUM}, trying next...${NC}" >&2
    fi
done

if [ "$CLAIMED" = false ]; then
    echo -e "${RED}Failed to claim any task (all contested).${NC}" >&2
    exit 2
fi

# --- Create worktree ---

WORKTREE_PATH=$(bash "$CREATE_WORKTREE" "$CLAIMED_SPRINT" "$CLAIMED_TASK_NUM" 2>/dev/null)

if [ -z "$WORKTREE_PATH" ]; then
    echo -e "${RED}Error: Failed to create worktree${NC}" >&2
    # Unclaim the task since we can't set up the workspace
    sqlite3 "$DB_PATH" "
        UPDATE tasks
        SET owner = NULL, status = 'pending', session_id = NULL, started_at = NULL
        WHERE sprint = '$CLAIMED_SPRINT' AND task_num = $CLAIMED_TASK_NUM;
    "
    exit 1
fi

# --- Background Supabase verification ---

_bg_handle_rejection() {
    local sprint="$1" task_num="$2" agent_id="$3" session_id="$4"

    # Unclaim locally
    sqlite3 "$DB_PATH" "
        UPDATE tasks
        SET owner = NULL, status = 'pending', session_id = NULL, started_at = NULL
        WHERE sprint = '$sprint' AND task_num = $task_num;
    " 2>/dev/null || true

    # Cleanup worktree
    if [ -f "$CLEANUP_WORKTREE" ]; then
        bash "$CLEANUP_WORKTREE" "$sprint" "$task_num" --force 2>/dev/null || true
    fi

    # Write rejection sentinel
    jq -n \
        --arg sprint "$sprint" \
        --argjson task_num "$task_num" \
        --arg agent_id "$agent_id" \
        --arg reason "supabase_rejected" \
        --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '{sprint: $sprint, task_num: $task_num, agent_id: $agent_id, reason: $reason, timestamp: $timestamp}' \
        > "$PROJECT_ROOT/.pm/claim-rejected-${sprint}-${task_num}" 2>/dev/null || true
}

_bg_verify_claim() {
    set +e  # Background handler manages its own errors

    # Attempt Supabase verification via _supabase_request directly
    # Return code distinguishes unreachable (rc!=0) from rejection (rc=0, empty result)
    local result rc=0
    result=$(_supabase_request "PATCH" \
        "tasks?sprint=eq.${CLAIMED_SPRINT}&task_num=eq.${CLAIMED_TASK_NUM}&owner=is.null" \
        "{\"owner\":\"${AGENT_ID}\",\"status\":\"red\"}" \
        2>/dev/null) || rc=$?

    if [ "$rc" -ne 0 ]; then
        # HTTP error or connection failure — treat as unreachable, local claim stands
        echo -e "${YELLOW}WARNING: Supabase unreachable — local claim stands for ${CLAIMED_SPRINT}#${CLAIMED_TASK_NUM}${NC}" >&2
        return 0
    fi

    # Request succeeded (2xx) — check if claim was accepted
    if [ -n "$result" ] && [ "$result" != "[]" ]; then
        echo -e "${GREEN}Supabase verified: ${CLAIMED_SPRINT}#${CLAIMED_TASK_NUM}${NC}" >&2
        return 0
    fi

    # 2xx but empty result — claim rejected by Supabase
    echo -e "${RED}Supabase rejected: ${CLAIMED_SPRINT}#${CLAIMED_TASK_NUM} — rolling back${NC}" >&2
    _bg_handle_rejection "$CLAIMED_SPRINT" "$CLAIMED_TASK_NUM" "$AGENT_ID" "$SESSION_ID"

    # Attempt to claim next candidate from original list
    for j in $(seq $((CLAIMED_INDEX + 1)) $((COUNT - 1))); do
        local next_sprint next_task_num
        next_sprint=$(echo "$CANDIDATES" | jq -r ".[$j].sprint")
        next_task_num=$(echo "$CANDIDATES" | jq -r ".[$j].task_num")

        local next_session_set=""
        if [ -n "$SESSION_ID" ]; then
            next_session_set=", session_id = '$SESSION_ID'"
        fi

        sqlite3 "$DB_PATH" "
            UPDATE tasks
            SET owner = '$AGENT_ID', status = 'red', started_at = datetime('now') $next_session_set
            WHERE sprint = '$next_sprint'
              AND task_num = $next_task_num
              AND owner IS NULL
              AND status = 'pending';
        " 2>/dev/null || continue

        local actual_owner
        actual_owner=$(sqlite3 "$DB_PATH" "
            SELECT owner FROM tasks WHERE sprint = '$next_sprint' AND task_num = $next_task_num;
        " 2>/dev/null)

        if [ "$actual_owner" != "$AGENT_ID" ]; then
            continue
        fi

        echo -e "${GREEN}Re-claimed: ${next_sprint}#${next_task_num}${NC}" >&2
        bash "$CREATE_WORKTREE" "$next_sprint" "$next_task_num" 2>/dev/null || true

        # Verify retry with Supabase
        local retry_result retry_rc=0
        retry_result=$(_supabase_request "PATCH" \
            "tasks?sprint=eq.${next_sprint}&task_num=eq.${next_task_num}&owner=is.null" \
            "{\"owner\":\"${AGENT_ID}\",\"status\":\"red\"}" \
            2>/dev/null) || retry_rc=$?

        if [ "$retry_rc" -ne 0 ]; then
            echo -e "${YELLOW}WARNING: Supabase unreachable on retry — local claim stands${NC}" >&2
            return 0
        fi

        if [ -n "$retry_result" ] && [ "$retry_result" != "[]" ]; then
            echo -e "${GREEN}Supabase verified retry: ${next_sprint}#${next_task_num}${NC}" >&2
            return 0
        fi

        echo -e "${RED}Supabase rejected retry: ${next_sprint}#${next_task_num}${NC}" >&2
        _bg_handle_rejection "$next_sprint" "$next_task_num" "$AGENT_ID" "$SESSION_ID"
    done

    echo -e "${YELLOW}No candidates left after Supabase rejection${NC}" >&2
}

if [ "$NO_VERIFY" = false ] && [ "${_SUPABASE_CONFIGURED:-false}" = "true" ]; then
    _bg_verify_claim &
fi

# --- Output JSON ---

# Use jq to safely encode strings (handles quotes, newlines, etc.)
jq -n \
    --arg agent_id "$AGENT_ID" \
    --arg sprint "$CLAIMED_SPRINT" \
    --argjson task_num "$CLAIMED_TASK_NUM" \
    --arg title "$CLAIMED_TITLE" \
    --arg description "$CLAIMED_DESCRIPTION" \
    --arg done_when "$CLAIMED_DONE_WHEN" \
    --arg type "$CLAIMED_TYPE" \
    --arg skills "$CLAIMED_SKILLS" \
    --arg worktree_path "$WORKTREE_PATH" \
    --arg branch "task/${CLAIMED_SPRINT}-${CLAIMED_TASK_NUM}" \
    '{
        agent_id: $agent_id,
        sprint: $sprint,
        task_num: $task_num,
        title: $title,
        description: $description,
        done_when: $done_when,
        type: $type,
        skills: $skills,
        worktree_path: $worktree_path,
        branch: $branch
    }'
