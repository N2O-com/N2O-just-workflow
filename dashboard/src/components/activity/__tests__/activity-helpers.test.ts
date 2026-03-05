import { describe, it, expect } from "vitest";
import {
  filterBySearch,
  filterByToolType,
  filterByDateRange,
  filterBySessionId,
  getUniqueToolTypes,
  type ActivityMessage,
  type ActivitySession,
} from "../activity-helpers";

// ── Test Data Factories ──────────────────────────────────

function makeMessage(overrides: Partial<ActivityMessage> = {}): ActivityMessage {
  return {
    role: "assistant",
    content: "Default message content",
    timestamp: "2025-06-15T10:30:00Z",
    toolCalls: [],
    ...overrides,
  };
}

function makeSession(overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    sessionId: "sess-1",
    developer: "ada",
    sprint: "sprint-1",
    taskNum: 1,
    taskTitle: "Setup project",
    startedAt: "2025-06-15T10:00:00Z",
    endedAt: "2025-06-15T11:00:00Z",
    model: "claude-opus-4",
    messages: [
      makeMessage({ role: "user", content: "Please read the file" }),
      makeMessage({
        role: "assistant",
        content: "I read the file successfully",
        toolCalls: [{ name: "Read", summary: "src/index.ts" }],
      }),
    ],
    ...overrides,
  };
}

// ── filterBySearch ───────────────────────────────────────

describe("filterBySearch", () => {
  const sessions = [
    makeSession({
      sessionId: "s1",
      messages: [
        makeMessage({ role: "user", content: "Fix the authentication bug" }),
        makeMessage({ role: "assistant", content: "I found the issue in auth.ts" }),
      ],
    }),
    makeSession({
      sessionId: "s2",
      messages: [
        makeMessage({ role: "user", content: "Add a new dashboard widget" }),
        makeMessage({ role: "assistant", content: "Creating the widget component" }),
      ],
    }),
    makeSession({
      sessionId: "s3",
      messages: [
        makeMessage({ role: "user", content: "Run the test suite" }),
        makeMessage({
          role: "assistant",
          content: "Tests passed",
          toolCalls: [{ name: "Bash", summary: "npm test" }],
        }),
      ],
    }),
  ];

  it("should return all sessions when search is empty", () => {
    expect(filterBySearch(sessions, "")).toEqual(sessions);
  });

  it("should return all sessions when search is whitespace only", () => {
    expect(filterBySearch(sessions, "   ")).toEqual(sessions);
  });

  it("should match user message content", () => {
    const result = filterBySearch(sessions, "authentication");
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s1");
  });

  it("should match assistant message content", () => {
    const result = filterBySearch(sessions, "widget component");
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s2");
  });

  it("should be case-insensitive", () => {
    const result = filterBySearch(sessions, "AUTHENTICATION");
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s1");
  });

  it("should match tool call names", () => {
    const result = filterBySearch(sessions, "Bash");
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s3");
  });

  it("should match tool call summaries", () => {
    const result = filterBySearch(sessions, "npm test");
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s3");
  });

  it("should return empty array when nothing matches", () => {
    const result = filterBySearch(sessions, "nonexistent query xyz");
    expect(result).toHaveLength(0);
  });

  it("should handle sessions with null content in messages", () => {
    const sessionsWithNull = [
      makeSession({
        sessionId: "s-null",
        messages: [
          makeMessage({ role: "assistant", content: null, toolCalls: [{ name: "Read", summary: "file.ts" }] }),
        ],
      }),
    ];
    const result = filterBySearch(sessionsWithNull, "Read");
    expect(result).toHaveLength(1);
  });

  it("should match across multiple messages in a session", () => {
    const result = filterBySearch(sessions, "auth.ts");
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s1");
  });
});

// ── filterByToolType ─────────────────────────────────────

describe("filterByToolType", () => {
  const sessions = [
    makeSession({
      sessionId: "s1",
      messages: [
        makeMessage({
          toolCalls: [
            { name: "Read", summary: "src/index.ts" },
            { name: "Edit", summary: "src/index.ts" },
          ],
        }),
      ],
    }),
    makeSession({
      sessionId: "s2",
      messages: [
        makeMessage({
          toolCalls: [{ name: "Bash", summary: "npm test" }],
        }),
      ],
    }),
    makeSession({
      sessionId: "s3",
      messages: [
        makeMessage({ content: "No tools used", toolCalls: [] }),
      ],
    }),
  ];

  it("should return all sessions when toolType is empty", () => {
    expect(filterByToolType(sessions, "")).toEqual(sessions);
  });

  it("should filter sessions containing the specified tool type", () => {
    const result = filterByToolType(sessions, "Read");
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s1");
  });

  it("should match any tool call in a message's toolCalls array", () => {
    const result = filterByToolType(sessions, "Edit");
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s1");
  });

  it("should exclude sessions without the tool type", () => {
    const result = filterByToolType(sessions, "Bash");
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s2");
  });

  it("should return empty array when no sessions have the tool", () => {
    const result = filterByToolType(sessions, "WebSearch");
    expect(result).toHaveLength(0);
  });

  it("should exclude sessions with no tool calls when filtering", () => {
    const result = filterByToolType(sessions, "Read");
    expect(result.find((s) => s.sessionId === "s3")).toBeUndefined();
  });
});

