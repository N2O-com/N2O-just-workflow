"use client";

import { useState } from "react";
import { ChevronRight, Database } from "lucide-react";
import { useAssistantToolUI } from "@assistant-ui/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface QueryResult {
  data: Record<string, unknown> | null;
  errors?: Array<{ message: string }>;
}

function flattenValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Generate a plain-English description of what the GraphQL query does */
function describeQuery(query: string): string {
  const cleaned = query.replace(/\s+/g, " ").trim();

  // Extract the root query name and args
  const rootMatch = cleaned.match(/\{\s*(\w+)(?:\(([^)]*)\))?/);
  if (!rootMatch) return "GraphQL query";

  const queryName = rootMatch[1];
  const argsStr = rootMatch[2];

  // Parse arguments into readable filters
  const filters: string[] = [];
  if (argsStr) {
    const argPairs = argsStr.match(/(\w+):\s*(?:"([^"]*)"|([\w.]+))/g);
    if (argPairs) {
      for (const pair of argPairs) {
        const m = pair.match(/(\w+):\s*(?:"([^"]*)"|([\w.]+))/);
        if (m) {
          const key = m[1];
          const val = m[2] ?? m[3];
          if (key === "limit") {
            filters.push(`last ${val}`);
          } else if (key === "sprint") {
            filters.push(`sprint "${val}"`);
          } else if (key === "developer" || key === "owner") {
            filters.push(`for ${val}`);
          } else if (key === "dateFrom") {
            filters.push(`from ${val}`);
          } else if (key === "dateTo") {
            filters.push(`to ${val}`);
          } else if (key === "status") {
            filters.push(`status = ${val}`);
          } else {
            filters.push(`${key} = ${val}`);
          }
        }
      }
    }
  }

  // Map query names to readable descriptions
  const descriptions: Record<string, string> = {
    activityLog: "Fetching activity log",
    tasks: "Fetching tasks",
    task: "Fetching task details",
    availableTasks: "Fetching available tasks",
    sprint: "Fetching sprint details",
    sprints: "Fetching sprints",
    developers: "Fetching developers",
    developer: "Fetching developer details",
    projects: "Fetching projects",
    project: "Fetching project details",
    conversationFeed: "Fetching conversation feed",
    events: "Fetching events",
    transcripts: "Fetching transcripts",
    dataHealth: "Fetching data health",
    skillUsage: "Fetching skill usage",
    skillTokenUsage: "Fetching skill token usage",
    developerQuality: "Fetching developer quality metrics",
    commonAuditFindings: "Fetching audit findings",
    reversionHotspots: "Fetching reversion hotspots",
    sprintVelocity: "Fetching sprint velocity",
    estimationAccuracy: "Fetching estimation accuracy",
    estimationAccuracyByType: "Fetching estimation accuracy by type",
    estimationAccuracyByComplexity: "Fetching estimation accuracy by complexity",
    developerLearningRate: "Fetching developer learning rates",
    phaseTimingDistribution: "Fetching phase timing",
    tokenEfficiencyTrend: "Fetching token efficiency trend",
    blowUpFactors: "Fetching blow-up factors",
    sessionTimeline: "Fetching session timeline",
  };

  const base = descriptions[queryName] ?? `Querying ${queryName}`;
  if (filters.length === 0) return base;
  return `${base} (${filters.join(", ")})`;
}

/** Collapsible section showing the GraphQL query that was executed */
function QueryDisclosure({
  query,
  variables,
  hasError,
}: {
  query: string;
  variables?: Record<string, unknown>;
  hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const description = describeQuery(query);

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 text-xs rounded-md px-2 py-1 transition-colors ${
          hasError
            ? "text-destructive/80 hover:bg-destructive/10"
            : "text-muted-foreground hover:bg-secondary"
        }`}
      >
        <ChevronRight
          size={12}
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Database size={12} />
        <span>{description}</span>
      </button>
      {open && (
        <div className="mt-1 ml-1 rounded-md border border-border bg-muted/30 overflow-x-auto">
          <pre className="p-2.5 text-xs font-mono text-foreground/80 whitespace-pre-wrap">
            {query.trim()}
          </pre>
          {variables && Object.keys(variables).length > 0 && (
            <div className="border-t border-border px-2.5 py-1.5 text-xs text-muted-foreground">
              Variables: {JSON.stringify(variables)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
        No results
      </div>
    );
  }

  const columns = Object.keys(rows[0]).filter(
    (k) => k !== "__typename"
  );

  return (
    <div className="relative max-h-[300px] overflow-auto rounded-md border border-border scrollbar-thin">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col} className="text-xs whitespace-nowrap">
                {col}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col} className="text-xs py-1.5">
                  {flattenValue(row[col])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function QueryOntologyToolUI({
  args,
  result,
}: {
  args: { query: string; variables?: Record<string, unknown> };
  result?: QueryResult;
  [key: string]: unknown;
}) {
  if (!result) {
    return (
      <div className="my-2">
        <QueryDisclosure query={args.query} variables={args.variables} />
        <div className="text-xs text-muted-foreground animate-pulse py-1">
          Querying data...
        </div>
      </div>
    );
  }

  if (result.errors?.length) {
    return (
      <div className="my-2">
        <QueryDisclosure
          query={args.query}
          variables={args.variables}
          hasError
        />
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {result.errors[0].message}
        </div>
      </div>
    );
  }

  if (!result.data) {
    return (
      <div className="my-2">
        <QueryDisclosure query={args.query} variables={args.variables} />
        <div className="text-xs text-muted-foreground py-1">
          No data returned
        </div>
      </div>
    );
  }

  // Extract the first array value from the data object
  const dataKey = Object.keys(result.data)[0];
  const dataValue = result.data[dataKey];

  if (Array.isArray(dataValue)) {
    return (
      <div className="my-2">
        <QueryDisclosure query={args.query} variables={args.variables} />
        <DataTable rows={dataValue as Record<string, unknown>[]} />
      </div>
    );
  }

  // Single object result
  if (typeof dataValue === "object" && dataValue !== null) {
    return (
      <div className="my-2">
        <QueryDisclosure query={args.query} variables={args.variables} />
        <DataTable rows={[dataValue as Record<string, unknown>]} />
      </div>
    );
  }

  return (
    <div className="my-2">
      <QueryDisclosure query={args.query} variables={args.variables} />
      <div className="text-xs text-muted-foreground py-1">
        {JSON.stringify(result.data)}
      </div>
    </div>
  );
}

export function useQueryOntologyToolUI() {
  useAssistantToolUI({
    toolName: "query_ontology",
    render: QueryOntologyToolUI,
  });
}
