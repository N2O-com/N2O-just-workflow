# 006: Reusability and Cross-Project Sync

## Problem

The workflow system (skills, schema, scripts) is designed to be used across multiple projects, but there's no mechanism to:
- Set up a new project quickly (currently 15+ manual steps)
- Push framework updates to existing projects (currently manual diffing and copying)
- Separate framework files (should be overwritten on update) from project files (should never be touched)

This blocks scaling beyond a handful of projects. Every new project is an hour of setup, and improvements to the framework don't propagate.

## Recommendation: Sync Script + Init Command

N2O-just-workflows stays as the **single source of truth**. A sync script pushes updates to target projects. An init command bootstraps new projects.

```
N2O-just-workflows (this repo)
        │
        │  n2o sync --all
        │
        ├──────────────────┬──────────────────┬─────────────────
        ▼                  ▼                  ▼
   project-a/         project-b/         project-c/
   .claude/skills/    .claude/skills/    .claude/skills/
   .pm/schema.sql     .pm/schema.sql     .pm/schema.sql
   scripts/           scripts/           scripts/
```

---

## File Ownership Model

The key insight is that files fall into two categories:

| Category | Examples | On sync | On init |
|----------|----------|---------|---------|
| **Framework-owned** | Skills, schema.sql, scripts/, commit hooks | **Overwrite** — always matches latest | Copy from framework |
| **Project-owned** | `.pm/config.json`, `schema-extensions.sql`, `CLAUDE.md`, `.pm/tasks.db`, `.mcp.json` | **Never touch** | Scaffold template (user fills in) |

A manifest file declares which is which:

```json
// n2o-manifest.json (in this repo)
{
  "version": "1.0.0",
  "framework_files": [
    "skills/**",
    ".pm/schema.sql",
    "scripts/**"
  ],
  "project_files": [
    ".pm/config.json",
    ".pm/schema-extensions.sql",
    ".pm/tasks.db",
    ".wm/**",
    "CLAUDE.md",
    ".mcp.json"
  ],
  "scaffolds": {
    ".pm/config.json": "templates/config.json",
    "CLAUDE.md": "templates/CLAUDE.md"
  }
}
```

---

## Init Command

One command bootstraps a new project:

```bash
./n2o init /path/to/project
```

**What it does:**

1. Creates directory structure:
   ```
   .pm/
   .pm/todo/
   .wm/
   .claude/
   .claude/skills/
   scripts/
   scripts/git/
   ```

2. Copies framework files:
   - Skills → `.claude/skills/`
   - Schema → `.pm/schema.sql`
   - Scripts → `scripts/`

3. Initializes database:
   ```bash
   sqlite3 .pm/tasks.db < .pm/schema.sql
   ```

4. Scaffolds project files from templates:
   - `.pm/config.json` — with prompts or auto-detection for test/lint/build commands
   - `CLAUDE.md` — template with framework instructions pre-filled, project sections blank
   - `.pm/schema-extensions.sql` — empty file, ready for project-specific columns

5. Updates `.gitignore`:
   ```
   .pm/tasks.db
   .wm/
   .env.local
   ```

6. Records framework version in `.pm/config.json`:
   ```json
   {
     "n2o_version": "1.0.0",
     "test_command": "pnpm test",
     ...
   }
   ```

**Interactive mode** (optional):

```bash
./n2o init /path/to/project --interactive
# → Detects package.json, asks: "Looks like a Node project. Use pnpm? (Y/n)"
# → Asks: "Test command? [pnpm test]"
# → Asks: "Lint command? [pnpm lint]"
# → Writes answers to .pm/config.json
```

---

## Sync Command

Pushes framework updates to one or more projects:

```bash
# Sync a single project
./n2o sync /path/to/project

# Sync all registered projects
./n2o sync --all

# Dry run — show what would change
./n2o sync /path/to/project --dry-run
```

**What it does:**

1. Reads `n2o-manifest.json` to determine framework-owned files
2. For each framework file:
   - If file exists in project and differs from framework → **overwrite** (with backup to `.n2o-backup/`)
   - If file doesn't exist in project → **copy**
3. For each project-owned file:
   - **Never touch** — skip entirely
4. If schema.sql changed, prompt to run migrations:
   ```
   schema.sql has changed. Run sqlite3 .pm/tasks.db < .pm/schema.sql? (y/N)
   ```
5. Updates `n2o_version` in project's `.pm/config.json`
6. Logs what changed

**Project registry** (for `--all`):

A file in this repo tracks which projects to sync:

```json
// .n2o-projects.json (gitignored — local to your machine)
{
  "projects": [
    "/Users/wiley/projects/client-a",
    "/Users/wiley/projects/client-b",
    "/Users/wiley/monorepo/packages/app-1",
    "/Users/wiley/monorepo/packages/app-2"
  ]
}
```

Or, projects self-register during init:
```bash
./n2o init /path/to/project --register
# → Adds path to .n2o-projects.json
```

---

## Config File (`.pm/config.json`)

Each project has a config file that stores project-specific values. Skills reference this instead of hardcoding commands.

```json
{
  "n2o_version": "1.0.0",
  "project_name": "client-a",

  "commands": {
    "test": "pnpm test",
    "typecheck": "pnpm typecheck:all",
    "lint": "pnpm lint:all",
    "build": "pnpm build"
  },

  "database": {
    "type": "neon",
    "env_var": "DATABASE_URL_DEV"
  },

  "pm_tool": null,

  "team": []
}
```

