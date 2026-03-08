import { describe, it, expect } from "vitest";
import {
  getPS,
  getTicks,
  buildDaily,
  flattenProjects,
  fmtDate,
  fmtShort,
  moLabel,
  GRANS,
  ROW_H,
  ROW_GAP,
  TIER_META,
  T_START,
  T_END,
  T_MS,
  SUPPLY,
  LEAD_CEIL,
} from "../capacity-utils";
import type { Project } from "../capacity-data";
import { DATA } from "../capacity-data";

// ─── DATA MODULE ───

describe("capacity-data", () => {
  it("exports DATA with correct config values", () => {
    expect(DATA.config.student_count).toBe(5);
    expect(DATA.config.professional_count).toBe(1);
    expect(DATA.config.lead_ceiling_per_professional).toBe(8);
    expect(DATA.config.timeline_start).toBe("2026-02-15");
    expect(DATA.config.timeline_end).toBe("2027-01-01");
    expect(DATA.companies.length).toBe(12);
  });

  it("each company has id, name, and non-empty projects array", () => {
    for (const co of DATA.companies) {
      expect(typeof co.id).toBe("string");
      expect(typeof co.name).toBe("string");
      expect(Array.isArray(co.projects)).toBe(true);
      expect(co.projects.length).toBeGreaterThan(0);
    }
  });

  it("each project has required fields with correct types and valid tiers", () => {
    for (const co of DATA.companies) {
      for (const p of co.projects) {
        expect(typeof p.id).toBe("string");
        expect(typeof p.name).toBe("string");
        expect(typeof p.seats).toBe("number");
        expect(p.seats).toBeGreaterThan(0);
        expect(typeof p.start).toBe("string");
        expect(typeof p.end).toBe("string");
        expect(typeof p.prob).toBe("number");
        expect(p.prob).toBeGreaterThanOrEqual(0);
        expect(p.prob).toBeLessThanOrEqual(100);
        expect(["active", "pipeline", "speculative", "internal"]).toContain(
          p.tier
        );
        expect(typeof p.notes).toBe("string");
      }
    }
  });

  it("total projects across all companies equals 15", () => {
    const total = DATA.companies.reduce(
      (sum, co) => sum + co.projects.length,
      0
    );
    expect(total).toBe(15);
  });
});

// ─── PROBABILITY COLOR HELPERS ───

describe("getPS", () => {
  it("returns exact green colors for 100% probability", () => {
    const ps = getPS(100);
    expect(ps.bar).toBe("#00E676");
    expect(ps.bg).toBe("rgba(0,230,118,0.18)");
  });

  it("returns exact colors for each probability tier", () => {
    expect(getPS(100).bar).toBe("#00E676");
    expect(getPS(90).bar).toBe("#69F0AE");
    expect(getPS(80).bar).toBe("#FFD740");
    expect(getPS(70).bar).toBe("#FF9100");
    expect(getPS(40).bar).toBe("#FF5252");
    expect(getPS(20).bar).toBe("#EF5350");
    expect(getPS(10).bar).toBe("#CE93D8");
  });

  it("returns distinct styles for all 7 probability tiers", () => {
    const bars = [100, 90, 80, 70, 40, 20, 10].map((p) => getPS(p).bar);
    const unique = new Set(bars);
    expect(unique.size).toBe(7);
  });

  it("maps in-between values to correct tier (95 → 90 tier)", () => {
    expect(getPS(95).bar).toBe("#69F0AE");
    expect(getPS(95).bg).toBe("rgba(105,240,174,0.15)");
  });

  it("maps 75 → 70 tier (orange)", () => {
    expect(getPS(75).bar).toBe("#FF9100");
  });

  it("maps 50 → 40 tier (red)", () => {
    expect(getPS(50).bar).toBe("#FF5252");
  });

  it("maps very low values (5) to purple tier", () => {
    expect(getPS(5).bar).toBe("#CE93D8");
    expect(getPS(5).bg).toBe("rgba(206,147,216,0.12)");
  });

  it("maps 0% to purple tier", () => {
    expect(getPS(0).bar).toBe("#CE93D8");
  });
});

