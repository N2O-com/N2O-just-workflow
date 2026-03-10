"use client";

export function PulsingDot({ color }: { color: string }) {
  return (
    <span className="relative inline-block w-2 h-2">
      <span
        className="absolute inset-0 rounded-full animate-pulse"
        style={{ backgroundColor: color, opacity: 0.4 }}
      />
      <span
        className="absolute inset-[1px] rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}
