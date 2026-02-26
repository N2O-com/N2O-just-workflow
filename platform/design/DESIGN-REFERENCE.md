# N2O Dashboard — Design Reference

> Palantir-inspired data operations dashboard. Dark, dense, information-rich.

## Reference Screenshots

Three Palantir product screenshots are stored alongside this file:
- `palantir-foundry-dashboard.png` — Foundry: dark theme, KPI cards with colored status text, choropleth map, tabbed detail panel, data table with colored change indicators
- `palantir-foundry-graph.png` — Foundry: graph/dependency visualization, dark canvas, color-coded node groups, toolbar with layout/select/expand/color controls, left icon sidebar
- `palantir-aip-terminal.png` — AIP: chat-driven interface with structured alert cards, detail tables, side-panel map visualization, conversational AI input

## Visual DNA (Extracted from References)

### Color System
| Token | Value | Usage |
|-------|-------|-------|
| `bg-canvas` | `#1C2127` | Main background (very dark blue-gray) |
| `bg-surface` | `#252A31` | Cards, panels, sidebar |
| `bg-surface-raised` | `#2F343C` | Hover states, active panels |
| `border-default` | `#394048` | Card borders, dividers |
| `text-primary` | `#F5F8FA` | Headings, primary content |
| `text-secondary` | `#A7B6C2` | Labels, descriptions |
| `text-muted` | `#738694` | Timestamps, metadata |
| `accent-blue` | `#2D72D2` | Links, active tabs, primary actions |
| `accent-green` | `#238551` | Positive changes, success, "green" tasks |
| `accent-red` | `#CD4246` | Negative changes, errors, "red" tasks, blocked |
| `accent-orange` | `#EC9A3C` | Warnings, moderate risk |
| `accent-teal` | `#00A396` | Secondary charts, alternative accent |

### Typography
- **Font**: System monospace stack for data, Inter/system sans for labels
- **KPI numbers**: 36-48px, bold, sometimes colored (red for "High", green for positive)
- **Card titles**: 13-14px, uppercase or bold, white
- **Data labels**: 11-12px, muted gray, often uppercase
- **Table text**: 13px, regular weight

### Layout Patterns
- **Dense information panels** — no whitespace waste, every pixel carries data
- **Split-pane layouts** — main view (map/graph/board) left, detail panel right
- **KPI card row** — top of dashboard, 3-5 cards with metric + delta + status color
- **Tabbed detail panels** — tabs within cards for related data views
- **Icon sidebar** — narrow left bar with icon-only navigation (home, search, graph, settings)
- **Toolbar rows** — icon buttons with text labels below, grouped by function

### Component Patterns
- **Cards**: 1px border (#394048), no shadow, slight bg difference from canvas
- **Tables**: No cell borders, alternating row bg subtle, colored badges for status
- **Charts**: Dark background, colored fills (green/orange bars), thin line overlays
- **Status badges**: Pill-shaped, colored bg with white text, compact
- **Tabs**: Underline-style active indicator in accent blue, no background change
- **Inputs**: Dark bg, subtle border, no rounded corners (or very slight 2-3px)
- **Buttons**: Flat, no gradients, icon + text, subtle hover state

### What Makes It Feel Like Palantir (Not Generic Dashboard)
1. **Dark-first** — not a light theme with dark mode bolted on
2. **Information density** — more data per pixel than typical SaaS
3. **Muted chrome, vivid data** — UI elements recede, data pops with color
4. **Structured, not decorative** — no hero sections, no marketing copy, no illustrations
5. **Operational feel** — feels like a command center, not a settings page
6. **Multi-panel composition** — views composed of dockable/resizable panels
7. **Monospace for data** — numbers and codes use monospace, labels use sans
