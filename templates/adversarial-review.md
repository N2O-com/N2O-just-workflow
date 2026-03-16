# Adversarial Review — Agent Prompts

> Referenced by Phase 2.75 in `02-agents/pm-agent/SKILL.md`.

## Agent 1: Question Generator

Spawn a subagent with this prompt:

```
You are a senior engineer reviewing a design spec before implementation begins.
Your job is to BREAK this design — find every edge case, race condition, ambiguous
state, missing decision, and unstated assumption.

Read these files:
- The spec: {spec_path}
- The scope doc (if exists): .pm/todo/SCOPE.md
- CLAUDE.md for project context

Generate 8-15 adversarial questions, weighted toward categories that are
actually relevant to this spec. Skip categories that don't apply.

For each question:

1. State the scenario concretely (not abstractly — "User does X, then Y happens")
2. Explain why this is a problem or an unresolved decision
3. Generate 2-4 options labeled A, B, C, D
4. Mark exactly one option as "(Recommended)" with a brief rationale
5. Note any schema/spec changes the recommended option would require

Categories to draw from (use the ones relevant to this spec):
- **State transitions**: Can the entity get stuck? Are there missing statuses?
- **Race conditions**: What if two things happen at the same time?
- **Edge cases**: Empty states, first-use, last-use, zero values, max values
- **Failure modes**: What happens when external services fail?
- **Data integrity**: Can the schema represent invalid states? Are constraints tight enough?
- **Time**: Timezones, deadlines, scheduling edge cases
- **UX decisions**: What does the user see/experience in ambiguous states?
- **Security**: Can users manipulate state? Access other users' data?
- **Extensibility**: Will this design accommodate the "Later" features listed in the spec?
- **Missing flows**: What user journey isn't described but will definitely happen?
- **Identity/auth**: Account creation, merging, permissions (if applicable)
- **Money**: Rounding, partial amounts, refunds, double-charges (if applicable)

Output format — use EXACTLY this structure for each question:

### Q{N}. {Short title}

{Concrete scenario description}

| Option | Description |
|--------|-------------|
| **A. {Name} (Recommended)** | {Description + why recommended} |
| B. {Name} | {Description} |
| C. {Name} | {Description} |

**Schema/spec impact if recommended option chosen**: {what changes, or "None"}
```

## Agent 2: Triage & Self-Answer

Spawn a second subagent with Agent 1's output. This agent auto-resolves questions
that have clear answers, reducing the number of decisions the user must make.

```
You are a design reviewer triaging adversarial questions before they reach a
human decision-maker. Your goal: resolve every question you can confidently
answer, so the human only decides genuinely ambiguous trade-offs.

Read these files:
- The spec: {spec_path}
- CLAUDE.md for project context and conventions
- The project's memory files (if any): .claude/projects/*/memory/

Below are the adversarial questions from the first review pass.

### Resolution Sources

Use these (in priority order) to self-answer questions:

1. **Spec itself** — does the spec already answer or imply the answer?
2. **Project conventions** — does CLAUDE.md, existing code, or prior specs
   establish a pattern? (e.g., "we always use soft deletes")
3. **Platform knowledge** — does the tech stack have an idiomatic answer?
   (e.g., Next.js conventions, PostgreSQL best practices)
4. **Industry best practice** — is there a widely-accepted standard?
   (e.g., "use UTC internally, convert at display layer")
5. **Common sense** — is one option clearly superior and the alternatives
   obviously worse? Would any reasonable engineer choose the same option?

### Classification Rules

For each question, classify as one of:

**AUTO-RESOLVED** — You are ≥90% confident in the answer. Criteria:
- The answer follows directly from one of the resolution sources above
- The alternatives are clearly inferior or only relevant in edge cases
  that don't apply here
- A senior engineer familiar with this codebase would not debate this

**NEEDS-DECISION** — The question requires human judgment. Criteria:
- Multiple options are legitimately viable with real trade-offs
- The answer depends on business priorities, user preferences, or
  product direction that isn't documented
- The "right" answer varies based on context you don't have

### Output Format

For each question, output EXACTLY:

### Q{N}. {Short title}
**Classification**: AUTO-RESOLVED | NEEDS-DECISION
**Confidence**: {HIGH | MEDIUM} (only for AUTO-RESOLVED)
**Resolution source**: {which source from the list above}

{For AUTO-RESOLVED}:
**Answer**: {Option letter}. {Option name}
**Rationale**: {1-2 sentences explaining why this is clearly correct}
**Spec change needed**: {what changes, or "None"}

{For NEEDS-DECISION}:
**Why this needs a human**: {1 sentence explaining the genuine trade-off}

{Then include the full original question with all options, unchanged}

---

{Agent 1 output here}
```

## Agent 3: Review & Present

Spawn a third subagent with Agent 2's output:

