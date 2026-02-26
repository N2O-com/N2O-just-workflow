#!/bin/bash
set -euo pipefail

# =============================================================================
# lint-file-size.sh — Flag files too large for safe parallel editing
#
# Usage:
#   bash scripts/lint-file-size.sh [OPTIONS] [PATH]
#
# Options:
#   --threshold N     Max lines before flagging (default: 200)
#   --extensions EXT  Comma-separated extensions (default: ts,tsx,js,jsx,py,rs,go,sh)
#   --exclude DIRS    Comma-separated dirs to skip (default: node_modules,.git,vendor,build,dist,.next)
#   --json            Output JSON instead of table
#   --help            Show this help
#
# Exit codes:
#   0 — No files exceed threshold
#   1 — One or more files exceed threshold
#
# Reference: specs/coordination.md Goal C2 (File Structure for Parallelism)
# Compatible with bash 3.2+ (macOS default)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Defaults
THRESHOLD=200
EXTENSIONS="ts,tsx,js,jsx,py,rs,go,sh"
EXCLUDES="node_modules,.git,vendor,build,dist,.next"
SCAN_PATH=""
JSON_OUTPUT=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# =============================================================================
# Parse arguments
# =============================================================================

while [ $# -gt 0 ]; do
  case "$1" in
    --threshold)
      THRESHOLD="$2"
      shift 2
      ;;
    --extensions)
      EXTENSIONS="$2"
      shift 2
      ;;
    --exclude)
      EXCLUDES="$2"
      shift 2
      ;;
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    --help|-h)
      sed -n '/^# lint-file-size/,/^# ====/{/^# ====/d; s/^# \{0,1\}//; p;}' "$0"
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      SCAN_PATH="$1"
      shift
      ;;
  esac
done

# Default scan path: project root (parent of scripts/)
if [ -z "$SCAN_PATH" ]; then
  SCAN_PATH="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

# Validate threshold is a number
if ! echo "$THRESHOLD" | grep -qE '^[0-9]+$'; then
  echo "Error: --threshold must be a positive integer, got '$THRESHOLD'" >&2
  exit 1
fi

# =============================================================================
# Build find command
# =============================================================================

# Build -name patterns from extensions
IFS=',' read -r -a ext_array <<< "$EXTENSIONS"
name_args=""
first=true
for ext in "${ext_array[@]}"; do
  ext="$(echo "$ext" | tr -d ' ')"
  if [ "$first" = true ]; then
    name_args="-name \"*.${ext}\""
    first=false
  else
    name_args="$name_args -o -name \"*.${ext}\""
  fi
done

# Build -path exclusions
IFS=',' read -r -a excl_array <<< "$EXCLUDES"
prune_args=""
for dir in "${excl_array[@]}"; do
  dir="$(echo "$dir" | tr -d ' ')"
  if [ -n "$prune_args" ]; then
    prune_args="$prune_args -o -path \"*/${dir}\" -o -path \"*/${dir}/*\""
  else
    prune_args="-path \"*/${dir}\" -o -path \"*/${dir}/*\""
  fi
done

# =============================================================================
# Scan files
# =============================================================================

VIOLATIONS=0
TOTAL_FILES=0
JSON_ENTRIES=""

# Use eval to expand the quoted patterns in find
files=$(eval "find \"$SCAN_PATH\" \\( $prune_args \\) -prune -o -type f \\( $name_args \\) -print" 2>/dev/null || true)

if [ -z "$files" ]; then
  if [ "$JSON_OUTPUT" = true ]; then
    echo '{"violations":[],"summary":{"files_scanned":0,"violations":0,"threshold":'"$THRESHOLD"'}}'
  else
    echo -e "${DIM}No source files found.${NC}"
  fi
  exit 0
fi

# Header (non-JSON only)
if [ "$JSON_OUTPUT" = false ]; then
  echo -e "${BOLD}N2O File Size Linter${NC}"
  echo -e "${DIM}Flagging files over $THRESHOLD lines for parallel safety${NC}"
  echo ""
fi

# Sort files for consistent output
sorted_files=$(echo "$files" | sort)

while IFS= read -r file; do
  [ -z "$file" ] && continue
  TOTAL_FILES=$((TOTAL_FILES + 1))

  line_count=$(wc -l < "$file" | tr -d ' ')

  if [ "$line_count" -gt "$THRESHOLD" ]; then
    VIOLATIONS=$((VIOLATIONS + 1))

    # Make path relative to scan root
    rel_path="${file#"$SCAN_PATH"/}"

    if [ "$JSON_OUTPUT" = true ]; then
      if [ -n "$JSON_ENTRIES" ]; then
        JSON_ENTRIES="$JSON_ENTRIES,"
      fi
      JSON_ENTRIES="$JSON_ENTRIES{\"file\":\"$rel_path\",\"lines\":$line_count,\"threshold\":$THRESHOLD}"
    else
      echo -e "  ${RED}$line_count${NC} lines  ${BOLD}$rel_path${NC}"
      echo -e "         ${DIM}Decompose into smaller files for parallel safety${NC}"
    fi
  fi
done <<< "$sorted_files"

# =============================================================================
# Output
# =============================================================================

if [ "$JSON_OUTPUT" = true ]; then
  echo "{\"violations\":[$JSON_ENTRIES],\"summary\":{\"files_scanned\":$TOTAL_FILES,\"violations\":$VIOLATIONS,\"threshold\":$THRESHOLD}}"
else
  echo ""
  printf '  '
  printf '%0.s-' $(seq 1 56)
  echo ""
  echo -e "  Files scanned:  $TOTAL_FILES"
  echo -e "  Threshold:      $THRESHOLD lines"
  if [ "$VIOLATIONS" -gt 0 ]; then
    echo -e "  ${RED}Violations:${NC}     $VIOLATIONS"
    echo ""
    echo -e "  ${YELLOW}Tip:${NC} Break large files into smaller, focused modules."
    echo -e "  ${DIM}Smaller files reduce merge conflicts when agents work in parallel.${NC}"
  else
    echo -e "  ${GREEN}Violations:${NC}     0"
    echo ""
    echo -e "  ${GREEN}All files are within the $THRESHOLD-line threshold.${NC}"
  fi
fi

# Exit code
if [ "$VIOLATIONS" -gt 0 ]; then
  exit 1
fi
exit 0
