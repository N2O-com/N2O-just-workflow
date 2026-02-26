Invoke /pm-agent for this task. This is a planning/design task, not implementation.

Task: Design spike — Developer Digital Twin fields + routing data model (coordination sprint task 8).

Context: The coordination system needs a Developer Digital Twin — a data model tracking each engineer's current context, skills, velocity, and trajectory. The routing algorithm (Task 9) reads from this to decide which developer gets which task. Inspired by VICA's Student Model. The Supabase schema already has a speculative developer_twins table (scripts/coordination/supabase-schema.sql, lines 91-117) but the fields haven't been validated.

Read these files first:
- specs/coordination.md — Goal H (Developer Digital Twin) and Q8 (Routing)
- scripts/coordination/supabase-schema.sql — existing developer_twins table
- .pm/schema.sql — local SQLite schema, any developer-related tables
- scripts/coordination/supabase-client.sh — supabase_update_twin(), supabase_get_twin()
- scripts/n2o-session-hook.sh — what data is available at session start
- scripts/coordination/claim-task.sh — what data is available at claim time

8 design questions to answer with concrete decisions (not hedging):
1. Field-level contract: For each twin field — what values, where from, grounded or speculative, staleness tolerance?
2. Loaded context population: How do we know which files/modules are "loaded"? From git diff? Previous path_history? Task description? When cleared?
3. Path history granularity: Files touched from git? Per-task or per-commit? How far back? Include tests?
4. Trajectory source: pm-agent decomposition, dependency chains, or feature ownership? Populated at task creation or computed at claim time?
5. Availability data sources: Config (hours_per_day) vs session hooks (elapsed) vs pattern inference (usual schedule). Formula for remaining time?
6. Velocity profile structure: Just avg_hours_per_task, or also blow-up ratio, reversions, confidence? Per-type or per-complexity?
7. Routing interface contract: Which fields required vs optional? What happens if NULL? Fallback behavior?
8. MVP scope for Task 9: Which fields are in scope NOW, which are deferred? Minimum viable twin?

Deliverable: A design doc (specs/developer-twin.md) with:
- Twin field reference table (name, type, source, grounding status, update frequency, staleness tolerance)
- Data flow diagram (session hooks to git events to task completion to twin)
- Interface contract for routing algorithm
- Population plan per field
- MVP scope for Task 9
- VICA Student Model mapping

Done when: Every field justified (not speculative). Data flow unambiguous. Routing interface precisely specified. MVP scoped. All 8 questions answered with concrete decisions. Ready for a developer to implement from, no follow-up needed.

When complete, update the task database: sqlite3 .pm/tasks.db "UPDATE tasks SET status = 'green' WHERE sprint = 'coordination' AND task_num = 8;"