// ── filterByDateRange ────────────────────────────────────

describe("filterByDateRange", () => {
  const sessions = [
    makeSession({
      sessionId: "s-jun-10",
      startedAt: "2025-06-10T10:00:00Z",
    }),
    makeSession({
      sessionId: "s-jun-15",
      startedAt: "2025-06-15T10:00:00Z",
    }),
    makeSession({
      sessionId: "s-jun-20",
      startedAt: "2025-06-20T10:00:00Z",
    }),
    makeSession({
      sessionId: "s-jun-25",
      startedAt: "2025-06-25T10:00:00Z",
    }),
  ];

  it("should return all sessions when both dates are null", () => {
    expect(filterByDateRange(sessions, null, null)).toEqual(sessions);
  });

  it("should filter sessions after startDate", () => {
    const result = filterByDateRange(sessions, "2025-06-15", null);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.sessionId)).toEqual(["s-jun-15", "s-jun-20", "s-jun-25"]);
  });

  it("should filter sessions before endDate", () => {
    const result = filterByDateRange(sessions, null, "2025-06-20");
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.sessionId)).toEqual(["s-jun-10", "s-jun-15", "s-jun-20"]);
  });

  it("should filter sessions within a date range (inclusive)", () => {
    const result = filterByDateRange(sessions, "2025-06-15", "2025-06-20");
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.sessionId)).toEqual(["s-jun-15", "s-jun-20"]);
  });

  it("should return empty when range excludes all sessions", () => {
    const result = filterByDateRange(sessions, "2025-07-01", "2025-07-31");
    expect(result).toHaveLength(0);
  });

  it("should handle sessions with null startedAt", () => {
    const sessionsWithNull = [
      ...sessions,
      makeSession({ sessionId: "s-null", startedAt: null }),
    ];
    const result = filterByDateRange(sessionsWithNull, "2025-06-15", null);
    // Sessions with null startedAt should be excluded when filtering by date
    expect(result.find((s) => s.sessionId === "s-null")).toBeUndefined();
  });

  it("should include a session that starts exactly on the startDate", () => {
    const result = filterByDateRange(sessions, "2025-06-10", null);
    expect(result.map((s) => s.sessionId)).toContain("s-jun-10");
  });

  it("should include a session that starts exactly on the endDate", () => {
    const result = filterByDateRange(sessions, null, "2025-06-25");
    expect(result.map((s) => s.sessionId)).toContain("s-jun-25");
  });
});

// ── filterBySessionId ────────────────────────────────────

describe("filterBySessionId", () => {
  const sessions = [
    makeSession({ sessionId: "sess-abc" }),
    makeSession({ sessionId: "sess-def" }),
    makeSession({ sessionId: "sess-ghi" }),
  ];

  it("should return all sessions when sessionId is null", () => {
    expect(filterBySessionId(sessions, null)).toEqual(sessions);
  });

  it("should return all sessions when sessionId is undefined", () => {
    expect(filterBySessionId(sessions, undefined)).toEqual(sessions);
  });

  it("should return only the matching session", () => {
    const result = filterBySessionId(sessions, "sess-def");
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("sess-def");
  });

  it("should return empty when sessionId does not match", () => {
    const result = filterBySessionId(sessions, "sess-nonexistent");
    expect(result).toHaveLength(0);
  });
});

// ── getUniqueToolTypes ───────────────────────────────────

describe("getUniqueToolTypes", () => {
  it("should return sorted unique tool type names", () => {
    const sessions = [
      makeSession({
        messages: [
          makeMessage({ toolCalls: [{ name: "Read", summary: "" }, { name: "Bash", summary: "" }] }),
          makeMessage({ toolCalls: [{ name: "Edit", summary: "" }] }),
        ],
      }),
      makeSession({
        messages: [
          makeMessage({ toolCalls: [{ name: "Bash", summary: "" }, { name: "Grep", summary: "" }] }),
        ],
      }),
    ];

    const result = getUniqueToolTypes(sessions);
    expect(result).toEqual(["Bash", "Edit", "Grep", "Read"]);
  });

  it("should return empty array when no tool calls exist", () => {
    const sessions = [
      makeSession({
        messages: [makeMessage({ toolCalls: [] })],
      }),
    ];
    expect(getUniqueToolTypes(sessions)).toEqual([]);
  });

  it("should handle empty sessions array", () => {
    expect(getUniqueToolTypes([])).toEqual([]);
  });
});
