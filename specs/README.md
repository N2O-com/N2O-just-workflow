# Specs

> Design documents, backlog, and deferred ideas — all in one place.

## Spec Registry

| Spec | Status | Goal | Description |
|------|--------|------|-------------|
| [n2o-roadmap.md](active/n2o-roadmap.md) | Active | — | Master roadmap: 8 goals, dependency map, implementation phases |
| [rollout-goals.md](active/rollout-goals.md) | Active | — | Four adoption goals: available, improveable, data-complete, accelerating |
| [metrics-definition.md](active/metrics-definition.md) | Active | 7 | Eight leadership metrics bridging Output/Hour x Tool Leverage |
| [observability.md](done/observability.md) | Done | 7 | workflow_events table, n2o stats CLI, 11 analytics views |
| [skill-quality.md](active/skill-quality.md) | Partial | 6 | Skill measurement framework: tokens, duration, blow-up factors |
| [coordination.md](active/coordination.md) | Partial | 4, 5 | Multi-agent coordination goals A-H: isolation, claiming, merging, routing |
| [data-platform.md](active/data-platform.md) | Draft | 7 | Three-layer platform: Ontology, Rules Engine, Intelligence |
| [rules-engine.md](active/rules-engine.md) | Draft | 6 | Multi-signal reasoning: deterministic extractors → learned weights → LLM |
| [workflow-coach.md](active/workflow-coach.md) | Draft | 6 | Proactive coaching: workflow, system/environment, tool recommendations |
| [observatory-v2.md](active/observatory-v2.md) | Draft | 7 | RADAR maturity model, equation tree, measurement blind spots |
| [developer-twin.md](active/developer-twin.md) | Designed | 4 | Developer model: loaded context, skill profile, trajectory, availability |
| [parallel-playbook.md](active/parallel-playbook.md) | Designed | 5 | Automated orchestrator: 5 patterns, multi-tier execution, iterative re-planning |
| [agent-teams.md](active/agent-teams.md) | Not Started | 5 | Claude Code Agent Teams integration: auto-teaming, tmux, quality hooks |
| [workflow-dashboard.md](active/workflow-dashboard.md) | Not Started | 7, 8 | Next.js dashboard: sprint progress, task board, velocity charts |
| [subscription-management.md](active/subscription-management.md) | Not Started | 8 | Admin CLI for per-developer Claude subscription tracking |

### By Execution Status

**Done**: [observability](done/observability.md)
**Partial**: [skill-quality](active/skill-quality.md), [coordination](active/coordination.md)
**Active**: [n2o-roadmap](active/n2o-roadmap.md), [rollout-goals](active/rollout-goals.md), [metrics-definition](active/metrics-definition.md)
**Designed**: [developer-twin](active/developer-twin.md), [parallel-playbook](active/parallel-playbook.md)
**Draft**: [data-platform](active/data-platform.md), [rules-engine](active/rules-engine.md), [workflow-coach](active/workflow-coach.md), [observatory-v2](active/observatory-v2.md)
**Not Started**: [agent-teams](active/agent-teams.md), [workflow-dashboard](active/workflow-dashboard.md), [subscription-management](active/subscription-management.md)

---

## Backlog

Active backlog for the N2O workflow framework. Items are pulled from the tasks DB — use `./n2o` for sprint-level execution. Completed proposals live in [`done/`](done/).

**Red** = broken or stalled, needs attention first.

---

### Coordination Reliability

Core agent lifecycle — sessions, heartbeats, cleanup. Most red items live here.

| Task | Title | Status | Horizon |
|------|-------|--------|---------|
| coordination/29 | Fix deregistration trap timing | **red** | active |
| coordination/30 | Add SessionEnd cleanup hook | **red** | active |
| coordination/32 | Add periodic agent heartbeat | **red** | active |
| coordination/15 | E2E integration test: full multi-agent loop | **red** | active |
| coordination/17 | Real-time subscription consumer | **red** | active |
| coordination/31 | Add crash recovery with staleness detection | pending | active |
| coordination/33 | Fix Supabase verification race condition | pending | active |
| coordination/18 | Graceful degradation testing | pending | active |

### Intelligent Routing

Score-based task assignment and file overlap avoidance.

| Task | Title | Status | Horizon |
|------|-------|--------|---------|
| coordination/9 | Routing scoring algorithm | pending | active |
| coordination/10 | File working set tracking + overlap avoidance | pending | active |

### Data Platform

Activity streams UI, schema foundations, and the three-layer intelligence stack.

| Task | Title | Status | Horizon |
|------|-------|--------|---------|
| activity-streams/1 | Build Streams timeline page with gantt bars per developer | pending | active |
| activity-streams/2 | Build Tasks board page with sprint-grouped table | pending | active |
| coordination/23 | Schema foundations for data platform | pending | next |
| coordination/24 | Build GraphQL Ontology API (Layer 1) | pending | next |
| coordination/25 | Investigate GPS rules engine architecture | pending | next |
| coordination/26 | Implement Rules Engine (Layer 2) | pending | later |
| coordination/27 | Build LLM Intelligence Layer (Layer 3) | pending | later |

### Observability & Monitoring

Dashboards, metrics, and developer onboarding.

| Task | Title | Status | Horizon |
|------|-------|--------|---------|
| coordination/13 | Coordination monitoring + observability | pending | active |
| coordination/19 | Developer onboarding flow | pending | active |
| coordination/20 | Metrics dashboard MVP | pending | active |

### Icebox

Parked ideas — revisit when upstream work unlocks them.

| Task | Title | Status | Horizon |
|------|-------|--------|---------|
| coordination/22 | Robust Warp launch-agents pane targeting | **red** | icebox |
| icebox/1 | Dashboard/HTML init interface | pending | icebox |
| icebox/2 | Task routing algorithm | pending | icebox |
| icebox/3 | Intelligent merging / merge queue | pending | icebox |
| icebox/4 | Full A/B testing framework for skills | pending | icebox |

---

## Deferred Ideas

Deferred research and features that aren't blocking rollout but should be tracked.

| Item | Category | Description |
|------|----------|-------------|
| Clawdbot workflow research | Research | Study Clawdbot creator's workflow for high-velocity shipping patterns |
| HTML diagram / theoretical clarity | Documentation | Visual representation of the Output/Hour framework and brain cycle model |
| Git policy documentation | Documentation | Branching strategy, merge conventions, worktree lifecycle for multi-developer teams |
| Supabase setup automation | Tooling | `n2o setup --supabase` to configure URL/key and apply cloud schema |
| NLP-based analysis | Feature | Natural language analysis of transcript content for quality signals |
