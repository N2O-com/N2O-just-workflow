# Portal Scaffold

> A student logs in via magic link and sees the portal shell with sidebar navigation — stub pages for each module, ready to be filled in.

| Field | Value |
|-------|-------|
| Status | Draft |
| Owner | — |
| Last Updated | 2026-03-11 |
| Depends On | RBAC Foundation (`rbac-v1/01-rbac-foundation.md`) |
| Enables | `03-weekly-plans.md` |

---

## Recent Changes

| Date | What changed | Section |
|------|-------------|---------|
| 2026-03-11 | Adversarial review: resolved sidebar as prop-driven Sidebar reuse, updated Enables list | Open Questions, Design |
| 2026-03-11 | Initial spec | All |

---

## Goal

Give students a place to log into. Right now they have nothing — all feedback flows through 1:1s and Notion docs. This spec delivers the shell: auth, layout, sidebar, and placeholder pages. Once this exists, subsequent specs fill in the real content.

## Success Criteria

- A developer with `access_role: engineer` can log in via magic link and land on the portal
- They see a student-specific sidebar with 5 nav items (Home, Hours, Weekly Plan, Scoring, Reference)
- Each nav item routes to a stub page with the page title
- Admin users (`access_role: admin`) continue to see the existing admin dashboard unchanged
- Dev mode bypass works for local development

## Current State

- Supabase magic link auth exists on `/login` (RBAC Foundation delivers this)
- Sidebar already has `adminOnly` flag per nav item, filtered via `useCurrentUser` hook
- Shell component orchestrates layout: sidebar + main content + optional right panels
- `developers` table will have `email` and `access_role` columns (from RBAC Foundation)
- No student-facing pages or routing exist

## Design

**Approach**: Add a Next.js route group `(student)` under `dashboard/src/app/` with its own layout and sidebar component. Role-based redirect after login sends engineers to `/portal` and admins to `/tasks`.

**This is simpler than** modifying the existing sidebar's filtering logic, because the student and admin experiences share almost nothing — different nav items, different information density, different audience.

**This spec covers:**
- Route group `(student)/` with student layout + student sidebar
- Post-login redirect logic based on `access_role`
- 5 stub pages: `/portal` (Home), `/portal/hours`, `/portal/plan`, `/portal/scoring`, `/portal/reference`
- Student sidebar component (same Palantir dark theme, same collapse behavior)

**Out of scope:**
- Auth flow, magic links, JWT validation → `rbac-v1/01-rbac-foundation.md`
- Actual page content → `02-student-hours-view.md`, `03-weekly-plans.md`, `04-basic-scoring.md`
- SMS integration → `sms-companion/01-sms-companion.md`

### Route Structure

```
dashboard/src/app/
├── (admin)/              # Existing admin pages (tasks, ontology, capacity, etc.)
│   └── layout.tsx        # Wraps Shell with admin sidebar
├── (student)/            # New student portal
│   ├── layout.tsx        # Wraps Shell with student sidebar
│   └── portal/
│       ├── page.tsx          # Home / "Where I Stand" (stub)
│       ├── hours/page.tsx    # My Hours (stub)
│       ├── plan/page.tsx     # Weekly Plan (stub)
│       ├── scoring/page.tsx  # Scoring (stub)
│       └── reference/page.tsx # Reference (stub)
├── login/page.tsx        # Shared (no layout chrome)
└── auth/callback/route.ts # Shared
```

### Student Sidebar Nav Items

```typescript
const studentNavItems = [
  { href: "/portal", icon: Home, label: "Home" },
  { href: "/portal/hours", icon: Clock, label: "Hours" },
  { href: "/portal/plan", icon: Calendar, label: "Plan" },
  { href: "/portal/scoring", icon: Target, label: "Scoring" },
  { href: "/portal/reference", icon: BookOpen, label: "Reference" },
];
```

### Post-Login Redirect

In `/auth/callback/route.ts`, after session exchange:
- Query `developers` table for `access_role`
- `admin` → redirect to `/tasks` (existing behavior)
- `engineer` → redirect to `/portal`

## Implementation Plan

| # | Task | Done When |
|---|------|-----------|
| 1 | Create student route group, layout, sidebar, and 5 stub pages | Engineer user sees student sidebar with 5 nav items, each routing to a stub page with title. Admin users still see existing dashboard. Dev mode works. |
| 2 | Add post-login role-based redirect | After magic link auth, engineers land on `/portal`, admins land on `/tasks`. Manual verification: log in as each role. |

## Open Questions

1. ~~Separate app or route group?~~ **Resolved**: Route group `(student)/` in existing dashboard. Shares providers (Apollo, Tooltip), avoids deploy complexity.
2. ~~Should the student sidebar reuse the same `Sidebar` component or be a new component?~~ **Resolved**: Refactor `Sidebar` to accept `navItems` as a prop. Pass `adminNavItems` or `studentNavItems` from the layout. Single source of truth for sidebar behavior (collapse, theme).

## References

- Vision spec: `.pm/backlog/student-portal/student-portal-spec.md`
- RBAC Foundation: `.pm/todo/rbac-v1/01-rbac-foundation.md`
- Existing sidebar: `dashboard/src/components/layout/sidebar.tsx`
- Existing Shell: `dashboard/src/components/layout/shell.tsx`
