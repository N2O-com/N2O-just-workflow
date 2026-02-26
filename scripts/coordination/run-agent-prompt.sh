#!/bin/bash
# Show a prompt for review, then pipe it to Claude Code on confirmation.
#
# Usage: run-agent-prompt.sh <prompt-file>

set -e

PROMPT_FILE="$1"

if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "Error: Prompt file not found: $PROMPT_FILE"
    exit 1
fi

# Display the full prompt
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PROMPT: $(basename "$PROMPT_FILE" .md)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
cat "$PROMPT_FILE"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Press ENTER to send this prompt to Claude Code"
echo "  Press Ctrl+C to cancel"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

read -r _ < /dev/tty

echo ""
echo "Launching Claude Code..."
echo ""
cat "$PROMPT_FILE" | claude --dangerously-skip-permissions
