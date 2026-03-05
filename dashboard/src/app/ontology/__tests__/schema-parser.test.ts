import { describe, it, expect } from "vitest";
import {
  parseSchemaToGraph,
  resolveFieldTypeName,
  getHealthStatus,
  type GraphNode,
  type GraphEdge,
  type IntrospectionTypeRef,
  type IntrospectionType,
} from "../schema-parser";

// ── Helpers ──────────────────────────────────────────────

/** Build a simple type reference (scalar or object). */
function typeRef(name: string, kind: string = "OBJECT"): IntrospectionTypeRef {
  return { name, kind, ofType: null };
}

/** Wrap a type ref in NON_NULL. */
function nonNull(inner: IntrospectionTypeRef): IntrospectionTypeRef {
  return { name: null, kind: "NON_NULL", ofType: inner };
}

/** Wrap a type ref in LIST. */
function list(inner: IntrospectionTypeRef): IntrospectionTypeRef {
  return { name: null, kind: "LIST", ofType: inner };
}

/** Build a minimal IntrospectionType for testing. */
function makeType(
  name: string,
  fields: Array<{ name: string; type: IntrospectionTypeRef }>,
  kind: string = "OBJECT"
): IntrospectionType {
  return { name, kind, description: null, fields };
}

// ── resolveFieldTypeName ────────────────────────────────

describe("resolveFieldTypeName", () => {
  it("resolves a simple OBJECT type", () => {
    expect(resolveFieldTypeName(typeRef("Task", "OBJECT"))).toBe("Task");
  });

  it("resolves a SCALAR type", () => {
    expect(resolveFieldTypeName(typeRef("String", "SCALAR"))).toBe("String");
  });

  it("resolves NON_NULL wrapping an OBJECT", () => {
    expect(resolveFieldTypeName(nonNull(typeRef("Sprint")))).toBe("Sprint");
  });

  it("resolves LIST wrapping an OBJECT", () => {
    expect(resolveFieldTypeName(list(typeRef("Developer")))).toBe("Developer");
  });

  it("resolves NON_NULL > LIST > OBJECT (common pattern: [Type]!)", () => {
    expect(resolveFieldTypeName(nonNull(list(typeRef("Event"))))).toBe("Event");
  });

  it("resolves NON_NULL > LIST > NON_NULL > OBJECT ([Type!]!)", () => {
    expect(resolveFieldTypeName(nonNull(list(nonNull(typeRef("Task")))))).toBe("Task");
  });

  it("returns null for a null ref", () => {
    expect(resolveFieldTypeName(null)).toBeNull();
  });
});

// ── parseSchemaToGraph ──────────────────────────────────

