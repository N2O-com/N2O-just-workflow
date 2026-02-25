# Manual Test Plan: SessionEnd Hook + Concurrent Sessions

## Setup

```bash
# Create a scratch directory for testing (keeps your real project clean)
SCRATCH=$(mktemp -d)
echo "Testing in: $SCRATCH"
```

---

## Test 1: `n2o init` creates `developer_context` table

Verifies that fresh projects get the table from `schema.sql`.

```bash
./n2o init "$SCRATCH"
sqlite3 "$SCRATCH/.pm/tasks.db" ".schema developer_context"
```

**Expect:** Full CREATE TABLE statement with `developer`, `concurrent_sessions`, `hour_of_day`, and the CHECK constraints. If you see nothing, the table wasn't created.

---

## Test 2: `n2o init` registers SessionEnd hook

Verifies that `register_session_hook()` writes the right entry.

```bash
cat "$SCRATCH/.claude/settings.json"
```

**Expect:** JSON with both `SessionStart` and `SessionEnd` keys. The `SessionEnd` entry should look like:

```json
"SessionEnd": [
  {
    "matcher": "",
    "hooks": [
      {
        "type": "command",
        "command": "bash \"$CLAUDE_PROJECT_DIR/scripts/collect-transcripts.sh\" --quiet",
        "timeout": 30
      }
    ]
  }
]
```

**If SessionEnd is missing but SessionStart is present:** The merge logic in `register_session_hook()` has a bug.

---

## Test 3: Session hook persists concurrent sessions to DB

Verifies the INSERT fires and writes valid data.

```bash
# Fire the hook manually (simulates what Claude Code does on startup)
cd "$SCRATCH"
echo '{"source":"startup","cwd":"'"$SCRATCH"'"}' | bash scripts/n2o-session-hook.sh

# Check the database
sqlite3 .pm/tasks.db "SELECT developer, concurrent_sessions, hour_of_day, recorded_at FROM developer_context;"
```

**Expect:** One row with:
- `developer` = your `git config user.name` (or "unknown")
- `concurrent_sessions` >= 1
- `hour_of_day` = current hour (0-23)
- `recorded_at` = roughly now

**Edge case — quotes in name:**

```bash
# Temporarily fake a name with a quote
git config user.name "Test O'Brien"
echo '{"source":"startup","cwd":"'"$SCRATCH"'"}' | bash scripts/n2o-session-hook.sh
sqlite3 .pm/tasks.db "SELECT developer FROM developer_context ORDER BY id DESC LIMIT 1;"
# Restore your name
git config user.name "<your real name>"
```

**Expect:** `Test O'Brien` — not a SQL error.

---

## Test 4: Hook idempotency (no duplication on re-init)

Verifies that running init again doesn't duplicate the hook entries.

```bash
./n2o init "$SCRATCH" 2>&1
# Count how many SessionEnd entries exist
jq '.hooks.SessionEnd | length' "$SCRATCH/.claude/settings.json"
```

**Expect:** `1` (not 2).

---

## Test 5: SessionEnd hook actually fires on session end

This is the real integration test — does Claude Code call `collect-transcripts.sh` when a session ends?

```bash
# 1. Start a Claude Code session in the scratch project
cd "$SCRATCH"
claude

# 2. Inside the session, do something minimal (e.g., type "hello" and get a response)
#    This creates a JSONL transcript in ~/.claude/projects/

# 3. Exit the session (Ctrl+D or type /exit)

# 4. Check if transcripts were collected
sqlite3 .pm/tasks.db "SELECT COUNT(*) FROM transcripts;"
```

**Expect:** >= 1 transcript row. If 0, the SessionEnd hook didn't fire or `collect-transcripts.sh` couldn't find the JSONL files.

**Debugging if it's 0:**

```bash
# Check if the JSONL file exists
ENCODED=$(echo "$SCRATCH" | sed 's|/|-|g; s|^-||')
ls -la ~/.claude/projects/-${ENCODED}/*.jsonl 2>/dev/null

# Run collection manually to see if it's a hook-firing issue vs a collection issue
bash scripts/collect-transcripts.sh --verbose
```

---

## Test 6: This repo's own `.claude/settings.json`

Verifies the hook is live for your actual development workflow (not just new projects).

```bash
cd /Users/wileysimonds/Documents/GitHub/N2O-just-workflow
jq '.hooks.SessionEnd' .claude/settings.json
```

**Expect:** The SessionEnd array with `collect-transcripts.sh`. This means your own sessions in this repo will auto-collect transcripts going forward.

---

## Test 7: Existing projects with old `Stop` hook (upgrade path)

Simulates what happens when `n2o sync` hits a project that was initialized with the old code.

```bash
# Create a project with a legacy Stop hook
LEGACY=$(mktemp -d)
./n2o init "$LEGACY"
# Manually inject an old-style Stop hook
jq '.hooks.Stop = [{"matcher":"","hooks":[{"type":"command","command":"bash scripts/collect-transcripts.sh --quiet"}]}]' \
  "$LEGACY/.claude/settings.json" > /tmp/legacy.json && mv /tmp/legacy.json "$LEGACY/.claude/settings.json"

# Now sync — does it add SessionEnd alongside Stop?
./n2o sync "$LEGACY"
jq '.hooks | keys' "$LEGACY/.claude/settings.json"
```

**Expect:** Keys include both `SessionEnd` and `Stop`. The sync adds SessionEnd but doesn't remove Stop. This is the "stale hook" tradeoff — both will run `collect-transcripts.sh`, which is harmless (idempotent) but redundant.

```bash
rm -rf "$LEGACY"
```

---

## Cleanup

```bash
rm -rf "$SCRATCH"
```

---

## Quick reference: what "broken" looks like

| Symptom | Likely cause |
|---------|-------------|
| No `developer_context` table after init | `schema.sql` change not picked up — check the table is before `_migrations` |
| No `SessionEnd` in settings.json after init | `register_session_hook()` still referencing `Stop` |
| SQL error when developer name has `'` | Quote escaping (`safe_dev`) not working |
| `concurrent_sessions` always 1 | `pgrep` not finding claude processes (expected in test — only real sessions bump it) |
| Transcripts not collected on session end | SessionEnd hook not firing — check `claude --version` supports SessionEnd hooks |
