/**
 * Schema parser for the Ontology graph.
 *
 * Takes GraphQL introspection result types and produces a graph-ready
 * structure of nodes (entity types) and edges (field references).
 */

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

// ── Constants ────────────────────────────────────────────

/** Type name prefixes to filter out of the graph. */
const SKIP_PREFIXES = ["__"];

/** Root operation types to filter out. */
const SKIP_NAMES = new Set(["Query", "Mutation", "Subscription"]);

/** Scalar type names -- never show as graph nodes. */
const SCALAR_TYPES = new Set(["String", "Int", "Float", "Boolean", "ID"]);

/** Non-object kinds to skip. */
const SKIP_KINDS = new Set(["INPUT_OBJECT", "ENUM", "SCALAR", "UNION", "INTERFACE"]);

// ── Staleness tolerance per stream (in hours) ───────────
// Mirrors the health page thresholds.

const TOLERANCE: Record<string, number> = {
  transcripts: 1,
  workflow_events: 1,
  tasks: 24,
  developer_context: 168, // 7 days
  skill_versions: 720,    // 30 days
};

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

// ── Health status mapping ───────────────────────────────

interface HealthStream {
  stream: string;
  count: number;
  lastUpdated: string | null;
  recentCount: number;
}

/**
 * Compute health status per entity type from DataHealth streams.
 * Returns a map of entity type name -> "green" | "yellow" | "red".
 */
export function getHealthStatus(
  streams: HealthStream[],
  lastSessionEndedAt: string | null,
  streamEntityMap: Record<string, string>
): Record<string, "green" | "yellow" | "red"> {
  const result: Record<string, "green" | "yellow" | "red"> = {};

  if (!lastSessionEndedAt) return result;

  const sessionMs = new Date(lastSessionEndedAt).getTime();
  if (isNaN(sessionMs)) return result;

  for (const s of streams) {
    const entityName = streamEntityMap[s.stream];
    if (!entityName) continue;

    if (!s.lastUpdated) {
      result[entityName] = "red";
      continue;
    }

    const updatedMs = new Date(s.lastUpdated).getTime();
    if (isNaN(updatedMs)) {
      result[entityName] = "red";
      continue;
    }

    const tolerance = TOLERANCE[s.stream] ?? 24;
    const lagHours = Math.max(0, (sessionMs - updatedMs) / (1000 * 60 * 60));

    if (lagHours <= tolerance) {
      result[entityName] = "green";
    } else if (lagHours <= tolerance * 2) {
      result[entityName] = "yellow";
    } else {
      result[entityName] = "red";
    }
  }

  return result;
}
