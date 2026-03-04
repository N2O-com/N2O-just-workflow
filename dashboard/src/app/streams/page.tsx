"use client";

import { useMemo } from "react";
import { useQuery } from "@apollo/client/react";
import { STREAMS_QUERY } from "@/lib/graphql/queries";
import { useRealtimeTable } from "@/hooks/use-realtime";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import type { Session } from "./types";
import {
  formatTokens,
  shortModel,
  computeTimeline,
  peakConcurrency,
  computeTicks,
} from "./helpers";
import { SessionBar } from "./session-bar";

export default function StreamsPage() {
  const { data, loading, error, refetch } = useQuery<any>(STREAMS_QUERY);
  useRealtimeTable("agents", refetch);

  const sessions: Session[] = useMemo(() => data?.sessionTimeline ?? [], [data]);

  const timeline = useMemo(() => computeTimeline(sessions), [sessions]);
  const ticks = useMemo(
    () => computeTicks(timeline.rangeStart, timeline.rangeEnd),
    [timeline.rangeStart, timeline.rangeEnd]
  );

  const activeSessions = sessions.filter((s) => s.endedAt === null).length;
  const totalSessions = sessions.length;
  const globalPeak = peakConcurrency(sessions);
  const totalTokens = sessions.reduce(
    (sum, s) => sum + (s.totalInputTokens ?? 0) + (s.totalOutputTokens ?? 0),
    0
  );
  const subagentCount = sessions.reduce(
    (sum, s) => sum + (s.subagents?.length ?? 0),
    0
  );

  const uniqueModels = useMemo(() => {
    const models = new Set<string>();
    for (const s of sessions) {
      const m = shortModel(s.model);
      if (m) models.add(m);
    }
    return models;
  }, [sessions]);
  const showModelBadges = uniqueModels.size > 1;

  const latestSessionTime = useMemo(() => {
    let latest = 0;
    for (const s of sessions) {
      const t = new Date(s.startedAt).getTime();
      if (t > latest) latest = t;
      if (s.endedAt) {
        const e = new Date(s.endedAt).getTime();
        if (e > latest) latest = e;
      }
    }
    return latest;
  }, [sessions]);
  const isStale = sessions.length > 0 && Date.now() - latestSessionTime > 24 * 60 * 60 * 1000;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-destructive">
        {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="streams-timeline">
      <h1 className="text-lg font-semibold">Streams</h1>

      {isStale && (
        <div className="rounded-md border border-[#EC9A3C]/40 bg-[#EC9A3C]/10 px-3 py-2 text-xs text-[#EC9A3C]">
          Data may be stale — latest session is over 24 hours old.
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        <KpiCard
          label="Parent Sessions"
          value={totalSessions}
          delta={subagentCount > 0 ? `+${subagentCount} subagents` : undefined}
          deltaType="neutral"
        />
        <KpiCard
          label="Active Now"
          value={activeSessions}
          deltaType={activeSessions > 0 ? "positive" : "neutral"}
        />
        <KpiCard label="Peak Concurrency" value={globalPeak} />
        <KpiCard label="Total Tokens" value={formatTokens(totalTokens)} />
      </div>

      <Card className="p-3 bg-card border-border overflow-hidden">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Session Timeline
        </h3>

        {sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No session data</p>
        ) : (
          <div className="overflow-x-auto">
            {/* Time axis (top) */}
            <div className="flex">
              <div className="w-[120px] shrink-0" />
              <div className="flex-1 relative h-5 border-b border-border/30">
                {ticks.map((tick, i) => (
                  <span
                    key={i}
                    className="absolute text-[10px] text-muted-foreground font-mono whitespace-nowrap"
                    style={{
                      left: `${tick.pct}%`,
                      transform: i === ticks.length - 1 ? "translateX(-100%)" : i > 0 ? "translateX(-50%)" : undefined,
                      top: 0,
                    }}
                    data-mono
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Developer rows */}
            {timeline.rows.map((row) => (
              <div key={row.name} className="flex items-stretch border-b border-border/20 last:border-0">
                <div className="w-[120px] shrink-0 flex items-center pr-2">
                  <span className="text-xs font-semibold text-accent-foreground truncate">
                    {row.name === "unassigned" && timeline.rows.length === 1
                      ? "All Sessions"
                      : row.name}
                  </span>
                  {(() => {
                    const active = row.sessions.filter((s) => s.endedAt === null).length;
                    return active > 0 ? (
                      <span className="text-[10px] text-[#238551] ml-1 shrink-0">
                        ({active} active)
                      </span>
                    ) : null;
                  })()}
                </div>

                <div className="flex-1 relative" style={{ height: `${row.laneCount * 28 + 8}px` }}>
                  {ticks.map((tick, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 border-l border-border/10"
                      style={{ left: `${tick.pct}%` }}
                    />
                  ))}

                  {row.sessions.map((s) => (
                    <SessionBar
                      key={s.sessionId}
                      session={s}
                      rangeStart={timeline.rangeStart}
                      totalRange={timeline.totalRange}
                      now={timeline.now}
                      showModelBadges={showModelBadges}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* Time axis (bottom) */}
            <div className="flex">
              <div className="w-[120px] shrink-0" />
              <div className="flex-1 relative h-5 border-t border-border/30">
                {ticks.map((tick, i) => (
                  <span
                    key={i}
                    className="absolute text-[10px] text-muted-foreground font-mono whitespace-nowrap"
                    style={{
                      left: `${tick.pct}%`,
                      transform: i === ticks.length - 1 ? "translateX(-100%)" : i > 0 ? "translateX(-50%)" : undefined,
                      bottom: 0,
                    }}
                    data-mono
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      <style dangerouslySetInnerHTML={{ __html: `
        .streams-pulse {
          animation: streamsPulse 2s ease-in-out infinite;
        }
        @keyframes streamsPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}} />
    </div>
  );
}
