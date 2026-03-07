# Explorer v1: PostgreSQL Adapter + Extended Detail Panel

> Add a PostgreSQL schema adapter that parses SQL files, extend the detail panel with constraints/indexes/RLS policies, and add an adapter selector to the ontology page.

| Field | Value |
|-------|-------|
| Status | Draft |
| Owner | wiley |
| Last Updated | 2026-03-07 |
| Depends On | `ontology-refactor` sprint (complete) |
| Enables | Explorer v2 (state machines), Adversarial Seed Agent |

---

## Recent Changes

| Date | What changed | Section |
|------|-------------|---------|
| 2026-03-07 | Initial spec | All |

---

## Goal

The ontology explorer currently only understands GraphQL introspection. We want to also visualize PostgreSQL schemas — tables, columns, foreign keys, constraints, indexes, and RLS policies — using the same graph/list/detail UI. This lets anyone click around and understand how a database connects, what the constraints are, and what states entities can be in.

---

## Success Criteria

- PostgreSQL schema parsed from `.sql` files renders in the same force-directed graph as GraphQL types
- Detail panel shows constraints (PK, FK, UNIQUE, CHECK, NOT NULL), indexes, and column defaults
- Adapter selector in the header lets you toggle between GraphQL and SQL views
- All existing GraphQL functionality unchanged (regression-free)
- Schema parser tests cover SQL parsing edge cases

---

## Prior Art

- **Supabase Studio**: Best-in-class RLS policy visualization. Dedicated policies page with per-table rules. We'll show RLS inline in the detail panel rather than a separate page.
- **DBeaver**: Multi-tab detail panel (Constraints, Columns, Indexes, Foreign Keys). Comprehensive but cluttered. We'll use expandable sections instead of tabs.
- **dbdiagram.io**: Uses DBML DSL for quick schema prototyping. Shows tables as nodes with FK lines. We already have a richer graph renderer.

---

## Current State

- SchemaAdapter interface defined (`schema-adapter.ts`) with `getCategoryConfig`, `getCategoryForType`, `getEntityColumns`
- GraphQL adapter fully implemented (`graphql-adapter.ts`) — INTROSPECTION_QUERY, CATEGORY_CONFIG, TYPE_CATEGORY_MAP, ENTITY_QUERIES
- Schema parser (`schema-parser.ts`) converts `IntrospectionType[]` to generic `GraphNode[]` + `GraphEdge[]`
- Detail panel shows: properties (scalar/relation badges), linked types, recent records table
- Detail panel does NOT show: constraints, indexes, RLS policies, column defaults, NOT NULL indicators
- `EntityColumnsConfig.query` is typed as `DocumentNode` (GraphQL-specific) — needs to be made polymorphic

---

## Ideal State

The ontology page becomes a universal schema explorer. You point it at any data source — GraphQL API, SQL migration files, live Postgres connection — and get the same interactive graph with full metadata. The detail panel shows everything relevant: columns with types and nullability, constraints with expressions, indexes with their columns and types, RLS policies with their SQL expressions. You can search, filter by category, and click through relationships regardless of the data source.

---

## Design

**Trade-offs from ideal**: No live database connection in v1 — we parse SQL files only. No RLS policy editing. No cross-adapter comparison view.

**This spec covers**:
- SQL file parser that extracts tables, columns, foreign keys, constraints, indexes, RLS policies
- PostgreSQL adapter implementing SchemaAdapter
- Extended detail panel with constraint/index/RLS sections
- Adapter selector UI in the header bar
- Making `EntityColumnsConfig` polymorphic (not GraphQL-only)

**Out of scope**:
- Live database connections (future: Explorer v2 or separate spec)
- State machine visualization (Explorer v2)
- Adversarial data generation (separate spec)
- Data browsing / sample records for SQL (no query execution in v1)

### SQL Parser

