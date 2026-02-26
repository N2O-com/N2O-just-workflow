"use client";

import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

interface BlowUpFactor {
  sprint: string;
  taskNum: number;
  title: string;
  type: string;
  blowUpRatio: number;
  reversions: number;
}

interface BlockedTask {
  sprint: string;
  taskNum: number;
  title: string;
  blockedReason: string;
}

interface AuditFinding {
  owner: string;
  fakeTestIncidents: number;
  patternViolations: number;
  belowAGrade: number;
  totalTasks: number;
}

export function FrictionPanel({
  blowUpFactors,
  blockedTasks,
  auditFindings,
}: {
  blowUpFactors: BlowUpFactor[];
  blockedTasks: BlockedTask[];
  auditFindings: AuditFinding[];
}) {
  const totalFakeTests = auditFindings.reduce(
    (sum, f) => sum + f.fakeTestIncidents,
    0
  );
  const totalBelowA = auditFindings.reduce(
    (sum, f) => sum + f.belowAGrade,
    0
  );

  return (
    <Card className="p-3 bg-card border-border">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        Friction Points
      </h3>
      <div className="space-y-3">
        {/* Blow-up tasks */}
        {blowUpFactors.slice(0, 3).map((b) => (
          <div
            key={`${b.sprint}-${b.taskNum}`}
            className="border-l-2 border-[#CD4246] pl-2"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono text-accent-foreground" data-mono>
                #{b.taskNum}
              </span>
              <span className="text-xs text-foreground truncate">
                {b.title}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-[#CD4246] font-mono" data-mono>
                {b.blowUpRatio}x blow-up
              </span>
              {b.reversions > 0 && (
                <span className="text-[11px] text-muted-foreground font-mono" data-mono>
                  {b.reversions} reversions
                </span>
              )}
            </div>
          </div>
        ))}

        {/* Blocked tasks */}
        {blockedTasks.slice(0, 3).map((t) => (
          <div
            key={`${t.sprint}-${t.taskNum}`}
            className="border-l-2 border-[#EC9A3C] pl-2"
          >
            <div className="flex items-center gap-1.5">
              <StatusBadge status="blocked" />
              <span className="text-xs font-mono text-accent-foreground" data-mono>
                #{t.taskNum}
              </span>
              <span className="text-xs text-foreground truncate">
                {t.title}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {t.blockedReason}
            </p>
          </div>
        ))}

        {/* Common audit findings */}
        {(totalFakeTests > 0 || totalBelowA > 0) && (
          <div className="border-t border-border pt-2 mt-2">
            <h4 className="text-[11px] font-semibold uppercase text-muted-foreground mb-1">
              Common Findings
            </h4>
            <div className="flex gap-4">
              {totalFakeTests > 0 && (
                <span className="text-[11px] text-[#EC9A3C]">
                  fake_tests: {totalFakeTests}
                </span>
              )}
              {totalBelowA > 0 && (
                <span className="text-[11px] text-[#EC9A3C]">
                  below_a_grade: {totalBelowA}
                </span>
              )}
            </div>
          </div>
        )}

        {blowUpFactors.length === 0 &&
          blockedTasks.length === 0 &&
          totalFakeTests === 0 &&
          totalBelowA === 0 && (
            <p className="text-xs text-muted-foreground">
              No friction points detected
            </p>
          )}
      </div>
    </Card>
  );
}
