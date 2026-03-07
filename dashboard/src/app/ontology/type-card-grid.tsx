/**
 * Card grid (list view) for the Ontology Explorer.
 * Renders entity types as colored cards with health indicators.
 */

import type { CategoryConfigEntry } from "./schema-adapter";
import { COLORS, type EnrichedNode } from "./ontology-canvas";

export interface TypeCardGridProps {
  nodes: EnrichedNode[];
  enrichedNodes: EnrichedNode[];
  selectedNode: EnrichedNode | null;
  onSelectNode: (node: EnrichedNode) => void;
  categoryConfig: Record<string, CategoryConfigEntry>;
}

export function TypeCardGrid({
  nodes, enrichedNodes, selectedNode, onSelectNode, categoryConfig,
}: TypeCardGridProps) {
  return (
    <div className="h-full overflow-y-auto p-4 scrollbar-thin">
      <div className="grid grid-cols-3 gap-3">
        {nodes.map((node) => {
          const catConfig = categoryConfig[node.category] || categoryConfig.other;
          const CatIcon = catConfig.icon;
          const outCount = node.fields.filter((f) =>
            enrichedNodes.some((n) => n.id === f.typeName)
          ).length;
          return (
            <div
              key={node.id}
              onClick={() => onSelectNode(node)}
              className={`rounded-md border cursor-pointer transition-colors overflow-hidden ${
                selectedNode?.id === node.id
                  ? "border-[" + catConfig.color + "] bg-[#394B59]"
                  : "border-border bg-card hover:bg-[#394B59]/60"
              }`}
            >
              <div className="flex">
                <div className="w-1 flex-shrink-0" style={{ backgroundColor: catConfig.color }} />
                <div className="p-3 flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <CatIcon size={14} style={{ color: catConfig.color }} className="flex-shrink-0" />
                    <span className="text-sm font-semibold text-foreground truncate">{node.id}</span>
                    {node.healthStatus && (
                      <span
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor:
                            node.healthStatus === "green" ? COLORS.healthGreen
                              : node.healthStatus === "yellow" ? COLORS.healthYellow
                                : COLORS.healthRed,
                        }}
                      />
                    )}
                  </div>
                  {node.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{node.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{node.fieldCount} fields</span>
                    <span>{outCount} outgoing</span>
                    <span>{node.incomingEdges.length} incoming</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: catConfig.color + "20", color: catConfig.color }}
                    >
                      {catConfig.label}
                    </span>
                    {node.healthStatus && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          node.healthStatus === "green"
                            ? "bg-[#238551]/20 text-[#238551]"
                            : node.healthStatus === "yellow"
                              ? "bg-[#EC9A3C]/20 text-[#EC9A3C]"
                              : "bg-[#CD4246]/20 text-[#CD4246]"
                        }`}
                      >
                        {node.healthStatus === "green" ? "Fresh" : node.healthStatus === "yellow" ? "Stale" : "Very Stale"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