Parse SQL `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, and RLS policy statements from `.sql` files. Output the same `IntrospectionType[]` structure the graph parser expects, enriched with PostgreSQL-specific metadata.

**What to parse**:
- `CREATE TABLE` — table name, columns (name, type, NOT NULL, DEFAULT, inline constraints)
- `FOREIGN KEY` — inline and ALTER TABLE variants
- `PRIMARY KEY` — inline and table-level
- `UNIQUE` — inline and table-level
- `CHECK` — constraint expressions
- `CREATE INDEX` — index name, columns, type (btree/gin/gist), unique flag
- `CREATE POLICY` — policy name, table, command (SELECT/INSERT/UPDATE/DELETE), USING/WITH CHECK expressions
- `ENABLE ROW LEVEL SECURITY` — track which tables have RLS enabled

**What to skip (v1)**:
- `CREATE VIEW`, `CREATE FUNCTION`, triggers, sequences, custom types
- Partitioning, inheritance, EXCLUDE constraints
- Comment annotations (`COMMENT ON`)

**Output enrichment**: Each `GraphNode` gains optional `pgMetadata`:

```typescript
interface PgTableMetadata {
  constraints: PgConstraint[];
  indexes: PgIndex[];
  rlsPolicies: PgRlsPolicy[];
  rlsEnabled: boolean;
}

interface PgConstraint {
  name: string | null;
  type: "PRIMARY KEY" | "FOREIGN KEY" | "UNIQUE" | "CHECK" | "NOT NULL";
  columns: string[];
  expression?: string;        // CHECK expression
  references?: { table: string; columns: string[] };  // FK target
}

interface PgIndex {
  name: string;
  columns: string[];
  unique: boolean;
  type?: string;              // btree, gin, gist, etc.
}

interface PgRlsPolicy {
  name: string;
  command: string;            // SELECT, INSERT, UPDATE, DELETE, ALL
  using?: string;             // USING expression
  withCheck?: string;         // WITH CHECK expression
}
```

### SchemaAdapter Changes

Make `EntityColumnsConfig` polymorphic so it's not locked to GraphQL:

```typescript
// Before (GraphQL-only):
interface EntityColumnsConfig {
  query: DocumentNode;
  field: string;
  columns: string[];
}

// After (adapter-agnostic):
interface EntityColumnsConfig {
  query: DocumentNode | string;  // GraphQL DocumentNode or SQL string
  field: string;
  columns: string[];
}
```

In v1, the PostgreSQL adapter returns `undefined` for `getEntityColumns()` since we don't execute SQL queries. The type change is forward-looking.

### PostgreSQL Adapter

New file `postgresql-adapter.ts`:
- `parseSqlSchema(sql: string): IntrospectionType[]` — the SQL parser
- `postgresqlAdapter` implementing SchemaAdapter
- Category assignment: tables grouped by naming convention (e.g., `task_*` tables in one category) or all under a single "Tables" category for v1
- Category config with appropriate icons (Table2, Key, Shield for RLS)

### Extended Detail Panel

Add three new expandable sections to `detail-panel.tsx` when `pgMetadata` is present:

1. **Constraints** — list PK, FK, UNIQUE, CHECK with their columns and expressions. FK entries are clickable (navigate to referenced table).
2. **Indexes** — list indexes with columns, type, unique flag.
3. **RLS Policies** — list policies with command type and USING/WITH CHECK expressions in a monospace code block.

These sections only render when the selected node has `pgMetadata` (i.e., came from the PostgreSQL adapter). GraphQL nodes look exactly the same as before.

### Adapter Selector

Add a small dropdown or toggle in the header bar (next to the list/graph view toggle) that shows the current adapter name and lets you switch. In v1, the options are "GraphQL" and any loaded SQL file.

**Data flow**: When the user selects "SQL", the page reads the SQL file content (provided via a text input or file picker in v1), parses it with `parseSqlSchema()`, and feeds the result through the existing `parseSchemaToGraph()` pipeline. The GraphQL data fetching (`useQuery`) is skipped when the SQL adapter is active.

---

## Schema

```typescript
// New types in schema-parser.ts or a new pg-types.ts

interface PgTableMetadata {
  constraints: PgConstraint[];
  indexes: PgIndex[];
  rlsPolicies: PgRlsPolicy[];
  rlsEnabled: boolean;
}