// ─── TIER METADATA ───

describe("TIER_META", () => {
  it("defines all four tiers with correct labels and ordering", () => {
    expect(TIER_META.active).toEqual({
      label: "Active",
      color: "#00E676",
      order: 0,
    });
    expect(TIER_META.pipeline).toEqual({
      label: "Pipeline",
      color: "#2D72D2",
      order: 1,
    });
    expect(TIER_META.speculative).toEqual({
      label: "Speculative",
      color: "#FF5252",
      order: 2,
    });
    expect(TIER_META.internal).toEqual({
      label: "Internal",
      color: "#8899AA",
      order: 3,
    });
  });
});

// ─── CONSTANTS ───

describe("constants", () => {
  it("GRANS has 3 granularities with correct keys and labels", () => {
    expect(GRANS).toEqual([
      { key: "month", label: "Monthly", ppd: 2.2 },
      { key: "week", label: "Weekly", ppd: 6 },
      { key: "day", label: "Daily", ppd: 14 },
    ]);
  });

  it("ppd increases from monthly to daily", () => {
    expect(GRANS[0].ppd).toBeLessThan(GRANS[1].ppd);
    expect(GRANS[1].ppd).toBeLessThan(GRANS[2].ppd);
  });

  it("ROW_H is 28 and ROW_GAP is 2", () => {
    expect(ROW_H).toBe(28);
    expect(ROW_GAP).toBe(2);
  });

  it("SUPPLY equals student_count from config (5)", () => {
    expect(SUPPLY).toBe(5);
  });

  it("LEAD_CEIL equals professional_count * lead_ceiling (8)", () => {
    expect(LEAD_CEIL).toBe(8);
  });

  it("T_START is Feb 15, 2026 and T_END is Jan 1, 2027 (UTC)", () => {
    expect(T_START).toBeInstanceOf(Date);
    expect(T_END).toBeInstanceOf(Date);
    expect(T_START.getUTCFullYear()).toBe(2026);
    expect(T_START.getUTCMonth()).toBe(1); // February
    expect(T_START.getUTCDate()).toBe(15);
    expect(T_END.getUTCFullYear()).toBe(2027);
    expect(T_END.getUTCMonth()).toBe(0); // January
    expect(T_END.getUTCDate()).toBe(1);
  });

  it("T_MS is the positive difference in milliseconds between T_END and T_START", () => {
    expect(T_MS).toBe(T_END.getTime() - T_START.getTime());
    expect(T_MS).toBeGreaterThan(0);
    // ~320 days in ms
    const expectedDays = Math.round(T_MS / 864e5);
    expect(expectedDays).toBeGreaterThanOrEqual(319);
    expect(expectedDays).toBeLessThanOrEqual(321);
  });
});

// ─── DATE FORMATTERS ───

describe("fmtDate", () => {
  it("formats date as 'Mon DD, YYYY'", () => {
    const d = new Date(2026, 5, 15); // June 15, 2026
    expect(fmtDate(d)).toBe("Jun 15, 2026");
  });

  it("formats another date correctly", () => {
    const d = new Date(2026, 0, 1); // January 1, 2026
    expect(fmtDate(d)).toBe("Jan 1, 2026");
  });
});

describe("fmtShort", () => {
  it("formats date as 'Mon DD' without year", () => {
    const d = new Date(2026, 5, 15); // June 15, 2026
    expect(fmtShort(d)).toBe("Jun 15");
  });

  it("formats another date correctly", () => {
    const d = new Date(2026, 11, 25); // December 25, 2026
    expect(fmtShort(d)).toBe("Dec 25");
  });
});

describe("moLabel", () => {
  it("returns abbreviated month name", () => {
    expect(moLabel(new Date(2026, 0, 15))).toBe("Jan");
    expect(moLabel(new Date(2026, 5, 15))).toBe("Jun");
    expect(moLabel(new Date(2026, 11, 15))).toBe("Dec");
  });
});

