#!/bin/bash
# Supabase client for N2O coordination.
# Source this file to get functions for interacting with the shared coordination store.
#
# Usage: source scripts/coordination/supabase-client.sh
#
# Required environment:
#   SUPABASE_URL  — Project URL (e.g., https://xyz.supabase.co)
#   SUPABASE_KEY  — Service role key (not the anon key)
#
# Or configure in .pm/config.json:
#   { "supabase": { "url": "...", "key_env": "SUPABASE_KEY" } }
#
# All functions output JSON on stdout and log to stderr.
# All functions are non-blocking — sync failures never block local operations.

# --- Configuration ---

_SUPABASE_URL=""
_SUPABASE_KEY=""
_SUPABASE_CONFIGURED=false

supabase_init() {
    # Load from environment first, then config.json
    _SUPABASE_URL="${SUPABASE_URL:-}"
    _SUPABASE_KEY="${SUPABASE_KEY:-}"

    # Try config.json if env vars not set
    if [ -z "$_SUPABASE_URL" ] && [ -f ".pm/config.json" ]; then
        _SUPABASE_URL=$(jq -r '.supabase.url // ""' .pm/config.json 2>/dev/null)
        local key_env
        key_env=$(jq -r '.supabase.key_env // ""' .pm/config.json 2>/dev/null)
        if [ -n "$key_env" ] && [ -z "$_SUPABASE_KEY" ]; then
            _SUPABASE_KEY="${!key_env:-}"
        fi
    fi

    if [ -z "$_SUPABASE_URL" ] || [ -z "$_SUPABASE_KEY" ]; then
        _SUPABASE_CONFIGURED=false
        return 1
    fi

    _SUPABASE_CONFIGURED=true
    return 0
}

# --- Internal helpers ---

_supabase_request() {
    local method="$1"
    local endpoint="$2"
    local data="${3:-}"
    local extra_headers="${4:-}"

    if [ "$_SUPABASE_CONFIGURED" != "true" ]; then
        echo '{"error":"Supabase not configured"}' >&2
        return 1
    fi

    local url="${_SUPABASE_URL}/rest/v1/${endpoint}"
    local -a curl_args=(
        -s
        -X "$method"
        -H "apikey: ${_SUPABASE_KEY}"
        -H "Authorization: Bearer ${_SUPABASE_KEY}"
        -H "Content-Type: application/json"
        -H "Prefer: return=representation"
    )

    if [ -n "$extra_headers" ]; then
        curl_args+=(-H "$extra_headers")
    fi

    if [ -n "$data" ]; then
        curl_args+=(-d "$data")
    fi

    local response
    local http_code
    response=$(curl "${curl_args[@]}" -w "\n%{http_code}" "$url" 2>/dev/null)
    http_code=$(echo "$response" | tail -1)
    response=$(echo "$response" | sed '$d')

    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo "$response"
        return 0
    else
        echo "Supabase error (HTTP $http_code): $response" >&2
        return 1
    fi
}

# --- Task functions ---

