# N2O Student Portal

> A chat-first, student-facing portal where N2O engineers see their hours, scores, goals, deadlines, comp, and events — with an SMS AI as the primary interface and a red-flag ladder that catches drift before it becomes churn.

| Field | Value |
|-------|-------|
| Status | Draft |
| Owner | whsimonds |
| Last Updated | 2026-03-11 |
| Depends On | RBAC Foundation (`rbac-v1/01-rbac-foundation.md`) |
| Enables | SMS Companion (`sms-companion/01-sms-companion.md`), Retention Dashboard |

## Reference Documents

Source documents for the student experience live in `reference/`:
- `01-the-trade.md` — What N2O gives, what students commit to
- `02-weekly-planning-view.md` — Calendar blocks + goals template
- `03-how-youre-scored.md` — Force Equation, rubric dimensions, bands & gates
- `commitment-agreement.pdf` — Signed two-way commitment

Retention framework: *$100M Playbook: Retention* (Hormozi, 2025)

---

## Recent Changes

| Date | What changed | Section |
|------|-------------|---------|
| 2026-03-11 | Complete rewrite: reorganized around goals/loops/modules structure; added red-flag ladder, activation ladder, phasing, $100M Playbook retention integration | All |

---

## 1. Product Goals

**Make it easy for students to:**
- Hit their hour commitments (25+ hrs) and keep a streak
- Submit weekly plans + Friday check-ins on time
- Complete biweekly self-scores and see bands clearly

**Make it easy for leads to:**
- See who's drifting early and intervene
- Run 1:1s from a single screen (hours, plans, scores, notes)

**Create clean, structured data for:**
- Activation-point analysis and churn modeling [$100M Playbook Retention, p16]
- "Usage churn" detection — hours, plans, and attendance dropping before exit [$100M Playbook Retention, p20]

---

## 2. Users & Jobs

**Student**: See where I stand (hours, band, goals, comp, events). Update my plan, blocks, and check-ins with minimum friction. Understand "The Trade" and "How I'm Scored" without digging through PDFs.

**Lead**: See my pod's risk map (who is Yellow / Orange / Red). Run Friday 1:1s in 15 minutes from one view. Approve schedule exceptions; set bands and notes.

**Admin**: Configure rubric versions, bands, commitments, cadences. Enter comp events; manage content for The Trade / weekly planning.

---

## 3. Behavior Loops

| Cadence | Student | Lead | System |
|---------|---------|------|--------|
| **Daily** | Work stated blocks, log hours | — | Compute pace vs target; detect no-logging days |
| **Weekly** | Submit Sunday plan; update Friday check-in | Monday kickoff + Friday 1:1 from portal | Lock plan Sunday EOD; unlock check-in Friday |
| **Biweekly** | Self-score (8 dimensions) | Score student; compare in 1:1 | Compute gap; update band if needed |
| **Termly** | — | Decide promotion / exit | Summarize term performance |

---

## 4. Modules

### 4.1 Home / "Where I Stand"

One-glance answer to: *"Am I good or screwed this week?"*

- Hours this week vs target, with on-track / behind / ahead indicator
- Current band + short text: what it unlocks (`reference/03-how-youre-scored.md`)
- Next 3 deadlines: plan due, self-score due, next 1:1
- **Activation ladder**: "You are on Step X of the N2O path" — synthesizes The Trade + scoring into a progression visual [$100M Playbook Retention, p27]
- Data: aggregates from Hours, Weekly Plan, Score, Events, Comp modules

### 4.2 My Hours

- Weekly bar chart with daily breakdown; "needed-hours-per-day" overlay for remaining days
- Last 8 weeks sparkline; streak badges (3+ weeks at 25h = activated) [$100M Playbook Retention, p14]
- Project breakdown (pie/bar by project this week)
- Duplicate flag count (same description + overlapping times)
- **Data source**: Existing `timeTrackingEntries` query, filtered to logged-in student's `toggl_user_id`
- **Key design note**: 25h target is configurable per student via `students.weekly_hour_target` (finals, agreed exceptions)

### 4.3 Weekly Plan & Check-in

Replaces the Notion/doc-based Weekly Planning View (`reference/02-weekly-planning-view.md`).

- Editable weekly calendar blocks (Mon–Sun) with hours per block
- Goals table: committed / stretch timelines, Friday outcome (stretch / committed / missed)
- Friday check-in form: what shipped, what slipped, one improvement, notes
- Status indicators: draft / submitted / locked / overdue
- History: past weekly plans (read-only) with goal hit rates