// ─── TICK GENERATION ───

describe("getTicks", () => {
  const tw = 1000;

  it("generates exactly 11 monthly ticks (Feb-Dec 2026)", () => {
    const ticks = getTicks("month", tw);
    const monthTicks = ticks.filter((t) => t.isMonth);
    expect(monthTicks.length).toBe(11);
    expect(monthTicks.map((t) => t.label)).toEqual([
      "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]);
  });

  it("weekly granularity adds extra ticks beyond monthly", () => {
    const monthOnly = getTicks("month", tw);
    const weekly = getTicks("week", tw);
    expect(weekly.length).toBeGreaterThan(monthOnly.length);
  });

  it("daily granularity adds extra ticks beyond monthly", () => {
    const monthOnly = getTicks("month", tw);
    const daily = getTicks("day", tw);
    expect(daily.length).toBeGreaterThan(monthOnly.length);
  });

  it("all ticks have required properties with correct types", () => {
    const ticks = getTicks("week", tw);
    for (const t of ticks) {
      expect(typeof t.px).toBe("number");
      expect(t.px).toBeGreaterThanOrEqual(0);
      expect(typeof t.width).toBe("number");
      expect(typeof t.label).toBe("string");
      expect(typeof t.major).toBe("boolean");
      expect(typeof t.isMonth).toBe("boolean");
    }
  });

  it("month ticks are marked as major", () => {
    const ticks = getTicks("month", tw);
    for (const t of ticks.filter((t) => t.isMonth)) {
      expect(t.major).toBe(true);
    }
  });

  it("month tick px values increase monotonically", () => {
    const monthTicks = getTicks("month", tw).filter((t) => t.isMonth);
    for (let i = 1; i < monthTicks.length; i++) {
      expect(monthTicks[i].px).toBeGreaterThan(monthTicks[i - 1].px);
    }
  });
});

// ─── DAILY DEMAND BUILDER ───

describe("buildDaily", () => {
  it("returns daily points covering T_START to T_END", () => {
    const projects: Project[] = [
      { id: "t", name: "T", seats: 2, start: "2026-03-01", end: "2026-06-01", prob: 100, tier: "active", notes: "" },
    ];
    const daily = buildDaily(projects);
    // Feb 15, 2026 → Jan 1, 2027 inclusive = 321 daily points
    expect(daily.length).toBe(321);
    expect(daily[0].date.getTime()).toBe(T_START.getTime());
  });

  it("correctly sums seats for overlapping projects", () => {
    const projects: Project[] = [
      { id: "a", name: "A", seats: 2, start: "2026-04-01", end: "2026-06-01", prob: 100, tier: "active", notes: "" },
      { id: "b", name: "B", seats: 3, start: "2026-04-01", end: "2026-06-01", prob: 80, tier: "pipeline", notes: "" },
    ];
    const daily = buildDaily(projects);
    const apr15 = daily.find(
      (d) => d.date.getMonth() === 3 && d.date.getDate() === 15
    );
    expect(apr15!.raw).toBe(5);
    expect(apr15!.cnt).toBe(2);
  });

  it("shows zero demand outside project date ranges", () => {
    const projects: Project[] = [
      { id: "late", name: "Late", seats: 3, start: "2026-06-01", end: "2026-08-01", prob: 100, tier: "active", notes: "" },
    ];
    const daily = buildDaily(projects);
    const feb20 = daily.find(
      (d) => d.date.getMonth() === 1 && d.date.getDate() === 20
    );
    expect(feb20!.raw).toBe(0);
    expect(feb20!.cnt).toBe(0);
  });

  it("each point has date, ms, frac, raw, cnt with correct types", () => {
    const projects: Project[] = [
      { id: "x", name: "X", seats: 1, start: "2026-03-01", end: "2026-04-01", prob: 100, tier: "active", notes: "" },
    ];
    const daily = buildDaily(projects);
    const pt = daily[0];
    expect(pt.date).toBeInstanceOf(Date);
    expect(pt.ms).toBe(T_START.getTime());
    expect(pt.frac).toBe(0);
    expect(typeof pt.raw).toBe("number");
    expect(typeof pt.cnt).toBe("number");
  });

  it("frac is 0 at start and ~1 at end", () => {
    const daily = buildDaily([]);
    expect(daily[0].frac).toBe(0);
    expect(daily[daily.length - 1].frac).toBeCloseTo(1, 1);
  });

  it("handles empty projects array (all zeros)", () => {
    const daily = buildDaily([]);
    expect(daily.length).toBeGreaterThan(0);
    expect(daily.every((d) => d.raw === 0)).toBe(true);
    expect(daily.every((d) => d.cnt === 0)).toBe(true);
  });

  it("handles project with same start and end date", () => {
    const projects: Project[] = [
      { id: "same", name: "Same", seats: 2, start: "2026-03-15", end: "2026-03-15", prob: 100, tier: "active", notes: "" },
    ];
    const daily = buildDaily(projects);
    // Find the point matching the project date (compare by ms timestamp)
    const targetMs = new Date("2026-03-15").getTime();
    const mar15 = daily.find((d) => d.ms === targetMs);
    expect(mar15!.raw).toBe(2);
    expect(mar15!.cnt).toBe(1);
  });

  it("with real DATA projects, peak demand is 24 seats", () => {
    const allProjects: Project[] = DATA.companies.flatMap((co) =>
      co.projects.map((p) => ({ ...p }))
    );
    const daily = buildDaily(allProjects);
    const peak = Math.max(...daily.map((d) => d.raw));
    // Peak occurs Jul-Aug when maximum projects overlap
    expect(peak).toBe(24);
  });
});

// ─── FLATTEN PROJECTS ───

describe("flattenProjects", () => {
  it("flattens company/project hierarchy adding client and companyId", () => {
    const companies = [
      {
        id: "co1",
        name: "Company One",
        projects: [
          { id: "p1", name: "Project 1", seats: 2, start: "2026-03-01", end: "2026-04-01", prob: 100, tier: "active" as const, notes: "test" },
        ],
      },
    ];
    const result = flattenProjects(companies);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("p1");
    expect(result[0].name).toBe("Project 1");
    expect(result[0].client).toBe("Company One");
    expect(result[0].companyId).toBe("co1");
    expect(result[0].seats).toBe(2);
  });

  it("handles multiple companies with multiple projects", () => {
    const companies = [
      {
        id: "co1",
        name: "Co1",
        projects: [
          { id: "p1", name: "P1", seats: 1, start: "2026-03-01", end: "2026-04-01", prob: 100, tier: "active" as const, notes: "" },
          { id: "p2", name: "P2", seats: 2, start: "2026-03-01", end: "2026-04-01", prob: 80, tier: "pipeline" as const, notes: "" },
        ],
      },
      {
        id: "co2",
        name: "Co2",
        projects: [
          { id: "p3", name: "P3", seats: 3, start: "2026-03-01", end: "2026-04-01", prob: 50, tier: "speculative" as const, notes: "" },
        ],
      },
    ];
    const result = flattenProjects(companies);
    expect(result).toHaveLength(3);
    expect(result[0].companyId).toBe("co1");
    expect(result[1].companyId).toBe("co1");
    expect(result[2].companyId).toBe("co2");
    expect(result[2].client).toBe("Co2");
  });

  it("returns empty array for empty input", () => {
    expect(flattenProjects([])).toEqual([]);
  });

  it("flattens all real DATA companies correctly", () => {
    const result = flattenProjects(DATA.companies);
    expect(result).toHaveLength(15);
    // Check first and last
    expect(result[0].companyId).toBe("totalcents");
    expect(result[result.length - 1].companyId).toBe("n2o-internal");
  });
});
