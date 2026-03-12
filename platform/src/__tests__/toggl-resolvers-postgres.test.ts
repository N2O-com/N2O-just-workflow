import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock toggl-api to track if Toggl API is called
vi.mock("../services/toggl-api.js", () => ({
  fetchToggl: vi.fn(),
  getToken: vi.fn().mockReturnValue("test-token"),
  cacheGet: vi.fn().mockReturnValue(null),
  cacheSet: vi.fn(),
  TOGGL_API_BASE: "https://api.track.toggl.com/api/v9",
  TOGGL_REPORTS_BASE: "https://api.track.toggl.com/reports/api/v3",
}));

// Mock auth (requireAdmin)
vi.mock("../auth.js", () => ({
  requireAdmin: vi.fn(),
}));

// Mock toggl-sync (for triggerTimeTrackingSync)
vi.mock("../services/toggl-sync.js", () => ({
  runSync: vi.fn(),
  isSyncing: vi.fn(),
  startSyncLoop: vi.fn(),
  stopSyncLoop: vi.fn(),
}));

import { timeTrackingResolvers } from "../resolvers/time-tracking.js";
import { healthResolvers } from "../resolvers/health.js";
import { fetchToggl } from "../services/toggl-api.js";

const mockFetchToggl = vi.mocked(fetchToggl);

function createMockCtx(queryResponses: Record<string, any[]> = {}) {
  const queryLog: Array<{ sql: string; params: any[] }> = [];
  const mockPool = {
    query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
      queryLog.push({ sql, params });
      for (const [pattern, rows] of Object.entries(queryResponses)) {
        if (sql.includes(pattern)) return { rows };
      }
      return { rows: [] };
    }),
    clearCache: vi.fn(),
    end: vi.fn(),
  };
  return {
    ctx: {
      db: mockPool,
      loaders: {},
      currentUser: { name: "admin", accessRole: "admin", email: "a@b.com" },
      pageRoute: null,
    } as any,
    queryLog,
    mockPool,
  };
}

// ── Resolvers migrated to Postgres ────────────────────────

describe("Resolvers migrated to Postgres", () => {
  beforeEach(() => {
    mockFetchToggl.mockReset();
  });

  it("timeTrackingEntries queries tt_entries with deleted_at filter", async () => {
    const { ctx, queryLog } = createMockCtx({
      tt_entries: [
        {
          id: 100, description: "Work", start: "2026-03-01T09:00:00Z",
          stop: "2026-03-01T10:00:00Z", seconds: 3600, user_id: 1,
          project_id: 10, tag_ids: [1, 2], billable: false,
        },
      ],
    });

    const result = await timeTrackingResolvers.Query.timeTrackingEntries(
      null, { startDate: "2026-03-01", endDate: "2026-03-07" }, ctx,
    );

    // Must query Postgres, not Toggl
    expect(queryLog.some((q) => q.sql.includes("tt_entries"))).toBe(true);
    expect(queryLog.some((q) => q.sql.includes("deleted_at IS NULL"))).toBe(true);
    expect(mockFetchToggl).not.toHaveBeenCalled();

    // Result maps DB columns to GraphQL fields
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe(1);
    expect(result[0].projectId).toBe(10);
    expect(result[0].tagIds).toEqual([1, 2]);
  });

  it("timeTrackingEntries supports limit and offset", async () => {
    const { ctx, queryLog } = createMockCtx({ tt_entries: [] });

    await timeTrackingResolvers.Query.timeTrackingEntries(
      null, { startDate: "2026-03-01", endDate: "2026-03-07", limit: 100, offset: 50 }, ctx,
    );

    const entry = queryLog.find((q) => q.sql.includes("tt_entries"));
    expect(entry!.sql).toContain("LIMIT");
    expect(entry!.sql).toContain("OFFSET");
    // Params include the limit and offset values
    expect(entry!.params).toContain(100);
    expect(entry!.params).toContain(50);
  });

  it("timeTrackingEntries uses default limit of 5000", async () => {
    const { ctx, queryLog } = createMockCtx({ tt_entries: [] });

    await timeTrackingResolvers.Query.timeTrackingEntries(
      null, { startDate: "2026-03-01", endDate: "2026-03-07" }, ctx,
    );

    const entry = queryLog.find((q) => q.sql.includes("tt_entries"));
    expect(entry!.params).toContain(5000);
  });

  it("timeTrackingProjects queries tt_projects", async () => {
    const { ctx, queryLog } = createMockCtx({
      tt_projects: [{ id: 10, name: "Project A", client_id: 1, color: "#ff0000", active: true }],
    });

    const result = await timeTrackingResolvers.Query.timeTrackingProjects(null, null, ctx);

    expect(queryLog.some((q) => q.sql.includes("tt_projects"))).toBe(true);
    expect(mockFetchToggl).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Project A");
    expect(result[0].clientId).toBe(1);
  });

  it("timeTrackingClients queries tt_clients", async () => {
    const { ctx, queryLog } = createMockCtx({
      tt_clients: [{ id: 1, name: "Client A" }],
    });

    const result = await timeTrackingResolvers.Query.timeTrackingClients(null, null, ctx);

    expect(queryLog.some((q) => q.sql.includes("tt_clients"))).toBe(true);
    expect(mockFetchToggl).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Client A");
  });

  it("timeTrackingTags queries tt_tags", async () => {
    const { ctx, queryLog } = createMockCtx({
      tt_tags: [{ id: 1, name: "Tag A" }],
    });

    const result = await timeTrackingResolvers.Query.timeTrackingTags(null, null, ctx);

    expect(queryLog.some((q) => q.sql.includes("tt_tags"))).toBe(true);
    expect(mockFetchToggl).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Tag A");
  });
});

