import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Task } from "../types";
import {
  groupTasksByProject,
  groupTasksByDeveloper,
  computeTimeInStatus,
} from "../use-tasks-data";

// ── Helpers ───────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> & { sprint: string; taskNum: number }): Task {
  return {
    title: `Task ${overrides.taskNum}`,
    spec: null,
    status: "pending",
    blockedReason: null,
    type: "feature",
    owner: null,
    complexity: null,
    startedAt: null,
    completedAt: null,
    estimatedMinutes: null,
    actualMinutes: null,
    blowUpRatio: null,
    dependencies: [],
    dependents: [],
    ...overrides,
  };
}

// ── groupTasksByProject ───────────────────────────────────────

describe("groupTasksByProject", () => {
  it("groups tasks into ProjectGroup[] by projectId", () => {
    const sprintProjects = new Map<string, string | null>([
      ["auth-v2", "proj-auth"],
      ["auth-v2-b", "proj-auth"],
      ["dashboard-v1", "proj-dash"],
    ]);

    const tasks: Task[] = [
      makeTask({ sprint: "auth-v2", taskNum: 1, status: "green" }),
      makeTask({ sprint: "auth-v2", taskNum: 2, status: "red" }),
      makeTask({ sprint: "auth-v2-b", taskNum: 1, status: "pending" }),
      makeTask({ sprint: "dashboard-v1", taskNum: 1, status: "red" }),
      makeTask({ sprint: "dashboard-v1", taskNum: 2, status: "green" }),
    ];

    const result = groupTasksByProject(tasks, sprintProjects);

    expect(result).toHaveLength(2);

    const authGroup = result.find((g) => g.projectId === "proj-auth");
    expect(authGroup).toBeDefined();
    expect(authGroup!.sprints).toHaveLength(2);
    expect(authGroup!.sprints.map((s) => s.sprint)).toEqual(["auth-v2", "auth-v2-b"]);
    expect(authGroup!.sprints[0].tasks).toHaveLength(2);
    expect(authGroup!.sprints[1].tasks).toHaveLength(1);

    const dashGroup = result.find((g) => g.projectId === "proj-dash");
    expect(dashGroup).toBeDefined();
    expect(dashGroup!.sprints).toHaveLength(1);
    expect(dashGroup!.sprints[0].tasks).toHaveLength(2);
  });

  it("puts tasks with null projectId into 'unassigned' group", () => {
    const sprintProjects = new Map<string, string | null>([
      ["orphan-sprint", null],
      ["known-sprint", "proj-a"],
    ]);

    const tasks: Task[] = [
      makeTask({ sprint: "orphan-sprint", taskNum: 1 }),
      makeTask({ sprint: "known-sprint", taskNum: 1 }),
    ];

    const result = groupTasksByProject(tasks, sprintProjects);
    const unassigned = result.find((g) => g.projectId === null);
    expect(unassigned).toBeDefined();
    expect(unassigned!.sprints).toHaveLength(1);
    expect(unassigned!.sprints[0].sprint).toBe("orphan-sprint");
  });

  it("returns empty array for empty tasks", () => {
    const result = groupTasksByProject([], new Map());
    expect(result).toEqual([]);
  });

  it("preserves task sort order within sprint groups (by taskNum)", () => {
    const sprintProjects = new Map<string, string | null>([["s1", "p1"]]);
    const tasks: Task[] = [
      makeTask({ sprint: "s1", taskNum: 3 }),
      makeTask({ sprint: "s1", taskNum: 1 }),
      makeTask({ sprint: "s1", taskNum: 2 }),
    ];

    const result = groupTasksByProject(tasks, sprintProjects);
    const taskNums = result[0].sprints[0].tasks.map((t) => t.taskNum);
    expect(taskNums).toEqual([1, 2, 3]);
  });
});

// ── groupTasksByDeveloper ─────────────────────────────────────

