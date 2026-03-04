import { describe, it, expect, beforeAll, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, wrapDbAsPool, seedTestData } from "./test-helpers.js";
import { createLoaders } from "../loaders.js";
import { SupabasePool } from "../db.js";

// ── Loaders ───────────────────────────────────────────────

describe("DataLoader batching", () => {
  let db: Database.Database;
  let pool: any;
  let loaders: ReturnType<typeof createLoaders>;

  beforeAll(() => {
    db = createTestDb();
    seedTestData(db);
    pool = wrapDbAsPool(db);
    loaders = createLoaders(pool);
  });

  it("developer loader resolves by name", async () => {
    const result = await loaders.developer.load("alice");
    expect(result).not.toBeNull();
    expect(result.name).toBe("alice");
    expect(result.full_name).toBe("Alice Smith");
  });

  it("developer loader returns null for unknown name", async () => {
    const result = await loaders.developer.load("nobody");
    expect(result).toBeNull();
  });

  it("project loader resolves by id", async () => {
    const result = await loaders.project.load("test-proj");
    expect(result).not.toBeNull();
    expect(result.name).toBe("Test Project");
  });

  it("project loader returns null for unknown id", async () => {
    const result = await loaders.project.load("no-proj");
    expect(result).toBeNull();
  });

  it("sprint loader resolves by name", async () => {
    const result = await loaders.sprint.load("test-sprint");
    expect(result).not.toBeNull();
    expect(result.status).toBe("active");
  });

  it("task loader resolves by sprint|taskNum key", async () => {
    const result = await loaders.task.load("test-sprint|1");
    expect(result).not.toBeNull();
    expect(result.title).toBe("Set up database");
  });

  it("task loader returns null for unknown key", async () => {
    const result = await loaders.task.load("test-sprint|999");
    expect(result).toBeNull();
  });

  it("task dependencies loader returns dependency tasks", async () => {
    // Task 2 depends on task 1
    const deps = await loaders.taskDependencies.load("test-sprint|2");
    expect(deps.length).toBe(1);
    expect(deps[0].task_num).toBe(1);
  });

  it("task dependencies loader returns empty for no dependencies", async () => {
    // Task 1 has no dependencies
    const deps = await loaders.taskDependencies.load("test-sprint|1");
    expect(deps.length).toBe(0);
  });

  it("task dependents loader returns dependent tasks", async () => {
    // Task 1 is depended on by task 2
    const deps = await loaders.taskDependents.load("test-sprint|1");
    expect(deps.length).toBe(1);
    expect(deps[0].task_num).toBe(2);
  });

  it("task dependents loader returns empty when no dependents", async () => {
    const deps = await loaders.taskDependents.load("test-sprint|4");
    expect(deps.length).toBe(0);
  });
});

// ── SupabasePool caching ──────────────────────────────────

describe("SupabasePool", () => {
  let pool: SupabasePool;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pool = new SupabasePool();
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 1, name: "test" }],
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns rows from fetch response", async () => {
    const result = await pool.query("SELECT 1");
    expect(result.rows).toEqual([{ id: 1, name: "test" }]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("caches repeated queries", async () => {
    await pool.query("SELECT 1");
    await pool.query("SELECT 1");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // Only 1 fetch, second is cached
  });

  it("does not cache different queries", async () => {
    await pool.query("SELECT 1");
    await pool.query("SELECT 2");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("interpolates $N parameters into SQL", async () => {
    await pool.query("SELECT * FROM t WHERE id = $1 AND name = $2", [42, "alice"]);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.query).toBe("SELECT * FROM t WHERE id = 42 AND name = 'alice'");
  });

  it("escapes single quotes in string parameters", async () => {
    await pool.query("SELECT * FROM t WHERE name = $1", ["O'Brien"]);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.query).toBe("SELECT * FROM t WHERE name = 'O''Brien'");
  });

  it("handles null and boolean parameters", async () => {
    await pool.query("INSERT INTO t VALUES ($1, $2, $3)", [null, true, false]);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.query).toBe("INSERT INTO t VALUES (NULL, TRUE, FALSE)");
  });

  it("retries on 429 status", async () => {
    fetchSpy
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1 }] });

    const result = await pool.query("SELECT 1");
    expect(result.rows).toEqual([{ id: 1 }]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws on non-429 error", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500, text: async () => "server error" });
    await expect(pool.query("SELECT 1")).rejects.toThrow("Supabase query failed (500)");
  });

  it("clears cache on end()", async () => {
    await pool.query("SELECT 1");
    await pool.end();
    await pool.query("SELECT 1");
    expect(fetchSpy).toHaveBeenCalledTimes(2); // No cache after end()
  });
});