**How skills use it:**

Instead of hardcoding `pnpm typecheck:all` in the tdd-agent SKILL.md:

```markdown
# Before (hardcoded)
pnpm typecheck:all

# After (config-driven)
$(jq -r '.commands.typecheck' .pm/config.json)
```

Or, the init script generates a small helper:

```bash
# scripts/n2o-config.sh (generated during init)
N2O_TEST_CMD=$(jq -r '.commands.test' .pm/config.json)
N2O_TYPECHECK_CMD=$(jq -r '.commands.typecheck' .pm/config.json)
N2O_LINT_CMD=$(jq -r '.commands.lint' .pm/config.json)
```

Skills source this file and use the variables.

---

## Schema Extensions

For projects that need custom columns or views, `schema-extensions.sql` loads after the base schema:

```sql
-- .pm/schema-extensions.sql (project-specific, never overwritten)

-- Example: consulting project needs client tracking
ALTER TABLE tasks ADD COLUMN client TEXT;

-- Example: project-specific view
CREATE VIEW IF NOT EXISTS tasks_by_client AS
SELECT client, COUNT(*) as total,
    SUM(CASE WHEN status = 'green' THEN 1 ELSE 0 END) as done
FROM tasks GROUP BY client;
```

The sync script, after updating `schema.sql`, checks if `schema-extensions.sql` exists and prompts:

```
schema.sql updated. Run schema + extensions? (y/N)
→ sqlite3 .pm/tasks.db < .pm/schema.sql
→ sqlite3 .pm/tasks.db < .pm/schema-extensions.sql
```

---

## CLAUDE.md Template

The scaffolded CLAUDE.md separates framework instructions (pre-filled) from project context (blank):

```markdown
# Project: {{project_name}}

## Framework

This project uses the N2O workflow system. See skills in `.claude/skills/` for:
- `/pm-agent` — sprint planning
- `/tdd-agent` — TDD implementation
- `/bug-workflow` — debugging

Task database: `.pm/tasks.db`
Config: `.pm/config.json`

## Project Context

<!-- Fill in project-specific information below -->

### Database
- Type:
- Connection:

### Architecture
-

### Key APIs / External Services
-

### Testing
- Test command: `{{test_command}}`
-
```

The `{{placeholders}}` get filled by the init script from config or user input.

---

## File Structure in This Repo

```
N2O-just-workflows/
├── n2o                         # Main CLI script (bash or node)
├── n2o-manifest.json           # Declares framework vs project files
├── .n2o-projects.json          # Local registry of projects (gitignored)
├── templates/
│   ├── config.json             # Template for .pm/config.json
│   ├── CLAUDE.md               # Template for project CLAUDE.md
│   └── schema-extensions.sql   # Empty template
├── skills/                     # Framework-owned
├── .pm/
│   └── schema.sql              # Framework-owned
├── scripts/                    # Framework-owned
└── changes/                    # This folder
```

---

## Alternatives Considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Sync script (this proposal)** | Simple, no git complexity, works anywhere, clear ownership model | No versioning — all projects get latest | **Recommended** — right for 5-10 projects |
| **Git submodules** | Versioned, each project pins a commit | Submodules are painful (forgotten updates, clone issues, merge confusion) | Avoid unless team already uses submodules |
| **npm package** | Semver, lockfiles, familiar workflow | Only for JS projects, files in node_modules need copy step | Overkill for internal tooling |
| **Git subtree** | No nested repos, regular git commands | Still manual per-project, merge conflicts possible | Middle ground but still complex |

If per-project version pinning becomes necessary later (e.g., a maintenance-mode project shouldn't get framework updates), add an optional `n2o_version_pinned` field to config that the sync script respects.

---

## Implementation

**Phase 1: Init script**
- Create `n2o init` command
- Create directory structure, copy files, init database
- Scaffold config and CLAUDE.md from templates
- Register project in `.n2o-projects.json`

**Phase 2: Sync script**
- Create `n2o sync` command
- Read manifest, copy framework files, skip project files
- Backup changed files before overwriting
- Update version in config

**Phase 3: Config-driven skills**
- Add `.pm/config.json` template
- Update SKILL.md files to reference config instead of hardcoded commands
- Or generate a `scripts/n2o-config.sh` helper that skills source

---

## Done When

- [ ] `n2o init /path/to/project` creates: `.pm/`, `.claude/skills/`, `scripts/`, initializes `tasks.db`, scaffolds `config.json` and `CLAUDE.md`
- [ ] `n2o sync /path/to/project` copies framework files, skips project files, backs up changed files
- [ ] `n2o sync --dry-run` shows what would change without modifying anything
- [ ] `n2o-manifest.json` correctly categorizes all files as framework or project
- [ ] `.pm/config.json` template has placeholders for test/lint/build commands
- [ ] At least one SKILL.md references config instead of hardcoded commands
- [ ] `.n2o-projects.json` is gitignored
- [ ] Verify: Init a fresh project, modify a framework file in source, sync, confirm it overwrites

## Files Affected

| File | Change |
|------|--------|
| `n2o` | New — main CLI script |
| `n2o-manifest.json` | New — declares file ownership |
| `.n2o-projects.json` | New — local project registry (gitignored) |
| `templates/` | New — scaffolding templates |
| `skills/tdd-agent/SKILL.md` | Update to reference config instead of hardcoded commands |
| `skills/pm-agent/SKILL.md` | Update to reference config |
| `.gitignore` | Add `.n2o-projects.json` |