// ── Live resolvers still use Toggl ────────────────────────

describe("Live resolvers unchanged", () => {
  beforeEach(() => {
    mockFetchToggl.mockReset();
    mockFetchToggl.mockImplementation(async (url: string) => {
      if (url.includes("/workspaces")) return [{ id: 123, name: "WS" }];
      return [];
    });
  });

  it("timeTrackingDashboardActivity still calls Toggl API", async () => {
    await timeTrackingResolvers.Query.timeTrackingDashboardActivity();

    expect(mockFetchToggl).toHaveBeenCalled();
    const urls = mockFetchToggl.mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes("dashboard"))).toBe(true);
  });

  it("timeTrackingCurrentTimer still calls Toggl API", async () => {
    mockFetchToggl.mockResolvedValue(null);

    await timeTrackingResolvers.Query.timeTrackingCurrentTimer();

    expect(mockFetchToggl).toHaveBeenCalled();
    const urls = mockFetchToggl.mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes("time_entries/current"))).toBe(true);
  });
});

// ── GraphQL schema updates ────────────────────────────────

describe("GraphQL schema updates", () => {
  it("TimeTrackingEntry.id is ID! (not Int)", async () => {
    const { timeTrackingTypeDefs } = await import("../schema/time-tracking-types.js");
    // Entry type should use ID! scalar for the id field
    expect(timeTrackingTypeDefs).toMatch(/type TimeTrackingEntry\s*\{[^}]*id:\s*ID!/);
  });

  it("TimeTrackingEntry includes billable field", async () => {
    const { timeTrackingTypeDefs } = await import("../schema/time-tracking-types.js");
    expect(timeTrackingTypeDefs).toMatch(/type TimeTrackingEntry\s*\{[^}]*billable:\s*Boolean/);
  });

  it("timeTrackingEntries accepts limit and offset arguments", async () => {
    const { timeTrackingTypeDefs } = await import("../schema/time-tracking-types.js");
    expect(timeTrackingTypeDefs).toContain("limit: Int");
    expect(timeTrackingTypeDefs).toContain("offset: Int");
  });
});

// ── dataHealth integration ────────────────────────────────

describe("dataHealth includes sync streams", () => {
  it("dataHealth returns tt_entries and tt_sync_log streams", async () => {
    const { ctx } = createMockCtx({
      tt_entries: [{ count: 1000, last_updated: "2026-03-12", recent_count: 50 }],
      tt_sync_log: [{ count: 10, last_updated: "2026-03-12", recent_count: 1 }],
      transcripts: [{ count: 5, last_updated: "2026-03-12", recent_count: 0 }],
    });

    const result = await healthResolvers.Query.dataHealth(null, null, ctx);

    const streamNames = result.streams.map((s: any) => s.stream);
    expect(streamNames).toContain("tt_entries");
    expect(streamNames).toContain("tt_sync_log");
  });
});
