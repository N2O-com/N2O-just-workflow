# Schema Migrations Automation

**Status**: Not Started

---

## Scope

Automated, forward-only schema migrations for the N2O framework so that `n2o sync` can safely update existing `tasks.db` databases across 50+ projects (growing to 100+) without manual intervention or data loss.

**This spec covers**:
- `_migrations` tracking table in schema.sql
- Migration file format and directory structure (`.pm/migrations/`)
- `n2o migrate` CLI command (generate + apply)
- Integration with `n2o sync` (auto-apply pending migrations)
- Fresh-install awareness (mark all migrations as applied on `n2o init`)
- E2E tests for migration scenarios

**Out of scope**:
- Rollback / down migrations (forward-only by design)
- Migrating `schema-extensions.sql` changes (project-owned, user's responsibility)
- Visual migration dashboard
- Cross-database migrations (each tasks.db is independent)

---

## Design

### How it works

**Two workflows, one migration system:**

1. **New installs** (`n2o init`): Creates `tasks.db` from latest `schema.sql`. All existing migration files are recorded in `_migrations` as already applied (the schema is already at latest).

2. **Existing installs** (`n2o sync`): When schema.sql changes, instead of re-running the full schema file, `n2o sync` runs only the pending migration files in order. Each migration is recorded in `_migrations` after successful execution.

### Migration files

```
.pm/migrations/
├── 001-add-workflow-events.sql
├── 002-add-transcripts.sql
├── 003-add-priority-column.sql
└── ...
```

**Naming**: `NNN-description.sql` — zero-padded 3-digit number, hyphenated description. Numbers are globally sequential (not per-version).

**Format**: Plain SQL. Each file is a self-contained, idempotent migration:

```sql
-- Migration: 003-add-priority-column
-- Version: 1.1.0
-- Description: Add priority and horizon columns to tasks table

ALTER TABLE tasks ADD COLUMN priority REAL;
ALTER TABLE tasks ADD COLUMN priority_reason TEXT;
ALTER TABLE tasks ADD COLUMN horizon TEXT DEFAULT 'active'
    CHECK (horizon IS NULL OR horizon IN ('active', 'next', 'later', 'icebox'));
```

**Idempotency note**: `ALTER TABLE ADD COLUMN` fails if the column already exists. Migrations should use a guard pattern or rely on the tracking table to prevent re-execution. The tracking table approach is preferred (simpler SQL, clearer semantics).

### Tracking table

Added to `schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,        -- e.g., '001-add-workflow-events'
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    framework_version TEXT,           -- version that shipped this migration
    checksum TEXT                     -- SHA256 of migration file contents
);
```

### Auto-generation (convenience tool)

`n2o migrate --generate` produces a first-draft migration by diffing old vs new `schema.sql`:

1. Parse both schema files to extract table definitions
2. Compare columns per table (detect added/removed columns)
3. Generate `ALTER TABLE ADD COLUMN` / `ALTER TABLE DROP COLUMN` statements
4. Detect new tables → `CREATE TABLE IF NOT EXISTS`
5. Views are always safe (already use `DROP VIEW IF EXISTS` + `CREATE VIEW`)
6. Output to next-numbered file in `.pm/migrations/`
7. **Developer reviews and adjusts before committing** — auto-generation is a convenience, not a guarantee

**What auto-generation handles well:**
- Add column (with or without default)
- Drop column
- New tables
- New views / indexes
- New triggers

**What requires hand-written migrations:**
- Rename column (detected as drop + add, loses data)
- Change column type or constraints
- Data transformations (backfill values)
- Complex multi-step operations

### Version tie-in

- Migrations ship with framework versions. `003-add-priority-column.sql` might be introduced in v1.1.0.
- The migration file header contains a `-- Version:` comment for documentation.
- The `_migrations.framework_version` column records which version applied each migration.
- Projects that are multiple versions behind run all pending migrations in sequence.

### schema-extensions.sql interaction

- Migrations only modify framework-owned tables/views (defined in `schema.sql`).
- `schema-extensions.sql` is re-applied after migrations (same as current behavior).
- If an extension adds a column to a framework table and a migration also touches that table, the extension's `ALTER TABLE ADD COLUMN` will get "column already exists" errors — but since extensions should use idempotent SQL (`ALTER TABLE ADD COLUMN IF NOT EXISTS` is not standard SQLite, so extensions should handle errors gracefully or use `CREATE TABLE IF NOT EXISTS` patterns).
- **Documented guidance**: Extensions should not modify framework table structure. They should add new tables/views or add columns that don't conflict.

---

## What's Done

| Item | Status |
|------|--------|
| `_migrations` table in schema.sql | Not started |
| Migration file directory + format | Not started |
| `n2o migrate --generate` command | Not started |
| `n2o migrate --apply` command | Not started |
| `n2o sync` integration | Not started |
| `n2o init` integration | Not started |
| Manifest updates | Not started |
| E2E tests | Not started |

---

## Suggested Tasks

| # | Task | Done When |
|---|------|-----------|
| 1 | Add `_migrations` table to schema.sql, create `.pm/migrations/` directory, update manifest | `_migrations` table exists in schema, directory created, manifest includes migrations in framework_files |
| 2 | Implement `n2o migrate --apply` and integrate with `n2o sync` and `n2o init` | `n2o sync` auto-applies pending migrations; `n2o init` marks all migrations as applied; `n2o migrate --apply` works standalone |
| 3 | Implement `n2o migrate --generate` (schema diff → migration file) | Running `n2o migrate --generate` against a changed schema.sql produces a correct migration file for add/drop column and new table scenarios |
| 4 | E2E tests for migration workflows | Tests pass for: fresh init marks migrations applied, sync applies pending migrations, multi-version catch-up, generate produces correct SQL |

---

## References

- Current schema: `.pm/schema.sql`
- Current sync logic: `n2o` (lines 464-571)
- Existing test harness: `tests/test-n2o-init.sh`
- Roadmap context: `specs/active/n2o-roadmap.md` (Goal 1: Seamless Updates)
- SQLite ALTER TABLE docs: full support in 3.35+ (we're on 3.51.0)