interface PgConstraint {
  name: string | null;
  type: "PRIMARY KEY" | "FOREIGN KEY" | "UNIQUE" | "CHECK" | "NOT NULL";
  columns: string[];
  expression?: string;
  references?: { table: string; columns: string[] };
}

interface PgIndex {
  name: string;
  columns: string[];
  unique: boolean;
  type?: string;
}

interface PgRlsPolicy {
  name: string;
  command: string;
  using?: string;
  withCheck?: string;
}

// GraphNode extended
interface GraphNode {
  // ... existing fields
  pgMetadata?: PgTableMetadata;
}
```

---

## Implementation Plan

### Task 1: Build SQL schema parser with tests (1 → 2 → 3)

**New file**: `dashboard/src/app/ontology/sql-parser.ts`

**What to build**:
- `parseSqlSchema(sql: string): { types: IntrospectionType[]; metadata: Map<string, PgTableMetadata> }` — regex-based parser that extracts:
  - `CREATE TABLE name (...)` — table name, column definitions (name, type, NOT NULL, DEFAULT, inline PK/UNIQUE/CHECK/REFERENCES)
  - Table-level `PRIMARY KEY (...)`, `UNIQUE (...)`, `CHECK (...)`, `FOREIGN KEY (...) REFERENCES ...`
  - `CREATE INDEX [UNIQUE] name ON table (cols)` — with optional `USING method`
  - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
  - `CREATE POLICY name ON table [FOR command] USING (...) [WITH CHECK (...)]`
- Output `IntrospectionType[]` in the same shape `parseSchemaToGraph()` expects (kind="OBJECT", fields with type refs). Foreign key targets become edges.
- Output `PgTableMetadata` map keyed by table name with constraints, indexes, RLS policies.

**New file**: `dashboard/src/app/ontology/pg-types.ts` — TypeScript interfaces for `PgTableMetadata`, `PgConstraint`, `PgIndex`, `PgRlsPolicy`.

**New file**: `dashboard/src/app/ontology/__tests__/sql-parser.test.ts`

**Test against real SQL**: Use `.pm/schema.sql` content (SQLite-flavored but structurally similar) and `scripts/coordination/supabase-schema.sql` (actual PostgreSQL) as fixture data. Also write synthetic SQL strings for edge cases.

**Tests must cover**:
- Simple `CREATE TABLE` with columns and types
- Inline `NOT NULL`, `DEFAULT`, `PRIMARY KEY`, `UNIQUE`, `REFERENCES`
- Table-level `PRIMARY KEY (col1, col2)` (composite keys — `.pm/schema.sql` uses these)
- Table-level `FOREIGN KEY (...) REFERENCES table(cols)`
- Table-level `CHECK (expression)` with IN clauses, IS NULL OR expressions
- `CREATE INDEX` with UNIQUE flag and USING clause
- `CREATE POLICY` with FOR command, USING, WITH CHECK
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- Multi-table SQL (multiple CREATE TABLE statements in one string)
- Edge generation: FK columns should produce edges in the IntrospectionType output
- Tables with zero foreign keys (no edges, but still nodes)
- Column types mapped to IntrospectionTypeRef format (TEXT→String-like SCALAR, INTEGER→Int-like SCALAR, BOOLEAN→Boolean-like SCALAR, etc.)

**Modify**: `dashboard/src/app/ontology/schema-parser.ts` — add optional `pgMetadata?: PgTableMetadata` to `GraphNode` interface.

**Done when**: `parseSqlSchema()` correctly parses both `.pm/schema.sql` and `supabase-schema.sql`, all unit tests pass, `GraphNode` type extended with optional `pgMetadata`.

---

### Task 2: Create PostgreSQL adapter + extend detail panel + adapter selector

**Depends on**: Task 1 (needs `parseSqlSchema()` and `PgTableMetadata` types)

**New file**: `dashboard/src/app/ontology/postgresql-adapter.ts`
- Implements `SchemaAdapter` interface
- `getCategoryConfig()` — single "Tables" category for v1 (icon: `Table2` from lucide-react, color: teal or similar)
- `getCategoryForType()` — returns "tables" for all types in v1
- `getEntityColumns()` — returns `undefined` (no SQL query execution in v1)

**Modify**: `dashboard/src/app/ontology/schema-adapter.ts`
- Change `EntityColumnsConfig.query` type from `DocumentNode` to `DocumentNode | string`
- This lets GraphQL adapter continue using `DocumentNode` while future SQL adapters can use SQL strings

**Modify**: `dashboard/src/app/ontology/detail-panel.tsx`
- Import `PgTableMetadata` types from `pg-types.ts`
- Accept `pgMetadata` from the selected node (access via `selectedNode.pgMetadata`)
- Add three new expandable sections (only render when `pgMetadata` is present):
  1. **Constraints** section: List each constraint with type badge (PK/FK/UNIQUE/CHECK/NOT NULL), columns, expression if CHECK, clickable FK references (navigate to target table via `onSelectNode`)
  2. **Indexes** section: List each index with name, columns, type (btree/gin/etc), unique badge
  3. **RLS Policies** section: Policy name, command badge (SELECT/INSERT/etc), USING and WITH CHECK expressions in `font-mono` code blocks
- Style: Use existing Palantir dark theme. Constraint type badges similar to existing scalar/relation badges. Section headers use existing uppercase tracking-wide pattern.

**Modify**: `dashboard/src/app/ontology/page.tsx`
- Add `activeAdapter` state: `useState<"graphql" | "sql">("graphql")`
- Add `sqlContent` state: `useState<string>("")` for pasted SQL
- When `activeAdapter === "sql"`: call `parseSqlSchema(sqlContent)`, feed results through `parseSchemaToGraph()`, skip GraphQL `useQuery` calls
- When `activeAdapter === "graphql"`: existing behavior unchanged
- Pass `pgMetadata` through to detail panel (enrich nodes with metadata from parser output)
- Add adapter selector in header bar: small dropdown next to list/graph toggle showing "GraphQL" / "SQL". When "SQL" selected, show a textarea modal or inline input to paste SQL content.

**Modify**: `dashboard/src/app/ontology/ontology-canvas.ts`
- Update `EnrichedNode` type to include optional `pgMetadata` (inherits from `GraphNode`)

**Done when**: Pasting SQL into the input and selecting "SQL" adapter renders the schema as a force graph with correct nodes/edges. Clicking a table node opens the detail panel with constraints, indexes, and RLS policies displayed. Switching back to "GraphQL" shows the original view unchanged.

---

### Task 3: Visual regression verification

**Depends on**: Task 2

**Modify**: `dashboard/e2e/ontology-baseline.spec.ts` (or new file)
- Add Playwright test that loads the ontology page with SQL adapter active (paste `.pm/schema.sql` content)
- Screenshot: SQL graph view showing table nodes with FK edges
- Screenshot: SQL detail panel open on a table with constraints/indexes visible
- Re-run existing 4 GraphQL baseline screenshots to confirm no regression
- All 32 existing unit tests (schema-parser, health-status, adapter) still pass

**Done when**: All Playwright screenshots captured and visually verified. All existing tests pass. User confirms visual parity for GraphQL mode and acceptable appearance for SQL mode.

---

## Open Questions

1. ~~Should the PostgreSQL adapter parse SQL files or connect to a live database?~~ **Resolved**: Parse SQL files in v1. Live connections are a future enhancement.
2. How should users provide SQL files? Paste into a text area, file picker, or hardcoded path?
3. Should the SQL parser handle multi-file schemas (schema.sql + migrations)?
4. ~~Should we show views and functions in the graph?~~ **Resolved**: Tables only in v1. Views/functions deferred.

---

## References

- Parent spec: `.pm/backlog/data-explorer.md`
- Predecessor sprint: `.pm/todo/ontology-refactor/01-decompose-page.md` (complete)
- Test SQL files: `.pm/schema.sql`, `scripts/coordination/supabase-schema.sql`
- Adapter interface: `dashboard/src/app/ontology/schema-adapter.ts`
