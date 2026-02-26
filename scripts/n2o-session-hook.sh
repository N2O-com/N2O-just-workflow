#!/bin/bash
# N2O SessionStart Hook
# Fires when a Claude Code session starts. Handles:
#   1. Whether the engineer needs to git pull
#   2. Whether the framework was recently updated (shows changelog once)
#   3. Auto-claim next available task and create worktree (coordination mode)
#
# Configured in .claude/settings.json, receives JSON on stdin.
# Stdout is injected into Claude's context.

# Only run on fresh startups (not resume/compact/clear)
input=$(cat)
source=$(echo "$input" | jq -r '.source // ""' 2>/dev/null)
if [[ "$source" != "startup" ]]; then
  exit 0
fi

cwd=$(echo "$input" | jq -r '.cwd // ""' 2>/dev/null)
if [[ -z "$cwd" ]]; then
  exit 0
fi
cd "$cwd" 2>/dev/null || exit 0

# Skip if not an N2O project
if [[ ! -f ".pm/config.json" ]]; then
  exit 0
fi

output=""

# --- Step 0.5: Auto-sync framework (before version notification) ---
global_config="$HOME/.n2o/config.json"
if [[ -f "$global_config" ]]; then
  auto_sync=$(jq -r '.auto_sync // false' "$global_config" 2>/dev/null)
  framework_path=$(jq -r '.framework_path // ""' "$global_config" 2>/dev/null)

  if [[ "$auto_sync" == "true" && -n "$framework_path" && -d "$framework_path" ]]; then
    # Skip if project is version-pinned
    pinned=$(jq -r '.n2o_version_pinned // ""' .pm/config.json 2>/dev/null)
    project_ver=$(jq -r '.n2o_version // ""' .pm/config.json 2>/dev/null)
    framework_ver=$(jq -r '.version // ""' "$framework_path/n2o-manifest.json" 2>/dev/null)

    if [[ -z "$pinned" && -n "$framework_ver" && "$project_ver" != "$framework_ver" ]]; then
      # Optional auto-pull
      auto_pull=$(jq -r '.auto_pull // false' "$global_config" 2>/dev/null)
      if [[ "$auto_pull" == "true" ]]; then
        git -C "$framework_path" pull --ff-only 2>/dev/null || true
      fi

      # Run quiet sync
      sync_output=$("$framework_path/n2o" sync "$cwd" --quiet 2>/dev/null) || true
      if [[ -n "$sync_output" ]]; then
        output="${output}${sync_output}\n"
      fi
    fi
  fi
fi

# --- Step 0: Developer identity and concurrent sessions ---
developer_name=$(jq -r '.developer_name // ""' .pm/config.json 2>/dev/null)
if [[ -z "$developer_name" ]]; then
  developer_name=$(git config user.name 2>/dev/null || echo "unknown")
fi

# Count concurrent Claude Code sessions for this project
concurrent_sessions=1
if command -v pgrep &>/dev/null; then
  # Count claude processes with this project's directory
  concurrent_sessions=$(pgrep -f "claude" 2>/dev/null | wc -l | tr -d ' ')
  [[ "$concurrent_sessions" -lt 1 ]] && concurrent_sessions=1
fi

# Persist concurrent session count to developer_context table (if it exists)
if [[ -f ".pm/tasks.db" ]]; then
  local_hour=$(date +%H 2>/dev/null | sed 's/^0//' || echo "")
  safe_dev="${developer_name//\'/\'\'}"
  sqlite3 .pm/tasks.db "INSERT INTO developer_context (developer, concurrent_sessions, hour_of_day) VALUES ('${safe_dev}', ${concurrent_sessions}, ${local_hour:-0});" 2>/dev/null || true
fi

output="${output}Developer: ${developer_name} | Concurrent sessions: ${concurrent_sessions}\n"

