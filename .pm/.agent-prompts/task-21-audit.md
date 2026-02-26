Invoke /tdd-agent for this task — specifically the AUDIT phase (Pattern Compliance, Gap Analysis, Testing Posture).

Task: Audit all Phase 2 test deliverables (Tasks 6, 7, 12, 16) against coordination goals + TDD retrofit (coordination sprint task 21).

Context: Tasks 6, 7, 12, and 16 were implemented in parallel WITHOUT tdd-agent. Tests exist but may be implementation-after-the-fact rather than spec-first. Three of these tasks modified merge-queue.sh independently — potential conflicts. This audit verifies quality, coverage, and integration.

Files to audit (spin up one sub-agent per file, all in parallel):
1. tests/test-n2o-claim-supabase.sh — Task 6 (optimistic claiming + Supabase verification)
2. tests/test-n2o-sync-hooks.sh — Task 7 (event-driven sync + git hooks)
3. tests/test-merge-conflicts.sh — Task 12 (conflict notification + escalation)
4. tests/test-resolve-conflict.sh — Task 12 (AI conflict auto-resolution)
5. tests/test-n2o-claim.sh — Task 16 additions (auto-claim on completion)

For each file, each sub-agent runs 3 checks:
- Pattern Compliance: Does it follow the established bash test harness (setup/teardown, mock curl, assert_* helpers)? Consistent with tests/test-n2o-supabase.sh patterns?
- Gap Analysis: Map each test to a coordination goal (A-H2 from specs/coordination.md). Which goals have NO coverage? Does each test verify a done_when criterion?
- Testing Posture + Litmus Test: For every test, ask "If I break the functionality, does this test fail?" Flag fake tests: existence checks without content verification, mock calls without response validation, assertions on variables instead of behavior.

Goal coverage matrix to verify:
| Goal | Expected Coverage |
|------|---|
| A. Parallel Execution | Concurrent claim contention (test-n2o-claim.sh) |
| B. Task Coordination | Supabase accept/reject (test-n2o-claim-supabase.sh) |
| C. Isolation | Conflict detection at merge (test-merge-conflicts.sh) |
| D. Conflict Resolution | Auto-resolve imports/disjoint, escalation (test-resolve-conflict.sh) |
| E. Sync & Visibility | Hook triggers, non-blocking sync (test-n2o-sync-hooks.sh) |
| F. Multi-Machine | Supabase rejection on cross-machine claim (test-n2o-claim-supabase.sh) |
| G. Developer Experience | Session hook auto-claim, zero manual steps (test-n2o-claim.sh) |

CRITICAL: merge-queue.sh integration check (main agent, not sub-agent):
- scripts/coordination/merge-queue.sh was touched by Tasks 7, 12, and 16 independently. Check for conflicting modifications. Verify the file is internally consistent — conflict detection (Task 12) feeds into auto-claim (Task 16) feeds into sync (Task 7).
- Run ALL test suites together: bash tests/test-n2o-claim.sh && bash tests/test-n2o-claim-supabase.sh && bash tests/test-n2o-sync-hooks.sh && bash tests/test-merge-conflicts.sh && bash tests/test-resolve-conflict.sh

Output: Consolidated audit report with:
- Per-file testing posture grade (target: A)
- Goal coverage matrix (every goal mapped to test cases, gaps highlighted)
- Fake tests found (file + line + why it fails litmus)
- merge-queue.sh integration status (clean / conflicted / needs manual merge)
- Gap list with recommended new tests
- Final recommendation: READY TO COMMIT / NEEDS FIX

Done when: All files audited with grades. Goal coverage matrix complete. All tests pass together (no regressions). No fake tests remain. merge-queue.sh verified as internally consistent. Gap list produced.

When complete, update the task database: sqlite3 .pm/tasks.db "UPDATE tasks SET status = 'green' WHERE sprint = 'coordination' AND task_num = 21;"
