#!/bin/bash
# Scan SKILL.md files and upsert skill_versions into local SQLite.
# Usage: bash scripts/sync-skill-versions.sh [db_path]
#
# Reads frontmatter (name, version) from each SKILL.md under 02-agents/ and
# 03-patterns/, plus the framework version from n2o-manifest.json.
# Inserts/updates rows in the skill_versions table so the Supabase sync
# pipeline can push them upstream.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PATH="${1:-$PROJECT_ROOT/.pm/tasks.db}"

if [ ! -f "$DB_PATH" ]; then
    echo "No tasks.db at $DB_PATH" >&2
    exit 1
fi

# Framework version from manifest
FW_VERSION=""
if [ -f "$PROJECT_ROOT/n2o-manifest.json" ]; then
    FW_VERSION=$(jq -r '.version // empty' "$PROJECT_ROOT/n2o-manifest.json" 2>/dev/null || true)
fi

# Scan skill directories
inserted=0
for skill_md in "$PROJECT_ROOT"/02-agents/*/SKILL.md "$PROJECT_ROOT"/03-patterns/*/SKILL.md; do
    [ -f "$skill_md" ] || continue

    # Extract frontmatter fields (between --- lines)
    skill_name=$(awk '/^---$/{n++; next} n==1 && /^name:/{sub(/^name: */, ""); print}' "$skill_md" | tr -d '"' | tr -d "'")
    skill_version=$(awk '/^---$/{n++; next} n==1 && /^version:/{sub(/^version: */, ""); print}' "$skill_md" | tr -d '"' | tr -d "'")

    [ -z "$skill_name" ] && continue
    [ -z "$skill_version" ] && continue

    sqlite3 "$DB_PATH" "
        INSERT INTO skill_versions (skill_name, version, framework_version)
        VALUES ('$skill_name', '$skill_version', '${FW_VERSION:-}')
        ON CONFLICT(skill_name, version) DO UPDATE SET
            framework_version = excluded.framework_version;
    "
    inserted=$((inserted + 1))
done

echo "Synced $inserted skill version(s) to $DB_PATH"
