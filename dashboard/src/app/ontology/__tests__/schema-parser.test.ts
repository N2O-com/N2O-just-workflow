import { describe, it, expect } from "vitest";
import {
  parseSchemaToGraph,
  resolveFieldTypeName,
  aggregateEdges,
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


// ── aggregateEdges ──────────────────────────────────────

describe("aggregateEdges", () => {
  it("passes through a single edge unchanged", () => {
    const edges: GraphEdge[] = [
      { source: "Task", target: "Sprint", label: "sprint" },
    ];
    const result = aggregateEdges(edges);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      source: "Task",
      target: "Sprint",
      labels: ["sprint"],
      count: 1,
    });
  });

  it("aggregates multiple edges between the same pair", () => {
    const edges: GraphEdge[] = [
      { source: "Task", target: "Developer", label: "owner" },
      { source: "Task", target: "Developer", label: "reviewer" },
      { source: "Task", target: "Developer", label: "assignee" },
    ];
    const result = aggregateEdges(edges);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("Task");
    expect(result[0].target).toBe("Developer");
    expect(result[0].count).toBe(3);
    expect(result[0].labels).toEqual(["owner", "reviewer", "assignee"]);
  });

  it("keeps bidirectional edges separate", () => {
    const edges: GraphEdge[] = [
      { source: "Task", target: "Sprint", label: "sprint" },
      { source: "Sprint", target: "Task", label: "tasks" },
    ];
    const result = aggregateEdges(edges);
    expect(result).toHaveLength(2);
    const keys = result.map((e) => `${e.source}->${e.target}`).sort();
    expect(keys).toEqual(["Sprint->Task", "Task->Sprint"]);
  });

  it("returns empty array for empty input", () => {
    expect(aggregateEdges([])).toEqual([]);
  });
});
