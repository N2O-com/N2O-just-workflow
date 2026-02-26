"use client";

import { useState } from "react";
import { useQuery } from "@apollo/client/react";
import { ACTIVITY_INSIGHTS_QUERY } from "@/lib/graphql/queries";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";

// ── Helpers ──────────────────────────────────────────────

function formatTokens(n: number | null): string {
  if (!n) return "—";
  return n > 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);
}

function formatDuration(mins: number | null): string {
  if (!mins) return "—";
  if (mins < 60) return `${Math.round(mins)}m`;
  return `${(mins / 60).toFixed(1)}h`;
}

function shortModel(model: string | null): string {
  if (!model) return "—";
  if (model.includes("opus")) return "opus";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("haiku")) return "haiku";
  return model.split("-").slice(-1)[0];
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

function formatDateTime(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

// ── Types ────────────────────────────────────────────────

interface SubagentSession {
  sessionId: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  toolCallCount: number | null;
  model: string | null;
}

interface Session {
  sessionId: string;
  developer: string | null;
  sprint: string | null;
  taskNum: number | null;
  taskTitle: string | null;
  skillName: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  toolCallCount: number | null;
  messageCount: number | null;
  model: string | null;
  subagents: SubagentSession[];
}

interface DevStats {
  name: string;
  sessions: number;
  totalTokens: number;
  totalMinutes: number;
  skills: Map<string, number>;
  peakConcurrency: number;
  totalSubagents: number;
  sessionList: Session[];
}

// ── Compute ──────────────────────────────────────────────

function peakConcurrency(sessions: { startedAt: string; endedAt: string | null }[]): number {
  if (sessions.length === 0) return 0;
  const events: { time: number; delta: number }[] = [];
  for (const s of sessions) {
    events.push({ time: new Date(s.startedAt).getTime(), delta: 1 });
    const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
    events.push({ time: end, delta: -1 });
  }
  events.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let current = 0, max = 0;
  for (const e of events) {
    current += e.delta;
    max = Math.max(max, current);
  }
  return max;
}

function computeDevStats(sessions: Session[]): DevStats[] {
  const devMap = new Map<string, DevStats>();

  for (const s of sessions) {
    const dev = s.developer ?? "unassigned";
    if (!devMap.has(dev)) {
      devMap.set(dev, {
        name: dev,
        sessions: 0,
        totalTokens: 0,
        totalMinutes: 0,
        skills: new Map(),
        peakConcurrency: 0,
        totalSubagents: 0,
        sessionList: [],
      });
    }
    const stats = devMap.get(dev)!;
    stats.sessions++;
    stats.totalTokens += (s.totalInputTokens ?? 0) + (s.totalOutputTokens ?? 0);
    stats.totalMinutes += s.durationMinutes ?? 0;
    if (s.skillName) {
      stats.skills.set(s.skillName, (stats.skills.get(s.skillName) ?? 0) + 1);
    }
    stats.totalSubagents += s.subagents?.length ?? 0;
    stats.sessionList.push(s);
  }

  for (const stats of devMap.values()) {
    stats.peakConcurrency = peakConcurrency(stats.sessionList);
  }

  return Array.from(devMap.values()).sort((a, b) => b.totalTokens - a.totalTokens);
}

// ── Page ─────────────────────────────────────────────────

export default function ActivityPage() {
  const { data, loading, error } = useQuery<any>(ACTIVITY_INSIGHTS_QUERY);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [devFilter, setDevFilter] = useState<string>("all");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading activity insights...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-[#CD4246]">
        Error: {error.message}
      </div>
    );
  }

  const sessions: Session[] = data?.sessionTimeline ?? [];
  const quality: any[] = data?.developerQuality ?? [];
  const findings: any[] = data?.commonAuditFindings ?? [];
  const skillUsage: any[] = data?.skillUsage ?? [];

  const devStats = computeDevStats(sessions);
  const allDevNames = devStats.map((d) => d.name);

  // Lookups
  const qualityByDev = new Map(quality.map((q) => [q.owner, q]));
  const findingsByDev = new Map(findings.map((f) => [f.owner, f]));

  // Global KPIs
  const totalSessions = sessions.length;
  const globalPeakConcurrency = peakConcurrency(sessions);
  const uniqueSkills = new Set(sessions.map((s) => s.skillName).filter(Boolean)).size;
  const totalReversions = quality.reduce((sum: number, q: any) => sum + (q.totalReversions ?? 0), 0);
  const totalTasks = quality.reduce((sum: number, q: any) => sum + (q.totalTasks ?? 0), 0);
  const reversionRate = totalTasks > 0 ? (totalReversions / totalTasks).toFixed(2) : "0";

  // Filtered sessions for explorer
  const filteredSessions =
    devFilter === "all"
      ? sessions
      : sessions.filter((s) => (s.developer ?? "unassigned") === devFilter);

  const sortedSessions = [...filteredSessions].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  const toggleSession = (id: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Activity</h1>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="Sessions" value={totalSessions} />
        <KpiCard label="Peak Concurrency" value={globalPeakConcurrency} />
        <KpiCard label="Skills Adopted" value={uniqueSkills} />
        <KpiCard label="Reversion Rate" value={`${reversionRate}/task`} />
      </div>

      {/* Developer Contribution + Skill Adoption */}
      <div className="grid grid-cols-5 gap-3">
        {/* Developer Contribution Cards — 3 cols */}
        <div className="col-span-3">
          <Card className="p-3 bg-card border-border">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Developer Contribution
            </h3>
            {devStats.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data</p>
            ) : (
              <div className="space-y-2">
                {devStats.map((dev) => {
                  const q = qualityByDev.get(dev.name) as any;
                  return (
                    <div
                      key={dev.name}
                      className="border border-border/50 rounded-sm p-2.5 bg-background/30"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold text-foreground">
                          {dev.name}
                        </span>
                        <div className="flex gap-3 text-[11px] text-muted-foreground font-mono" data-mono>
                          <span>{dev.sessions} sessions</span>
                          <span>{formatTokens(dev.totalTokens)} tokens</span>
                          <span>{formatDuration(dev.totalMinutes)}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4 mt-1">
                        {/* Skills used */}
                        <div>
                          <span className="text-[10px] uppercase text-muted-foreground tracking-wider">
                            Skills
                          </span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {dev.skills.size === 0 ? (
                              <span className="text-[11px] text-muted-foreground">
                                none
                              </span>
                            ) : (
                              Array.from(dev.skills.entries())
                                .sort((a, b) => b[1] - a[1])
                                .map(([skill, count]) => (
                                  <span
                                    key={skill}
                                    className="text-[10px] px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary font-mono"
                                    data-mono
                                  >
                                    {skill} ({count})
                                  </span>
                                ))
                            )}
                          </div>
                        </div>

                        {/* Concurrency */}
                        <div>
                          <span className="text-[10px] uppercase text-muted-foreground tracking-wider">
                            Concurrency
                          </span>
                          <div className="mt-0.5 flex items-center gap-2">
                            <span
                              className="text-xs font-mono font-bold"
                              style={{
                                color:
                                  dev.peakConcurrency >= 3
                                    ? "#238551"
                                    : dev.peakConcurrency >= 2
                                      ? "#EC9A3C"
                                      : "#738694",
                              }}
                              data-mono
                            >
                              {dev.peakConcurrency} peak
                            </span>
                            <span
                              className="text-[11px] text-muted-foreground font-mono"
                              data-mono
                            >
                              {dev.totalSubagents} subagents
                            </span>
                          </div>
                        </div>

                        {/* Quality */}
                        <div>
                          <span className="text-[10px] uppercase text-muted-foreground tracking-wider">
                            Quality
                          </span>
                          <div className="mt-0.5">
                            {q ? (
                              <div className="flex gap-2 items-center">
                                <span
                                  className="text-xs font-mono font-bold"
                                  style={{
                                    color:
                                      (q.aGradePct ?? 0) >= 80
                                        ? "#238551"
                                        : (q.aGradePct ?? 0) >= 50
                                          ? "#EC9A3C"
                                          : "#CD4246",
                                  }}
                                  data-mono
                                >
                                  {q.aGradePct?.toFixed(0) ?? 0}% A
                                </span>
                                <span
                                  className="text-[11px] text-muted-foreground font-mono"
                                  data-mono
                                >
                                  {q.reversionsPerTask?.toFixed(1) ?? 0} rev/task
                                </span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">
                                no data
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Right column — Skill Adoption + Quality Signals */}
        <div className="col-span-2 space-y-3">
          {/* Skill Adoption */}
          <Card className="p-3 bg-card border-border">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Skill Adoption
            </h3>
            {skillUsage.length === 0 ? (
              <p className="text-xs text-muted-foreground">No skills data</p>
            ) : (
              <div className="space-y-1.5">
                {skillUsage.map((s: any) => {
                  const maxInv = Math.max(
                    ...skillUsage.map((x: any) => x.invocations),
                    1
                  );
                  const pct = (s.invocations / maxInv) * 100;
                  return (
                    <div key={s.toolName} className="flex items-center gap-2">
                      <span className="text-xs text-accent-foreground w-24 truncate shrink-0">
                        {s.toolName}
                      </span>
                      <div className="flex-1 h-3 bg-background/50 rounded-sm overflow-hidden">
                        <div
                          className="h-full rounded-sm"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: "#2D72D2",
                            opacity: 0.7,
                          }}
                        />
                      </div>
                      <span
                        className="text-[11px] font-mono text-muted-foreground w-8 text-right shrink-0"
                        data-mono
                      >
                        {s.invocations}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Quality Signals Table */}
          <Card className="p-3 bg-card border-border">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Quality Signals
            </h3>
            {quality.length === 0 ? (
              <p className="text-xs text-muted-foreground">No quality data</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-[11px] h-7">Dev</TableHead>
                    <TableHead className="text-[11px] h-7 text-right">Tasks</TableHead>
                    <TableHead className="text-[11px] h-7 text-right">Rev.</TableHead>
                    <TableHead className="text-[11px] h-7 text-right">Rev/Task</TableHead>
                    <TableHead className="text-[11px] h-7 text-right">A%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quality.map((q: any) => {
                    const f = findingsByDev.get(q.owner) as any;
                    return (
                      <TableRow
                        key={q.owner}
                        className="border-border hover:bg-secondary/50"
                      >
                        <TableCell className="py-1 text-xs text-accent-foreground">
                          {q.owner}
                        </TableCell>
                        <TableCell
                          className="py-1 text-xs font-mono text-right"
                          data-mono
                        >
                          {q.totalTasks}
                        </TableCell>
                        <TableCell
                          className="py-1 text-xs font-mono text-right"
                          style={{
                            color: q.totalReversions > 2 ? "#CD4246" : "#738694",
                          }}
                          data-mono
                        >
                          {q.totalReversions}
                        </TableCell>
                        <TableCell
                          className="py-1 text-xs font-mono text-right"
                          data-mono
                        >
                          {q.reversionsPerTask?.toFixed(1) ?? "—"}
                        </TableCell>
                        <TableCell
                          className="py-1 text-xs font-mono text-right font-bold"
                          style={{
                            color:
                              (q.aGradePct ?? 0) >= 80
                                ? "#238551"
                                : (q.aGradePct ?? 0) >= 50
                                  ? "#EC9A3C"
                                  : "#CD4246",
                          }}
                          data-mono
                        >
                          {q.aGradePct?.toFixed(0) ?? "—"}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      </div>

      {/* Concurrency Leaders */}
      <Card className="p-3 bg-card border-border">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Concurrency Leaders
          <span className="normal-case font-normal ml-2 text-muted-foreground">
            sessions with most subagent parallelism
          </span>
        </h3>
        {(() => {
          const withSubagents = sessions
            .filter((s) => (s.subagents?.length ?? 0) > 0)
            .sort((a, b) => (b.subagents?.length ?? 0) - (a.subagents?.length ?? 0))
            .slice(0, 8);

          if (withSubagents.length === 0) {
            return (
              <p className="text-xs text-muted-foreground">
                No concurrent sessions found
              </p>
            );
          }

          return (
            <div className="space-y-0.5">
              {withSubagents.map((s) => {
                const tokens =
                  (s.totalInputTokens ?? 0) + (s.totalOutputTokens ?? 0);
                const subTokens = s.subagents.reduce(
                  (sum, sub) =>
                    sum + (sub.totalInputTokens ?? 0) + (sub.totalOutputTokens ?? 0),
                  0
                );
                return (
                  <div
                    key={s.sessionId}
                    className="flex items-center gap-2 text-xs py-1 border-b border-border/20 last:border-0"
                  >
                    <span className="text-accent-foreground w-20 shrink-0 truncate">
                      {s.developer ?? "—"}
                    </span>
                    {s.skillName && (
                      <span className="text-[11px] px-1.5 py-0 rounded-sm bg-primary/10 text-primary font-semibold shrink-0">
                        {s.skillName}
                      </span>
                    )}
                    <span
                      className="text-muted-foreground font-mono truncate"
                      data-mono
                    >
                      {s.sprint && s.taskNum != null
                        ? `${s.sprint} #${s.taskNum}`
                        : s.sessionId.slice(0, 8)}
                    </span>
                    <span
                      className="font-mono font-bold ml-auto shrink-0"
                      style={{ color: "#238551" }}
                      data-mono
                    >
                      {s.subagents.length} subagents
                    </span>
                    <span
                      className="font-mono text-muted-foreground shrink-0 w-16 text-right"
                      data-mono
                    >
                      {formatTokens(tokens + subTokens)}
                    </span>
                    <span
                      className="font-mono text-muted-foreground shrink-0"
                      data-mono
                    >
                      {formatDuration(s.durationMinutes)}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </Card>

      {/* Session Explorer */}
      <Card className="p-3 bg-card border-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Session Explorer
          </h3>
          <select
            className="text-[11px] bg-background border border-border rounded-sm px-1.5 py-0.5 text-foreground"
            value={devFilter}
            onChange={(e) => setDevFilter(e.target.value)}
          >
            <option value="all">All developers</option>
            {allDevNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="max-h-[500px] overflow-y-auto space-y-0">
          {sortedSessions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No sessions</p>
          ) : (
            sortedSessions.slice(0, 50).map((s) => {
              const isExpanded = expandedSessions.has(s.sessionId);
              const tokens =
                (s.totalInputTokens ?? 0) + (s.totalOutputTokens ?? 0);
              const subCount = s.subagents?.length ?? 0;

              return (
                <div
                  key={s.sessionId}
                  className="border-b border-border/30 last:border-0"
                >
                  {/* Row header */}
                  <button
                    className="flex items-center gap-2 w-full py-1.5 px-1 text-left hover:bg-secondary/30 transition-colors"
                    onClick={() => toggleSession(s.sessionId)}
                  >
                    {isExpanded ? (
                      <ChevronDown
                        size={12}
                        className="text-muted-foreground shrink-0"
                      />
                    ) : (
                      <ChevronRight
                        size={12}
                        className="text-muted-foreground shrink-0"
                      />
                    )}
                    <span className="text-xs text-accent-foreground w-20 shrink-0 truncate">
                      {s.developer ?? "—"}
                    </span>
                    {s.skillName && (
                      <span className="text-[11px] px-1.5 py-0 rounded-sm bg-primary/10 text-primary font-semibold shrink-0">
                        {s.skillName}
                      </span>
                    )}
                    <span
                      className="text-xs text-muted-foreground font-mono truncate"
                      data-mono
                    >
                      {s.sprint && s.taskNum != null
                        ? `${s.sprint} #${s.taskNum}${s.taskTitle ? ` — ${s.taskTitle}` : ""}`
                        : s.sessionId.slice(0, 12)}
                    </span>
                    <span
                      className="text-[11px] text-muted-foreground font-mono ml-auto shrink-0 flex gap-2"
                      data-mono
                    >
                      <span>{formatDuration(s.durationMinutes)}</span>
                      <span>{formatTokens(tokens)}</span>
                      {subCount > 0 && (
                        <span className="text-[#238551] font-bold">
                          +{subCount}
                        </span>
                      )}
                      <span className="w-14 text-right">
                        {timeAgo(s.endedAt ?? s.startedAt)}
                      </span>
                    </span>
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="pl-8 pb-2 space-y-2 text-[11px]">
                      {/* Row 1: Session metadata */}
                      <div className="grid grid-cols-3 gap-4 text-muted-foreground">
                        <div>
                          <span className="text-[10px] uppercase tracking-wider block">
                            Session
                          </span>
                          <span
                            className="font-mono text-accent-foreground"
                            data-mono
                          >
                            {s.sessionId}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wider block">
                            Model
                          </span>
                          <span
                            className="font-mono text-accent-foreground"
                            data-mono
                          >
                            {shortModel(s.model)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wider block">
                            Timing
                          </span>
                          <span
                            className="font-mono text-accent-foreground"
                            data-mono
                          >
                            {formatDateTime(s.startedAt)} →{" "}
                            {formatDateTime(s.endedAt)}
                          </span>
                        </div>
                      </div>

                      {/* Row 2: Metrics */}
                      <div className="grid grid-cols-4 gap-4 text-muted-foreground">
                        <div>
                          <span className="text-[10px] uppercase tracking-wider block">
                            Input
                          </span>
                          <span
                            className="font-mono text-accent-foreground"
                            data-mono
                          >
                            {formatTokens(s.totalInputTokens)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wider block">
                            Output
                          </span>
                          <span
                            className="font-mono text-accent-foreground"
                            data-mono
                          >
                            {formatTokens(s.totalOutputTokens)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wider block">
                            Tool Calls
                          </span>
                          <span
                            className="font-mono text-accent-foreground"
                            data-mono
                          >
                            {s.toolCallCount ?? 0}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wider block">
                            Messages
                          </span>
                          <span
                            className="font-mono text-accent-foreground"
                            data-mono
                          >
                            {s.messageCount ?? 0}
                          </span>
                        </div>
                      </div>

                      {/* Subagents */}
                      {subCount > 0 && (
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-0.5">
                            Subagents ({subCount})
                          </span>
                          <div className="space-y-0.5">
                            {s.subagents.map((sub) => {
                              const subTokens =
                                (sub.totalInputTokens ?? 0) +
                                (sub.totalOutputTokens ?? 0);
                              return (
                                <div
                                  key={sub.sessionId}
                                  className="flex items-center gap-2 text-muted-foreground pl-2 border-l-2 border-border/50"
                                >
                                  <span
                                    className="font-mono text-accent-foreground"
                                    data-mono
                                  >
                                    {sub.sessionId.slice(0, 8)}
                                  </span>
                                  <span className="font-mono" data-mono>
                                    {shortModel(sub.model)}
                                  </span>
                                  <span className="font-mono" data-mono>
                                    {formatTokens(subTokens)} tok
                                  </span>
                                  <span className="font-mono" data-mono>
                                    {sub.toolCallCount ?? 0} calls
                                  </span>
                                  <span className="font-mono" data-mono>
                                    {formatDuration(sub.durationMinutes)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
