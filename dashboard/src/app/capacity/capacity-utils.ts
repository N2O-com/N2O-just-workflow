// Capacity planner utility functions
// Extracted from platform/reference/n2o-capacity-planner.jsx

import type { Project, DailyPoint, Tick, ProbStyle, TierMeta } from "./capacity-data";
import { DATA } from "./capacity-data";

// ─── Colors (Palantir theme adapted) ───

const C = {
  green: "#00E676",
  greenDim: "rgba(0,230,118,0.18)",
  yellow: "#FFD740",
  yellowDim: "rgba(255,215,64,0.15)",
  orange: "#FF9100",
  orangeDim: "rgba(255,145,0,0.15)",
  red: "#FF5252",
  redDim: "rgba(255,82,82,0.12)",
  purple: "#CE93D8",
  purpleDim: "rgba(206,147,216,0.12)",
  accent: "#2D72D2",
  textSecondary: "#8899AA",
  supplyLine: "#00E5FF",
};

// ─── Probability style mapping ───

const PS: Record<number, ProbStyle> = {
  100: { bar: C.green, bg: C.greenDim },
  90: { bar: "#69F0AE", bg: "rgba(105,240,174,0.15)" },
  80: { bar: C.yellow, bg: C.yellowDim },
  70: { bar: C.orange, bg: C.orangeDim },
  40: { bar: C.red, bg: C.redDim },
  20: { bar: "#EF5350", bg: "rgba(239,83,80,0.12)" },
  10: { bar: C.purple, bg: C.purpleDim },
};

const PS_THRESHOLDS = [100, 90, 80, 70, 40, 20, 10] as const;

export function getPS(prob: number): ProbStyle {
  for (const k of PS_THRESHOLDS) {
    if (prob >= k) return PS[k];
  }
  return PS[10];
}

// ─── Tier metadata ───

export const TIER_META: Record<string, TierMeta> = {
  active: { label: "Active", color: C.green, order: 0 },
  pipeline: { label: "Pipeline", color: C.accent, order: 1 },
  speculative: { label: "Speculative", color: C.red, order: 2 },
  internal: { label: "Internal", color: C.textSecondary, order: 3 },
};

// ─── Granularity options ───

export const GRANS: { key: string; label: string; ppd: number }[] = [
  { key: "month", label: "Monthly", ppd: 2.2 },
  { key: "week", label: "Weekly", ppd: 6 },
  { key: "day", label: "Daily", ppd: 14 },
];

// ─── Layout constants ───

export const ROW_H = 28;
export const ROW_GAP = 2;
export const LABEL_W_DEFAULT = 150;

// ─── Timeline config ───

const cfg = DATA.config;
export const SUPPLY = cfg.student_count;
export const LEAD_CEIL = cfg.professional_count * cfg.lead_ceiling_per_professional;
export const T_START = new Date(cfg.timeline_start);
export const T_END = new Date(cfg.timeline_end);
export const T_MS = T_END.getTime() - T_START.getTime();

// ─── Date formatters ───

export function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function moLabel(d: Date): string {
  return d.toLocaleString("en-US", { month: "short" });
}

// ─── Tick generation ───

export function getTicks(gran: string, tw: number): Tick[] {
  const ticks: Tick[] = [];

  // Monthly ticks
  for (
    let d = new Date("2026-02-01");
    d < T_END;
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  ) {
    const px = Math.max(0, ((d.getTime() - T_START.getTime()) / T_MS) * tw);
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const npx = Math.min(tw, ((next.getTime() - T_START.getTime()) / T_MS) * tw);
    if (npx - px > 2) {
      ticks.push({
        px,
        width: npx - px,
        label: moLabel(d),
        major: true,
        isMonth: true,
      });
    }
  }

  // Weekly ticks
  if (gran === "week") {
    const d = new Date(T_START);
    const dow = d.getDay();
    const startMonday = new Date(
      d.getTime() + (dow === 0 ? 1 : dow <= 1 ? 1 - dow : 8 - dow) * 864e5
    );
    let current = startMonday;
    while (current < T_END) {
      const px = Math.max(
        0,
        ((current.getTime() - T_START.getTime()) / T_MS) * tw
      );
      if (!ticks.some((t) => t.isMonth && Math.abs(t.px - px) < 30)) {
        const ww = tw / ((T_END.getTime() - T_START.getTime()) / (7 * 864e5));
        ticks.push({
          px,
          width: 0,
          label: ww > 45 ? `${current.getDate()}` : "",
          major: false,
          isMonth: false,
        });
      }
      current = new Date(current.getTime() + 7 * 864e5);
    }
  }

  // Daily ticks (Mondays only)
  if (gran === "day") {
    for (let ms = T_START.getTime(); ms < T_END.getTime(); ms += 864e5) {
      const d = new Date(ms);
      if (d.getDay() === 1 && d.getDate() !== 1) {
        const px = ((ms - T_START.getTime()) / T_MS) * tw;
        if (!ticks.some((t) => t.isMonth && Math.abs(t.px - px) < 40)) {
          ticks.push({
            px,
            width: 0,
            label: `${d.getDate()}`,
            major: false,
            isMonth: false,
          });
        }
      }
    }
  }

  return ticks;
}

// ─── Daily demand builder ───

export function buildDaily(projects: Project[]): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const s = T_START.getTime();
  const e = T_END.getTime();

  for (let ms = s; ms <= e; ms += 864e5) {
    let raw = 0;
    let cnt = 0;
    for (const p of projects) {
      if (
        new Date(p.start).getTime() <= ms &&
        new Date(p.end).getTime() >= ms
      ) {
        raw += p.seats;
        cnt++;
      }
    }
    pts.push({
      date: new Date(ms),
      ms,
      frac: (ms - s) / (e - s),
      raw,
      cnt,
    });
  }

  return pts;
}

// ─── Flatten projects helper ───

export function flattenProjects(
  companies: { id: string; name: string; projects: Project[] }[]
): (Project & { client: string; companyId: string })[] {
  const result: (Project & { client: string; companyId: string })[] = [];
  for (const co of companies) {
    for (const p of co.projects) {
      result.push({ ...p, client: co.name, companyId: co.id });
    }
  }
  return result;
}