supabase_upsert_task() {
    # Upsert a task from local SQLite to Supabase.
    # Usage: supabase_upsert_task <sprint> <task_num> [db_path]
    local sprint="$1"
    local task_num="$2"
    local db_path="${3:-.pm/tasks.db}"

    local task_json
    task_json=$(sqlite3 -json "$db_path" "
        SELECT sprint, task_num, title, description, done_when,
               status, type, owner, session_id, priority,
               started_at, completed_at, merged_at
        FROM tasks
        WHERE sprint = '$sprint' AND task_num = $task_num;
    " 2>/dev/null | jq '.[0]' 2>/dev/null)

    if [ -z "$task_json" ] || [ "$task_json" = "null" ]; then
        echo "Task not found: $sprint#$task_num" >&2
        return 1
    fi

    # Add synced_at timestamp
    task_json=$(echo "$task_json" | jq '. + {synced_at: now | strftime("%Y-%m-%dT%H:%M:%SZ")}')

    _supabase_request "POST" "tasks" "$task_json" "Prefer: resolution=merge-duplicates,return=representation"
}

supabase_sync_all_tasks() {
    # Sync all tasks from a sprint to Supabase.
    # Usage: supabase_sync_all_tasks <sprint> [db_path]
    local sprint="$1"
    local db_path="${2:-.pm/tasks.db}"

    local tasks_json
    tasks_json=$(sqlite3 -json "$db_path" "
        SELECT sprint, task_num, title, description, done_when,
               status, type, owner, session_id, priority,
               started_at, completed_at, merged_at
        FROM tasks
        WHERE sprint = '$sprint';
    " 2>/dev/null)

    if [ -z "$tasks_json" ] || [ "$tasks_json" = "[]" ]; then
        echo "No tasks found for sprint: $sprint" >&2
        return 1
    fi

    _supabase_request "POST" "tasks" "$tasks_json" "Prefer: resolution=merge-duplicates,return=representation"
}

# --- Agent functions ---

supabase_register_agent() {
    # Register this agent in the shared agent registry.
    # Usage: supabase_register_agent <agent_id> <machine_id> [developer] [task_sprint] [task_num]
    local agent_id="$1"
    local machine_id="$2"
    local developer="${3:-}"
    local task_sprint="${4:-}"
    local task_num="${5:-}"

    local agent_json
    agent_json=$(jq -n \
        --arg agent_id "$agent_id" \
        --arg machine_id "$machine_id" \
        --arg developer "$developer" \
        --arg task_sprint "$task_sprint" \
        --arg task_num "$task_num" \
        --arg status "active" \
        '{
            agent_id: $agent_id,
            machine_id: $machine_id,
            developer: (if $developer != "" then $developer else null end),
            task_sprint: (if $task_sprint != "" then $task_sprint else null end),
            task_num: (if $task_num != "" then ($task_num | tonumber) else null end),
            status: $status,
            last_heartbeat: (now | strftime("%Y-%m-%dT%H:%M:%SZ"))
        }')

    _supabase_request "POST" "agents" "$agent_json" "Prefer: resolution=merge-duplicates,return=representation"
}

supabase_heartbeat() {
    # Update agent heartbeat and optionally files_touched.
    # Usage: supabase_heartbeat <agent_id> [files_json_array]
    local agent_id="$1"
    local files_touched="${2:-}"

    local update_json
    if [ -n "$files_touched" ]; then
        update_json=$(jq -n \
            --argjson files "$files_touched" \
            '{last_heartbeat: (now | strftime("%Y-%m-%dT%H:%M:%SZ")), files_touched: $files}')
    else
        update_json='{"last_heartbeat":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}'
    fi

    _supabase_request "PATCH" "agents?agent_id=eq.${agent_id}" "$update_json"
}

supabase_deregister_agent() {
    # Mark agent as stopped.
    # Usage: supabase_deregister_agent <agent_id>
    local agent_id="$1"

    _supabase_request "PATCH" "agents?agent_id=eq.${agent_id}" \
        '{"status":"stopped","task_sprint":null,"task_num":null}'
}

supabase_get_agents() {
    # Get all active agents (optionally filtered by developer).
    # Usage: supabase_get_agents [developer]
    local developer="${1:-}"

    local filter="status=eq.active"
    if [ -n "$developer" ]; then
        filter="${filter}&developer=eq.${developer}"
    fi

    _supabase_request "GET" "agents?${filter}&order=started_at.desc"
}

# --- Activity log functions ---

supabase_log_event() {
    # Log a coordination event.
    # Usage: supabase_log_event <event_type> <agent_id> [task_sprint] [task_num] [metadata_json]
    local event_type="$1"
    local agent_id="$2"
    local task_sprint="${3:-}"
    local task_num="${4:-}"
    local metadata="${5:-}"
    if [ -z "$metadata" ]; then metadata="{}"; fi
    local machine_id
    machine_id=$(hostname -s 2>/dev/null || echo "unknown")

    local event_json
    event_json=$(jq -n \
        --arg event_type "$event_type" \
        --arg agent_id "$agent_id" \
        --arg machine_id "$machine_id" \
        --arg task_sprint "$task_sprint" \
        --arg task_num "$task_num" \
        --argjson metadata "$metadata" \
        '{
            event_type: $event_type,
            agent_id: $agent_id,
            machine_id: $machine_id,
            task_sprint: (if $task_sprint != "" then $task_sprint else null end),
            task_num: (if $task_num != "" then ($task_num | tonumber) else null end),
            metadata: $metadata
        }')

    _supabase_request "POST" "activity_log" "$event_json"
}

# --- Claim verification ---

supabase_claim_verify() {
    # Verify a local claim with Supabase (optimistic claiming).
    # Returns 0 if claim is accepted, 1 if rejected (someone else claimed first).
    # Usage: supabase_claim_verify <sprint> <task_num> <agent_id>
    local sprint="$1"
    local task_num="$2"
    local agent_id="$3"

    # Attempt atomic claim: update only if unclaimed
    local result
    result=$(_supabase_request "PATCH" \
        "tasks?sprint=eq.${sprint}&task_num=eq.${task_num}&owner=is.null" \
        "{\"owner\":\"${agent_id}\",\"status\":\"red\"}" \
        2>/dev/null)

    # Check if the update affected any rows
    if [ -z "$result" ] || [ "$result" = "[]" ]; then
        # No rows updated — someone else claimed it
        echo "Claim rejected: $sprint#$task_num already claimed" >&2
        return 1
    fi

    return 0
}

# --- Working set queries (for routing) ---

supabase_get_active_working_sets() {
    # Get file working sets for all active developers.
    # Used by routing algorithm for overlap avoidance.
    # Usage: supabase_get_active_working_sets
    _supabase_request "GET" "active_working_sets"
}

# --- Developer twin functions ---

supabase_update_twin() {
    # Update developer twin state.
    # Usage: supabase_update_twin <developer> <field> <json_value>
    local developer="$1"
    local field="$2"
    local value="$3"

    local update_json
    update_json=$(jq -n \
        --arg field "$field" \
        --argjson value "$value" \
        --arg updated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '{($field): $value, updated_at: $updated_at}')

    _supabase_request "PATCH" "developer_twins?developer=eq.${developer}" "$update_json"
}

supabase_get_twin() {
    # Get a developer's twin state.
    # Usage: supabase_get_twin <developer>
    local developer="$1"
    _supabase_request "GET" "developer_twins?developer=eq.${developer}"
}

# --- Transcript functions ---

_transcript_select_cols() {
    # Shared column list for transcript queries
    echo "session_id, parent_session_id, agent_id,
           message_count, user_message_count, assistant_message_count,
           tool_call_count, total_input_tokens, total_output_tokens,
           cache_read_tokens, cache_creation_tokens,
           estimated_cost_usd, model, started_at, ended_at,
           sprint, task_num,
           user_message_timestamps, assistant_message_timestamps,
           total_user_content_length,
           stop_reason_counts, thinking_message_count, thinking_total_length,
           service_tier, has_sidechain, system_error_count, system_retry_count,
           avg_turn_duration_ms, tool_result_error_count, compaction_count,
           cwd, git_branch, background_task_count, web_search_count"
}

_transcript_add_metadata() {
    # Add developer, machine_id, synced_at to transcript JSON; convert has_sidechain
    local json="$1"
    local developer="$2"
    local machine_id="$3"
    echo "$json" | jq \
        --arg dev "$developer" \
        --arg machine "$machine_id" \
        '. + {
            developer: (if $dev != "" then $dev else null end),
            machine_id: $machine,
            has_sidechain: (if .has_sidechain == 1 then true else false end),
            synced_at: (now | strftime("%Y-%m-%dT%H:%M:%SZ"))
        }'
}

_transcript_mark_synced() {
    # Mark a transcript as successfully synced
    local db_path="$1"
    local session_id="$2"
    local escaped
    escaped=$(echo "$session_id" | sed "s/'/''/g")
    sqlite3 "$db_path" "
        UPDATE transcripts
        SET synced_at = datetime('now'), sync_attempts = 0, sync_error = NULL
        WHERE session_id = '$escaped';
    " 2>/dev/null
}

_transcript_mark_failed() {
    # Record a sync failure: increment attempts, store error message
    local db_path="$1"
    local session_id="$2"
    local error_msg="$3"
    local escaped_sid
    escaped_sid=$(echo "$session_id" | sed "s/'/''/g")
    local escaped_err
    escaped_err=$(echo "$error_msg" | sed "s/'/''/g" | head -c 500)
    sqlite3 "$db_path" "
        UPDATE transcripts
        SET sync_attempts = sync_attempts + 1,
            sync_error = '$escaped_err'
        WHERE session_id = '$escaped_sid';
    " 2>/dev/null
}

supabase_upsert_transcript() {
    # Upsert a single transcript row from local SQLite to Supabase.
    # Tracks sync attempts — marks failure with error message on failure.
    # Usage: supabase_upsert_transcript <session_id> [db_path] [developer] [machine_id]
    local session_id="$1"
    local db_path="${2:-.pm/tasks.db}"
    local developer="${3:-}"
    local machine_id="${4:-$(hostname -s 2>/dev/null || echo "unknown")}"

    if [ -z "$developer" ]; then
        developer=$(git config user.name 2>/dev/null || echo "")
    fi

    local cols
    cols=$(_transcript_select_cols)
    local escaped
    escaped=$(echo "$session_id" | sed "s/'/''/g")

    local transcript_json
    transcript_json=$(sqlite3 -json "$db_path" "
        SELECT $cols FROM transcripts
        WHERE session_id = '$escaped' LIMIT 1;
    " 2>/dev/null | jq '.[0]' 2>/dev/null)

    if [ -z "$transcript_json" ] || [ "$transcript_json" = "null" ]; then
        echo "Transcript not found: $session_id" >&2
        return 1
    fi

    transcript_json=$(_transcript_add_metadata "$transcript_json" "$developer" "$machine_id")

    local error_output
    if error_output=$(_supabase_request "POST" "transcripts" "$transcript_json" \
        "Prefer: resolution=merge-duplicates,return=representation" 2>&1); then
        _transcript_mark_synced "$db_path" "$session_id"
        echo "$error_output"
    else
        _transcript_mark_failed "$db_path" "$session_id" "$error_output"
        return 1
    fi
}

supabase_sync_all_transcripts() {
    # Sync all unsynced transcripts to Supabase.
    # Strategy: batch POST first (fast). If batch fails, fall back to
    # individual upserts so one bad row doesn't block the rest.
    # Skips rows with sync_attempts >= 5 (permanently broken).
    # Usage: supabase_sync_all_transcripts [db_path] [developer] [machine_id]
    local db_path="${1:-.pm/tasks.db}"
    local developer="${2:-}"
    local machine_id="${3:-$(hostname -s 2>/dev/null || echo "unknown")}"
    local max_attempts=5

    if [ -z "$developer" ]; then
        developer=$(git config user.name 2>/dev/null || echo "")
    fi

    # Count eligible unsynced transcripts (exclude rows that have failed too many times)
    local unsynced_count
    unsynced_count=$(sqlite3 "$db_path" "
        SELECT COUNT(*) FROM transcripts
        WHERE synced_at IS NULL AND sync_attempts < $max_attempts;
    " 2>/dev/null)

    if [ "$unsynced_count" -eq 0 ] 2>/dev/null; then
        # Check if there are permanently failed rows
        local stuck_count
        stuck_count=$(sqlite3 "$db_path" "
            SELECT COUNT(*) FROM transcripts
            WHERE synced_at IS NULL AND sync_attempts >= $max_attempts;
        " 2>/dev/null)
        if [ "$stuck_count" -gt 0 ] 2>/dev/null; then
            echo "All transcripts synced ($stuck_count permanently failed — see sync_error column)" >&2
        else
            echo "All transcripts already synced" >&2
        fi
        return 0
    fi

    echo "Syncing $unsynced_count unsynced transcript(s)..." >&2

    local cols
    cols=$(_transcript_select_cols)

    # Extract eligible unsynced transcripts as a JSON array
    local batch_json
    batch_json=$(sqlite3 -json "$db_path" "
        SELECT $cols FROM transcripts
        WHERE synced_at IS NULL AND sync_attempts < $max_attempts;
    " 2>/dev/null)

    if [ -z "$batch_json" ] || [ "$batch_json" = "[]" ]; then
        echo "All transcripts already synced" >&2
        return 0
    fi

    # Add metadata to each row
    batch_json=$(echo "$batch_json" | jq \
        --arg dev "$developer" \
        --arg machine "$machine_id" \
        '[.[] | . + {
            developer: (if $dev != "" then $dev else null end),
            machine_id: $machine,
            has_sidechain: (if .has_sidechain == 1 then true else false end),
            synced_at: (now | strftime("%Y-%m-%dT%H:%M:%SZ"))
        }]')

    # --- Fast path: single batch POST ---
    local batch_error
    if batch_error=$(_supabase_request "POST" "transcripts" "$batch_json" \
        "Prefer: resolution=merge-duplicates,return=representation" 2>&1); then
        # Batch succeeded — mark all as synced
        sqlite3 "$db_path" "
            UPDATE transcripts
            SET synced_at = datetime('now'), sync_attempts = 0, sync_error = NULL
            WHERE synced_at IS NULL AND sync_attempts < $max_attempts;
        " 2>/dev/null
        echo "Synced: $unsynced_count (batch)" >&2
        return 0
    fi

    # --- Slow path: batch failed, fall back to individual upserts ---
    echo "Batch failed, falling back to individual sync..." >&2

    local session_ids
    session_ids=$(sqlite3 "$db_path" "
        SELECT session_id FROM transcripts
        WHERE synced_at IS NULL AND sync_attempts < $max_attempts;
    " 2>/dev/null)

    local synced=0
    local failed=0
    while IFS= read -r sid; do
        [ -z "$sid" ] && continue
        if supabase_upsert_transcript "$sid" "$db_path" "$developer" "$machine_id" >/dev/null 2>&1; then
            ((synced++)) || true
        else
            ((failed++)) || true
        fi
    done <<< "$session_ids"

    echo "Synced: $synced, Failed: $failed" >&2
    if [ "$failed" -gt 0 ]; then
        return 1
    fi
}

# --- Connectivity check ---

supabase_ping() {
    # Check if Supabase is reachable. Returns 0 if yes, 1 if no.
    # Usage: supabase_ping
    if [ "$_SUPABASE_CONFIGURED" != "true" ]; then
        return 1
    fi

    local result
    result=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "apikey: ${_SUPABASE_KEY}" \
        "${_SUPABASE_URL}/rest/v1/" 2>/dev/null)

    if [ "$result" = "200" ]; then
        return 0
    fi
    return 1
}

# --- Auto-initialize on source ---

supabase_init 2>/dev/null || true
