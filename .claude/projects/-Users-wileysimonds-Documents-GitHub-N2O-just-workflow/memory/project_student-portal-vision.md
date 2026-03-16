---
name: Student Portal Vision & Philosophy
description: The 6-page student portal design, the "be a great API" metaphor, the A-E-P-P-P feedback framework, and the "kind not nice" coaching philosophy that drives all student-facing UI decisions.
type: project
---

## Core Philosophy

Students are here to become "great APIs for getting important things done." A great API means:
- Clear spec in → reliable output out
- Observable (plans, updates, logs)
- Handles errors and ambiguity without drama
- Ships fast and reliably at high quality

NOS (the student portal) exists to show them their logs and help them iterate.

## "Kind, Not Nice" Feedback Approach

From Wiley's mentor (ex-CEO of BAE, $60B company): "Your biggest problem is that you are nice when you should be kind. You are depriving your people of the feedback that's going to make them better."

Tech Captains/Leads use the A-E-P-P-P script:
- **Aim**: State the standard + their stated goal
- **Evidence**: Objective NOS data (hours, streaks, rework count)
- **Potential**: "I'm giving you this feedback because I think you can be that engineer. Do you agree?"
- **Plan**: Next 2-3 weeks, 2 specific levers
- **Ping**: Scheduled follow-up with specific numbers to hit

## 6 Portal Pages

1. **NOS Home (Weekly Cockpit)**: "Am I winning this week?" — snapshot tiles from Goals, Plan, Hours, Outcomes. Green/yellow/red.
2. **Goals & The Trade**: Target job/comp/timeline. What N2O gives vs. what they commit. "Developer API" card. Reviewed termly.
3. **Weekly Plan & Tasks**: 3-5 concrete commitments. Blockers surface early. Shipping streak. Done/not-done + why.
4. **Hours (Reps)**: Hero, weekly/streak, daily pattern, project breakdown. Microcopy ties hours to stated goals.
5. **Outcomes & Feedback**: Timeline of shipped PRs/features/bugs. Tags: impact, rescue, rework. Reference-worthy events.
6. **Profile & Growth Path**: NOS Level, history, strengths, 2-3 "next unlocks." Links to rubrics and suggested projects.

## API Metaphor Microcopy (per page)

- **Weekly Plan**: "This is your input contract: what you've agreed your API will do this week."
- **Hours**: "These are your throughput logs. Consistent volume is how APIs get trusted with bigger specs."
- **Outcomes**: "This is your error handling and release notes. The goal isn't no bugs; it's fast, honest iteration."

## Microcopy Rules

- Max one sentence per section in v1
- Every line must either tie to career outcome (jobs, projects, references) or prescribe a behavior
- No jokes that undercut seriousness. Light is fine; flippant kills trust
- Coaching in text at the exact moment they see the data — cockpit, not surveillance

## Portal-Wide Future Integrations

### Moxo Form Builder
A separate project has a full Moxo replication with tasking and form builder. Wiley will link the project so we can assess how much to replicate for student portal forms (check-ins, surveys, prioritization exercises, growth path quizzes). For now, the cadence/assignment system in `03-weekly-plans.md` handles structured forms.

### "Last One Standing / First to Go" Survey
Prioritization exercise where students rank which NOS features they'd fight to keep vs. happily cut. Two questions:
- "Which single feature would you fight hardest to keep?" (Last One Standing)
- "Which feature would you be happiest to see gone tomorrow?" (First to Go)
Natural fit for the cadence system as a periodic survey (quarterly?). Deferred until Moxo form builder integration is assessed.

### Recurring Commitments
The `developer_commitments` table (spec'd in `02-student-hours.md`) supports recurrence via `recurrence_rule` (RRULE string). Build in v2 — handles things like "class every Tue/Thu 2-5pm" across the whole portal, not just hours.
