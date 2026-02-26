#!/bin/bash
# Launch parallel Claude Code agents in Warp split panes.
#
# Usage:
#   ./scripts/coordination/launch-agents.sh prompt1.md prompt2.md [prompt3.md ...]
#   ./scripts/coordination/launch-agents.sh --from-dir /path/to/prompts/
#   ./scripts/coordination/launch-agents.sh --auto-run prompt1.md prompt2.md
#
# Default behavior:
#   1. Opens a new Warp window with split panes
#   2. Launches Claude Code in each pane
#   3. Pastes the prompt into Claude's input (without submitting)
#   4. User presses Ctrl+G to review/edit in external editor, then Enter to run
#
# With --auto-run:
#   Pipes prompts directly into Claude (runs immediately, no review)

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# --- Parse arguments ---

PROMPT_FILES=()
PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
AUTO_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --from-dir)
            if [[ ! -d "$2" ]]; then
                echo -e "${RED}Error: Directory not found: $2${NC}" >&2
                exit 1
            fi
            for f in "$2"/*.md; do
                [[ -f "$f" ]] && PROMPT_FILES+=("$f")
            done
            shift 2
            ;;
        --project-dir)
            PROJECT_DIR="$2"
            shift 2
            ;;
        --auto-run)
            AUTO_RUN=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options] prompt1.md [prompt2.md ...]"
            echo ""
            echo "Options:"
            echo "  --from-dir <dir>     Load all .md files from directory as prompts"
            echo "  --project-dir <dir>  Working directory for agents (default: git root)"
            echo "  --auto-run           Skip review, pipe prompts directly into Claude"
            echo ""
            echo "Default: pastes prompts into Claude's input for review."
            echo "Press Ctrl+G to open in editor, then Enter to submit."
            exit 0
            ;;
        *)
            if [[ -f "$1" ]]; then
                PROMPT_FILES+=("$1")
            else
                echo -e "${RED}Error: File not found: $1${NC}" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ ${#PROMPT_FILES[@]} -eq 0 ]]; then
    echo -e "${RED}Error: No prompt files provided.${NC}" >&2
    echo "Usage: $0 prompt1.md prompt2.md [prompt3.md ...]" >&2
    exit 1
fi

NUM_PROMPTS=${#PROMPT_FILES[@]}
echo -e "${GREEN}Launching ${NUM_PROMPTS} agent(s) in Warp split panes${NC}" >&2

# --- Copy prompts to stable location ---

STABLE_DIR="$PROJECT_DIR/.pm/.agent-prompts"
mkdir -p "$STABLE_DIR"
rm -f "$STABLE_DIR"/prompt-*.md

for i in "${!PROMPT_FILES[@]}"; do
    cp "${PROMPT_FILES[$i]}" "$STABLE_DIR/prompt-$((i+1)).md"
    echo -e "  Pane $((i+1)): ${PROMPT_FILES[$i]}" >&2
done

# --- Generate Warp Launch Configuration ---

LAUNCH_CONFIG="$HOME/.warp/launch_configurations/n2o-agents.yaml"

build_pane_yaml() {
    local idx=$1
    local prompt_file="$STABLE_DIR/prompt-${idx}.md"
    local indent="$2"

    if $AUTO_RUN; then
        cat <<PANE
${indent}- cwd: ${PROJECT_DIR}
${indent}  commands:
${indent}    - exec: cat ${prompt_file} | claude --dangerously-skip-permissions
PANE
    else
        cat <<PANE
${indent}- cwd: ${PROJECT_DIR}
${indent}  commands:
${indent}    - exec: claude --dangerously-skip-permissions
PANE
    fi
}

generate_layout() {
    local num=$1

    if [[ $num -eq 1 ]]; then
        cat <<EOF
        layout:
          panes:
$(build_pane_yaml 1 "            ")
EOF
    elif [[ $num -eq 2 ]]; then
        cat <<EOF
        layout:
          split_direction: horizontal
          panes:
$(build_pane_yaml 1 "            ")
$(build_pane_yaml 2 "            ")
EOF
    elif [[ $num -eq 3 ]]; then
        cat <<EOF
        layout:
          split_direction: horizontal
          panes:
$(build_pane_yaml 1 "            ")
            - split_direction: vertical
              panes:
$(build_pane_yaml 2 "                ")
$(build_pane_yaml 3 "                ")
EOF
    elif [[ $num -eq 4 ]]; then
        cat <<EOF
        layout:
          split_direction: horizontal
          panes:
            - split_direction: vertical
              panes:
$(build_pane_yaml 1 "                ")
$(build_pane_yaml 2 "                ")
            - split_direction: vertical
              panes:
$(build_pane_yaml 3 "                ")
$(build_pane_yaml 4 "                ")
EOF
    else
        local half=$(( (num + 1) / 2 ))
        cat <<EOF
        layout:
          split_direction: horizontal
          panes:
            - split_direction: vertical
              panes:
EOF
        for i in $(seq 1 $half); do
            build_pane_yaml "$i" "                "
        done
        cat <<EOF
            - split_direction: vertical
              panes:
EOF
        for i in $(seq $((half + 1)) $num); do
            build_pane_yaml "$i" "                "
        done
    fi
}

cat > "$LAUNCH_CONFIG" <<EOF
---
name: N2O Agents (${NUM_PROMPTS} panes)
windows:
  - tabs:
      - title: "N2O: ${NUM_PROMPTS} Parallel Agents"
$(generate_layout $NUM_PROMPTS)
        color: green
EOF

echo -e "${GREEN}Launch config written${NC}" >&2

# --- Open new Warp window with launch config ---

echo -e "${YELLOW}Opening new Warp window...${NC}" >&2

osascript 2>/dev/null <<'APPLESCRIPT' || {
    tell application "Warp"
        activate
        delay 0.5
    end tell
    tell application "System Events"
        tell process "Warp"
            keystroke "n" using {command down}
            delay 1.5
            keystroke "p" using {command down}
            delay 1
            keystroke "launch"
            delay 1
            key code 36
            delay 0.5
            key code 36
        end tell
    end tell
APPLESCRIPT
    echo -e "${YELLOW}AppleScript failed. Manually: Cmd+N → Cmd+P → type 'launch' → Enter${NC}" >&2
}

# --- For auto-run mode, we're done ---

if $AUTO_RUN; then
    echo -e "${GREEN}Agents launched with prompts piped in.${NC}" >&2
    exit 0
fi

# --- Paste prompts into each pane's Claude input ---

echo -e "${YELLOW}Waiting for Claude Code to start (12s)...${NC}" >&2
echo -e "${YELLOW}You can keep working — the script will focus the N2O window when ready.${NC}" >&2
sleep 12

# Save current clipboard
OLD_CLIPBOARD=$(pbpaste 2>/dev/null || true)

echo -e "${YELLOW}Pasting prompts into panes...${NC}" >&2

for i in $(seq 1 "$NUM_PROMPTS"); do
    prompt_file="$STABLE_DIR/prompt-${i}.md"

    # Focus the N2O window (by finding it by title), then paste
    # This ensures pastes go to the right window even if user switched focus
    cat "$prompt_file" | pbcopy
    sleep 0.3

    if [[ $i -eq 1 ]]; then
        # First pane: just focus the N2O window and paste
        osascript 2>/dev/null <<'APPLESCRIPT'
tell application "System Events"
    tell process "Warp"
        -- Find and raise the N2O agents window
        repeat with w in (every window)
            if name of w contains "N2O" then
                perform action "AXRaise" of w
            end if
        end repeat
        delay 0.5
        -- Paste into first pane (already focused)
        keystroke "v" using {command down}
    end tell
end tell
APPLESCRIPT
    else
        # Subsequent panes: focus N2O window, switch pane, paste
        osascript 2>/dev/null <<'APPLESCRIPT'
tell application "System Events"
    tell process "Warp"
        -- Find and raise the N2O agents window
        repeat with w in (every window)
            if name of w contains "N2O" then
                perform action "AXRaise" of w
            end if
        end repeat
        delay 0.5
        -- Move to next pane (Opt+Cmd+Right)
        key code 124 using {option down, command down}
        delay 1
        -- Paste
        keystroke "v" using {command down}
    end tell
end tell
APPLESCRIPT
    fi

    sleep 1
    echo -e "  Pasted prompt ${i}/${NUM_PROMPTS}" >&2
done

# Restore clipboard
echo -n "$OLD_CLIPBOARD" | pbcopy 2>/dev/null || true

echo "" >&2
echo -e "${GREEN}Done! Prompts pasted into ${NUM_PROMPTS} panes.${NC}" >&2
echo -e "${YELLOW}In each pane: Ctrl+G to view/edit in editor, Enter to submit.${NC}" >&2