**Cadence logic:**
- Sunday EOD: plan locks for the week
- Monday 10am: plan is read-only
- Friday: check-in form unlocks until EOD

### 4.4 Scoring & Bands

Makes "How You're Scored" (`reference/03-how-youre-scored.md`) fully live.

- Current band (Elite / High / Standard / At Risk) — large, prominent
- Band history timeline (progression over past terms)
- Force Equation visual with student's actual data where available
- Biweekly self-score form (6 core + 2 supporting dimensions, Always/Often/Sometimes/Rarely)
- Side-by-side: self vs lead scores, gap highlighting (dimensions differing by 2+)
- Goal hit rates: committed % and stretch % (from weekly plans)
- Full rubric text inline — students shouldn't have to open a separate doc

**Extensibility requirement**: Dimensions, scale, and band thresholds MUST be stored as config, not hardcoded. Support adding/removing/reordering dimensions, changing scale (1-4 today, maybe 1-5 later), marking core vs supporting, versioning (old scores stay linked to their rubric version).

### 4.5 Events & Comp

- Upcoming N2O events + personal meetings (Monday 10am, Friday 10am, Friday 1:1, biweekly review)
- Comp timeline: next pay event, historical payments
- "What your band unlocks" table (projects, pay, advocacy from `reference/03-how-youre-scored.md`)
- Optional: Google Calendar sync for deadlines

**Edit permissions**: Comp is admin-write, student-read-only.

### 4.6 Commitments & Reference

Read-only rendered views of:
- The Trade (`reference/01-the-trade.md`)
- Weekly Planning View explainer (`reference/02-weekly-planning-view.md`)
- How You're Scored (`reference/03-how-youre-scored.md`)
- Signed commitment agreement (`reference/commitment-agreement.pdf`)
- Escalation SOP

Content managed by admins. Students shouldn't need to dig through PDFs.

---

## 5. SMS AI (Chat-First)

The portal is **chat-first**: SMS is the primary interface. The web dashboard exists for visual depth, but the most common interactions happen over text.

**Intents:**
- **Capture**: weekly plan, updated blocks, Friday check-in, self-score link
- **Status**: hours this week, pace, band, next deadlines, upcoming comp
- **Exceptions**: schedule change requests → `schedule_exceptions` row for lead approval

**Read**: all student-facing data (hours, plans, bands, events, comp).
**Write** (student only): blocks, goals (pre-lock), check-ins, exception requests.
**Cannot write**: band/score data (lead-only), comp data (admin-only), other students' data, rubric config.

**Cadence:**
- Sunday: plan reminder if not submitted
- Midweek: hours & pace digest
- Biweekly: self-score reminder
- On milestone: congrats + small "unlock" (badge, message) [$100M Playbook Retention, p19]

**MMS stretch goal**: Server-side chart-to-image for hours/pace visuals via SMS.

---

## 6. Red-Flag Ladder

Detect drift before it becomes churn. [$100M Playbook Retention, p4: "If you talked to them right when their attendance goes down to two sessions, you could rescue them."]

**Signals**: weekly hours %, missed plans, missed check-ins, missed 1:1s, skipped self-scores, band drops, portal/SMS inactivity.

| Level | Trigger | Response |
|-------|---------|----------|
| **Yellow** | 1-week drift (any signal) | AI nudge via SMS + reason capture |
| **Orange** | 2 Yellow in 4 weeks OR missed 1:1 | AI books "stability check" with lead |
| **Red** | At Risk band OR recurring Orange | Structured PIP + term risk flag |

**Lead view**: "Risk board" sorted by level; click into full student profile (hours, plans, scores, notes).

---

## 7. Metrics & Phasing

### V1 Success Criteria

- % of weeks with on-time plan submissions
- % of students maintaining 3+ week 25h streaks (activation point) [$100M Playbook Retention, p16]
- Reduction in "I don't know where I stand" friction in 1:1s

### Phasing

| Phase | Scope |
|-------|-------|
| **Phase 1** (must-have) | Home, Hours, Weekly Plan, basic Scoring, SMS for plans/hours |
| **Phase 2** | Full scoring + bands, Red-flag ladder, Events & Comp |
| **Phase 3** | Activation ladder visualization, retention analytics/models [$100M Playbook Retention, p27] |

---

## Data Model

The data model must be **extensible** — particularly the performance review schema. Shape, not final DDL:

