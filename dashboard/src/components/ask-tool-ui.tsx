"use client";

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
    <div className="max-h-[300px] overflow-auto rounded-md border border-border">
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
  result,
}: {
  args: { query: string; variables?: Record<string, unknown> };
  result?: QueryResult;
  [key: string]: unknown;
}) {
  if (!result) {
    return (
      <div className="text-xs text-muted-foreground animate-pulse py-1">
        Querying data...
      </div>
    );
  }

  if (result.errors?.length) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {result.errors[0].message}
      </div>
    );
  }

  if (!result.data) {
    return (
      <div className="text-xs text-muted-foreground py-1">No data returned</div>
    );
  }

  // Extract the first array value from the data object
  const dataKey = Object.keys(result.data)[0];
  const dataValue = result.data[dataKey];

  if (Array.isArray(dataValue)) {
    return (
      <div className="my-2">
        <DataTable rows={dataValue as Record<string, unknown>[]} />
      </div>
    );
  }

  // Single object result
  if (typeof dataValue === "object" && dataValue !== null) {
    return (
      <div className="my-2">
        <DataTable rows={[dataValue as Record<string, unknown>]} />
      </div>
    );
  }

  return (
    <div className="text-xs text-muted-foreground py-1">
      {JSON.stringify(result.data)}
    </div>
  );
}

export function useQueryOntologyToolUI() {
  useAssistantToolUI({
    toolName: "query_ontology",
    render: QueryOntologyToolUI,
  });
}
