# Student Hours Dashboard

> Students see their own de-duplicated time-tracking data — pace, daily breakdown, work breakdown, and patterns — so they always know where they stand relative to their weekly target.

| Field | Value |
|-------|-------|
| Status | Draft |
| Owner | — |
| Last Updated | 2026-03-12 |
| Depends On | `01-portal-scaffold.md`, toggl-sync sprint (tt_entries populated) |
| Enables | Weekly Plans (plan vs. actual comparison in future) |

---

## Recent Changes

| Date | What changed | Section |
|------|-------------|---------|
| 2026-03-12 | Added developer_commitments model with partial-day granularity, noted Moxo integration as future | Commitments, Open Questions |
| 2026-03-12 | Added explainer card, per-section microcopy, "hours as reps" framing | Page Sections, Microcopy |
| 2026-03-12 | Initial spec from design discussion | All |

---

## Goal

Show students if they're giving themselves enough focused reps for their goals. Build consistency via streaks, not shame via one bad week. Hours are the throughput logs of their "developer API" — consistent volume is how APIs get trusted with bigger specs.

This page answers: "How many hours do I have?", "Am I on track?", "What did I work on?", and "Am I getting better?" All data comes from the synced Postgres tt_entries table — the de-duplicated source of truth used for payments. The only live API call is for the current running timer.

## Success Criteria

- Student sees their hours this week, pace delta, and forward projection on page load
- Daily breakdown shows hours per day with projected needed hours on remaining days
- Gap warnings highlight days with 0 hours logged
- Weekly progression chart shows this week vs last 2-3 weeks cumulative
- Work breakdown shows project/description groups sorted by time
- Recent weeks (4-6) bar chart with target line and on-target rate
- Day-of-week pattern shows best/worst day
- Trend sparkline shows this week vs last week with % change
- All data scoped to the logged-in student only
- Source of truth banner visible
- Explainer card and per-section microcopy present — each line ties to career outcome or prescribes a behavior
- Page feels like a coaching cockpit, not surveillance

## Current State

- tt_entries, tt_projects, tt_clients, tt_tags synced to Postgres every 5 minutes
- Existing admin page shows team-wide data with PeopleView, PaceOverview, charts
- usePeopleData.js computes pace, day-of-week averages, weekly cumulative data — but for all members from live API
- No student-facing hours page exists
- developers table has time_tracking_user_id linking to Toggl user IDs
- No configurable weekly target per developer (currently role-based defaults in frontend code)

## Design

**Approach**: New GraphQL resolver `myHoursSummary` queries the synced Postgres `tt_entries` table scoped to one developer's `time_tracking_user_id`. Frontend page at `/portal/hours` renders the data. Charts reuse patterns from existing `PeopleExpandedRow.jsx` but are new components scoped to single-user data.

**Why Postgres (not live Toggl API)**: The synced data is de-duplicated and is the payment source of truth. Students need to see the same numbers used for their compensation. Live API has duplicates and rate limits.

**This spec covers:**
- `weekly_hours_target` column on developers table (nullable, falls back to role-based default)
- GraphQL resolver: `myHoursSummary` query returning all data for the page
- Student hours page at `/portal/hours` with 7 sections
- Current timer display (only live API call)

**Out of scope:**
- Plan vs. actual comparison → deferred until `03-weekly-plans.md` is live
- Team comparisons / leaderboard → admin only
- Editing time entries → students use Toggl directly
- SMS hour check → `sms-companion` spec

## Microcopy Philosophy

Every section gets one line of microcopy. Each line must either **tie to a career outcome** (jobs, projects, references) or **prescribe a behavior**. No decoration. This is coaching in text at the exact moment they see the data — cockpit, not surveillance.

## Page Sections (in order)

### 0. Explainer Card (top of page)

Title: **Why NOS shows your hours**

Body: "Hours are your reps. This page tells you if you're getting enough focused work in to earn the outcomes you want here: better projects, better references, better jobs. Use it to adjust your week before it gets away from you."

Rendered as a subtle card above the hero. Dismissible (persists via localStorage).

### 1. Hero

- **Current timer**: If a Toggl timer is running, show description + elapsed time prominently. Uses existing `timeTrackingCurrentTimer` query (live API, no cache).
- **Big number**: "21.0h / 30h" — hours tracked this week vs weekly target
  - Microcopy: *"This is your training volume for this week. Most people who win here hit their target consistently, not perfectly."*
