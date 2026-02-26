#!/bin/bash
# Install N2O git hooks for event-driven sync.
#
# Usage: bash scripts/coordination/install-hooks.sh [project-root]
#
# Installs post-commit, post-merge, pre-push, and post-checkout hooks
# into .git/hooks/. Each hook calls sync-task-state.sh with the
# appropriate event type.
#
# Idempotent: safe to run multiple times.
# Hooks never block git operations (exit 0 always).

set -e

PROJECT_ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null)}"

if [ -z "$PROJECT_ROOT" ]; then
    echo "Error: Not inside a git repository and no project-root provided." >&2
    exit 1
fi

HOOKS_DIR="$PROJECT_ROOT/.git/hooks"
SYNC_SCRIPT="scripts/coordination/sync-task-state.sh"

# Ensure hooks directory exists
mkdir -p "$HOOKS_DIR"

# Marker to identify N2O-managed hooks
N2O_MARKER="# N2O-MANAGED-HOOK"

install_hook() {
    local hook_name="$1"
    local event_type="$2"
    local hook_path="$HOOKS_DIR/$hook_name"

    # If hook exists and is ours, overwrite it
    # If hook exists and is NOT ours, append our call
    if [ -f "$hook_path" ]; then
        if grep -q "$N2O_MARKER" "$hook_path" 2>/dev/null; then
            # Already installed — overwrite the N2O section
            return 0
        fi
        # Existing non-N2O hook — append our call
        cat >> "$hook_path" <<HOOK

$N2O_MARKER
# Event-driven sync: fire $event_type on $hook_name
if [ -f "$SYNC_SCRIPT" ]; then
    bash "$SYNC_SCRIPT" "$event_type" &>/dev/null &
fi
# N2O hooks never block git
HOOK
        chmod +x "$hook_path"
        return 0
    fi

    # Fresh hook
    cat > "$hook_path" <<HOOK
#!/bin/bash
$N2O_MARKER
# Event-driven sync: fire $event_type on $hook_name
# Installed by N2O — sync-task-state.sh routes events to Supabase.
# Failures never block git operations.

if [ -f "$SYNC_SCRIPT" ]; then
    bash "$SYNC_SCRIPT" "$event_type" &>/dev/null &
fi

exit 0
HOOK
    chmod +x "$hook_path"
}

install_hook "post-commit"   "post-commit"
install_hook "post-merge"    "post-merge"
install_hook "pre-push"      "pre-push"
install_hook "post-checkout" "post-checkout"

echo "N2O git hooks installed." >&2
