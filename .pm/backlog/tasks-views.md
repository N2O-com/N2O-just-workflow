# Add Views to Capacity Planner Sidebar
> Add a Views selector to the capacity sidebar with two presets: the current pipeline view (stage → client → project) and a new timeline view that shows all non-past projects sorted by nearest deadline.
>
> **Note**: Dashboard code now lives in the [NOS repo](https://github.com/N2O-com/NOS). File paths below reference the NOS repo structure.

## Recent Changes

| Rev | Change |
|---|---|
| v3 | Corrected: this is the capacity page, not tasks page. Two views, both hide past projects. Views icon takes the current group icon (stacked layers), group gets a new icon. |
| v2 | Clarified sort order and that all projects show. |

## Current State

The capacity sidebar (`project-sidebar.tsx`) has a **PROJECTS** header with two icon buttons:

| Button | Icon | What it does |
|---|---|---|
| **Group & Sort** | Stacked layers (custom SVG) | Dropdown with drag-reorder of stage/client/project dims, per-dim sort, checkboxes |
| **Filter** | Funnel (custom SVG) | Dropdown to filter by tier (active, pipeline, speculative, internal) or by client |

Default grouping: **stage → client → project**, with `past-clients` stage hidden via stage chips. Projects sort by timeline within each group (active ending soonest first, then future starting soonest).

Stage chips below the header let you toggle visibility of each pipeline stage (Active, Prosp., Past, Int.) and drag to reorder.

**Key defaults** (`capacity-utils.ts`):
- `DEFAULT_GROUP_ORDER: ["stage", "client", "project"]`
- `DEFAULT_GROUP_ENABLED: { stage: true, client: true, project: true }`
- `DEFAULT_STAGE_VISIBLE: { "active-clients": true, prospective: true, "past-clients": false, internal: true }`
- `DEFAULT_GROUP_SORT: { stage: "default", client: "timeline", project: "timeline" }`

## What Changes

### 1. Views selector

Add a **Views** button to the sidebar header (between "PROJECTS" label and the existing group/filter buttons).

- **Icon**: The stacked layers icon currently used by the Group & Sort button — it becomes the Views icon
- Clicking opens a dropdown listing the two preset views
- Active view is highlighted

### 2. Group icon swap

The Group & Sort button loses its stacked layers icon and gets a new one. Use `Rows3` from lucide-react (three horizontal stacked lines — represents row grouping). The dropdown behavior is unchanged.

### 3. Two built-in views

| View | Grouping | Stage visibility | Sort | Description |
|---|---|---|---|---|
| **Pipeline** (default) | Stage → Client → Project | Past hidden, rest visible | Stage: default, Client: timeline, Project: timeline | Current behavior — unchanged |
| **Timeline** | Flat project list (no stage/client grouping) | Past hidden | Timeline (ongoing by soonest end, upcoming by soonest start) | All non-past projects in one sorted list |

Both views hide past projects. The difference is structure:
- **Pipeline** groups by stage → client → project hierarchy (the current default)
- **Timeline** collapses the hierarchy into a flat list sorted purely by delivery urgency — ongoing projects ending soonest at top, then upcoming projects starting soonest

### 4. What "Timeline" view does mechanically

When the user selects the Timeline view:
- Set `groupEnabled` to `{ stage: false, client: false, project: true }` (only project leaf, no nesting)
- Set `stageVisible["past-clients"]` to `false`
- Set `groupSort.project` to `"timeline"`
- The sidebar renders Case 5 in `renderList()` — a flat project list with `client` shown on each row

### 5. What selecting "Pipeline" does

Resets to defaults:
- `groupOrder: ["stage", "client", "project"]`
- `groupEnabled: { stage: true, client: true, project: true }`
- `groupSort: { stage: "default", client: "timeline", project: "timeline" }`
- `stageVisible: { "active-clients": true, prospective: true, "past-clients": false, internal: true }`

## Steps

1. **Add Views dropdown component** in `project-sidebar.tsx`
   - Small button with the stacked-layers SVG icon
   - Dropdown lists "Pipeline" and "Timeline" with short descriptions
   - Selecting a view applies the preset state (groupEnabled, groupSort, stageVisible)
   - Highlight the active view; show no highlight if user has customized beyond presets

2. **Swap Group icon**
   - Replace the stacked-layers SVG in `GroupByDropdown` with `Rows3` from lucide-react (or equivalent 3-row SVG)

3. **Wire view presets**
   - Define two preset objects with the exact state each view applies
   - On select, call the existing `onSetGroupOrder`, `onSetGroupEnabled`, `onSetGroupSort`, `onSetStageVisible` callbacks
   - Detect active view by comparing current state to presets

4. **Update header layout**
   - Order in header: `PROJECTS` label + info icon | Views button | Group button | Filter button

## Files

| File | Change |
|---|---|
| `dashboard/src/app/capacity/project-sidebar.tsx` | Add ViewsDropdown component, swap Group icon, update header layout |
| `dashboard/src/app/capacity/capacity-utils.ts` | Add view preset constants (PIPELINE_VIEW, TIMELINE_VIEW) |

## Verification

- Default load → "Pipeline" view active, current behavior unchanged (stage → client → project, past hidden)
- Click "Timeline" → flat project list, no stage headers or client groups, past hidden, sorted by delivery urgency
- Ongoing projects (started, not ended) appear first sorted by soonest end date
- Upcoming projects appear next sorted by soonest start date
- Past projects don't appear in either view
- Click "Pipeline" → back to hierarchical view
- Manually adjust group settings → no view highlighted (custom state)
- Group & Sort button now shows rows icon instead of stacked layers
