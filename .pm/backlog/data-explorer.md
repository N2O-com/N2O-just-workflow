# Extend Ontology Explorer into a Data Explorer
> Add PostgreSQL/Supabase schema support, adversarial data generation, and production data browsing to the existing ontology view.
>
> **Note**: Dashboard and platform code now live in the [NOS repo](https://github.com/N2O-com/NOS). File paths below reference the NOS repo structure.

## Goals

1. **Multi-schema visualization.** The ontology explorer currently only understands GraphQL introspection. Extend it to also consume PostgreSQL/Supabase schemas via an adapter pattern, so the same graph/list/detail UI works for both.

2. **Reduce schema mistakes.** Make it easy to explore relationships, constraints, foreign keys, RLS policies, and indexes visually. Catch structural problems before they're buried under application code.

3. **Prove the model under pressure.** Generate adversarial data targeting boundary conditions, impossible states, and edge cases. If the schema survives, it's ready.

4. **Build shared understanding.** Anyone should be able to click around and understand how the data connects, what the constraints are, and what states an entity can be in.

## Recent Changes

| Date | Change |
|------|--------|
| 2026-03-07 | Step Zero complete: `ontology-refactor` sprint landed (937d9c2). page.tsx decomposed from 1,280→266 lines into 7 modules. SchemaAdapter interface defined, GraphQL adapter implemented. Health-status extracted. All Playwright baselines pass. |
| 2026-03-07 | Step Zero sprint created: `ontology-refactor` (5 tasks, ~135 min). Spec at `.pm/todo/ontology-refactor/01-decompose-page.md`. |
| 2026-03-07 | Initial port from Mast project backlog, adapted to actual N2O ontology code structure. |

## Current State

The ontology explorer lives at `dashboard/src/app/ontology/` (refactored in Step Zero):

| File | Lines | What it does |
|------|-------|-------------|
| `page.tsx` | 266 | Thin composition shell: state, data fetching, wiring components |
| `ontology-canvas.ts` | 344 | Pure module: canvas rendering callbacks factory, colors, types |
| `category-sidebar.tsx` | 126 | Left sidebar: category groups, search, collapse |
| `detail-panel.tsx` | 301 | Right panel: properties, linked types, recent records |
| `type-card-grid.tsx` | 94 | Card grid list view |
| `schema-adapter.ts` | 44 | `SchemaAdapter` interface + types (`CategoryConfigEntry`, `EntityColumnsConfig`) |
| `graphql-adapter.ts` | 157 | GraphQL adapter: CATEGORY_CONFIG, TYPE_CATEGORY_MAP, ENTITY_QUERIES, INTROSPECTION_QUERY |
| `health-status.ts` | ~60 | N2O-specific health model: `getHealthStatus`, `STREAM_ENTITY_MAP`, `TOLERANCE` |
| `schema-parser.ts` | 172 | GraphQL introspection -> `GraphNode[]` + `GraphEdge[]`, edge aggregation |
| `__tests__/schema-parser.test.ts` | 427 | 32 tests covering parser, health status, adapter, and edge aggregation |

**What already works well and is largely reusable as-is:**
- Force-directed graph with custom rectangular canvas nodes, category colors, health dots
- Category sidebar with collapsible groups, counts, click-to-filter
- Search filtering across both sidebar and graph
- List/graph toggle with card grid view
- Resizable right detail panel: fields with scalar/relation badges, linked types, recent records table
- Edge aggregation with hover-expand field labels
- Node dimming for non-neighbors on hover
- Drag-to-pin nodes, zoom controls, fit-to-view
- `GraphNode` / `GraphEdge` / `GraphData` types in `schema-parser.ts` — these are already the right universal shape

The rendering core (canvas painters, interaction handlers, layout) doesn't need to change. The work is making the **configuration** injectable instead of hardcoded.

**What needs to become injectable (currently hardcoded to N2O):**
- `TYPE_CATEGORY_MAP` (lines 117-142) — static mapping of 30+ N2O type names to categories. Adapters should provide their own category assignment.
- `CATEGORY_CONFIG` (lines 104-115) — category labels, colors, icons. Should be adapter-provided or merged with adapter categories.
- `ENTITY_QUERIES` (lines 184-191) — hardcoded GraphQL queries for 6 specific N2O types. Adapters should provide their own sample-data fetching.
- `INTROSPECTION_QUERY` (lines 40-69) — GraphQL-specific. Moves into the GraphQL adapter.
- `STREAM_ENTITY_MAP` + health polling (lines 73-79, 276-278) — N2O-specific health model. Should be pulled to a separate concern, not part of the adapter interface.

**What should be extracted into separate components (page.tsx is 1,280 lines):**
- Category sidebar (~90 lines of JSX, lines 741-828)
- Detail panel (~240 lines of JSX, lines 1031-1275)
- Canvas rendering callbacks (~180 lines, lines 456-620)
- The page becomes a thin shell wiring adapter + components together

## What Changes

### Step Zero: Refactor monolithic page.tsx into composable components (own sprint)

This is a prerequisite for everything else and will be executed as its own sprint via `/pm-agent`. The goal is **not** to change any user-visible behavior — just decompose the 1,280-line monolith and make the hardcoded N2O config injectable.

**Decompose `page.tsx` into focused components:**
- `category-sidebar.tsx` — category groups, collapsible sections, click-to-filter. Accepts `CategoryConfig` and nodes as props instead of reading from module-level constants.
- `detail-panel.tsx` — resizable right panel with fields, linked types, recent records. Accepts selected node + optional sample records as props.
- `ontology-canvas.ts` — canvas rendering callbacks (node painter, link painter, hit areas, pointer area). Accepts colors/category config as parameters.
- `page.tsx` remains as the shell: data fetching, state, wiring components together.

**Make config injectable:**
- `TYPE_CATEGORY_MAP` and `CATEGORY_CONFIG` become props/context rather than module constants. The GraphQL adapter provides the N2O-specific mappings; a future Postgres adapter provides its own.
- `ENTITY_QUERIES` becomes an adapter concern — the detail panel just receives sample records, it doesn't know how they were fetched.
- `INTROSPECTION_QUERY` moves into the GraphQL adapter module.

**Separate health status from schema parsing:**
- `getHealthStatus` + `STREAM_ENTITY_MAP` + `TOLERANCE` move out of `schema-parser.ts` into their own module (e.g., `health-status.ts`). This is N2O-specific telemetry, not part of the schema adapter contract.
- `schema-parser.ts` keeps `parseSchemaToGraph`, `aggregateEdges`, `resolveFieldTypeName`, and the core types (`GraphNode`, `GraphEdge`, `GraphData`).

**Define `SchemaAdapter` interface** (lightweight — not over-engineered):
- `fetchSchema(): Promise<GraphData>` — returns `GraphNode[]` + `GraphEdge[]`
- `getCategories(): CategoryConfig` — category groupings for sidebar
- `getSampleRecords?(typeName: string): Promise<Record<string, unknown>[]>` — optional

The existing GraphQL path becomes the first adapter. Existing behavior unchanged.

**After Step Zero lands**, update this spec's Recent Changes table to mark it complete and remove it from sequencing.

### View 1: Ontology Graph (existing, extended)

The existing force-directed graph, extended to also support PostgreSQL schemas:
- Tables/types as nodes, foreign keys/relationships as edges
- Category colors, health indicators, search, zoom, drag-to-pin (all existing)
- Click a node -> detail panel extended with constraints, RLS policies, indexes (new for Postgres)

### View 2: Scenario/Demo View (new)

A focused view showing specific entities and their edge cases:
- State machine visualization for status/state columns (auto-detected from CHECK constraints or enum values)
- Clickable transitions showing what triggers each state change
- Annotations showing what adversarial data tests each scenario

### View 3: Table View (new)

Browsable data tables with a toggle between datasets:
- **Tab: Adversarial data** — generated rows with annotations explaining what each tests
- **Tab: Production data** — live read-only connection to project database
- **Tab: All data** — combined view

## Component 1: The Explorer (visualization)

Interactive visualization consuming schema + data from any adapter.

**Core capabilities:**
- Force-directed entity graph (reuse existing canvas rendering)
- Click-to-expand detail panel (extend with constraints, access policies, indexes, sample records)
- State machine extraction from status/state columns with CHECK constraints or enum values
- Data browser with toggle tabs (adversarial / production / all)
- Schema-agnostic via adapter interface

## Component 2: The Adversarial Seed Agent

Separate tool that reads a schema and generates hostile test data.

**Layer 1: Rule-based generator (deterministic)**
- Boundary values: min/max for every constraint
- Every state permutation: one record per enum/CHECK value
- Null/empty boundaries: nullable fields at null, text empty vs null
- Type extremes: max-length strings, epoch timestamps, far-future dates
- Referential stress: cascade scenarios, orphaned references

**Layer 2: LLM augmentation (two roles)**
- **Readability pass**: human-readable data with annotations explaining what each row tests
- **Reasoning agent**: reads schema + business context, identifies semantic edge cases the rules engine can't find

**Output**: Adversarial dataset + findings report. Dataset browsable in the Explorer's table view.

**Production data** (when available):
- Live read-only connection to project database
- Spot anomalies: records that don't match expected patterns
- Coverage gaps: states in schema but never in production

## Design Decisions

1. **Two schema adapters**: PostgreSQL/Supabase and GraphQL. Not "universal" — just the two data sources we actually use.
2. **Lives in the existing dashboard** at `/ontology` (extended, not a separate page). The page gains adapter selection but defaults to GraphQL for this project.
3. **PII tradeoff accepted.** Dashboard connects to project databases with read-only access. Data is viewed locally by the project owner.
4. **Dashboard AI can interact with (read/query) the data explorer but cannot mutate data.** Read-only interaction.

## Sequencing

1. ~~**Step Zero**: Refactor `page.tsx` into composable components + adapter interface~~ **DONE** (937d9c2)
2. **Explorer v1**: PostgreSQL adapter + ontology graph + extended detail panel
3. **Explorer v2**: State machine view + scenario/demo view
4. **Adversarial Seed Agent v1**: Rule-based generator + LLM readability (separate spec recommended)
5. **Adversarial Seed Agent v2**: LLM reasoning agent for semantic edge cases
6. **Production data**: Live read-only connection + anomaly detection

## Open Questions

1. ~~Should the ontology view and data explorer be one merged page or two pages?~~ One page with adapter selection — avoids duplicating the graph/detail-panel/sidebar shell.
2. For state machine auto-detection: rely purely on CHECK constraints, or allow explicit configuration for complex lifecycles?
3. Adversarial agent: should it attempt to INSERT and report what the database rejects, or generate data as a plan first?
4. How should the dashboard AI's read-only interaction with the explorer work? Natural language queries against the schema/data?
5. PostgreSQL adapter: connect via Supabase management API, direct connection string, or parse SQL migration files?
