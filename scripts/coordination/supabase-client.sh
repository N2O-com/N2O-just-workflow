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

_sqlite_to_json() {
    # Produce properly-encoded JSON from SQLite query.
    # Uses Python's sqlite3 + json for reliable encoding of text with
    # control characters that sqlite3 -json may not escape properly.
    local db_path="$1"
    local query="$2"
    python3 -c "
import sqlite3, json, sys
conn = sqlite3.connect(sys.argv[1])
conn.row_factory = sqlite3.Row
rows = [dict(r) for r in conn.execute(sys.argv[2]).fetchall()]
conn.close()
json.dump(rows, sys.stdout, default=str)
" "$db_path" "$query" 2>/dev/null
}

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

# --- Message and tool_call sync ---

supabase_sync_session_messages() {
    # Sync messages for a session from local SQLite to Supabase.
    # Usage: supabase_sync_session_messages <session_id> [db_path]
    local session_id="$1"
    local db_path="${2:-.pm/tasks.db}"

    if [ "$_SUPABASE_CONFIGURED" != "true" ]; then
        return 1
    fi

    local escaped
    escaped=$(echo "$session_id" | sed "s/'/''/g")

    local msg_json
    msg_json=$(_sqlite_to_json "$db_path" "
        SELECT session_id, message_index, role, content, timestamp,
               model, input_tokens, output_tokens, stop_reason
        FROM messages
        WHERE session_id = '$escaped' AND synced_at IS NULL;
    ")

    if [ -z "$msg_json" ] || [ "$msg_json" = "[]" ]; then
        return 0
    fi

    local count
    count=$(printf '%s' "$msg_json" | jq 'length')

    # Chunk at 100 rows for large sessions
    local chunk_size=100
    local offset=0
    while [ "$offset" -lt "$count" ]; do
        local chunk
        chunk=$(printf '%s' "$msg_json" | jq ".[$offset:$((offset + chunk_size))]")
        if _supabase_request "POST" "messages" "$chunk" \
            "Prefer: resolution=merge-duplicates,return=representation" >/dev/null 2>&1; then
            :
        else
            echo "Messages sync failed for $session_id at offset $offset" >&2
            return 1
        fi
        offset=$((offset + chunk_size))
    done

    # Mark as synced
    sqlite3 "$db_path" "
        UPDATE messages SET synced_at = datetime('now')
        WHERE session_id = '$escaped' AND synced_at IS NULL;
    " 2>/dev/null

    echo "Synced: $count messages for $session_id" >&2
}

supabase_sync_session_tool_calls() {
    # Sync tool_calls for a session from local SQLite to Supabase.
    # Converts input TEXT to JSONB via jq.
    # Usage: supabase_sync_session_tool_calls <session_id> [db_path]
    local session_id="$1"
    local db_path="${2:-.pm/tasks.db}"

    if [ "$_SUPABASE_CONFIGURED" != "true" ]; then
        return 1
    fi

    local escaped
    escaped=$(echo "$session_id" | sed "s/'/''/g")

    local tc_json
    tc_json=$(_sqlite_to_json "$db_path" "
        SELECT session_id, message_index, tool_index, tool_use_id,
               tool_name, input, output, is_error, timestamp
        FROM tool_calls
        WHERE session_id = '$escaped' AND synced_at IS NULL;
    ")

    if [ -z "$tc_json" ] || [ "$tc_json" = "[]" ]; then
        return 0
    fi

    # Convert input from TEXT to proper JSON for Supabase JSONB column,
    # and is_error from 0/1 to boolean
    tc_json=$(printf '%s' "$tc_json" | jq '[.[] |
        .input = (if .input != null and .input != "" then (.input | try fromjson catch null) else null end) |
        .is_error = (.is_error == 1)
    ]')

    local count
    count=$(printf '%s' "$tc_json" | jq 'length')

    # Chunk at 100 rows (Edit diffs can be large)
    local chunk_size=100
    local offset=0
    while [ "$offset" -lt "$count" ]; do
        local chunk
        chunk=$(printf '%s' "$tc_json" | jq ".[$offset:$((offset + chunk_size))]")
        if _supabase_request "POST" "tool_calls" "$chunk" \
            "Prefer: resolution=merge-duplicates,return=representation" >/dev/null 2>&1; then
            :
        else
            echo "Tool calls sync failed for $session_id at offset $offset" >&2
            return 1
        fi
        offset=$((offset + chunk_size))
    done

    # Mark as synced
    sqlite3 "$db_path" "
        UPDATE tool_calls SET synced_at = datetime('now')
        WHERE session_id = '$escaped' AND synced_at IS NULL;
    " 2>/dev/null

    echo "Synced: $count tool_calls for $session_id" >&2
}

supabase_sync_all_messages() {
    # Sync all unsynced messages across all sessions.
    # Usage: supabase_sync_all_messages [db_path]
    local db_path="${1:-.pm/tasks.db}"

    if [ "$_SUPABASE_CONFIGURED" != "true" ]; then
        return 1
    fi

    local session_ids
    session_ids=$(sqlite3 "$db_path" "
        SELECT DISTINCT session_id FROM messages WHERE synced_at IS NULL;
    " 2>/dev/null)

    if [ -z "$session_ids" ]; then
        echo "All messages already synced" >&2
        return 0
    fi

    local synced=0
    local failed=0
    while IFS= read -r sid; do
        [ -z "$sid" ] && continue
        if supabase_sync_session_messages "$sid" "$db_path" 2>/dev/null; then
            ((synced++)) || true
        else
            ((failed++)) || true
        fi
    done <<< "$session_ids"

    echo "Messages: $synced sessions synced, $failed failed" >&2
}

supabase_sync_all_tool_calls() {
    # Sync all unsynced tool_calls across all sessions.
    # Usage: supabase_sync_all_tool_calls [db_path]
    local db_path="${1:-.pm/tasks.db}"

    if [ "$_SUPABASE_CONFIGURED" != "true" ]; then
        return 1
    fi

    local session_ids
    session_ids=$(sqlite3 "$db_path" "
        SELECT DISTINCT session_id FROM tool_calls WHERE synced_at IS NULL;
    " 2>/dev/null)

    if [ -z "$session_ids" ]; then
        echo "All tool_calls already synced" >&2
        return 0
    fi

    local synced=0
    local failed=0
    while IFS= read -r sid; do
        [ -z "$sid" ] && continue
        if supabase_sync_session_tool_calls "$sid" "$db_path" 2>/dev/null; then
            ((synced++)) || true
        else
            ((failed++)) || true
        fi
    done <<< "$session_ids"

    echo "Tool calls: $synced sessions synced, $failed failed" >&2
}

# --- Bulk sync: all streams ---

supabase_sync_all_events() {
    # Sync workflow_events to Supabase (incremental by max remote ID).
    # Usage: supabase_sync_all_events [db_path]
    local db_path="${1:-.pm/tasks.db}"

    if [ "$_SUPABASE_CONFIGURED" != "true" ]; then
        return 1
    fi

    # Get the max ID already in Supabase
    local remote_max_id
    remote_max_id=$(curl -s \
        -H "apikey: ${_SUPABASE_KEY}" \
        -H "Authorization: Bearer ${_SUPABASE_KEY}" \
        "${_SUPABASE_URL}/rest/v1/workflow_events?select=id&order=id.desc&limit=1" \
        2>/dev/null | jq -r '.[0].id // 0')

    local local_count
    local_count=$(sqlite3 "$db_path" "
        SELECT COUNT(*) FROM workflow_events WHERE id > $remote_max_id;
    " 2>/dev/null)

    if [ "$local_count" -eq 0 ] 2>/dev/null; then
        echo "All workflow events already synced" >&2
        return 0
    fi

    echo "Syncing $local_count new workflow event(s) (after id $remote_max_id)..." >&2

    # Batch in chunks of 500 to avoid payload limits
    local offset=0
    local chunk_size=500
    local synced=0

    while true; do
        local batch_json
        batch_json=$(_sqlite_to_json "$db_path" "
            SELECT id, timestamp, session_id, sprint, task_num,
                   event_type, tool_name, tool_use_id, skill_name,
                   skill_version, phase, agent_id, agent_type,
                   input_tokens, output_tokens, tool_calls_in_msg,
                   metadata
            FROM workflow_events
            WHERE id > $remote_max_id
            ORDER BY id
            LIMIT $chunk_size OFFSET $offset;
        ")

        if [ -z "$batch_json" ] || [ "$batch_json" = "[]" ]; then
            break
        fi

        # Convert metadata from TEXT to proper JSON for Supabase JSONB column
        batch_json=$(printf '%s' "$batch_json" | jq '[.[] | .metadata = (
            if .metadata != null and .metadata != "" then
                (.metadata | try fromjson catch null)
            else null end
        )]')

        if _supabase_request "POST" "workflow_events" "$batch_json" \
            "Prefer: resolution=merge-duplicates,return=representation" >/dev/null 2>&1; then
            local batch_count
            batch_count=$(printf '%s' "$batch_json" | jq 'length')
            synced=$((synced + batch_count))
            offset=$((offset + chunk_size))
        else
            echo "Batch at offset $offset failed" >&2
            return 1
        fi
    done

    echo "Synced: $synced workflow events" >&2
}

supabase_sync_all_tasks_bulk() {
    # Sync ALL tasks across all sprints to Supabase.
    # Unlike supabase_sync_all_tasks (single sprint), this does every sprint.
    # Usage: supabase_sync_all_tasks_bulk [db_path]
    local db_path="${1:-.pm/tasks.db}"

    if [ "$_SUPABASE_CONFIGURED" != "true" ]; then
        return 1
    fi

    local tasks_json
    tasks_json=$(_sqlite_to_json "$db_path" "
        SELECT sprint, task_num, title, description, done_when,
               status, blocked_reason, type, owner, skills,
               session_id, priority, priority_reason,
               assignment_reason, horizon,
               estimated_minutes, complexity, complexity_notes,
               reversions, pattern_audited, pattern_audit_notes,
               skills_updated, skills_update_notes,
               tests_pass, testing_posture, verified,
               started_at, completed_at, merged_at,
               commit_hash, lines_added, lines_removed,
               external_id, external_url,
               created_at, updated_at
        FROM tasks;
    ")

    if [ -z "$tasks_json" ] || [ "$tasks_json" = "[]" ]; then
        echo "No tasks to sync" >&2
        return 0
    fi

    local count
    count=$(printf '%s' "$tasks_json" | jq 'length')
    echo "Syncing $count task(s)..." >&2

    # Convert SQLite booleans (0/1) to JSON booleans
    tasks_json=$(printf '%s' "$tasks_json" | jq '[.[] |
        .pattern_audited = (.pattern_audited == 1) |
        .skills_updated = (.skills_updated == 1) |
        .tests_pass = (.tests_pass == 1) |
        .verified = (.verified == 1)
    ]')

    if _supabase_request "POST" "tasks" "$tasks_json" \
        "Prefer: resolution=merge-duplicates,return=representation" >/dev/null 2>&1; then
        echo "Synced: $count tasks" >&2
    else
        echo "Task sync failed" >&2
        return 1
    fi
}

supabase_sync_developer_context() {
    # Sync all developer_context rows to Supabase.
    # Usage: supabase_sync_developer_context [db_path]
    local db_path="${1:-.pm/tasks.db}"

    if [ "$_SUPABASE_CONFIGURED" != "true" ]; then
        return 1
    fi

    local ctx_json
    ctx_json=$(_sqlite_to_json "$db_path" "
        SELECT id, developer, recorded_at, concurrent_sessions,
               hour_of_day, alertness, environment, notes
        FROM developer_context;
    ")

    if [ -z "$ctx_json" ] || [ "$ctx_json" = "[]" ]; then
        echo "No developer context to sync" >&2
        return 0
    fi

    local count
    count=$(printf '%s' "$ctx_json" | jq 'length')
    echo "Syncing $count developer context row(s)..." >&2

    if _supabase_request "POST" "developer_context" "$ctx_json" \
        "Prefer: resolution=merge-duplicates,return=representation" >/dev/null 2>&1; then
        echo "Synced: $count developer context rows" >&2
    else
        echo "Developer context sync failed" >&2
        return 1
    fi
}

supabase_sync_skill_versions() {
    # Sync all skill_versions rows to Supabase.
    # Usage: supabase_sync_skill_versions [db_path]
    local db_path="${1:-.pm/tasks.db}"

    if [ "$_SUPABASE_CONFIGURED" != "true" ]; then
        return 1
    fi

    local sv_json
    sv_json=$(_sqlite_to_json "$db_path" "
        SELECT id, skill_name, version, framework_version,
               introduced_at, changelog
        FROM skill_versions;
    ")

    if [ -z "$sv_json" ] || [ "$sv_json" = "[]" ]; then
        echo "No skill versions to sync" >&2
        return 0
    fi

    local count
    count=$(printf '%s' "$sv_json" | jq 'length')
    echo "Syncing $count skill version(s)..." >&2

    if _supabase_request "POST" "skill_versions" "$sv_json" \
        "Prefer: resolution=merge-duplicates,return=representation" >/dev/null 2>&1; then
        echo "Synced: $count skill versions" >&2
    else
        echo "Skill versions sync failed" >&2
        return 1
    fi
}

# --- Task pull (bidirectional sync) ---

# Status rank for comparison: pending=0, red=1, green=2
_status_rank() {
    case "$1" in
        pending) echo 0 ;;
        red)     echo 1 ;;
        green)   echo 2 ;;
        *)       echo 0 ;;
    esac
}

supabase_pull_tasks() {
    # Pull task state from Supabase into local SQLite.
    # Safe merge: only updates tasks you don't own locally, status only advances,
    # definition fields (title, description, done_when, type, priority) are never pulled.
    #
    # Usage: supabase_pull_tasks <sprint> <db_path> <my_id>
    #   sprint  — sprint name to pull
    #   db_path — path to local tasks.db
    #   my_id   — local agent/developer identity (tasks owned by this ID are protected)
    #
    # Returns: 0 on success, 1 on error/not configured
    local sprint="$1"
    local db_path="$2"
    local my_id="$3"

    if [ "$_SUPABASE_CONFIGURED" != "true" ]; then
        return 1
    fi

    # GET state-only columns from Supabase
    local response
    response=$(_supabase_request "GET" \
        "tasks?sprint=eq.${sprint}&select=sprint,task_num,status,owner,started_at,completed_at,merged_at" \
        2>/dev/null) || {
        echo "Supabase unreachable — skipping task pull" >&2
        return 1
    }

    if [ -z "$response" ] || [ "$response" = "[]" ]; then
        return 0
    fi

    local count
    count=$(echo "$response" | jq 'length' 2>/dev/null)
    if [ -z "$count" ] || [ "$count" -eq 0 ] 2>/dev/null; then
        return 0
    fi

    local pulled=0
    local skipped=0
    local superseded=0

    for i in $(seq 0 $((count - 1))); do
        local sb_task_num sb_status sb_owner sb_started sb_completed sb_merged
        sb_task_num=$(echo "$response" | jq -r ".[$i].task_num")
        sb_status=$(echo "$response" | jq -r ".[$i].status // \"pending\"")
        sb_owner=$(echo "$response" | jq -r ".[$i].owner // \"\"")
        sb_started=$(echo "$response" | jq -r ".[$i].started_at // \"\"")
        sb_completed=$(echo "$response" | jq -r ".[$i].completed_at // \"\"")
        sb_merged=$(echo "$response" | jq -r ".[$i].merged_at // \"\"")

        # Get local state for this task
        local local_row
        local_row=$(sqlite3 -separator '|' "$db_path" "
            SELECT status, owner, merged_at
            FROM tasks
            WHERE sprint = '$sprint' AND task_num = $sb_task_num;
        " 2>/dev/null)

        if [ -z "$local_row" ]; then
            # Task doesn't exist locally — skip (definitions come from git)
            ((skipped++)) || true
            continue
        fi

        local local_status local_owner local_merged
        IFS='|' read -r local_status local_owner local_merged <<< "$local_row"

        # merged_at is sticky: once set, never unset
        if [ -n "$local_merged" ] && [ -z "$sb_merged" ]; then
            sb_merged="$local_merged"
        fi

        # Check if this is MY task locally
        if [ -n "$local_owner" ] && [ "$local_owner" = "$my_id" ]; then
            # Supersession check: different owner on Supabase AND more advanced status
            local sb_rank local_rank
            sb_rank=$(_status_rank "$sb_status")
            local_rank=$(_status_rank "$local_status")

            if [ -n "$sb_owner" ] && [ "$sb_owner" != "$my_id" ] && [ "$sb_rank" -gt "$local_rank" ]; then
                # Superseded: someone else completed the task
                echo "Task ${sprint}#${sb_task_num} was completed by ${sb_owner} — your local claim has been reset" >&2
                sqlite3 "$db_path" "
                    UPDATE tasks
                    SET status = 'pending', owner = NULL, session_id = NULL,
                        started_at = NULL, synced_at = NULL
                    WHERE sprint = '$sprint' AND task_num = $sb_task_num;
                " 2>/dev/null
                ((superseded++)) || true

                # Flag worktree for cleanup
                local wt_path
                wt_path=$(git worktree list --porcelain 2>/dev/null | grep -A1 "worktree.*task/${sprint}-${sb_task_num}" | head -1 | sed 's/^worktree //')
                if [ -n "$wt_path" ] && [ -d "$wt_path" ]; then
                    local has_changes
                    has_changes=$(git -C "$wt_path" status --porcelain 2>/dev/null)
                    if [ -z "$has_changes" ]; then
                        git worktree remove "$wt_path" 2>/dev/null || true
                    else
                        echo "WARNING: Worktree at $wt_path has uncommitted changes — not removing" >&2
                    fi
                fi
            else
                # My task, not superseded — keep local state
                ((skipped++)) || true
            fi
            continue
        fi

        # Not my task — check if status advances
        local sb_rank local_rank
        sb_rank=$(_status_rank "$sb_status")
        local_rank=$(_status_rank "$local_status")

        if [ "$sb_rank" -le "$local_rank" ]; then
            # Supabase status is same or less advanced — skip
            ((skipped++)) || true
            continue
        fi

        # Update local state columns (never touch definition fields)
        local set_clauses="status = '$sb_status'"
        [ -n "$sb_owner" ] && set_clauses="${set_clauses}, owner = '$sb_owner'"
        [ -n "$sb_started" ] && set_clauses="${set_clauses}, started_at = '$sb_started'"
        [ -n "$sb_completed" ] && set_clauses="${set_clauses}, completed_at = '$sb_completed'"
        [ -n "$sb_merged" ] && set_clauses="${set_clauses}, merged_at = '$sb_merged'"

        sqlite3 "$db_path" "
            UPDATE tasks
            SET $set_clauses
            WHERE sprint = '$sprint' AND task_num = $sb_task_num;
        " 2>/dev/null
        ((pulled++)) || true
    done

    if [ "$pulled" -gt 0 ] || [ "$superseded" -gt 0 ]; then
        echo "Pulled: $pulled updated, $skipped skipped, $superseded superseded" >&2
    fi

    return 0
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