describe("groupTasksByDeveloper", () => {
  it("groups tasks by owner name across all sprints", () => {
    const tasks: Task[] = [
      makeTask({ sprint: "s1", taskNum: 1, owner: { name: "alice" }, status: "red" }),
      makeTask({ sprint: "s1", taskNum: 2, owner: { name: "bob" }, status: "green" }),
      makeTask({ sprint: "s2", taskNum: 1, owner: { name: "alice" }, status: "green" }),
      makeTask({ sprint: "s2", taskNum: 2, owner: { name: "bob" }, status: "pending" }),
    ];

    const result = groupTasksByDeveloper(tasks);

    expect(result).toHaveLength(2);

    const alice = result.find((g) => g.developer === "alice");
    expect(alice).toBeDefined();
    expect(alice!.tasks).toHaveLength(2);
    expect(alice!.tasks.map((t) => `${t.sprint}::${t.taskNum}`)).toEqual(["s1::1", "s2::1"]);

    const bob = result.find((g) => g.developer === "bob");
    expect(bob).toBeDefined();
    expect(bob!.tasks).toHaveLength(2);
  });

  it("groups unassigned tasks under 'unassigned'", () => {
    const tasks: Task[] = [
      makeTask({ sprint: "s1", taskNum: 1, owner: null }),
      makeTask({ sprint: "s1", taskNum: 2, owner: { name: "alice" } }),
    ];

    const result = groupTasksByDeveloper(tasks);
    const unassigned = result.find((g) => g.developer === "unassigned");
    expect(unassigned).toBeDefined();
    expect(unassigned!.tasks).toHaveLength(1);
  });

  it("returns empty array for empty tasks", () => {
    const result = groupTasksByDeveloper([]);
    expect(result).toEqual([]);
  });

  it("sorts developer groups alphabetically", () => {
    const tasks: Task[] = [
      makeTask({ sprint: "s1", taskNum: 1, owner: { name: "charlie" } }),
      makeTask({ sprint: "s1", taskNum: 2, owner: { name: "alice" } }),
      makeTask({ sprint: "s1", taskNum: 3, owner: { name: "bob" } }),
    ];

    const result = groupTasksByDeveloper(tasks);
    expect(result.map((g) => g.developer)).toEqual(["alice", "bob", "charlie"]);
  });
});

// ── computeTimeInStatus ───────────────────────────────────────

describe("computeTimeInStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns formatted duration for red task with startedAt", () => {
    // Set "now" to a known time
    const now = new Date("2025-03-01T12:00:00Z");
    vi.setSystemTime(now);

    const task = makeTask({
      sprint: "s1",
      taskNum: 1,
      status: "red",
      startedAt: "2025-03-01T09:30:00Z", // 2.5 hours ago
    });

    const result = computeTimeInStatus(task);
    expect(result).toBe("2.5h");
  });

  it("returns dash for pending task", () => {
    const task = makeTask({
      sprint: "s1",
      taskNum: 1,
      status: "pending",
      startedAt: null,
    });

    const result = computeTimeInStatus(task);
    expect(result).toBe("\u2014");
  });

  it("returns dash for green (completed) task", () => {
    const task = makeTask({
      sprint: "s1",
      taskNum: 1,
      status: "green",
      startedAt: "2025-03-01T09:00:00Z",
      completedAt: "2025-03-01T10:00:00Z",
    });

    const result = computeTimeInStatus(task);
    expect(result).toBe("\u2014");
  });

  it("returns dash for blocked task without startedAt", () => {
    const task = makeTask({
      sprint: "s1",
      taskNum: 1,
      status: "blocked",
      startedAt: null,
    });

    const result = computeTimeInStatus(task);
    expect(result).toBe("\u2014");
  });

  it("handles red task started minutes ago", () => {
    const now = new Date("2025-03-01T12:00:00Z");
    vi.setSystemTime(now);

    const task = makeTask({
      sprint: "s1",
      taskNum: 1,
      status: "red",
      startedAt: "2025-03-01T11:45:00Z", // 15 minutes ago
    });

    const result = computeTimeInStatus(task);
    expect(result).toBe("15m");
  });

  it("handles red task started days ago", () => {
    const now = new Date("2025-03-04T12:00:00Z");
    vi.setSystemTime(now);

    const task = makeTask({
      sprint: "s1",
      taskNum: 1,
      status: "red",
      startedAt: "2025-03-01T12:00:00Z", // 3 days ago
    });

    const result = computeTimeInStatus(task);
    expect(result).toBe("3.0d");
  });

  it("computes time for blocked task with startedAt", () => {
    const now = new Date("2025-03-01T14:00:00Z");
    vi.setSystemTime(now);

    const task = makeTask({
      sprint: "s1",
      taskNum: 1,
      status: "blocked",
      startedAt: "2025-03-01T10:00:00Z", // 4 hours ago
    });

    const result = computeTimeInStatus(task);
    expect(result).toBe("4.0h");
  });
});