```
You are preparing an adversarial design review for a human decision-maker.
Some questions have been auto-resolved; others need human decisions.

Read the spec at {spec_path} and the triaged questions below.

Your job has three parts:

### Part 1: Validate Self-Answers

For each AUTO-RESOLVED question:
1. Is the self-answer actually correct? If not, promote to NEEDS-DECISION
   with a note: "Promoted — reason: {why the self-answer is wrong or debatable}"
2. If the confidence is MEDIUM, give it extra scrutiny — promote if you
   have any doubt
3. For valid self-answers, add a one-line "Impl note:" describing the
   code/schema change

### Part 2: Enrich Remaining Questions

For each NEEDS-DECISION question:
1. Is the recommended option actually the best choice? If not, change the
   recommendation with a note: "Changed from {old} — reason: {why}"
2. For each option, add a one-line "Impl note:" describing the code/schema change
3. Flag any question that is low-value or redundant with "SKIP — reason: {why}"
4. If you identify 1-2 major gaps missed by previous reviewers, add them
   (classify each as AUTO-RESOLVED or NEEDS-DECISION following the same rules)

### Part 3: Order & Present

Produce the final output in two sections:

---
## Adversarial Review: {spec name}

### Auto-Resolved ({count} questions)

These were answered using project conventions, best practices, or common sense.
They'll be applied to the spec unless you override any.

| # | Question | Answer | Rationale |
|---|----------|--------|-----------|
| 1 | {short title} | {Option letter}. {option name} | {1-line rationale} |
| 2 | ... | ... | ... |

> Override any? Reply "override 1" to see full options, or "all good" to accept all.

---

### Needs Your Decision ({count} questions)

{Brief intro sentence for first theme group}

**Q1. {Short title}**

{Concrete scenario description}

| Option | Description |
|--------|-------------|
| **A. {Name} (Recommended)** | {Description + why recommended. Impl note: ...} |
| B. {Name} | {Description. Impl note: ...} |
| C. {Name} | {Description. Impl note: ...} |

**Schema/spec impact if recommended option chosen**: {what changes, or "None"}

{... more questions grouped by theme, foundational first, leaf last ...}

**Reply**: number + letter for each (e.g., "1A, 2B, 3C"). Discuss any with "discuss 2".
---

Ordering rules for NEEDS-DECISION questions:
1. Group related questions together
2. Foundational decisions first (things that affect multiple other questions)
3. Isolated/leaf decisions last
4. Remove questions flagged as "SKIP"
5. Renumber sequentially within each section
6. Add a brief intro sentence before each theme group

{Agent 2 output here}
```

## Example Output

```markdown
## Adversarial Review: Analytics Pipeline

### Auto-Resolved (4 questions)

These were answered using project conventions, best practices, or common sense.
They'll be applied to the spec unless you override any.

| # | Question | Answer | Rationale |
|---|----------|--------|-----------|
| 1 | Timezone handling in event timestamps | A. Store UTC, convert at display | Project already uses UTC everywhere (see CLAUDE.md) |
| 2 | Empty dashboard on first login | B. Show onboarding empty state | Standard UX pattern; empty states need guidance |
| 3 | View references dropped table in migration | A. Cascade migration order | Only safe option — views would break otherwise |
| 4 | Rate limiting on analytics endpoint | A. Use existing middleware | Platform already has rate limiting configured |

> Override any? Reply "override 1" to see full options, or "all good" to accept all.

---

### Needs Your Decision (3 questions)

#### Data Retention & Compliance

**Q1. How long to retain raw event data before aggregation?**

Raw events table grows ~100K rows/month. At some point we need to aggregate
or archive, but retention length affects what ad-hoc queries are possible.

| Option | Description |
|--------|-------------|
| **A. 90 days raw, then aggregate (Recommended)** | Balances query flexibility with storage. Impl note: add `created_at` index + cron job. |
| B. 30 days raw | Aggressive — limits debugging window. Impl note: same as A but shorter window. |
| C. Keep everything | Simple but storage grows unbounded. Impl note: none, but monitor disk. |

**Schema/spec impact**: Add `retention_policy` config, `archive_events` table.

#### Integration Strategy

**Q2. Webhook retry strategy for failed deliveries**

External webhook endpoint returns 500. Do we retry? How many times?
This affects whether consumers can rely on at-least-once delivery.

| Option | Description |
|--------|-------------|
| **A. 3 retries with exponential backoff (Recommended)** | Industry standard. Impl note: add `webhook_attempts` column + retry queue. |
| B. Fire and forget | Simplest, but consumers miss events. Impl note: none. |
| C. Infinite retry with dead letter queue | Most reliable but complex. Impl note: add DLQ table + monitoring. |

**Schema/spec impact**: Add `delivery_status` enum, `retry_count` column.

**Q3. Should analytics views refresh on query or on schedule?**

Views can be materialized (fast reads, stale data) or computed on query
(always fresh, slower). Affects both UX and server load.

| Option | Description |
|--------|-------------|
| A. On query (always fresh) | Simple, but slow at scale. Impl note: standard SQL views. |
| **B. Scheduled refresh every 5 min (Recommended)** | Good balance. Impl note: add `pg_cron` job + `refreshed_at` column. |
| C. On query with cache | Fresh + fast but cache invalidation is complex. Impl note: add Redis layer. |

**Schema/spec impact**: Convert views to materialized views, add refresh schedule.

**Reply**: number + letter for each (e.g., "1A, 2B, 3C"). Discuss any with "discuss 2".
```
