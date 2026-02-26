"use client";

import { Card } from "@/components/ui/card";

interface PhaseItem {
  phase: string;
  seconds: number;
  pctOfTotal: number;
}

const phaseColors: Record<string, string> = {
  RED: "#CD4246",
  GREEN: "#238551",
  REFACTOR: "#2D72D2",
  AUDIT: "#EC9A3C",
};

export function PhaseDistribution({
  data,
}: {
  data: Array<{
    sprint: string;
    taskNum: number;
    phase: string;
    seconds: number;
    pctOfTotal: number;
  }>;
}) {
  // Aggregate across all tasks
  const phaseMap = new Map<string, { seconds: number; count: number }>();
  for (const item of data) {
    const existing = phaseMap.get(item.phase) ?? { seconds: 0, count: 0 };
    existing.seconds += item.seconds;
    existing.count += 1;
    phaseMap.set(item.phase, existing);
  }

  const totalSeconds = Array.from(phaseMap.values()).reduce(
    (sum, p) => sum + p.seconds,
    0
  );

  const phases = Array.from(phaseMap.entries())
    .map(([phase, { seconds }]) => ({
      phase,
      seconds,
      pct: totalSeconds > 0 ? Math.round((seconds / totalSeconds) * 100) : 0,
    }))
    .sort((a, b) => b.seconds - a.seconds);

  return (
    <Card className="p-3 bg-card border-border">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Phase Distribution
      </h3>
      {phases.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data</p>
      ) : (
        <div className="space-y-1.5">
          {phases.map((p) => (
            <div key={p.phase} className="flex items-center gap-2">
              <span
                className="text-xs w-16 font-mono uppercase"
                style={{ color: phaseColors[p.phase] ?? "#738694" }}
                data-mono
              >
                {p.phase}
              </span>
              <div className="flex-1 h-4 bg-background rounded-sm overflow-hidden">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${p.pct}%`,
                    backgroundColor: phaseColors[p.phase] ?? "#738694",
                    opacity: 0.6,
                  }}
                />
              </div>
              <span
                className="text-xs text-muted-foreground w-8 text-right font-mono"
                data-mono
              >
                {p.pct}%
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
