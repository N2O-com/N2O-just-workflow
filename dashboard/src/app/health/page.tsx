"use client";

import { useQuery } from "@apollo/client/react";
import { DATA_HEALTH_QUERY } from "@/lib/graphql/queries";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Types ────────────────────────────────────────────────

interface DataHealthStream {
  stream: string;
  count: number;
  lastUpdated: string | null;
  recentCount: number;
}

// ── Freshness thresholds (in hours) ─────────────────────

const FRESHNESS: Record<string, number> = {
  transcripts: 1,
  workflow_events: 1,
  tasks: 24,
  developer_context: 168, // 7 days
  skill_versions: 720, // 30 days
};

// ── Stream display labels ────────────────────────────────

const LABELS: Record<string, string> = {
  transcripts: "Transcripts",
  workflow_events: "Workflow Events",
  tasks: "Tasks",
  developer_context: "Developer Context",
  skill_versions: "Skill Versions",
};

// ── Helpers ──────────────────────────────────────────────

function getStatus(stream: string, lastUpdated: string | null): "green" | "yellow" | "red" {
  if (!lastUpdated) return "red";
  const threshold = FRESHNESS[stream] ?? 24;
  const parsed = new Date(lastUpdated).getTime();
  if (isNaN(parsed)) return "red";
  const ageHours = (Date.now() - parsed) / (1000 * 60 * 60);
  if (ageHours <= threshold) return "green";
  if (ageHours <= threshold * 2) return "yellow";
  return "red";
}

const STATUS_DOT: Record<string, string> = {
  green: "bg-[#238551]",
  yellow: "bg-[#EC9A3C]",
  red: "bg-[#CD4246]",
};

function formatThreshold(hours: number): string {
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function statusTooltip(stream: string, lastUpdated: string | null): string {
  const threshold = FRESHNESS[stream] ?? 24;
  const t = formatThreshold(threshold);
  const t2 = formatThreshold(threshold * 2);

  if (!lastUpdated) {
    return `No data — needs at least one record to turn green.\n\nGreen: updated within ${t}\nYellow: updated within ${t2}\nRed: older than ${t2} or no data`;
  }

  const parsed = new Date(lastUpdated).getTime();
  if (isNaN(parsed)) {
    return `Invalid timestamp.\n\nGreen: updated within ${t}\nYellow: updated within ${t2}\nRed: older than ${t2}`;
  }

  const ageHours = (Date.now() - parsed) / (1000 * 60 * 60);
  const ageStr = ageHours < 24
    ? `${Math.round(ageHours)}h old`
    : `${Math.round(ageHours / 24)}d old`;

  return `Currently ${ageStr}.\n\nGreen: updated within ${t}\nYellow: updated within ${t2}\nRed: older than ${t2}`;
}

function relativeTime(ts: string | null): string {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Page ─────────────────────────────────────────────────

export default function HealthPage() {
  const { data, loading, error } = useQuery<any>(DATA_HEALTH_QUERY, {
    pollInterval: 30000,
  });

  const streams: DataHealthStream[] = data?.dataHealth ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Data Health</h1>
        {!loading && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-[#238551] animate-pulse" />
            Live
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-[#CD4246]/30 bg-[#CD4246]/10 p-3 text-sm text-[#CD4246]">
          Failed to load health data: {error.message}
        </div>
      )}

      {loading && !data && (
        <div className="text-sm text-muted-foreground">Loading...</div>
      )}

      {streams.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-card">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Stream</th>
                <th className="px-4 py-2 text-center font-medium text-muted-foreground w-20">Status</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground w-24">Count</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground w-32">Last Updated</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground w-24">Rate (1h)</th>
              </tr>
            </thead>
            <tbody>
              {streams.map((s) => {
                const status = getStatus(s.stream, s.lastUpdated);
                return (
                  <tr key={s.stream} className="border-b border-border last:border-0 hover:bg-card/50">
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {LABELS[s.stream] ?? s.stream}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-full cursor-help ${STATUS_DOT[status]}`}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8} className="max-w-64">
                          <p className="whitespace-pre-line text-xs">
                            {statusTooltip(s.stream, s.lastUpdated)}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {s.count.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                      {relativeTime(s.lastUpdated)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {s.recentCount > 0 ? `${s.recentCount}/hr` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
