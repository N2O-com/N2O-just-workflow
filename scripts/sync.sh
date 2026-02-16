#!/bin/bash
set -e

# =============================================================================
# sync.sh — Orchestrator for PM tool sync
# Reads pm_tool from .pm/config.json and delegates to the correct adapter.
#
# Usage:
#   ./scripts/sync/sync.sh claim <sprint> <task_num>
#   ./scripts/sync/sync.sh complete <sprint> <task_num>
#   ./scripts/sync/sync.sh blocked <sprint> <task_num>
#   ./scripts/sync/sync.sh sprint-summary <sprint>
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG=".pm/config.json"

if [[ ! -f "$CONFIG" ]]; then
  echo "Error: $CONFIG not found. Are you in the project root?" >&2
  exit 1
fi

PM_TOOL=$(jq -r '.pm_tool // empty' "$CONFIG")

if [[ -z "$PM_TOOL" ]]; then
  echo "No pm_tool configured in $CONFIG. Skipping sync." >&2
  exit 0
fi

ADAPTER="$SCRIPT_DIR/${PM_TOOL}-sync.sh"

if [[ ! -f "$ADAPTER" ]]; then
  echo "Error: No sync adapter found for '$PM_TOOL' (expected $ADAPTER)" >&2
  exit 1
fi

exec "$ADAPTER" "$@"