- **Pace delta**: "+3.6h ahead" (green) or "-2.1h behind" (yellow/red). Computed as: `hoursThisWeek - (target * fractionOfWeekElapsed)`. Green if >=0, yellow if between -2 and 0, red if < -2.
  - Microcopy (green): *"You're giving your future self enough shots on goal."*
- **Trend sparkline**: This week (solid line) vs last week (dashed line) cumulative hours, with % change label (e.g., "-56%"). Same style as existing TREND column in PeopleView.
- **Forward projection**: "You need 9 more hours across 3 remaining days (~3.0 hrs/day)". Only shown if behind or exactly on pace. Hidden if week is complete.
  - Microcopy: *"If this looks ugly by Wednesday, fix your calendar, not your willpower."*

### 2. This Week Daily Breakdown

- Mon-Sun bars showing hours per day (vertical bars, one per day)
- Today highlighted with accent color
- Past days with 0 hours: gap warning badge ("No hours logged")
  - Gap tooltip: *"A single zero day is fine. A pattern of zeros is what stalls careers."*
- Future remaining days: dotted-outline bars showing projected needed hours per day (remaining hours / remaining days)
- Optional toggle: faded last-week overlay for comparison
- Total hours label at the top
- Microcopy (section subtitle): *"Front-load your week so weekends are optional, not emergency catch-up."*

### 3. Weekly Progression

