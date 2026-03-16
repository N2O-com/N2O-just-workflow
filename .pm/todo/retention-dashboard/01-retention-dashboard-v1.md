# Build Developer Retention Prediction Dashboard
> Surface leading indicators of developer churn so managers can intervene before losing people.

**Start here:** Before designing anything, craft a prompt for the [Acquisition.com AI](https://www.acquisition.com/ai) to identify which metrics actually predict retention in small dev teams. That output becomes the foundation for everything below.

| Field | Value |
|-------|-------|
| Status | Draft |
| Owner | — |
| Last Updated | 2026-03-11 |
| Depends On | Acquisition.com AI research (Task 1) |
| Enables | Proactive retention interventions, team health scoring |

---

## Goal

Give engineering leaders a single dashboard that answers: *"Which developers are at risk of leaving, and what can I do about it?"* — using data we already collect (tasks, time tracking, velocity, quality, session activity) plus lightweight pulse signals we can add.

---

## Current State

We already track significant developer activity data:
- **Task throughput**: completion rates, velocity trends, estimation accuracy
- **Quality signals**: reversion counts, testing posture grades, audit findings
- **Time tracking**: hours logged via Toggl, billable vs. non-billable breakdown
- **Session activity**: concurrent sessions, tool calls, transcript metadata
- **Skills**: self-reported skill ratings (1-5) across 6 dimensions
- **Developer context**: alertness snapshots, environment, concurrent session counts

None of this is currently framed through a retention lens. No composite risk scores, no trend alerts, no manager-facing "who needs attention" view.

---

## Task 1: Build the Acquisition.com AI Prompt

Before designing the dashboard, we need domain expertise on what actually predicts developer retention. The first deliverable is a well-crafted prompt for the Acquisition.com AI that gives it sufficient context to advise us.

### What the prompt needs to convey

**1. Who we are / what we're building**
- Small engineering team using an AI-augmented workflow framework (N2O)
- We coordinate multiple AI agents to plan, implement, test, and review code
- Developers work alongside AI — their role is more orchestration than raw coding
- We want to retain our best developers and spot disengagement early

**2. What data we already have**
- Task data: sprint assignments, completion rates, velocity over time, complexity ratings, estimation accuracy (blow-up factors), reversions, testing quality grades
- Time tracking: daily hours logged (Toggl), project allocation, billable/non-billable split
- Session metadata: how many concurrent AI sessions a dev runs, session duration, token usage, tool call patterns
- Developer profiles: skill ratings across 6 dimensions, role, strengths, growth areas
- Quality metrics: code reversion frequency, audit finding patterns, phase timing breakdowns

**3. What we want to learn**
- Which behavioral metrics are most predictive of developer churn/disengagement?
- What leading indicators should we track (vs. lagging indicators that confirm someone already left)?
- What thresholds or trend patterns signal "at risk" vs. "healthy"?
- Are there lightweight signals we should add (pulse surveys, 1-on-1 sentiment, etc.)?
- How should we weight/combine signals into a composite retention risk score?
- What intervention playbooks map to specific risk signals?

**4. Constraints**
- Small team (under 20 developers)
- AI-augmented workflow (developers orchestrate AI agents, not traditional coding)
- We prefer leading indicators from existing data over adding heavy new data collection
- Dashboard consumer is engineering manager, not HR
- Privacy-conscious — signals should be team-health oriented, not surveillance

### Prompt draft

> We run a small engineering team (~10-20 developers) using an AI-augmented development workflow. Our developers orchestrate multiple AI agents for planning, coding, testing, and code review rather than writing all code by hand.
>
> We want to build a dashboard that predicts developer retention risk using data we already collect. Here's what we track today:
>
> **Task data**: Sprint assignments, completion rates, velocity trends (tasks/week), task complexity (low/med/high), estimation accuracy (estimated vs. actual minutes), code reversions, testing quality grades (A-F), dependency-blocked time.
>
> **Time tracking**: Daily hours via Toggl — project allocation, billable vs. non-billable, weekly hour trends.
>
> **Session activity**: Number of concurrent AI sessions per developer, session durations, token consumption, tool call patterns (reads, edits, bash commands), context loading times.
>
> **Developer profiles**: Skill self-ratings (1-5) across React, Node, Database, Infra, Testing, Debugging. Role, strengths, and growth areas.
>
> **Quality signals**: Code reversion frequency, common audit findings per developer, phase timing (how long in red/green/refactor phases).
>
> Given this data, please help us design a retention prediction system:
>
> 1. Which of these metrics are most predictive of developer disengagement or churn?
> 2. What leading indicators should we prioritize (signals that appear weeks/months before someone leaves)?
> 3. What trend patterns or thresholds should trigger an "at risk" flag?
> 4. What lightweight additional signals would you recommend adding (pulse surveys, 1-on-1 notes, etc.)?
> 5. How should we combine these into a composite risk score?
> 6. What specific manager interventions map to each risk signal?
>
> Constraints: Small team, privacy-conscious (team health not surveillance), engineering manager audience, prefer leveraging existing data over heavy new collection.

---

## Design (Pending Acquisition.com AI Output)

After receiving AI guidance, this section will define:
- **Risk model**: Which signals, what weights, what composite score formula
- **Dashboard layout**: Risk overview, individual profiles, trend sparklines, alert system
- **Alert thresholds**: When to surface warnings and to whom
- **Intervention playbook**: What actions to take for each signal type

---

## Implementation Plan (Pending)

| # | Task | Done When |
|---|------|-----------|
| 1 | Craft and submit prompt to Acquisition.com AI | Response received and documented |
| 2 | Analyze response, select metrics, define risk model | Risk scoring formula documented |
| 3 | Add SQL views for retention signals | Views query correctly in sqlite |
| 4 | Add GraphQL resolvers for retention data | Queries return expected data |
| 5 | Build retention dashboard page | Page renders with risk scores and trends |
| 6 | Add alert/notification system for at-risk developers | Alerts fire on threshold breach |

---

## Open Questions

1. Does the Acquisition.com AI have specific guidance for AI-augmented teams vs. traditional dev teams?
2. Should the risk score be visible to the developer themselves, or manager-only?
3. Do we need historical benchmarking (i.e., calibrate against past departures)?
4. What's the minimum data history needed before risk scores become meaningful?
5. Should we integrate any external signals (Glassdoor sentiment, market salary data)?

---

## References

- [Acquisition.com AI](https://www.acquisition.com/ai) — starting point for retention metric research
- Existing analytics views: `.pm/schema.sql` (27 views covering velocity, quality, estimation, concurrency)
- Dashboard: `dashboard/src/app/` (11 existing pages)
- Developer data: `developers` table with skill ratings, roles, growth areas
