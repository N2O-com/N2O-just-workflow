import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// We'll test the sync service module once it exists.
// For now, define the expected interface and test against it.

// Mock the toggl-api module
vi.mock("../services/toggl-api.js", () => ({
  fetchToggl: vi.fn(),
  getToken: vi.fn().mockReturnValue("test-token"),
  TOGGL_API_BASE: "https://api.track.toggl.com/api/v9",
  TOGGL_REPORTS_BASE: "https://api.track.toggl.com/reports/api/v3",
  RateLimitError: class extends Error {
    resetSeconds: number;
    constructor(msg: string, secs: number) {
      super(msg);
      this.resetSeconds = secs;
    }
  },
}));

import {
  runSync,
  isSyncing,
  startSyncLoop,
  stopSyncLoop,
  type SyncResult,
} from "../services/toggl-sync.js";
import { fetchToggl } from "../services/toggl-api.js";
import { SupabasePool } from "../db.js";

const mockFetchToggl = vi.mocked(fetchToggl);

describe("Toggl sync service", () => {
  let pool: SupabasePool;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let queryLog: string[];

  beforeEach(() => {
    pool = new SupabasePool();
    queryLog = [];
    fetchSpy = vi.fn().mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      queryLog.push(body.query);
      // Return empty rows by default
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", fetchSpy);

    // Reset Toggl API mocks
    mockFetchToggl.mockReset();
    // Default: workspace returns id 123
    mockFetchToggl.mockImplementation(async (url: string) => {
      if (url.includes("/workspaces") && !url.includes("/workspace/")) {
        return [{ id: 123, name: "Test Workspace" }];
      }
      if (url.includes("/projects")) return [];
      if (url.includes("/clients")) return [];
      if (url.includes("/tags")) return [];
      if (url.includes("/search/time_entries")) return [];
      return [];
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    stopSyncLoop();
  });

  // ── Mutex ──────────────────────────────────────────────────

  it("mutex prevents overlapping syncs", async () => {
    // Make the first sync slow
    let resolveFirst: () => void;
    const slowPromise = new Promise<void>((r) => { resolveFirst = r; });
    mockFetchToggl.mockImplementationOnce(async () => {
      await slowPromise;
      return [{ id: 123, name: "WS" }];
    });

    const first = runSync(pool);
    // isSyncing should be true while first is running
    expect(isSyncing()).toBe(true);

    // Second sync should be skipped
    const second = await runSync(pool);
    expect(second.status).toBe("already_syncing");

    // Complete the first sync
    resolveFirst!();
    await first;
  });

  // ── Reference data first ───────────────────────────────────

  it("syncs reference data (projects, clients, tags) before entries", async () => {
    const callOrder: string[] = [];
    mockFetchToggl.mockImplementation(async (url: string) => {
      if (url.includes("/workspaces") && !url.includes("/workspace/")) {
        return [{ id: 123, name: "WS" }];
      }
      if (url.includes("/projects")) { callOrder.push("projects"); return []; }
      if (url.includes("/clients")) { callOrder.push("clients"); return []; }
      if (url.includes("/tags")) { callOrder.push("tags"); return []; }
      if (url.includes("/search/time_entries")) { callOrder.push("entries"); return []; }
      return [];
    });

    await runSync(pool);

    // Reference data should come before entries
    const projectsIdx = callOrder.indexOf("projects");
    const entriesIdx = callOrder.indexOf("entries");
    expect(projectsIdx).toBeLessThan(entriesIdx);
  });

  it("skips entry sync if reference data sync fails", async () => {
    const callOrder: string[] = [];
    mockFetchToggl.mockImplementation(async (url: string) => {
      if (url.includes("/projects")) { throw new Error("Toggl API down"); }
      if (url.includes("/search/time_entries")) { callOrder.push("entries"); return []; }
      if (url.includes("/workspaces")) {
        return [{ id: 123, name: "WS" }];
      }
      return [];
    });

    const result = await runSync(pool);

    // Entries should not have been fetched
    expect(callOrder).not.toContain("entries");
    // Sync should record the error
    expect(result.error).toBeTruthy();
  });

  // ── Sync log finalization ─────────────────────────────────

  it("always finalizes sync_log even on error", async () => {
    mockFetchToggl.mockImplementation(async (url: string) => {
      if (url.includes("/workspaces") && !url.includes("/workspace/")) {
        return [{ id: 123, name: "WS" }];
      }
      throw new Error("API failure");
    });

    const result = await runSync(pool);

    // Should have recorded error but still completed
    expect(result.error).toContain("API failure");
    // sync_log should have been written (INSERT + UPDATE in queryLog)
    const syncLogInserts = queryLog.filter((q) => q.includes("tt_sync_log") && q.includes("INSERT"));
    const syncLogUpdates = queryLog.filter((q) => q.includes("tt_sync_log") && q.includes("UPDATE"));
    expect(syncLogInserts.length).toBeGreaterThanOrEqual(1);
    expect(syncLogUpdates.length).toBeGreaterThanOrEqual(1);
    // UPDATE should contain the error message (interpolated into SQL)
    expect(syncLogUpdates[0]).toContain("API failure");
  });

  // ── SyncResult shape ──────────────────────────────────────

  it("returns SyncResult with counts on success", async () => {
    const result = await runSync(pool);

    expect(result.status).toBe("success");
    expect(result.entriesUpserted).toBe(0); // No entries from mock
    expect(result.error).toBeUndefined();
  });

  // ── Cache clearing ────────────────────────────────────────

  it("clears pool cache after successful sync", async () => {
    const clearSpy = vi.spyOn(pool, "clearCache");
    await runSync(pool);
    expect(clearSpy).toHaveBeenCalled();
  });

  // ── Entry upsert with batching ────────────────────────────

  it("upserts entries in batches using ON CONFLICT", async () => {
    // Return 3 entries from Toggl
    mockFetchToggl.mockImplementation(async (url: string) => {
      if (url.includes("/workspaces") && !url.includes("/workspace/")) {
        return [{ id: 123, name: "WS" }];
      }
      if (url.includes("/projects")) return [];
      if (url.includes("/clients")) return [];
      if (url.includes("/tags")) return [];
      if (url.includes("/search/time_entries")) {
        return [
          {
            user_id: 1, description: "Work", project_id: 10, tag_ids: [1, 2],
            time_entries: [
              { id: 100, start: "2026-03-01T09:00:00Z", stop: "2026-03-01T10:00:00Z", seconds: 3600 },
              { id: 101, start: "2026-03-01T10:00:00Z", stop: "2026-03-01T11:00:00Z", seconds: 3600 },
            ],
          },
          {
            user_id: 2, description: "Review", project_id: 11, tag_ids: [],
            time_entries: [
              { id: 102, start: "2026-03-01T09:00:00Z", stop: "2026-03-01T09:30:00Z", seconds: 1800 },
            ],
          },
        ];
      }
      return [];
    });

    const result = await runSync(pool);

    expect(result.entriesUpserted).toBe(3);
    // Should have used ON CONFLICT for upsert
    const upsertQueries = queryLog.filter((q) => q.includes("ON CONFLICT"));
    expect(upsertQueries.length).toBeGreaterThanOrEqual(1);
    // Should include tt_entries in the INSERT
    const entryInserts = queryLog.filter((q) => q.includes("tt_entries") && q.includes("INSERT"));
    expect(entryInserts.length).toBeGreaterThanOrEqual(1);
  });

  // ── Sync loop lifecycle ───────────────────────────────────

  it("startSyncLoop fires runSync on interval", async () => {
    vi.useFakeTimers();
    try {
      let syncCallCount = 0;
      mockFetchToggl.mockImplementation(async (url: string) => {
        if (url.includes("/workspaces") && !url.includes("/workspace/")) {
          syncCallCount++;
          return [{ id: 123, name: "WS" }];
        }
        return [];
      });

      const handle = startSyncLoop(pool, 1000);
      expect(handle).toBeTruthy();

      // No sync yet (interval hasn't fired)
      expect(syncCallCount).toBe(0);

      // Advance past first interval
      await vi.advanceTimersByTimeAsync(1100);
      expect(syncCallCount).toBeGreaterThanOrEqual(1);

      stopSyncLoop();
      const countAfterStop = syncCallCount;

      // Advance more — count should NOT increase after stop
      await vi.advanceTimersByTimeAsync(2000);
      expect(syncCallCount).toBe(countAfterStop);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stopSyncLoop is idempotent", () => {
    startSyncLoop(pool, 60_000);
    stopSyncLoop();
    expect(() => stopSyncLoop()).not.toThrow();
  });

  // ── Error handling ───────────────────────────────────────

  it("returns error when no workspaces found", async () => {
    mockFetchToggl.mockImplementation(async (url: string) => {
      if (url.includes("/workspaces")) return [];
      return [];
    });

    const result = await runSync(pool);
    expect(result.status).toBe("error");
    expect(result.error).toContain("No Toggl workspaces found");
    expect(isSyncing()).toBe(false);
  });

  it("isSyncing resets to false after sync error", async () => {
    mockFetchToggl.mockImplementation(async () => {
      throw new Error("Total failure");
    });

    const result = await runSync(pool);
    expect(result.status).toBe("error");
    expect(isSyncing()).toBe(false);
  });

  // ── sync_log finalized on ref-data early return ─────────

  it("finalizes sync_log when reference data fails (early return path)", async () => {
    mockFetchToggl.mockImplementation(async (url: string) => {
      if (url.includes("/projects")) { throw new Error("Projects API down"); }
      if (url.includes("/workspaces")) { return [{ id: 123, name: "WS" }]; }
      return [];
    });

    const result = await runSync(pool);

    expect(result.status).toBe("error");
    expect(result.error).toContain("Projects API down");

    // sync_log should still have INSERT and UPDATE
    const syncLogInserts = queryLog.filter((q) => q.includes("tt_sync_log") && q.includes("INSERT"));
    const syncLogUpdates = queryLog.filter((q) => q.includes("tt_sync_log") && q.includes("UPDATE"));
    expect(syncLogInserts.length).toBeGreaterThanOrEqual(1);
    expect(syncLogUpdates.length).toBeGreaterThanOrEqual(1);

    // UPDATE should contain the error message
    const updateQuery = syncLogUpdates[0];
    expect(updateQuery).toContain("Projects API down");
  });
});

// ── GraphQL mutation type ──────────────────────────────────

describe("triggerTimeTrackingSync mutation type", () => {
  it("TogglSyncStatus type has required fields and mutation is declared", async () => {
    const { timeTrackingTypeDefs } = await import("../schema/time-tracking-types.js");

    // Type exists with correct fields
    expect(timeTrackingTypeDefs).toContain("type TogglSyncStatus");
    expect(timeTrackingTypeDefs).toContain("status: String!");
    expect(timeTrackingTypeDefs).toContain("lastSyncAt: String");
    expect(timeTrackingTypeDefs).toContain("entriesUpserted: Int");

    // Mutation is declared with correct return type
    expect(timeTrackingTypeDefs).toContain("triggerTimeTrackingSync: TogglSyncStatus!");
  });
});