- Cumulative line chart: x-axis Mon-Sun, y-axis hours
- This week: bold colored line (accent #2D72D2)
- Last 2-3 weeks: faded gray lines
- Dashed horizontal target line at weekly goal
- Toggle: "Weekly Progression" / "Avg by Day"
- Avg by Day mode: bar chart showing average hours per day-of-week across last 6 weeks. Best day highlighted green, worst day highlighted red. Same style as existing PeopleExpandedRow Avg by Day chart.

### 4. What You Worked On

- This week's entries from tt_entries, grouped by project name (from tt_projects), then by description
- Each group shows: project color dot + project name + total hours
- Within each project: description rows with hours, sorted by most time
- Entries with no project grouped under "(No project)"
- Entries with no description show "(no description)"
- Microcopy (section subtitle): *"If it doesn't show up here, it's hard for us to give you credit for it later."*
- Microcopy (bottom note): *"Use this when you write resume bullets or prep for 1:1s. It's your receipts."*

### 5. Weekly Totals (Recent Weeks)

- Bar chart: last 6 complete weeks + current partial week
- Each bar: total hours that week, number label on top
- Current week bar: accent color. Past weeks: muted color.
- Dashed horizontal target line
- On-target rate badge below: "Hit target 4 of 6 weeks" (weeks where total >= 80% of target)
  - Microcopy next to badge: *"Aim for 4+ on-target weeks in a row. That's the bar top performers usually clear."*
- Same visual style as existing PeopleExpandedRow Weekly Totals chart
- Microcopy (section subtitle): *"This is your consistency graph. Streaks matter more than hero weeks."*

### 6. Avg by Day (Your Pattern)

- Day-of-week bar chart (Mon-Sun)
- Average hours per day across last 6 complete weeks
- Best day: green-tinted bar. Worst day: red-tinted bar.
- Hours label on top of each bar
- Same visual style as existing PeopleExpandedRow Avg by Day chart
- Note: This section also accessible via the Weekly Progression toggle, but shown standalone here for users who don't interact with the toggle
- Microcopy (section subtitle): *"This is your habits fingerprint. The goal is to make your best day your new average."*
- Microcopy (hover on best day): *"If your best day is [day], protect it like a meeting with your future boss."*

### 7. Source of Truth Banner

- Bottom of page, subtle but persistent
- Gray background, small text
- *"This dashboard uses the same de-duplicated data we use for payments and staffing, so you can safely plan your week off these numbers."*

## Schema Changes

**Migration**: `platform/migrations/004-weekly-hours-target.sql`

```sql
-- Add configurable weekly hours target to developers table
ALTER TABLE developers ADD COLUMN IF NOT EXISTS weekly_hours_target REAL;

-- NULL means "use role-based default":
--   leadership = 40
--   developer = 30
--   non-developer = 15
COMMENT ON COLUMN developers.weekly_hours_target IS 'Weekly hours target. NULL = role-based default (leadership=40, developer=30, non-developer=15)';
```

## GraphQL Schema

```graphql
type MyHoursSummary {
  # Hero
  weeklyTarget: Float!
  hoursThisWeek: Float!
  paceDelta: Float!
  paceStatus: String!          # "ahead", "slightly_behind", "behind"
  projectionHoursNeeded: Float
  projectionDaysRemaining: Int
  projectionHoursPerDay: Float
  trendPctChange: Float        # % change this week vs last week (at same point in week)

  # Daily breakdown (this week)
  dailyHours: [DailyHours!]!

  # Last week daily (for sparkline/overlay)
  lastWeekDailyHours: [DailyHours!]!

  # Work breakdown (this week)
  workBreakdown: [WorkGroup!]!

  # Weekly totals (last 6 weeks + current)
  weeklyTotals: [WeekTotal!]!

  # Day-of-week averages
  dayOfWeekAverages: [DayAverage!]!

  # On-target stats
  onTargetWeeks: Int!
  totalCompleteWeeks: Int!
}

type DailyHours {
  date: String!           # ISO date
  dayLabel: String!       # "Mon", "Tue", etc.
  hours: Float!
  isToday: Boolean!
  isFuture: Boolean!
  projectedHours: Float   # only for future days
  hasGap: Boolean!        # true if past day with 0 hours
}

type WorkGroup {
  projectName: String
  projectColor: String
  totalHours: Float!
  entries: [WorkEntry!]!
}

type WorkEntry {
  description: String!
  hours: Float!
}

type WeekTotal {
  weekLabel: String!       # "Mar 3-9"
  periodStart: String!     # ISO date
  hours: Float!
  isCurrentWeek: Boolean!
  isOnTarget: Boolean!     # hours >= target * 0.8
}

type DayAverage {
  dayLabel: String!        # "Mon", "Tue", etc.
  avgHours: Float!
  isBest: Boolean!
  isWorst: Boolean!
}

extend type Query {
  myHoursSummary(developer: String!): MyHoursSummary!
}
```

## Resolver Logic

**Query: myHoursSummary(developer: String!)**

1. Look up developer's `time_tracking_user_id` and `weekly_hours_target` from developers table
2. Determine weekly target: `weekly_hours_target ?? role_default(role)`
3. Compute week boundaries: current week Mon 00:00 → Sun 23:59 (ET default)
4. Query `tt_entries` for last 7 weeks (current + 6 complete) WHERE `user_id = time_tracking_user_id`
5. Join `tt_projects` for project names and colors
6. Aggregate:
   - **hoursThisWeek**: sum of seconds for current week entries / 3600
   - **paceDelta**: hoursThisWeek - (target * dayOfWeek/7)
   - **dailyHours**: group by date, compute hours per day. Future days get projectedHours = remainingHours / remainingDays
   - **lastWeekDailyHours**: same but for previous week
   - **trendPctChange**: (thisWeekCumulative - lastWeekCumulativeAtSamePoint) / lastWeekCumulativeAtSamePoint * 100
   - **workBreakdown**: group by project_id then description, sum hours, sort descending
   - **weeklyTotals**: group by ISO week, sum hours per week
   - **dayOfWeekAverages**: across 6 complete weeks, average hours per day-of-week
   - **onTargetWeeks**: count of complete weeks where hours >= target * 0.8

**De-duplication note**: tt_entries are already de-duped by the sync process (upsert on Toggl entry ID). No additional de-duplication needed in the resolver. However, overlapping entries (same user, overlapping time ranges) should have their seconds taken as-is from Toggl (Toggl tracks wall-clock, not de-overlapped time).

## Implementation Plan

| # | Task | Done When |
|---|------|-----------|
| 1 | Run migration + add myHoursSummary GraphQL resolver | Migration adds weekly_hours_target column. Resolver returns correct data for a test developer. Manual test: query returns hoursThisWeek, dailyHours, workBreakdown, weeklyTotals, dayOfWeekAverages with real tt_entries data. |
| 2 | Build student hours page with all 7 sections | Page renders at /portal/hours. Hero shows pace + sparkline. Daily breakdown shows bars with projections and gap warnings. Weekly progression chart toggles to Avg by Day. Work breakdown shows project groups. Weekly totals shows 6-week bars with on-target badge. Source of truth banner at bottom. Manual verification: page loads for logged-in student showing only their data. |

## Commitments & Adjusted Targets

Students can flag schedule conflicts (exams, vacation, appointments) in advance. The hours page adjusts the target line and pace calculations accordingly.

### Data Model: `developer_commitments`

```sql
CREATE TABLE developer_commitments (
  id SERIAL PRIMARY KEY,
  developer TEXT NOT NULL REFERENCES developers(name),

  -- What
  commitment_type TEXT NOT NULL,          -- 'academic', 'vacation', 'personal', 'conference', 'sick', 'other'
  title TEXT NOT NULL,                    -- "Midterm exams", "Spring break", "Dentist"
  notes TEXT,

  -- When (supports full-day and partial-day)
  start_at TIMESTAMPTZ NOT NULL,          -- date+time for partial day; midnight for full day
  end_at TIMESTAMPTZ NOT NULL,            -- date+time for partial day; end-of-day for full day
  all_day BOOLEAN NOT NULL DEFAULT true,  -- UI hint: true = render as full-day block

  -- Impact
  hours_blocked REAL,                     -- hours consumed by this commitment. NULL for all-day = full day blocked

  -- Recurrence (v2-ready)
  recurrence_rule TEXT,                   -- RRULE string for recurring (e.g., "FREQ=WEEKLY;BYDAY=TU,TH")
  recurrence_end DATE,                    -- when recurrence stops

  -- Metadata
  status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'cancelled'
  visibility TEXT NOT NULL DEFAULT 'team', -- 'self', 'team'
  metadata JSONB DEFAULT '{}',            -- future: approval status, etc.

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dev_commitments_range ON developer_commitments(developer, start_at, end_at);
CREATE INDEX idx_dev_commitments_status ON developer_commitments(status) WHERE status = 'active';
```

### How partial-day works

| Commitment | start_at | end_at | all_day | hours_blocked |
|---|---|---|---|---|
| Midterms all week | Mon 00:00 | Fri 23:59 | true | NULL (= full days) |
| Class Tue/Thu 2-5pm | Tue 14:00 | Tue 17:00 | false | 3.0 |
| Dentist Wed morning | Wed 09:00 | Wed 12:00 | false | 3.0 |
| Spring break | Mon 00:00 | Fri 23:59 | true | NULL |

### Target adjustment logic

1. For each day in the week, sum `hours_blocked` from overlapping partial-day commitments
2. All-day commitments block the entire day (daily allotment = weekly_target / 7)
3. Adjusted weekly target = normal_target - blocked_hours
4. Hours page shows: "Midterms this week — adjusted target: 15h" with the commitment title
5. Multiple commitments compose: exam Mon-Wed + dentist Thu = 4 blocked days

### Where commitments are created

- **v1**: Simple form on the Plan page or a dedicated section on Home
- **v2**: Recurring commitments via recurrence_rule (class schedules)
- **Future**: Moxo-style form builder from separate project (to be integrated — see Open Questions)

### How it flows

- **Hours page**: Target line adjusts, pace recalculates, banner shows active commitments
- **Weekly plan**: Pre-populates availability context when plan is lazily created
- **Capacity planner (leads)**: Shows reduced availability across team for upcoming weeks
- **1:1 prep**: Lead sees "student flagged exams" before the meeting

## Open Questions

1. **Overlapping entries**: Should we de-overlap (compute non-overlapping seconds) or trust Toggl's `seconds` field? The admin dashboard uses `getNonOverlappingSeconds()` for display. **Recommendation**: Use Toggl's `seconds` field for v1 since entries are already de-duped by ID. Add overlap detection as a future enhancement if discrepancies are reported.
2. ~~**Weekly target storage**~~ **Resolved**: `weekly_hours_target` column on developers table, nullable, falls back to role-based default.
3. ~~**Data source**~~ **Resolved**: Synced Postgres tt_entries (de-duplicated), not live Toggl API. Exception: current timer from live API.
4. ~~**History depth**~~ **Resolved**: 6 complete weeks + current week.
5. **Plan vs. actual**: Deferred. When `03-weekly-plans.md` is implemented, add a comparison overlay to the daily breakdown showing planned blocks vs actual hours.
6. ~~**Partial-day commitments**~~ **Resolved**: Supported via `start_at`/`end_at` TIMESTAMPTZ + `all_day` flag + `hours_blocked`. Recurrence via `recurrence_rule` in v2.

## References

- Portal scaffold: `01-portal-scaffold.md`
- Weekly plans: `03-weekly-plans.md` (future plan vs. actual integration)
- Toggl sync tables: `platform/migrations/003-toggl-sync-tables.sql`
- Existing pace computation: `dashboard/src/app/time-tracking/toggl/hooks/usePeopleData.js`
- Existing chart components: `dashboard/src/app/time-tracking/toggl/components/people/PeopleExpandedRow.jsx`
- Existing resolvers: `platform/src/resolvers/time-tracking.ts`
- Student portal vision: `memory/project_student-portal-vision.md`
