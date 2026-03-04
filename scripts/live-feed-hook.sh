#!/bin/bash
# live-feed-hook.sh — Real-time activity feed hook
# Inserts workflow_events rows for live dashboard updates.
# Called by Claude Code hooks (UserPromptSubmit, PostToolUse, SubagentStart/Stop, Stop).
#
# Usage: bash scripts/live-feed-hook.sh <event_type>
# Receives hook JSON on stdin.

EVENT_TYPE="${1:-}"
[[ -z "$EVENT_TYPE" ]] && exit 0

# Find project root
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  PROJECT_ROOT="$CLAUDE_PROJECT_DIR"
elif [[ -f ".pm/tasks.db" ]]; then
  PROJECT_ROOT="."
else
  exit 0
fi

DB="$PROJECT_ROOT/.pm/tasks.db"
[[ -f "$DB" ]] || exit 0

# Read hook input
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""' 2>/dev/null)
[[ -z "$SESSION_ID" ]] && exit 0

# Get task context from current session (best-effort)
SPRINT=$(sqlite3 "$DB" "SELECT sprint FROM transcripts WHERE session_id='${SESSION_ID}' LIMIT 1;" 2>/dev/null || echo "")
TASK_NUM=$(sqlite3 "$DB" "SELECT task_num FROM transcripts WHERE session_id='${SESSION_ID}' LIMIT 1;" 2>/dev/null || echo "")

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
METADATA=""
TOOL_NAME=""
SKILL_NAME=""
AGENT_TYPE=""

case "$EVENT_TYPE" in
  user_prompt)
    # Extract user prompt directly from hook input JSON (.prompt field)
    PROMPT_TEXT=$(echo "$INPUT" | jq -r '.prompt // ""' 2>/dev/null)
    # Truncate to 500 chars
    PROMPT_TEXT="${PROMPT_TEXT:0:500}"
    METADATA=$(jq -nc --arg text "$PROMPT_TEXT" --arg source "hook" \
      '{prompt_text: $text, source: $source}')
    ;;

  tool_call)
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)

    case "$TOOL_NAME" in
      Read|Edit|Write)
        FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
        METADATA=$(jq -nc --arg fp "$FILE_PATH" --arg source "hook" \
          '{file_path: $fp, source: $source}')
        ;;
      Bash)
        COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)
        COMMAND="${COMMAND:0:200}"
        METADATA=$(jq -nc --arg cmd "$COMMAND" --arg source "hook" \
          '{command: $cmd, source: $source}')
        ;;
      Grep)
        PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // ""' 2>/dev/null)
        GREP_PATH=$(echo "$INPUT" | jq -r '.tool_input.path // ""' 2>/dev/null)
        METADATA=$(jq -nc --arg p "$PATTERN" --arg path "$GREP_PATH" --arg source "hook" \
          '{pattern: $p, path: $path, source: $source}')
        ;;
      Glob)
        PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // ""' 2>/dev/null)
        METADATA=$(jq -nc --arg p "$PATTERN" --arg source "hook" \
          '{pattern: $p, source: $source}')
        ;;
      Task)
        DESC=$(echo "$INPUT" | jq -r '.tool_input.description // ""' 2>/dev/null)
        METADATA=$(jq -nc --arg d "$DESC" --arg source "hook" \
          '{description: $d, source: $source}')
        ;;
      Skill)
        SKILL_NAME=$(echo "$INPUT" | jq -r '.tool_input.skill // ""' 2>/dev/null)
        METADATA=$(jq -nc --arg s "$SKILL_NAME" --arg source "hook" \
          '{skill: $s, source: $source}')
        ;;
      WebSearch)
        QUERY=$(echo "$INPUT" | jq -r '.tool_input.query // ""' 2>/dev/null)
        METADATA=$(jq -nc --arg q "$QUERY" --arg source "hook" \
          '{query: $q, source: $source}')
        ;;
      *)
        METADATA=$(jq -nc --arg source "hook" '{source: $source}')
        ;;
    esac
    ;;

  subagent_start)
    AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // .subagent_type // ""' 2>/dev/null)
    METADATA=$(jq -nc --arg t "$AGENT_TYPE" --arg source "hook" \
      '{agent_type: $t, source: $source}')
    ;;

  subagent_stop)
    AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // .subagent_type // ""' 2>/dev/null)
    METADATA=$(jq -nc --arg t "$AGENT_TYPE" --arg source "hook" \
      '{agent_type: $t, source: $source}')
    ;;

  turn_complete)
    STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
    METADATA=$(jq -nc --arg active "$STOP_ACTIVE" --arg source "hook" \
      '{stop_hook_active: $active, source: $source}')
    ;;

  *)
    exit 0
    ;;
esac

# Build SQL — use jq to safely escape values for SQLite
SAFE_METADATA=$(echo "$METADATA" | sed "s/'/''/g")

# Build NULL-safe column values
SPRINT_VAL="NULL"
[[ -n "$SPRINT" ]] && SPRINT_VAL="'${SPRINT//\'/\'\'}'"
TASK_NUM_VAL="NULL"
[[ -n "$TASK_NUM" ]] && TASK_NUM_VAL="$TASK_NUM"
TOOL_NAME_VAL="NULL"
[[ -n "$TOOL_NAME" ]] && TOOL_NAME_VAL="'${TOOL_NAME//\'/\'\'}'"
SKILL_NAME_VAL="NULL"
[[ -n "$SKILL_NAME" ]] && SKILL_NAME_VAL="'${SKILL_NAME//\'/\'\'}'"
AGENT_TYPE_VAL="NULL"
[[ -n "$AGENT_TYPE" ]] && AGENT_TYPE_VAL="'${AGENT_TYPE//\'/\'\'}'"

sqlite3 "$DB" "INSERT INTO workflow_events
  (timestamp, session_id, sprint, task_num, event_type, tool_name, skill_name, agent_type, metadata)
VALUES
  ('$TIMESTAMP', '$SESSION_ID', $SPRINT_VAL, $TASK_NUM_VAL, '$EVENT_TYPE',
   $TOOL_NAME_VAL, $SKILL_NAME_VAL, $AGENT_TYPE_VAL, '$SAFE_METADATA');" 2>/dev/null || true

exit 0
