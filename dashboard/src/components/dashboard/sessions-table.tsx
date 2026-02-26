"use client";

import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Session {
  sessionId: string;
  sprint: string | null;
  taskNum: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  toolCallCount: number | null;
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

function formatTokens(n: number | null): string {
  if (!n) return "—";
  return n > 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${(mins / 60).toFixed(1)}h`;
}

function timeAgo(ts: string | null): string {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function SessionsTable({ sessions }: { sessions: Session[] }) {
  return (
    <Card className="p-3 bg-card border-border">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Recent Sessions
      </h3>
      {sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No sessions</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[11px] h-7">Session</TableHead>
              <TableHead className="text-[11px] h-7">Task</TableHead>
              <TableHead className="text-[11px] h-7">Duration</TableHead>
              <TableHead className="text-[11px] h-7">Tokens</TableHead>
              <TableHead className="text-[11px] h-7">Model</TableHead>
              <TableHead className="text-[11px] h-7 text-right">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.slice(0, 10).map((s, i) => (
              <TableRow
                key={`${s.sessionId}-${i}`}
                className="border-border hover:bg-secondary/50"
              >
                <TableCell className="py-1.5 text-xs font-mono text-accent-foreground" data-mono>
                  {s.sessionId.slice(0, 8)}
                </TableCell>
                <TableCell className="py-1.5 text-xs font-mono" data-mono>
                  {s.sprint && s.taskNum != null
                    ? `${s.sprint} #${s.taskNum}`
                    : "—"}
                </TableCell>
                <TableCell className="py-1.5 text-xs font-mono" data-mono>
                  {formatDuration(s.startedAt, s.endedAt)}
                </TableCell>
                <TableCell className="py-1.5 text-xs font-mono" data-mono>
                  {formatTokens(
                    (s.totalInputTokens ?? 0) + (s.totalOutputTokens ?? 0)
                  )}
                </TableCell>
                <TableCell className="py-1.5 text-[11px] text-muted-foreground">
                  {s.model?.replace("claude-", "").split("-")[0] ?? "—"}
                </TableCell>
                <TableCell className="py-1.5 text-[11px] text-muted-foreground text-right">
                  {timeAgo(s.endedAt ?? s.startedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
