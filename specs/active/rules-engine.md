# Rules Engine (Layer 2)

> Multi-signal reasoning engine that combines deterministic signal extractors (1.0), learned combination weights (2.0), and LLM explanation/edge-case handling (3.0) to make ontology-aware decisions.

| Field | Value |
|-------|-------|
| Status | Draft |
| Owner | Wiley |
| Last Updated | 2026-02-23 |
| Depends On | `data-platform.md` (Layer 1 Ontology) |
| Enables | Intelligent task assignment, risk detection, capacity planning, forecasting |

---

## Recent Changes

| Date | What changed | Section |
|------|-------------|---------|
| 2026-02-23 | Added portfolio-level reasoning, feedback loop design, temporal patterns (2.0 extension). V1 objective: optimize for effectiveness. | [Portfolio Reasoning](#portfolio-level-reasoning), [Feedback Loop](#feedback-loop), [Software 2.0](#software-20-learned-combination-weights) |
| 2026-02-23 | Initial draft — Software 1.0/2.0/3.0 architecture, signal extractors, combination model, worked examples | All |

---

## The Problem

Layer 1 (Ontology) stores facts and relationships. But facts alone don't make decisions. The question "who should take this task?" requires combining multiple signals — skill match, current context, historical accuracy, availability, sprint familiarity — into a single recommendation with a confidence score and an explanation.

This is the same pattern as ontological reasoning in other domains (the DLA scrap metal example from `data-platform.md`): visual evidence says 50/50 between two possibilities, but contextual priors from the knowledge graph shift confidence to 95/5. Single signals are ambiguous; combined signals are decisive.

The rules engine is the reasoning layer that sits between "here are the facts" (Layer 1) and "here's what the human asked" (Layer 3).

---

## Software 1.0 / 2.0 / 3.0 Architecture

Using Karpathy's framing:
- **1.0** — humans write explicit code (every rule, threshold, and weight is hand-authored)
- **2.0** — learned parameters (humans define architecture and loss function, data determines the weights)
- **3.0** — LLM-driven (natural language in, reasoning out)

These are **not alternatives**. They are layers that compose. Each handles what it's best at:

```
┌─────────────────────────────────────────────────────────────┐
│  SOFTWARE 3.0 — LLM (Layer 3 Intelligence)                  │
│                                                              │
│  - Explain WHY a decision was made (narrative from scores)   │
│  - Handle novel queries ("is anything weird about this       │
│    sprint?") that don't map to pre-defined rules             │
│  - Resolve ambiguity when 2.0 scores are too close           │
│  - Generate dynamic dashboards from reasoning results        │
│                                                              │
│  Input: signal scores + weights + context                    │
│  Output: human-readable explanation, visualization           │
├─────────────────────────────────────────────────────────────┤
│  SOFTWARE 2.0 — Learned Weights                              │
│                                                              │
│  - Learn optimal signal combination weights from history     │
│  - Predict effectiveness from context variables              │
│  - Estimate task complexity from description + metadata      │
│  - Calibrate confidence thresholds                           │
│                                                              │
│  Input: signal scores (from 1.0) + historical outcomes       │
│  Output: combined confidence score, calibrated prediction    │
├─────────────────────────────────────────────────────────────┤
│  SOFTWARE 1.0 — Deterministic Signal Extractors              │
│                                                              │
│  - Extract individual signals from ontology data             │
│  - Capacity arithmetic (available minutes - committed)       │
│  - Skill match scoring (developer skill vs task type)        │
│  - Blow-up ratio computation (actual / estimated)            │
│  - Context scoring (alertness, concurrent sessions)          │
│  - Sprint familiarity (how many related tasks completed)     │
│                                                              │
│  Input: raw ontology data (via GraphQL)                      │
│  Output: normalized signal scores (0.0-1.0) per signal       │
└─────────────────────────────────────────────────────────────┘
```

### Why this decomposition matters

1. **1.0 is auditable.** Every signal extractor is a pure function: input data, output score. You can unit test it, inspect it, explain it. When something goes wrong, you can trace which signal was off.

2. **2.0 is learnable.** You don't know a priori whether skill match should be 2x more important than availability. But you have historical data — past assignments and their outcomes. The weights emerge from data, not guesswork.

3. **3.0 is flexible.** When a user asks "is anything weird about this sprint?", no pre-defined rule covers that. The LLM reasons over the signal scores and raw data to find anomalies. When two developers score within 5%, the LLM can reason about factors not captured in the numerical model.

4. **Each layer can ship independently.** Start with 1.0 (hand-tuned weights). Add 2.0 when you have enough historical data. 3.0 is already built (Layer 3 Intelligence). No rewiring needed at any transition.

---

## Software 1.0: Signal Extractors

Each signal extractor is a pure function: ontology data in, normalized score (0.0-1.0) out. Higher is always better (more suitable, more available, more capable).

### Signal catalog

| Signal | Question it answers | Input (from ontology) | Output | Normalization |
|--------|--------------------|-----------------------|--------|---------------|
| `skill_match` | How well do this developer's skills match the task? | `developer_skills`, task type/tags | 0.0-1.0 | developer's relevant skill rating / 5.0 |
| `availability` | Does this developer have time? | `contributor_availability`, active task estimates | 0.0-1.0 | remaining_minutes / task_estimated_minutes, clamped to [0,1] |
| `context_focus` | How focused is this developer right now? | `developer_context` (concurrent sessions, alertness) | 0.0-1.0 | alertness * (1 / concurrent_sessions), normalized |
| `sprint_familiarity` | Has this developer worked on related tasks in this sprint? | `tasks` (completed, same sprint) | 0.0-1.0 | related_tasks_completed / total_sprint_tasks, clamped |
| `historical_accuracy` | Does this developer reliably estimate tasks like this? | `effective_velocity` (blow-up ratio by task type) | 0.0-1.0 | 1.0 / blow_up_ratio, clamped to [0,1] (perfect=1.0, 3x blowup=0.33) |
| `recency` | When did this developer last work on something similar? | `tasks` (completed_at, same type) | 0.0-1.0 | exponential decay from last similar task |

### Signal interface

Every signal extractor conforms to the same interface:

```typescript
interface Signal {
  name: string;
  description: string;

  // Pure function: ontology data → score
  extract(context: SignalContext): SignalResult;
}

interface SignalContext {
  task: Task;                    // The task being evaluated
  developer: Developer;          // The developer being considered
  ontology: OntologyClient;      // GraphQL client for additional queries
}

interface SignalResult {
  score: number;                 // 0.0-1.0, higher = better
  confidence: number;            // 0.0-1.0, how much data backs this score
  evidence: string;              // Human-readable: "Luke has backend skill 4.2/5.0"
  dataPoints: number;            // How many observations inform this score
}
```

**Confidence** is distinct from score. A skill_match score of 0.8 with confidence 0.9 (assessed last week, 12 relevant tasks) means something different than 0.8 with confidence 0.2 (no direct skill rating, inferred from one similar task). The combination layer uses confidence to weight how much to trust each signal.

### Capacity rules (deterministic, no scoring needed)

Some rules are boolean gates, not scored signals. These run before signal combination — if a gate fails, the candidate is excluded.

| Gate | Logic | Output |
|------|-------|--------|
| `has_capacity` | `available_minutes - sum(active_task_estimates) >= task_estimate` | pass/fail + reason |
| `no_conflicts` | Developer has no active tasks that depend on or are blocked by this task | pass/fail + reason |
| `status_available` | Developer availability status is not `unavailable` | pass/fail + reason |

---

## Software 2.0: Learned Combination Weights

### Optimization objective

V1 optimizes for a single objective: **effectiveness** — the assignment most likely to produce an on-time, high-quality completion. This means the combined score answers: "which developer will complete this task fastest, with the lowest blow-up ratio, and the best testing posture?"

Other objectives exist (growth/skill-building, fairness/workload balance, knowledge distribution/bus factor reduction) but are deferred. Optimizing for effectiveness first produces the data needed to understand the tradeoffs. Once we can reliably predict effective assignments, we can introduce secondary objectives as tunable parameters — e.g., "optimize 80% for effectiveness, 20% for growth." But effectiveness is the foundation.

### The combination problem

Given 6 signal scores for each developer-task pair, how do you produce a single recommendation?

**Software 1.0 approach (ship first):** Hand-tuned weights.

```typescript
// V1: hand-tuned weights based on intuition
const DEFAULT_WEIGHTS: Record<string, number> = {
  skill_match:          0.25,
  availability:         0.20,
  context_focus:        0.20,
  sprint_familiarity:   0.15,
  historical_accuracy:  0.15,
  recency:              0.05,
};

function combine(signals: SignalResult[], weights: Record<string, number>): number {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const signal of signals) {
    const w = weights[signal.name] * signal.confidence;  // confidence-adjusted weight
    weightedSum += signal.score * w;
    totalWeight += w;
  }

  return weightedSum / totalWeight;  // weighted average, normalized
}
```

This works. It's transparent, testable, and shippable on day one. But the weights are guesses.

**Software 2.0 approach (add when data exists):** Learn the weights from historical outcomes.

The training data is every past assignment:
- **Input**: the 6 signal scores at the time of assignment
- **Outcome**: was the task completed on time? What was the blow-up ratio? Was quality maintained (testing posture A/B)?

This is a straightforward regression/ranking problem:
- **Logistic regression** (simplest): learn weights that predict "successful assignment" (completed on time, blow-up ratio < 1.5, posture A or B)
- **Learning to rank** (better): given two developers for the same task, learn to rank the one who would produce a better outcome higher
- **Contextual bandits** (most sophisticated): treat each assignment as an arm, learn a policy that maximizes outcome quality over time

### What can be learned vs. what should stay 1.0

| Component | 1.0 or 2.0? | Why |
|-----------|-------------|-----|
| Signal extraction (skill_match, availability, etc.) | **1.0 forever** | These are definitions, not predictions. "Skill match = developer rating / 5.0" is a fact, not a learned parameter. |
| Signal combination weights | **Start 1.0, move to 2.0** | We don't know the right weights. Data will tell us. |
| Effectiveness prediction (context → velocity) | **2.0** | The relationship between concurrent_sessions + alertness + hour_of_day and actual velocity is empirical. A regression model learns it from historical data. |
| Task complexity estimation (description → complexity) | **2.0** | Predicting how hard a task will be from its description is a text regression problem. |
| Confidence thresholds ("when is 0.7 high enough?") | **Start 1.0, move to 2.0** | Initially, set thresholds manually (e.g. "recommend if combined score > 0.6"). Learn calibrated thresholds from outcome data. |

### Data requirements for 2.0

The transition from 1.0 to 2.0 weights requires enough historical outcomes to learn from. Rough minimums:

| What | Minimum observations | Why |
|------|---------------------|-----|
| Signal combination weights | ~50-100 completed assignments with outcome data | 6 parameters to learn, need ~10-15x observations per parameter |
| Effectiveness regression | ~30 context snapshots per developer with paired velocity | Need variance in context variables (sessions, alertness, time) |
| Complexity estimation | ~100 tasks with actual_minutes and description text | Text regression needs enough examples to generalize |

Until these thresholds are met, 1.0 hand-tuned weights are the right answer. The system should track when 2.0 becomes viable: "You have 47/100 assignments logged. 2.0 weights available in ~3 weeks at current pace."

### Planned 2.0 extension: temporal patterns

The current signal extractors are point-in-time snapshots. But there are patterns over time that a 2.0 model can learn from historical data:

- **Day-of-week effects**: "Luke is consistently 30% slower on Mondays"
- **Fatigue accumulation**: "Velocity drops after 3 consecutive high-concurrency days"
- **Time-of-day patterns**: "Blow-up ratios spike on tasks started after 6pm"
- **Sprint-phase effects**: "Estimation accuracy degrades in the last 20% of a sprint" (deadline pressure → shortcuts)

The `developer_context` table already captures the raw inputs (hour_of_day, alertness, concurrent_sessions). The `effective_velocity` view pairs these with outcomes. A regression model over context history with time features would surface these patterns automatically.

This is not needed for v1 — the point-in-time `context_focus` signal captures the most important factor (is the developer focused right now?). Temporal features are a refinement that improves prediction accuracy once enough longitudinal data exists.

---

## Software 3.0: LLM as Reasoning Complement

Layer 3 (Intelligence) already exists in the data platform architecture. For the rules engine specifically, the LLM handles three things that 1.0 and 2.0 cannot:

### 1. Explanation generation

Given signal scores and a final recommendation, produce a human-readable explanation.

**Input (from 1.0 + 2.0):**
```json
{
  "recommendation": "Sarah",
  "combined_score": 0.82,
  "signals": {
    "skill_match":         { "score": 0.76, "confidence": 0.9, "evidence": "backend 3.8/5.0" },
    "availability":        { "score": 0.95, "confidence": 1.0, "evidence": "120 min available, task est. 45 min" },
    "context_focus":       { "score": 0.90, "confidence": 0.8, "evidence": "1 session, alertness 0.9" },
    "sprint_familiarity":  { "score": 0.75, "confidence": 0.9, "evidence": "3/8 sprint tasks completed" },
    "historical_accuracy": { "score": 0.91, "confidence": 0.7, "evidence": "1.1x avg blowup on auth tasks" },
    "recency":             { "score": 0.80, "confidence": 0.9, "evidence": "last auth task 2 days ago" }
  },
  "runner_up": {
    "developer": "Luke",
    "combined_score": 0.51,
    "key_weakness": "context_focus: 0.25 (4 concurrent sessions, alertness 0.4)"
  }
}
```

**Output (from 3.0):**
> Sarah is the best fit for "fix auth token refresh" (82% confidence). She has strong backend skills (3.8/5), is focused on a single session right now, and has already completed 3 related auth tasks this sprint with excellent estimation accuracy (1.1x). Luke has slightly higher backend skill (4.2 vs 3.8) but is currently split across 4 sessions with low alertness — his auth tasks have historically blown up 2.8x under similar conditions.

This is what 3.0 is uniquely good at: turning structured scores into a narrative that a human manager can evaluate and trust.

### 2. Novel query handling

Rules handle known questions. The LLM handles unknown questions by reasoning over signal scores and raw data.

- "Is anything weird about this sprint?" — no pre-defined rule, but the LLM can spot that velocity dropped 40% this week, or that one developer has claimed 60% of tasks
- "Should we be worried about the deadline?" — combines forecast rule output with contextual factors the rules don't model (upcoming holiday, team member PTO)

### 3. Ambiguity resolution

When 2.0 combination scores are close (e.g., Sarah 0.72, Luke 0.69), the LLM can reason about qualitative factors:
- "Sarah is already context-loaded on this feature area — the switching cost for Luke would add ~20 minutes that isn't captured in the signals"
- "Luke hasn't had any tasks this sprint — distributing work may be more important than optimizing for this single assignment"

These judgments are inherently qualitative. Encoding them as 1.0 rules would be brittle. Having the LLM reason about them, with the structured scores as context, is the right tool.

---

## Worked Example: End-to-End

**Question**: "Who should take task #7 (fix auth token refresh)?"

### Step 1: Gate checks (1.0)

| Developer | has_capacity | no_conflicts | status_available | Result |
|-----------|-------------|--------------|-----------------|--------|
| Luke | pass (30 min avail, 45 min est — tight) | pass | pass | Candidate |
| Sarah | pass (120 min avail, 45 min est) | pass | pass | Candidate |
| Alex | fail (0 min available) | — | unavailable | **Excluded** |

### Step 2: Signal extraction (1.0)

| Signal | Luke | Sarah |
|--------|------|-------|
| skill_match | 0.84 (backend 4.2/5.0) | 0.76 (backend 3.8/5.0) |
| availability | 0.67 (30/45 min, tight) | 1.00 (120/45 min, plenty) |
| context_focus | 0.25 (4 sessions, alertness 0.4) | 0.90 (1 session, alertness 0.9) |
| sprint_familiarity | 0.00 (0 tasks in sprint) | 0.38 (3/8 tasks completed) |
| historical_accuracy | 0.36 (2.8x avg blowup on auth) | 0.91 (1.1x avg blowup on auth) |
| recency | 0.30 (last auth task 3 weeks ago) | 0.80 (last auth task 2 days ago) |

### Step 3: Weighted combination (1.0 hand-tuned → 2.0 learned)

Using default weights: skill=0.25, avail=0.20, focus=0.20, familiarity=0.15, accuracy=0.15, recency=0.05

| | Luke | Sarah |
|--|------|-------|
| **Combined score** | **0.44** | **0.82** |

Sarah wins decisively. The single signal favoring Luke (skill match, +0.08) is overwhelmed by five signals favoring Sarah.

### Step 4: Explanation (3.0)

The LLM receives the structured scores and produces the narrative shown above.

### Step 5: Output via GraphQL

```graphql
query {
  recommendAssignment(taskId: 7) {
    recommendation {
      developer { name }
      combinedScore
      confidence
      explanation          # LLM-generated narrative
      signals {
        name
        score
        evidence
      }
    }
    alternatives {
      developer { name }
      combinedScore
      keyGap               # biggest signal deficit vs winner
    }
  }
}
```

---

## Implementation Sequence

| Step | What | Software version | Blocked on |
|------|------|-----------------|-----------|
| 1 | Define signal extractor interface + implement all 6 signals | 1.0 | Layer 1 Ontology (data access) |
| 2 | Implement gate checks (capacity, conflicts, availability) | 1.0 | Layer 1 |
| 3 | Implement weighted combination with hand-tuned weights (objective: effectiveness) | 1.0 | Step 1 |
| 4 | Expose via GraphQL (`recommendAssignment`, `assessRisk`, `forecastSprint`) | 1.0 | Step 3, Layer 1 |
| 5 | Implement `recommendation_log` table + automatic outcome capture (see [Feedback Loop](#feedback-loop)) | 1.0 | Step 4 |
| 6 | Wire Layer 3 `execute_rule` tool to rules engine | 3.0 | Step 4 |
| 7 | Learn combination weights from outcome data (when N > 50-100) | 2.0 | Step 5 + sufficient data |
| 8 | Learn effectiveness prediction (context → velocity regression) | 2.0 | Sufficient `developer_context` + `effective_velocity` data |
| 9 | Learn complexity estimation (task description → estimated minutes) | 2.0 | Sufficient task completion data |
| 10 | Temporal pattern features (day-of-week, fatigue, time-of-day) | 2.0 | Step 8 + longitudinal data |
| 11 | Portfolio-level reasoning (multi-task assignment optimization) | 1.0 | Step 4 + team size ≥ 4 |

Steps 1-6 are the MVP. Step 5 (feedback loop) ships with the MVP because it's the foundation for everything that follows — without outcome data, 2.0 never activates. Steps 7-10 activate when data thresholds are met. Step 11 activates when team size makes portfolio optimization visibly better than pairwise.

---

## Rule Categories

The signal-combination pattern applies to assignment. Other rule categories use the same architecture but with different signals:

### Risk assessment ("Is this sprint at-risk?")

| Signal | What it measures | Source |
|--------|-----------------|--------|
| `velocity_trend` | Is the team completing tasks faster or slower than last week? | `effective_velocity` rolling window |
| `remaining_ratio` | Remaining work / remaining time | `sprint_forecast` view |
| `blocked_count` | How many tasks are blocked right now? | `tasks` where status = blocked |
| `dependency_depth` | What's the longest unresolved dependency chain? | `task_dependencies` traversal |
| `estimation_drift` | Are tasks blowing up more than usual this sprint? | `effective_velocity` this sprint vs historical |

Combined score → risk level (low / medium / high / critical) with explanation.

### Forecasting ("When will this sprint finish?")

| Signal | What it measures | Source |
|--------|-----------------|--------|
| `remaining_minutes` | Sum of estimated minutes for incomplete tasks | `tasks` |
| `team_velocity` | Adjusted minutes completed per day (context-weighted) | `effective_velocity` + `developer_context` |
| `availability_forward` | Total available minutes across team for remaining days | `contributor_availability` |
| `blowup_adjustment` | Historical blowup factor for this sprint's task types | `effective_velocity` by type |

Output → date range (optimistic / expected / pessimistic) with confidence interval.

---

## Portfolio-Level Reasoning

The signal-combination model above answers "who is the best developer for this task?" — a pairwise evaluation. But real assignment decisions are often portfolio problems: "how should we distribute the remaining 8 tasks across 3 developers to maximize sprint completion?"

These are different questions. Assigning task #7 to Sarah might be locally optimal (highest combined score), but if task #12 arriving tomorrow is a harder auth problem that only Sarah can handle, the globally optimal move is to give #7 to Luke now and reserve Sarah's capacity.

### What portfolio reasoning adds

| Level | Question | Method |
|-------|----------|--------|
| **Pairwise** (current) | "Best developer for this task" | Signal extraction → weighted combination → rank |
| **Portfolio** (planned) | "Best assignment of N tasks across M developers" | Pairwise scores as input → optimization over the assignment matrix |

The pairwise scoring is still the foundation. Portfolio reasoning is a layer on top that considers:

- **Capacity allocation**: don't assign 5 tasks to the person with 60 minutes available
- **Dependency ordering**: if task B depends on task A, the developer doing A should probably not also be blocking on B
- **Upcoming work**: if a high-priority task is expected soon, reserve the best-fit developer's capacity
- **Diminishing returns**: the 3rd auth task assigned to Sarah has less marginal value than spreading auth knowledge

### Implementation approach

This is a constrained optimization problem. For the scale we're operating at (3-8 developers, 5-20 tasks per sprint), it's small enough to solve exactly:

1. Compute the full pairwise score matrix: every developer × every unassigned task
2. Apply capacity constraints (each developer's available minutes)
3. Apply dependency constraints (ordering requirements)
4. Find the assignment that maximizes total combined score across all tasks

For small teams, this is a straightforward assignment problem (Hungarian algorithm or even brute-force for N < 10). For larger teams, it becomes a linear programming problem — still tractable at any realistic scale.

### When to build this

Portfolio reasoning is a v2 feature. The pairwise model ships first because:
1. It's simpler and immediately useful
2. It generates the outcome data needed to validate portfolio-level decisions
3. Most day-to-day usage is "who should take this one task?" not "rebalance the whole sprint"

The portfolio layer activates when the team reaches a size where local optimization visibly diverges from global optimization — probably 4+ developers working concurrently on the same sprint.

---

## Feedback Loop

The feedback loop is not optional infrastructure — it's the mechanism that enables 2.0 and validates 1.0. Without it, the rules engine is a black box that makes recommendations nobody can verify.

### What to track

For every recommendation the rules engine produces:

| Field | What | When captured |
|-------|------|---------------|
| `recommendation_id` | Unique ID | At recommendation time |
| `rule_type` | `assignment`, `risk`, `forecast` | At recommendation time |
| `task_id` | The task being evaluated | At recommendation time |
| `recommended_developer` | Who the engine suggested | At recommendation time |
| `combined_score` | The winning score | At recommendation time |
| `signal_snapshot` | Full signal scores for all candidates (JSON) | At recommendation time |
| `actual_developer` | Who was actually assigned | When task is claimed/assigned |
| `recommendation_followed` | Did they follow the suggestion? | Derived: recommended == actual |
| `outcome_blowup_ratio` | actual_minutes / estimated_minutes | When task completes |
| `outcome_testing_posture` | A/B/C/D/F | When task completes |
| `outcome_completed_on_time` | Finished before sprint deadline? | When task completes |

### Schema

```sql
CREATE TABLE IF NOT EXISTS recommendation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- What was recommended
    rule_type TEXT NOT NULL,
    sprint TEXT,
    task_num INTEGER,
    recommended_developer TEXT,
    combined_score REAL,
    runner_up_developer TEXT,
    runner_up_score REAL,
    signal_snapshot TEXT,             -- JSON: full signal scores for all candidates

    -- What actually happened
    actual_developer TEXT,
    recommendation_followed BOOLEAN,
    outcome_blowup_ratio REAL,
    outcome_testing_posture TEXT,
    outcome_completed_on_time BOOLEAN,
    outcome_recorded_at DATETIME,

    FOREIGN KEY (sprint, task_num) REFERENCES tasks(sprint, task_num),
    CHECK (rule_type IN ('assignment', 'risk', 'forecast')),
    CHECK (outcome_testing_posture IS NULL OR outcome_testing_posture IN ('A', 'B', 'C', 'D', 'F'))
);

CREATE INDEX IF NOT EXISTS idx_rec_log_task ON recommendation_log(sprint, task_num);
CREATE INDEX IF NOT EXISTS idx_rec_log_type ON recommendation_log(rule_type, created_at DESC);
```

### How outcomes are captured

The outcome columns fill in asynchronously as work progresses:

1. **Recommendation created** → `recommendation_id`, `recommended_developer`, `signal_snapshot` filled
2. **Task claimed/assigned** → `actual_developer`, `recommendation_followed` filled (can be automated: compare claimed_by with recommended_developer)
3. **Task completed** → `outcome_blowup_ratio`, `outcome_testing_posture`, `outcome_completed_on_time` filled (automated from task completion data)

No manual UX needed for the core loop. The system observes what happened. The only case requiring input is when a recommendation is explicitly overridden — and even that can be inferred from the data (recommended Sarah, Luke claimed it → not followed).

### What the feedback data enables

- **1.0 validation**: "Recommendations that were followed had a 1.2x avg blowup ratio. Recommendations that were overridden had 1.8x. The engine is adding value."
- **2.0 training**: the `signal_snapshot` + `outcome_*` columns are exactly the training data for learned weights (input features → outcome labels)
- **Drift detection**: "Override rate jumped from 15% to 40% this week — hand-tuned weights may need adjustment, or the team composition changed"
- **2.0 readiness tracking**: "87/100 outcomes logged. Learned weights available in ~1 week."

---

## Open Questions

1. **Weight initialization** — the hand-tuned default weights (skill=0.25, avail=0.20, focus=0.20, familiarity=0.15, accuracy=0.15, recency=0.05) are guesses. Should we run a lightweight survey or expert elicitation before shipping 1.0?
2. **Signal independence** — the combination model assumes signals are roughly independent. In reality, context_focus and historical_accuracy may correlate (distracted developers blow up more). Should the 2.0 model account for interaction effects?
3. **Per-task-type weights** — should assignment weights vary by task type? Backend infra tasks might weight historical_accuracy more heavily; frontend tasks might weight recency more. This is learnable in 2.0 but adds complexity.
4. **Cold start** — new developers have no historical data. How should signals with confidence=0.0 be handled? Current approach: fall back to baseline_competency and increase weight on available signals. Is this sufficient?
5. **Retraining cadence** — when 2.0 weights are active, how often should they retrain? After every N assignments? On a schedule? Triggered by drift detection?
6. **Secondary objectives** — v1 optimizes for effectiveness only. When should growth, fairness, and knowledge distribution be introduced as tunable objectives? What's the UX for a manager to say "optimize 80% effectiveness, 20% growth"?

---

## References

- `data-platform.md` — Layer 1 Ontology, Layer 3 Intelligence, schema definitions
- Karpathy, "Software 2.0" (2017) — framing for learned vs hand-coded systems
- DLA scrap metal identification — analogy for multi-signal ontological reasoning (see `data-platform.md`, Layer 2 section)
