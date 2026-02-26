"use client";

import { Card } from "@/components/ui/card";

interface SkillUsageItem {
  toolName: string;
  invocations: number;
  sessions: number;
}

export function SkillUsageChart({ data }: { data: SkillUsageItem[] }) {
  const maxInvocations = Math.max(...data.map((d) => d.invocations), 1);

  return (
    <Card className="p-3 bg-card border-border">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Skill Usage
      </h3>
      {data.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data</p>
      ) : (
        <div className="space-y-1.5">
          {data.slice(0, 8).map((item) => (
            <div key={item.toolName} className="flex items-center gap-2">
              <span
                className="text-xs text-accent-foreground w-24 truncate font-mono"
                data-mono
              >
                {item.toolName}
              </span>
              <div className="flex-1 h-4 bg-background rounded-sm overflow-hidden">
                <div
                  className="h-full bg-primary/60 rounded-sm"
                  style={{
                    width: `${(item.invocations / maxInvocations) * 100}%`,
                  }}
                />
              </div>
              <span
                className="text-xs text-muted-foreground w-8 text-right font-mono"
                data-mono
              >
                {item.invocations}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
