"use client";

import { useState, useEffect } from "react";
import { PulsingDot } from "./pulsing-dot";

function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = Math.floor(Date.now() / 1000) + seconds;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}

export function LiveCard({
  member,
  timeEntry,
  color,
}: {
  member: { name: string };
  timeEntry?: { duration: number; start: string; description?: string; stop?: string | null };
  color: string;
}) {
  const isRunning = timeEntry && timeEntry.duration < 0;
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!isRunning || !timeEntry?.start) return;
    const update = () => {
      const secs = Math.floor((Date.now() - new Date(timeEntry.start).getTime()) / 1000);
      setElapsed(formatDuration(secs));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [isRunning, timeEntry?.start]);

  return (
    <div
      className="flex items-center gap-3 rounded-md px-3 py-2 border-l-[3px]"
      style={{
        borderLeftColor: isRunning ? "#4caf50" : "#2a2f3a",
        backgroundColor: "#1e2330",
      }}
    >
      <div
        className="flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold shrink-0"
        style={{
          backgroundColor: color + "20",
          border: `1px solid ${color}40`,
          color,
        }}
      >
        {member.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-medium truncate" style={{ color: "#e0e0e0" }}>
          {member.name}
        </span>
        {isRunning ? (
          <div className="flex items-center gap-1.5">
            <PulsingDot color="#4caf50" />
            <span className="text-[10px] font-mono" style={{ color: "#4caf50" }}>
              {elapsed}
            </span>
            {timeEntry?.description && (
              <span className="text-[10px] truncate" style={{ color: "#5a5f6a" }}>
                — {timeEntry.description}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[10px]" style={{ color: "#5a5f6a" }}>
            Not tracking
          </span>
        )}
      </div>
    </div>
  );
}