describe("parseSchemaToGraph", () => {
  it("extracts object types as nodes", () => {
    const types: IntrospectionType[] = [
      makeType("Task", [
        { name: "id", type: typeRef("ID", "SCALAR") },
        { name: "title", type: typeRef("String", "SCALAR") },
      ]),
      makeType("Sprint", [
        { name: "name", type: typeRef("String", "SCALAR") },
      ]),
    ];

    const { nodes } = parseSchemaToGraph(types);
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n: GraphNode) => n.id).sort()).toEqual(["Sprint", "Task"]);
  });

  it("filters out introspection types (__Type, __Schema, etc.)", () => {
    const types: IntrospectionType[] = [
      makeType("__Schema", [{ name: "types", type: list(typeRef("__Type")) }]),
      makeType("__Type", [{ name: "name", type: typeRef("String", "SCALAR") }]),
      makeType("Task", [{ name: "id", type: typeRef("ID", "SCALAR") }]),
    ];

    const { nodes } = parseSchemaToGraph(types);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe("Task");
  });

  it("filters out Query, Mutation, Subscription root types", () => {
    const types: IntrospectionType[] = [
      makeType("Query", [{ name: "tasks", type: list(typeRef("Task")) }]),
      makeType("Mutation", [{ name: "updateTask", type: typeRef("Task") }]),
      makeType("Task", [{ name: "id", type: typeRef("ID", "SCALAR") }]),
    ];

    const { nodes } = parseSchemaToGraph(types);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe("Task");
  });

  it("filters out INPUT_OBJECT and ENUM types", () => {
    const types: IntrospectionType[] = [
      { name: "TaskInput", kind: "INPUT_OBJECT", description: null, fields: [] },
      { name: "Status", kind: "ENUM", description: null, fields: null },
      makeType("Task", [{ name: "id", type: typeRef("ID", "SCALAR") }]),
    ];

    const { nodes } = parseSchemaToGraph(types);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe("Task");
  });

  it("filters out types with no fields", () => {
    const types: IntrospectionType[] = [
      { name: "EmptyType", kind: "OBJECT", description: null, fields: null },
      makeType("Task", [{ name: "id", type: typeRef("ID", "SCALAR") }]),
    ];

    const { nodes } = parseSchemaToGraph(types);
    expect(nodes).toHaveLength(1);
  });

  it("creates edges for fields that reference other object types", () => {
    const types: IntrospectionType[] = [
      makeType("Task", [
        { name: "id", type: typeRef("ID", "SCALAR") },
        { name: "sprint", type: typeRef("Sprint") },
        { name: "owner", type: typeRef("Developer") },
      ]),
      makeType("Sprint", [
        { name: "name", type: typeRef("String", "SCALAR") },
        { name: "tasks", type: list(typeRef("Task")) },
      ]),
      makeType("Developer", [
        { name: "name", type: typeRef("String", "SCALAR") },
      ]),
    ];

    const { edges } = parseSchemaToGraph(types);
    // Task -> Sprint, Task -> Developer, Sprint -> Task
    expect(edges).toHaveLength(3);

    const edgeKeys = edges.map((e: GraphEdge) => `${e.source}->${e.target}`).sort();
    expect(edgeKeys).toEqual([
      "Sprint->Task",
      "Task->Developer",
      "Task->Sprint",
    ]);
  });

  it("does not create edges for scalar fields", () => {
    const types: IntrospectionType[] = [
      makeType("Task", [
        { name: "id", type: typeRef("ID", "SCALAR") },
        { name: "title", type: typeRef("String", "SCALAR") },
        { name: "count", type: typeRef("Int", "SCALAR") },
      ]),
    ];

    const { edges } = parseSchemaToGraph(types);
    expect(edges).toHaveLength(0);
  });

  it("handles NON_NULL and LIST-wrapped references correctly", () => {
    const types: IntrospectionType[] = [
      makeType("Sprint", [
        { name: "tasks", type: nonNull(list(typeRef("Task"))) },
      ]),
      makeType("Task", [
        { name: "sprint", type: nonNull(typeRef("Sprint")) },
      ]),
    ];

    const { edges } = parseSchemaToGraph(types);
    expect(edges).toHaveLength(2);

    const edgeKeys = edges.map((e: GraphEdge) => `${e.source}->${e.target}`).sort();
    expect(edgeKeys).toEqual(["Sprint->Task", "Task->Sprint"]);
  });

  it("does not create edges to types not in the graph", () => {
    // Developer is referenced but not in the types list as OBJECT
    const types: IntrospectionType[] = [
      makeType("Task", [
        { name: "owner", type: typeRef("Developer") },
      ]),
    ];

    const { edges } = parseSchemaToGraph(types);
    expect(edges).toHaveLength(0);
  });

  it("sets field count on each node", () => {
    const types: IntrospectionType[] = [
      makeType("Task", [
        { name: "id", type: typeRef("ID", "SCALAR") },
        { name: "title", type: typeRef("String", "SCALAR") },
        { name: "status", type: typeRef("String", "SCALAR") },
      ]),
    ];

    const { nodes } = parseSchemaToGraph(types);
    expect(nodes[0].fieldCount).toBe(3);
  });

  it("includes field details on each node", () => {
    const types: IntrospectionType[] = [
      makeType("Task", [
        { name: "id", type: typeRef("ID", "SCALAR") },
        { name: "sprint", type: typeRef("Sprint") },
      ]),
      makeType("Sprint", [
        { name: "name", type: typeRef("String", "SCALAR") },
      ]),
    ];

    const { nodes } = parseSchemaToGraph(types);
    const taskNode = nodes.find((n: GraphNode) => n.id === "Task")!;
    expect(taskNode.fields).toHaveLength(2);
    expect(taskNode.fields[0]).toEqual({ name: "id", typeName: "ID" });
    expect(taskNode.fields[1]).toEqual({ name: "sprint", typeName: "Sprint" });
  });

  it("populates incomingEdges for referenced types", () => {
    const types: IntrospectionType[] = [
      makeType("Task", [
        { name: "sprint", type: typeRef("Sprint") },
      ]),
      makeType("Sprint", [
        { name: "name", type: typeRef("String", "SCALAR") },
      ]),
    ];

    const { nodes } = parseSchemaToGraph(types);
    const sprintNode = nodes.find((n: GraphNode) => n.id === "Sprint")!;
    expect(sprintNode.incomingEdges).toEqual(["Task"]);
  });

  it("stores edge labels (field names)", () => {
    const types: IntrospectionType[] = [
      makeType("Task", [
        { name: "owner", type: typeRef("Developer") },
      ]),
      makeType("Developer", [
        { name: "name", type: typeRef("String", "SCALAR") },
      ]),
    ];

    const { edges } = parseSchemaToGraph(types);
    expect(edges[0].label).toBe("owner");
  });

  it("stores description from type when present", () => {
    const types: IntrospectionType[] = [
      { name: "Task", kind: "OBJECT", description: "A work item", fields: [
        { name: "id", type: typeRef("ID", "SCALAR") },
      ]},
    ];

    const { nodes } = parseSchemaToGraph(types);
    expect(nodes[0].description).toBe("A work item");
  });
});

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

    // We need to simulate the lag based on session end time
    // getHealthStatus uses lag = session - lastUpdated
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
