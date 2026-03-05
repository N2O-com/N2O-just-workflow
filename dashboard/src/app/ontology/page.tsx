/**
 * Ontology page: force-directed graph of all GraphQL entity types.
 *
 * - Nodes = GraphQL OBJECT types (Task, Sprint, Developer, etc.)
 * - Edges = fields that reference other OBJECT types
 * - Click node -> right sidebar with field details
 * - Health freshness dots per entity node
 * - Search bar to find/highlight entities
 */
"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@apollo/client/react";
import { gql } from "@apollo/client/core";
import { Search, X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { DATA_HEALTH_QUERY } from "@/lib/graphql/queries";
import {
  parseSchemaToGraph,
  getHealthStatus,
  type GraphNode,
  type GraphEdge,
  type IntrospectionType,
} from "./schema-parser";

// ── Dynamic import (no SSR for canvas-based lib) ────────

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

// ── Introspection query ─────────────────────────────────

const INTROSPECTION_QUERY = gql`
  query OntologyIntrospection {
    __schema {
      types {
        name
        kind
        description
        fields {
          name
          type {
            name
            kind
            ofType {
              name
              kind
              ofType {
                name
                kind
                ofType {
                  name
                  kind
                }
              }
            }
          }
        }
      }
    }
  }
`;

// ── Stream -> entity mapping ────────────────────────────

const STREAM_ENTITY_MAP: Record<string, string> = {
  transcripts: "Transcript",
  workflow_events: "Event",
  tasks: "Task",
  developer_context: "DeveloperContext",
  skill_versions: "SkillVersion",
};

// ── Colors ──────────────────────────────────────────────

const COLORS = {
  bg: "#1C2127",
  nodeFill: "#2D72D2",
  nodeHighlight: "#4B94E6",
  nodeMatched: "#FFFFFF",
  nodeDimmed: "#394048",
  edge: "#394048",
  edgeHighlight: "#5F6B7C",
  text: "#F5F8FA",
  textMuted: "#738694",
  card: "#252A31",
  border: "#394048",
  healthGreen: "#238551",
  healthYellow: "#EC9A3C",
  healthRed: "#CD4246",
};

// ── Force graph node/link shapes ────────────────────────
// Use permissive index-signature types matching react-force-graph's NodeObject.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ForceNode = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ForceLink = Record<string, any>;

// ── Main component ──────────────────────────────────────

export default function OntologyPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Measure container on mount and resize
  useEffect(() => {
    function updateDimensions() {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width,
          height: rect.height,
        });
      }
    }
    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // ── Data fetching ───────────────────────────────────

  const {
    data: schemaData,
    loading: schemaLoading,
    error: schemaError,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = useQuery<any>(INTROSPECTION_QUERY);

  const {
    data: healthData,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = useQuery<any>(DATA_HEALTH_QUERY, {
    pollInterval: 30000,
  });

  // ── Parse schema into graph ─────────────────────────

  const graphData = useMemo(() => {
    if (!schemaData?.__schema?.types) return null;
    const types: IntrospectionType[] = schemaData.__schema.types;
    return parseSchemaToGraph(types);
  }, [schemaData]);

  // ── Health status per entity ────────────────────────

  const healthMap = useMemo(() => {
    const streams = healthData?.dataHealth?.streams ?? [];
    const lastSession = healthData?.dataHealth?.lastSessionEndedAt ?? null;
    return getHealthStatus(streams, lastSession, STREAM_ENTITY_MAP);
  }, [healthData]);

  // ── Apply health status to nodes ────────────────────

  const enrichedNodes = useMemo(() => {
    if (!graphData) return [];
    return graphData.nodes.map((n) => ({
      ...n,
      healthStatus: healthMap[n.id] ?? null,
    }));
  }, [graphData, healthMap]);

  // ── Search filtering ────────────────────────────────

  const matchedNodeIds = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>();
    const q = searchQuery.toLowerCase();
    return new Set(
      enrichedNodes
        .filter((n) => n.id.toLowerCase().includes(q))
        .map((n) => n.id)
    );
  }, [searchQuery, enrichedNodes]);

  const hasSearch = searchQuery.trim().length > 0;

  // ── Force graph data ────────────────────────────────

  const forceGraphData = useMemo(() => {
    if (!graphData) return { nodes: [], links: [] };
    return {
      nodes: enrichedNodes,
      links: graphData.edges.map((e: GraphEdge) => ({
        source: e.source,
        target: e.target,
        label: e.label,
      })),
    };
  }, [enrichedNodes, graphData]);

  // ── Node click handler ──────────────────────────────

  const handleNodeClick = useCallback(
    (node: ForceNode) => {
      const found = enrichedNodes.find((n) => n.id === node.id);
      setSelectedNode(found ?? null);
    },
    [enrichedNodes]
  );

  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // ── Zoom controls ──────────────────────────────────

  const handleZoomIn = useCallback(() => {
    if (graphRef.current) {
      const currentZoom = graphRef.current.zoom();
      graphRef.current.zoom(currentZoom * 1.5, 300);
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (graphRef.current) {
      const currentZoom = graphRef.current.zoom();
      graphRef.current.zoom(currentZoom / 1.5, 300);
    }
  }, []);

  const handleZoomFit = useCallback(() => {
    if (graphRef.current) {
      graphRef.current.zoomToFit(400, 40);
    }
  }, []);

  // ── Node hover ─────────────────────────────────────

  const handleNodeHover = useCallback((node: ForceNode | null) => {
    setHoveredNode(node?.id ?? null);
  }, []);

  // ── Custom node rendering ──────────────────────────

  const nodeCanvasObject = useCallback(
    (node: ForceNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const label = node.id as string;
      const fontSize = 12 / globalScale;
      ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;

      // Determine node state
      const isSelected = selectedNode?.id === node.id;
      const isHovered = hoveredNode === node.id;
      const isMatched = hasSearch && matchedNodeIds.has(node.id);
      const isDimmed = hasSearch && !matchedNodeIds.has(node.id);

      // Node sizing
      const fieldCount = node.fieldCount ?? 4;
      const baseRadius = Math.max(8, Math.min(18, 6 + fieldCount * 0.8)) / globalScale;
      const radius = isSelected || isHovered ? baseRadius * 1.2 : baseRadius;

      // Node fill color
      let fillColor = COLORS.nodeFill;
      if (isDimmed) fillColor = COLORS.nodeDimmed;
      if (isMatched) fillColor = COLORS.nodeHighlight;
      if (isSelected) fillColor = COLORS.nodeHighlight;
      if (isHovered && !isSelected) fillColor = COLORS.nodeHighlight;

      // Draw node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = fillColor;
      ctx.fill();

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = COLORS.text;
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Health dot (top-right of node)
      const health = node.healthStatus as string | null;
      if (health) {
        const dotRadius = 3 / globalScale;
        const dotX = node.x + radius * 0.7;
        const dotY = node.y - radius * 0.7;
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
        ctx.fillStyle =
          health === "green"
            ? COLORS.healthGreen
            : health === "yellow"
              ? COLORS.healthYellow
              : COLORS.healthRed;
        ctx.fill();
      }

      // Label
      const textOpacity = isDimmed ? 0.3 : 1;
      ctx.fillStyle = COLORS.text;
      ctx.globalAlpha = textOpacity;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(label, node.x, node.y + radius + 2 / globalScale);
      ctx.globalAlpha = 1;
    },
    [selectedNode, hoveredNode, hasSearch, matchedNodeIds]
  );

  const nodePointerAreaPaint = useCallback(
    (node: ForceNode, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const fieldCount = node.fieldCount ?? 4;
      const radius = Math.max(8, Math.min(18, 6 + fieldCount * 0.8)) / globalScale;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius * 1.5, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    []
  );

  // ── Link rendering ────────────────────────────────

  const linkColor = useCallback(
    (link: ForceLink) => {
      if (selectedNode) {
        const srcId = typeof link.source === "object" ? (link.source as ForceNode).id : link.source;
        const tgtId = typeof link.target === "object" ? (link.target as ForceNode).id : link.target;
        if (srcId === selectedNode.id || tgtId === selectedNode.id) {
          return COLORS.edgeHighlight;
        }
      }
      if (hasSearch) return COLORS.nodeDimmed;
      return COLORS.edge;
    },
    [selectedNode, hasSearch]
  );

  // ── Sidebar width ─────────────────────────────────

  const sidebarOpen = selectedNode !== null;
  const sidebarWidth = 320;

  // Recalculate graph width when sidebar opens/closes
  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDimensions({
        width: rect.width - (sidebarOpen ? sidebarWidth : 0),
        height: rect.height,
      });
    }
  }, [sidebarOpen]);

  // ── Loading / error states ────────────────────────

  if (schemaLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading schema...</div>
      </div>
    );
  }

  if (schemaError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="rounded-md border border-[#CD4246]/30 bg-[#CD4246]/10 p-4 text-sm text-[#CD4246]">
          Failed to load schema: {schemaError.message}
        </div>
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">No entity types found in schema.</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      {/* Search bar */}
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
        <div className="flex items-center rounded-md border border-border bg-card px-3 py-1.5 text-sm">
          <Search size={14} className="mr-2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search entities..."
            className="bg-transparent text-foreground placeholder:text-muted-foreground outline-none w-48"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="ml-1 text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {hasSearch && (
          <span className="text-xs text-muted-foreground">
            {matchedNodeIds.size} of {enrichedNodes.length} entities
          </span>
        )}
      </div>

      {/* Zoom controls */}
      <div className="absolute left-4 bottom-4 z-10 flex flex-col gap-1">
        <button
          onClick={handleZoomIn}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          title="Zoom in"
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={handleZoomOut}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          title="Zoom out"
        >
          <ZoomOut size={16} />
        </button>
        <button
          onClick={handleZoomFit}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          title="Fit to view"
        >
          <Maximize2 size={16} />
        </button>
      </div>

      {/* Legend */}
      <div className="absolute right-4 bottom-4 z-10 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground"
           style={{ right: sidebarOpen ? `${sidebarWidth + 16}px` : "16px" }}>
        <div className="mb-1.5 font-medium text-foreground">Health</div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS.healthGreen }} />
            <span>Fresh</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS.healthYellow }} />
            <span>Stale</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS.healthRed }} />
            <span>Very stale</span>
          </div>
        </div>
      </div>

      {/* Force graph */}
      <ForceGraph2D
        ref={graphRef}
        graphData={forceGraphData}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor={COLORS.bg}
        nodeId="id"
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => "replace"}
        nodePointerAreaPaint={nodePointerAreaPaint}
        linkColor={linkColor}
        linkWidth={1}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={linkColor}
        linkCurvature={0.15}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onBackgroundClick={handleBackgroundClick}
        enableZoomInteraction={true}
        enablePanInteraction={true}
        enableNodeDrag={true}
        cooldownTime={3000}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />

      {/* Right sidebar */}
      {sidebarOpen && selectedNode && (
        <div
          className="absolute right-0 top-0 z-20 h-full border-l border-border bg-card overflow-y-auto scrollbar-thin"
          style={{ width: `${sidebarWidth}px` }}
        >
          <div className="p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">
                  {selectedNode.id}
                </h2>
                {selectedNode.healthStatus && (
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor:
                        selectedNode.healthStatus === "green"
                          ? COLORS.healthGreen
                          : selectedNode.healthStatus === "yellow"
                            ? COLORS.healthYellow
                            : COLORS.healthRed,
                    }}
                  />
                )}
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Description */}
            {selectedNode.description && (
              <p className="text-xs text-muted-foreground">
                {selectedNode.description}
              </p>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-md border border-border bg-background p-2">
                <div className="text-muted-foreground">Fields</div>
                <div className="text-lg font-semibold text-foreground">
                  {selectedNode.fieldCount}
                </div>
              </div>
              <div className="rounded-md border border-border bg-background p-2">
                <div className="text-muted-foreground">Referenced by</div>
                <div className="text-lg font-semibold text-foreground">
                  {selectedNode.incomingEdges.length}
                </div>
              </div>
            </div>

            {/* Fields list */}
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Fields
              </h3>
              <div className="space-y-0.5">
                {selectedNode.fields.map((f) => {
                  const isRelation = enrichedNodes.some((n) => n.id === f.typeName);
                  return (
                    <div
                      key={f.name}
                      className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-background"
                    >
                      <span className="font-mono text-foreground">{f.name}</span>
                      <span
                        className={`font-mono ${
                          isRelation
                            ? "text-[#2D72D2] cursor-pointer hover:underline"
                            : "text-muted-foreground"
                        }`}
                        onClick={() => {
                          if (isRelation) {
                            const target = enrichedNodes.find(
                              (n) => n.id === f.typeName
                            );
                            if (target) setSelectedNode(target);
                          }
                        }}
                      >
                        {f.typeName}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Incoming references */}
            {selectedNode.incomingEdges.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Referenced by
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {selectedNode.incomingEdges.map((src) => (
                    <button
                      key={src}
                      onClick={() => {
                        const node = enrichedNodes.find((n) => n.id === src);
                        if (node) setSelectedNode(node);
                      }}
                      className="rounded border border-border bg-background px-2 py-0.5 text-xs font-mono text-[#2D72D2] hover:bg-secondary transition-colors"
                    >
                      {src}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Health details */}
            {selectedNode.healthStatus && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Data Health
                </h3>
                <div className="flex items-center gap-2 rounded-md border border-border bg-background p-2 text-xs">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor:
                        selectedNode.healthStatus === "green"
                          ? COLORS.healthGreen
                          : selectedNode.healthStatus === "yellow"
                            ? COLORS.healthYellow
                            : COLORS.healthRed,
                    }}
                  />
                  <span className="text-foreground">
                    {selectedNode.healthStatus === "green"
                      ? "Data is fresh"
                      : selectedNode.healthStatus === "yellow"
                        ? "Data is stale"
                        : "Data is very stale"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