# --- Step 1: Git pull reminder (local-only, no network call) ---
if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null 2>&1; then
  # Detect default remote branch
  default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
  if [[ -z "$default_branch" ]]; then
    default_branch="main"
  fi

  behind=$(git rev-list "HEAD..origin/$default_branch" --count 2>/dev/null || echo "0")
  if [[ "$behind" -gt 0 ]]; then
    output="${output}Your branch is ${behind} commit(s) behind origin/${default_branch}. Run \`git pull\` to get the latest updates.\n\n"
  fi
fi

# --- Step 2: Framework update notification (show once per version) ---
current_version=$(jq -r '.n2o_version // ""' .pm/config.json 2>/dev/null)
last_seen=$(cat .pm/.last_seen_version 2>/dev/null || echo "")

if [[ -n "$current_version" && "$current_version" != "$last_seen" ]]; then
  # Build notification
  notification="N2O framework updated to v${current_version}."

  # Parse CHANGELOG.md for entries for this version
  if [[ -f "CHANGELOG.md" ]]; then
    changelog_entries=""
    in_version=false
    while IFS= read -r line; do
      if [[ "$line" =~ ^##[[:space:]]+([0-9]+\.[0-9]+\.[0-9]+) ]]; then
        ver="${BASH_REMATCH[1]}"
        if [[ "$ver" == "$current_version" ]]; then
          in_version=true
          continue
        else
          if $in_version; then
            break
          fi
        fi
      fi
      if $in_version && [[ -n "$line" ]] && [[ ! "$line" =~ ^# ]]; then
        changelog_entries="${changelog_entries}  ${line}\n"
      fi
    done < "CHANGELOG.md"

    if [[ -n "$changelog_entries" ]]; then
      notification="${notification}\n${changelog_entries}"
    fi
  fi

  output="${output}${notification}"

  # Mark as seen so it only shows once
  echo "$current_version" > .pm/.last_seen_version 2>/dev/null || true
fi

# --- Step 3: Auto-claim task (coordination mode) ---
# If tasks.db exists and has available tasks, claim one and set up a worktree.
# The claim-task.sh script handles atomic claiming and worktree creation.
# Its JSON output is parsed here to produce context for Claude.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAIM_SCRIPT="$SCRIPT_DIR/coordination/claim-task.sh"
SUPABASE_CLIENT="$SCRIPT_DIR/coordination/supabase-client.sh"
SYNC_SCRIPT="$SCRIPT_DIR/coordination/sync-task-state.sh"

# Source Supabase client if available (for agent registration)
_supabase_available=false
if [[ -f "$SUPABASE_CLIENT" ]]; then
  source "$SUPABASE_CLIENT" 2>/dev/null || true
  if [[ "$_SUPABASE_CONFIGURED" == "true" ]]; then
    _supabase_available=true
  fi
fi

if [[ -f ".pm/tasks.db" && -x "$CLAIM_SCRIPT" ]]; then
  # Check if there are any available tasks before attempting claim
  available_count=$(sqlite3 .pm/tasks.db "SELECT COUNT(*) FROM available_tasks;" 2>/dev/null || echo "0")

  if [[ "$available_count" -gt 0 ]]; then
    # Attempt to claim — claim-task.sh outputs JSON on stdout, logs to stderr
    claim_err=$(mktemp)
    claim_json=$(bash "$CLAIM_SCRIPT" --session-id "${SESSION_ID:-unknown}" 2>"$claim_err") || true

    # Surface any claim errors to the user
    if [[ -s "$claim_err" ]]; then
      local err_text
      err_text=$(cat "$claim_err")
      # Only surface actual errors (not info/success messages)
      if echo "$err_text" | grep -qi "error\|failed\|rejected"; then
        output="${output}\nTask claim issue: ${err_text}\n"
      fi
    fi
    rm -f "$claim_err"

    if [[ -n "$claim_json" ]]; then
      # Parse the claim result
      task_title=$(echo "$claim_json" | jq -r '.title // ""' 2>/dev/null)
      task_sprint=$(echo "$claim_json" | jq -r '.sprint // ""' 2>/dev/null)
      task_num=$(echo "$claim_json" | jq -r '.task_num // ""' 2>/dev/null)
      task_desc=$(echo "$claim_json" | jq -r '.description // ""' 2>/dev/null)
      task_done_when=$(echo "$claim_json" | jq -r '.done_when // ""' 2>/dev/null)
      task_skills=$(echo "$claim_json" | jq -r '.skills // ""' 2>/dev/null)
      task_type=$(echo "$claim_json" | jq -r '.type // ""' 2>/dev/null)
      worktree_path=$(echo "$claim_json" | jq -r '.worktree_path // ""' 2>/dev/null)
      branch=$(echo "$claim_json" | jq -r '.branch // ""' 2>/dev/null)
      agent_id=$(echo "$claim_json" | jq -r '.agent_id // ""' 2>/dev/null)

      # Register agent and log session start to Supabase
      if $_supabase_available && [[ -n "$agent_id" ]]; then
        machine_id=$(hostname -s 2>/dev/null || echo "unknown")
        developer=$(git config user.name 2>/dev/null || echo "")
        supabase_register_agent "$agent_id" "$machine_id" "$developer" "$task_sprint" "$task_num" >/dev/null 2>&1 || true
        supabase_log_event "session_start" "$agent_id" "$task_sprint" "$task_num" \
          "{\"session_id\":\"${SESSION_ID:-unknown}\"}" >/dev/null 2>&1 || true

        # Set up trap to deregister agent on session end
        _n2o_agent_id="$agent_id"
        _n2o_deregister() {
          if [[ -f "$SYNC_SCRIPT" ]]; then
            bash "$SYNC_SCRIPT" "agent-stopped" "$_n2o_agent_id" 2>/dev/null || true
          fi
        }
        trap _n2o_deregister SIGINT SIGTERM EXIT
      fi

      if [[ -n "$task_title" ]]; then
        output="${output}\n--- TASK AUTO-CLAIMED ---\n"
        output="${output}Agent: ${agent_id}\n"
        output="${output}Task: ${task_sprint}#${task_num} — ${task_title}\n"
        output="${output}Type: ${task_type}\n"
        output="${output}Branch: ${branch}\n"
        output="${output}Worktree: ${worktree_path}\n"
        if [[ -n "$task_desc" ]]; then
          output="${output}\nDescription:\n${task_desc}\n"
        fi
        if [[ -n "$task_done_when" ]]; then
          output="${output}\nDone when:\n${task_done_when}\n"
        fi
        if [[ -n "$task_skills" ]]; then
          output="${output}\nSkills to invoke: ${task_skills}\n"
        fi
        output="${output}\nYour working directory is: ${worktree_path}\n"

        # Determine workflow skill — default to tdd-agent unless task skills
        # explicitly specify a different workflow (bug-workflow, pm-agent, etc.)
        workflow_skill="tdd-agent"
        if [[ "$task_skills" == *"bug-workflow"* ]]; then
          workflow_skill="bug-workflow"
        elif [[ "$task_skills" == *"pm-agent"* ]]; then
          workflow_skill="pm-agent"
        fi

        output="${output}\nIMPORTANT: You MUST invoke /${workflow_skill} now to implement this task.\n"
        if [[ "$workflow_skill" == "tdd-agent" ]]; then
          output="${output}Follow the full workflow: RED → GREEN → REFACTOR → AUDIT → CODIFY → COMMIT.\n"
          output="${output}Do NOT implement without /tdd-agent — it enforces test-first development and quality gates.\n"
        fi
        output="${output}--- END TASK ---\n"
      fi
    fi
  fi
fi

# Print output if we have any (plain text, no ANSI — stdout goes to Claude context)
if [[ -n "$output" ]]; then
  # Strip any ANSI escape codes for clean context injection
  echo -e "$output" | sed $'s/\033\\[[0-9;]*m//g'
fi

# --- Step 4: Collect stale transcripts from sibling sessions (background) ---
# If another session on this project is still running, its JSONL has grown
# since last collection. Re-collect in background to keep data fresh.
COLLECT_SCRIPT="$SCRIPT_DIR/../collect-transcripts.sh"
if [[ -f "$COLLECT_SCRIPT" ]]; then
  bash "$COLLECT_SCRIPT" --quiet 2>/dev/null &
fi
