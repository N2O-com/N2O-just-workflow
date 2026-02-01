#!/bin/bash
# Commit changes for a task and record the commit hash in tasks.db
#
# Usage: ./scripts/git/commit-task.sh <sprint> <task_num>
# Example: ./scripts/git/commit-task.sh auth-sprint 5
#
# This script:
# 1. Looks up the task title from tasks.db
# 2. Creates a conventional commit with the task reference
# 3. Records the commit hash back in tasks.db
#
# Prerequisites:
# - Files must be staged (git add) before running
# - Task must exist in .pm/tasks.db

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check arguments
if [ $# -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 <sprint> <task_num>"
    echo "Example: $0 auth-sprint 5"
    exit 1
fi

SPRINT="$1"
TASK_NUM="$2"
DB_PATH=".pm/tasks.db"

# Check database exists
if [ ! -f "$DB_PATH" ]; then
    echo -e "${RED}Error: Database not found at $DB_PATH${NC}"
    echo "Initialize with: sqlite3 $DB_PATH < .pm/schema.sql"
    exit 1
fi

# Check for staged changes
if git diff --cached --quiet; then
    echo -e "${RED}Error: No staged changes to commit${NC}"
    echo "Stage your changes first: git add <files>"
    exit 1
fi

# Look up task title
TASK_TITLE=$(sqlite3 "$DB_PATH" "SELECT title FROM tasks WHERE sprint = '$SPRINT' AND task_num = $TASK_NUM;")

if [ -z "$TASK_TITLE" ]; then
    echo -e "${RED}Error: Task not found: sprint='$SPRINT', task_num=$TASK_NUM${NC}"
    exit 1
fi

# Look up task type for conventional commit prefix
TASK_TYPE=$(sqlite3 "$DB_PATH" "SELECT type FROM tasks WHERE sprint = '$SPRINT' AND task_num = $TASK_NUM;")

# Map task type to conventional commit prefix
case "$TASK_TYPE" in
    database)   PREFIX="feat" ;;
    actions)    PREFIX="feat" ;;
    frontend)   PREFIX="feat" ;;
    infra)      PREFIX="chore" ;;
    agent)      PREFIX="feat" ;;
    e2e)        PREFIX="test" ;;
    docs)       PREFIX="docs" ;;
    *)          PREFIX="feat" ;;
esac

# Build commit message
COMMIT_MSG="$PREFIX($SPRINT): $TASK_TITLE (Task #$TASK_NUM)"

echo -e "${YELLOW}Committing:${NC} $COMMIT_MSG"

# Create the commit
git commit -m "$COMMIT_MSG"

# Capture the commit hash
COMMIT_HASH=$(git rev-parse HEAD)

echo -e "${GREEN}Commit created:${NC} $COMMIT_HASH"

# Update tasks.db with commit hash
sqlite3 "$DB_PATH" "UPDATE tasks SET commit_hash = '$COMMIT_HASH' WHERE sprint = '$SPRINT' AND task_num = $TASK_NUM;"

echo -e "${GREEN}Updated tasks.db with commit hash${NC}"

# Show summary
echo ""
echo -e "${GREEN}Task #$TASK_NUM committed successfully${NC}"
echo "  Sprint:  $SPRINT"
echo "  Title:   $TASK_TITLE"
echo "  Commit:  $COMMIT_HASH"
