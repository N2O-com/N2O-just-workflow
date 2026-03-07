/**
 * Schema parser for the Ontology graph.
 *
 * Takes GraphQL introspection result types and produces a graph-ready
 * structure of nodes (entity types) and edges (field references).
 */

import type { PgTableMetadata } from "./pg-types";

// ── Types ────────────────────────────────────────────────

export interface IntrospectionTypeRef {
  name: string | null;
  kind: string;
  ofType: IntrospectionTypeRef | null;
}

export interface IntrospectionType {
  name: string;
  kind: string;
  description: string | null;
  fields: Array<{ name: string; type: IntrospectionTypeRef }> | null;
}

export interface FieldInfo {
  name: string;
  typeName: string;
}

export interface GraphNode {
  id: string;
  description: string | null;
  fieldCount: number;
  fields: FieldInfo[];
  incomingEdges: string[];
  healthStatus?: "green" | "yellow" | "red" | null;
  pgMetadata?: PgTableMetadata;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface AggregatedEdge {
  source: string;
  target: string;
  labels: string[];
  count: number;
}

/**
 * Aggregate multiple edges between the same source::target pair.
 * Returns one AggregatedEdge per unique direction, with a count and all labels.
 */
export function aggregateEdges(edges: GraphEdge[]): AggregatedEdge[] {
  const map = new Map<string, AggregatedEdge>();
  for (const e of edges) {
    const key = `${e.source}::${e.target}`;
    const existing = map.get(key);
    if (existing) {
      existing.labels.push(e.label);
      existing.count++;
    } else {
      map.set(key, {
        source: e.source,
        target: e.target,
        labels: [e.label],
        count: 1,
      });
    }
  }
  return Array.from(map.values());
}

// ── Constants ────────────────────────────────────────────

/** Type name prefixes to filter out of the graph. */
const SKIP_PREFIXES = ["__"];

/** Root operation types to filter out. */
const SKIP_NAMES = new Set(["Query", "Mutation", "Subscription"]);

/** Scalar type names -- never show as graph nodes. */
const SCALAR_TYPES = new Set(["String", "Int", "Float", "Boolean", "ID"]);

/** Non-object kinds to skip. */
const SKIP_KINDS = new Set(["INPUT_OBJECT", "ENUM", "SCALAR", "UNION", "INTERFACE"]);

// ── Helpers ──────────────────────────────────────────────

/**
 * Recursively unwrap NON_NULL / LIST wrappers to get the leaf type name.
 * Returns null if the ref is null or the leaf has no name.
 */
export function resolveFieldTypeName(
  ref: IntrospectionTypeRef | null | undefined
): string | null {
  if (!ref) return null;
  if (ref.kind === "NON_NULL" || ref.kind === "LIST") {
    return resolveFieldTypeName(ref.ofType);
  }
  return ref.name;
}

/** Should this type be included as a node in the graph? */
function shouldInclude(t: IntrospectionType): boolean {
  if (t.kind !== "OBJECT") return false;
  if (SKIP_KINDS.has(t.kind)) return false;
  if (!t.fields || t.fields.length === 0) return false;
  if (SKIP_NAMES.has(t.name)) return false;
  if (SKIP_PREFIXES.some((p) => t.name.startsWith(p))) return false;
  if (SCALAR_TYPES.has(t.name)) return false;
  return true;
}

// ── Main parser ─────────────────────────────────────────

/**
 * Parse a list of introspection types into a graph-ready structure.
 * Nodes = GraphQL OBJECT types (excluding internals/scalars/inputs).
 * Edges = fields that reference another OBJECT type in the graph.
 */
export function parseSchemaToGraph(types: IntrospectionType[]): GraphData {
  // 1. Filter to documentable object types
  const objectTypes = types.filter(shouldInclude);
  const typeNameSet = new Set(objectTypes.map((t) => t.name));

  // 2. Build nodes
  const nodes: GraphNode[] = objectTypes.map((t) => ({
    id: t.name,
    description: t.description,
    fieldCount: t.fields!.length,
    fields: t.fields!.map((f) => ({
      name: f.name,
      typeName: resolveFieldTypeName(f.type) ?? "Unknown",
    })),
    incomingEdges: [],
  }));

  // 3. Build edges: field type refs pointing to other object types
  const edges: GraphEdge[] = [];

  for (const t of objectTypes) {
    for (const f of t.fields!) {
      const targetName = resolveFieldTypeName(f.type);
      if (targetName && typeNameSet.has(targetName) && targetName !== t.name) {
        edges.push({
          source: t.name,
          target: targetName,
          label: f.name,
        });
      }
    }
  }

  // 4. Populate incomingEdges on each node
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    const targetNode = nodeMap.get(edge.target);
    if (targetNode && !targetNode.incomingEdges.includes(edge.source)) {
      targetNode.incomingEdges.push(edge.source);
    }
  }

  return { nodes, edges };
}

