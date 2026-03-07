import { describe, it, expect } from "vitest";
import { getHealthStatus } from "../health-status";

// ── getHealthStatus ─────────────────────────────────────

describe("getHealthStatus", () => {
  const STREAM_ENTITY_MAP: Record<string, string> = {
    transcripts: "Transcript",
    workflow_events: "Event",
    tasks: "Task",
    developer_context: "DeveloperContext",
    skill_versions: "SkillVersion",
  };

  it("returns green when stream is within tolerance", () => {
    const now = new Date();
    const lastUpdated = new Date(now.getTime() - 30 * 60 * 1000).toISOString(); // 30min ago
    const lastSession = now.toISOString();

    const streams = [
      { stream: "transcripts", count: 100, lastUpdated, recentCount: 5 },
    ];

    const result = getHealthStatus(streams, lastSession, STREAM_ENTITY_MAP);
    expect(result["Transcript"]).toBe("green");
  });

  it("returns yellow when stream is between 1x and 2x tolerance", () => {
    const now = new Date();
    const lastSession = now.toISOString();
    // transcripts tolerance = 1h, so 1.5h behind = yellow
    const lastUpdated = new Date(now.getTime() - 1.5 * 3600 * 1000).toISOString();

    const streams = [
      { stream: "transcripts", count: 100, lastUpdated, recentCount: 5 },
    ];

    const result = getHealthStatus(streams, lastSession, STREAM_ENTITY_MAP);
    expect(result["Transcript"]).toBe("yellow");
  });

  it("returns red when stream is beyond 2x tolerance", () => {
    const now = new Date();
    const lastSession = now.toISOString();
    // transcripts tolerance = 1h, so 3h behind = red
    const lastUpdated = new Date(now.getTime() - 3 * 3600 * 1000).toISOString();

    const streams = [
      { stream: "transcripts", count: 100, lastUpdated, recentCount: 5 },
    ];

    const result = getHealthStatus(streams, lastSession, STREAM_ENTITY_MAP);
    expect(result["Transcript"]).toBe("red");
  });

  it("returns red when lastUpdated is null", () => {
    const streams = [
      { stream: "transcripts", count: 0, lastUpdated: null, recentCount: 0 },
    ];

    const result = getHealthStatus(streams, new Date().toISOString(), STREAM_ENTITY_MAP);
    expect(result["Transcript"]).toBe("red");
  });

  it("maps multiple streams to their entity types", () => {
    const now = new Date();
    const lastSession = now.toISOString();
    const recent = new Date(now.getTime() - 10 * 60 * 1000).toISOString(); // 10min ago

    const streams = [
      { stream: "transcripts", count: 100, lastUpdated: recent, recentCount: 5 },
      { stream: "workflow_events", count: 200, lastUpdated: recent, recentCount: 10 },
      { stream: "tasks", count: 50, lastUpdated: recent, recentCount: 1 },
    ];

    const result = getHealthStatus(streams, lastSession, STREAM_ENTITY_MAP);
    expect(result["Transcript"]).toBe("green");
    expect(result["Event"]).toBe("green");
    expect(result["Task"]).toBe("green");
  });

  it("ignores streams not in the entity map", () => {
    const now = new Date();
    const lastSession = now.toISOString();
    const recent = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

    const streams = [
      { stream: "unknown_stream", count: 100, lastUpdated: recent, recentCount: 5 },
    ];

    const result = getHealthStatus(streams, lastSession, STREAM_ENTITY_MAP);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("returns empty object when lastSession is null", () => {
    const streams = [
      { stream: "transcripts", count: 100, lastUpdated: new Date().toISOString(), recentCount: 5 },
    ];

    const result = getHealthStatus(streams, null, STREAM_ENTITY_MAP);
    expect(Object.keys(result)).toHaveLength(0);
  });
});
