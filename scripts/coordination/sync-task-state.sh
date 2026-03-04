#!/bin/bash
# Event-driven sync handler for N2O coordination.
#
# Usage: bash scripts/coordination/sync-task-state.sh <event-type> [extra-args...]
#
# Event types:
#   post-commit   — Extract sprint/task from branch, upsert task
#   post-merge    — Sync merge completion with merged_at
#   pre-push      — Sync all pending tasks for current sprint
#   post-checkout — Log event only (no task update)
#   task-completed — Upsert completed task
#   task-claimed   — Upsert task + register agent
#   agent-started  — Register agent + heartbeat
#   agent-stopped  — Deregister agent
#
# Non-blocking: all operations are fire-and-forget.
# Graceful degradation: failures are logged to stderr, never block.

# Never exit non-zero — this script must not block git or local ops
trap 'exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_SCRIPT="$SCRIPT_DIR/supabase-client.sh"

# Source the Supabase client
if [ ! -f "$CLIENT_SCRIPT" ]; then
    exit 0
fi
source "$CLIENT_SCRIPT"

# If Supabase is not configured, silently exit
if [ "$_SUPABASE_CONFIGURED" != "true" ]; then
    exit 0
fi

EVENT_TYPE="${1:-}"
shift 2>/dev/null || true

# --- Helpers ---

# Extract sprint and task_num from current branch name.
# Branch convention: task/{sprint}-{task_num}
parse_branch() {
    local branch
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

    # Skip main/master/develop — no task context
    case "$branch" in
        main|master|develop|"") return 1 ;;
    esac

    # Match task/{sprint}-{task_num}
    if [[ "$branch" =~ ^task/(.+)-([0-9]+)$ ]]; then
        TASK_SPRINT="${BASH_REMATCH[1]}"
        TASK_NUM="${BASH_REMATCH[2]}"
        return 0
    fi

    return 1
}

# Get agent ID from environment or generate one
get_agent_id() {
    if [ -n "${N2O_AGENT_ID:-}" ]; then
        echo "$N2O_AGENT_ID"
        return
    fi
    local hostname_short
    hostname_short=$(hostname -s 2>/dev/null || echo "local")
    echo "agent-${hostname_short}-$$"
}

get_machine_id() {
    hostname -s 2>/dev/null || echo "unknown"
}

# --- Event handlers ---

handle_post_commit() {
    if ! parse_branch; then
        return
    fi
    supabase_upsert_task "$TASK_SPRINT" "$TASK_NUM" 2>/dev/null || true
}

handle_post_merge() {
    if ! parse_branch; then
        return
    fi
    # Update merged_at timestamp in local DB before syncing
    local db_path=".pm/tasks.db"
    if [ -f "$db_path" ]; then
        sqlite3 "$db_path" "
            UPDATE tasks SET merged_at = datetime('now')
            WHERE sprint = '$TASK_SPRINT' AND task_num = $TASK_NUM
              AND merged_at IS NULL;
        " 2>/dev/null || true
    fi
    supabase_upsert_task "$TASK_SPRINT" "$TASK_NUM" 2>/dev/null || true
}

handle_pre_push() {
    if ! parse_branch; then
        return
    fi
    supabase_sync_all_tasks "$TASK_SPRINT" 2>/dev/null || true
}

handle_post_checkout() {
    local agent_id
    agent_id=$(get_agent_id)
    local branch
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
    supabase_log_event "post_checkout" "$agent_id" "" "" \
        "{\"branch\":\"$branch\"}" 2>/dev/null || true
}

handle_task_completed() {
    local sprint="${1:-}"
    local task_num="${2:-}"
    if [ -z "$sprint" ] || [ -z "$task_num" ]; then
        if ! parse_branch; then return; fi
        sprint="$TASK_SPRINT"
        task_num="$TASK_NUM"
    fi
    supabase_upsert_task "$sprint" "$task_num" 2>/dev/null || true
}

handle_task_claimed() {
    local sprint="${1:-}"
    local task_num="${2:-}"
    local agent_id="${3:-$(get_agent_id)}"
    local developer="${4:-}"
    if [ -z "$sprint" ] || [ -z "$task_num" ]; then
        if ! parse_branch; then return; fi
        sprint="$TASK_SPRINT"
        task_num="$TASK_NUM"
    fi
    supabase_upsert_task "$sprint" "$task_num" 2>/dev/null || true
    supabase_register_agent "$agent_id" "$(get_machine_id)" "$developer" "$sprint" "$task_num" 2>/dev/null || true
}

handle_agent_started() {
    local agent_id="${1:-$(get_agent_id)}"
    local developer="${2:-}"
    local sprint="${3:-}"
    local task_num="${4:-}"
    supabase_register_agent "$agent_id" "$(get_machine_id)" "$developer" "$sprint" "$task_num" 2>/dev/null || true
    supabase_heartbeat "$agent_id" 2>/dev/null || true
}

handle_agent_stopped() {
    local agent_id="${1:-$(get_agent_id)}"
    supabase_deregister_agent "$agent_id" 2>/dev/null || true
}

handle_transcript_collected() {
    # Sync a single newly-collected transcript (aggregates + messages + tool_calls).
    # Usage: sync-task-state.sh transcript-collected <session_id> [developer]
    local session_id="${1:-}"
    local developer="${2:-}"
    if [ -z "$session_id" ]; then
        return
    fi
    supabase_upsert_transcript "$session_id" ".pm/tasks.db" "$developer" 2>/dev/null || true
    supabase_sync_session_messages "$session_id" ".pm/tasks.db" 2>/dev/null || true
    supabase_sync_session_tool_calls "$session_id" ".pm/tasks.db" 2>/dev/null || true
}

handle_sync_transcripts() {
    # Bulk sync all unsynced transcripts (catch-up).
    # Usage: sync-task-state.sh sync-transcripts [developer]
    local developer="${1:-}"
    supabase_sync_all_transcripts ".pm/tasks.db" "$developer" 2>/dev/null || true
}

handle_sync_all() {
    # Sync all streams to Supabase (catch-up for all data).
    # Usage: sync-task-state.sh sync-all [db_path]
    local db_path="${1:-.pm/tasks.db}"
    # Populate skill_versions from SKILL.md frontmatter before syncing
    bash "$SCRIPT_DIR/../sync-skill-versions.sh" "$db_path" 2>/dev/null || true
    supabase_sync_all_transcripts "$db_path" "" 2>/dev/null || true
    supabase_sync_all_events "$db_path" 2>/dev/null || true
    supabase_sync_all_tasks_bulk "$db_path" 2>/dev/null || true
    supabase_sync_developer_context "$db_path" 2>/dev/null || true
    supabase_sync_skill_versions "$db_path" 2>/dev/null || true
    supabase_sync_all_messages "$db_path" 2>/dev/null || true
    supabase_sync_all_tool_calls "$db_path" 2>/dev/null || true
}

# --- Route event ---

case "$EVENT_TYPE" in
    post-commit)    handle_post_commit ;;
    post-merge)     handle_post_merge ;;
    pre-push)       handle_pre_push ;;
    post-checkout)  handle_post_checkout ;;
    task-completed) handle_task_completed "$@" ;;
    task-claimed)   handle_task_claimed "$@" ;;
    agent-started)  handle_agent_started "$@" ;;
    agent-stopped)  handle_agent_stopped "$@" ;;
    transcript-collected) handle_transcript_collected "$@" ;;
    sync-transcripts) handle_sync_transcripts "$@" ;;
    sync-all) handle_sync_all "$@" ;;
    *)
        echo "Unknown event type: $EVENT_TYPE" >&2
        ;;
esac

exit 0
