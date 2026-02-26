"use client";

import { useQuery } from "@apollo/client/react";
import { OBSERVATORY_QUERY } from "@/lib/graphql/queries";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { SkillUsageChart } from "@/components/dashboard/skill-usage-chart";
import { PhaseDistribution } from "@/components/dashboard/phase-distribution";
import { FrictionPanel } from "@/components/dashboard/friction-panel";
import { SessionsTable } from "@/components/dashboard/sessions-table";

export default function ObservatoryPage() {
  const { data, loading, error } = useQuery<any>(OBSERVATORY_QUERY);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading observatory data...
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

  // Compute KPIs
  const primarySessions = (data?.transcripts ?? []).filter(
    (t: any) => !t.parentSessionId
  );
  const sessionCount = primarySessions.length;

  const completedTasks = (data?.sprints ?? []).reduce(
    (sum: number, s: any) => sum + (s.progress?.green ?? 0),
    0
  );

  const blowUpFactors = data?.blowUpFactors ?? [];
  const avgBlowUp =
    blowUpFactors.length > 0
      ? (
          blowUpFactors.reduce(
            (sum: number, b: any) => sum + (b.blowUpRatio ?? 0),
            0
          ) / blowUpFactors.length
        ).toFixed(1)
      : "—";

  const totalTokens = primarySessions.reduce(
    (sum: number, t: any) =>
      sum + (t.totalInputTokens ?? 0) + (t.totalOutputTokens ?? 0),
    0
  );
  const avgTokensPerSession =
    sessionCount > 0 ? Math.round(totalTokens / sessionCount) : 0;
  const tokensDisplay =
    avgTokensPerSession > 1000
      ? `${(avgTokensPerSession / 1000).toFixed(0)}K`
      : String(avgTokensPerSession);

  const blockedCount = (data?.tasks ?? []).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Observatory</h1>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="Sessions" value={sessionCount} />
        <KpiCard label="Tasks Completed" value={completedTasks} />
        <KpiCard
          label="Avg Blow-up"
          value={`${avgBlowUp}x`}
          delta={blowUpFactors.length > 0 ? `${blowUpFactors.length} tasks >2x` : undefined}
          deltaType={blowUpFactors.length > 0 ? "negative" : "neutral"}
        />
        <KpiCard
          label="Tokens/Session"
          value={tokensDisplay}
          delta={blockedCount > 0 ? `${blockedCount} blocked` : undefined}
          deltaType={blockedCount > 0 ? "negative" : "neutral"}
        />
      </div>

      {/* Split Panel */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-3">
          <SkillUsageChart data={data?.skillUsage ?? []} />
          <PhaseDistribution data={data?.phaseTimingDistribution ?? []} />
        </div>
        <FrictionPanel
          blowUpFactors={blowUpFactors}
          blockedTasks={data?.tasks ?? []}
          auditFindings={data?.commonAuditFindings ?? []}
        />
      </div>

      {/* Recent Sessions */}
      <SessionsTable sessions={primarySessions} />
    </div>
  );
}