```
students
  id, name, email, phone, toggl_user_id, role, active, term,
  weekly_hour_target (default 25), lead_id, created_at

rubric_versions
  id, version_name, created_at, active

rubric_dimensions
  id, rubric_version_id, ordinal, name, description,
  ask_yourself_prompt, category (core | supporting),
  scale_min, scale_max

band_thresholds
  id, rubric_version_id, band_name (elite|high|standard|at_risk),
  min_average, core_gate_description

weekly_plans
  id, student_id, week_start_date, status (draft|submitted|locked),
  submitted_at, locked_at

weekly_plan_blocks
  id, weekly_plan_id, day_of_week, time_block_description, hours

weekly_plan_goals
  id, weekly_plan_id, ordinal, description,
  committed_by, stretch_by,
  outcome (stretch|committed|missed|null)

friday_checkins
  id, weekly_plan_id, what_shipped, what_slipped,
  one_improvement, other_notes, submitted_at

performance_reviews
  id, student_id, rubric_version_id, review_period_start,
  review_period_end, status (pending|self_scored|lead_scored|complete)

review_scores
  id, performance_review_id, rubric_dimension_id,
  scorer_type (self|lead), score, comment

student_bands
  id, student_id, band (elite|high|standard|at_risk),
  effective_date, set_by, notes

comp_events
  id, student_id, type (payment|trip|benefit),
  description, expected_date, amount, status, notes

schedule_exceptions
  id, student_id, requested_via (sms|web), date,
  original_plan, requested_change, reason,
  status (pending|approved|denied), reviewed_by

sms_conversations
  id, student_id, direction (inbound|outbound),
  message_text, media_url, timestamp,
  intent_classification, action_taken

red_flag_events
  id, student_id, level (yellow|orange|red),
  signal_type, triggered_at, resolved_at,
  resolution_notes, lead_id
```

**Extensibility notes:**
- `rubric_versions` + `rubric_dimensions` = fully configurable scoring. New rubric = new version; old scores stay linked to their version.
- `band_thresholds` are per-version — changing band math doesn't retroactively reclassify.
- `schedule_exceptions` captures AI schedule change requests as structured data for lead approval.
- `sms_conversations` logs all AI interactions for auditability.
- `red_flag_events` tracks the full escalation history per student.

---

## Permission Model

| Data | Student | Lead | Admin |
|------|---------|------|-------|
| Own hours (Toggl) | read | read | read |
| Own weekly plan | read/write (until lock) | read/write | read/write |
| Own Friday check-in | read/write | read | read |
| Own self-scores | read/write | read | read |
| Lead scores (for them) | read (after lead submits) | read/write | read/write |
| Own band | read | read/write | read/write |
| Comp data | read | read | read/write |
| Rubric config | read | read | read/write |
| Other students' data | none | read (their pod) | read/write |
| Schedule exceptions | create/read | read/approve | read/approve |
| Red-flag events | none | read/resolve | read/resolve |

---

## Current State

**What exists today (internal/leadership-facing):**
- Toggl integration with full GraphQL API (entries, members, projects, clients, tags, live timers)
- People view with live cards, pace tracking, sparklines, 3-week averages
- Trends view with line charts and period tables
- Week calendar (Gantt-style timeline) view
- Filter bar with date range, member, and project filters
- Member role system (leadership / developer / non-developer) with configurable hour targets
- 4-minute cached entry data, 1-hour cached member/project data

**What students have today:** Nothing. No self-service view of their hours, scores, goals, or standing. All feedback flows through 1:1s and manual Notion docs.

---

## Open Questions

1. ~~**SMS provider?**~~ **Resolved**: Twilio. Toll-free number verification in progress; migrating to 202 number. See `sms-companion/01-sms-companion.md`.
2. **Auth for student portal?** Magic links via SMS (aligns with RBAC Foundation) or separate student login?
3. **Toggl duplicate detection** — exact heuristic? Same description + overlapping time windows? Same description + same duration within 5 minutes?
4. **Calendar sync** — do students use Google Calendar? Read from it, or are weekly plan blocks sufficient?
5. **MMS chart rendering** — server-side chart-to-image (Puppeteer) or charting library that renders to PNG?
6. **Comp data source** — QuickBooks, Gusto, or manually entered by admin?
7. **Lead assignment** — how do we know which lead is assigned to which student? `lead_id` on students table, or inferred from Toggl workspace?
8. ~~**AI model for SMS**~~ **Resolved**: Claude Opus. See `sms-companion/01-sms-companion.md`.
9. **Weekly plan lock timing** — EOD Sunday, but grace period? What happens if student submits Monday 8am?
10. **Activation point definition** — is the 3-week 25h streak + on-time plans the right threshold, or do we need to validate with data first? [$100M Playbook Retention, p16: "Retest every 6-12 months."]
