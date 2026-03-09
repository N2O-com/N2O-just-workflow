"use client";

import { useState, useMemo, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import type { DailyPoint, Tick, Company } from "./capacity-data";
import { DATA } from "./capacity-data";
import {
  getPS,
  getTicks,
  GRANS,
  ROW_H,
  ROW_GAP,
  LABEL_W_DEFAULT,
  SUPPLY,
  T_START,
  T_END,
  T_MS,
  TIER_META,
  STAGE_META,
  isAtCross,
  buildRowList,
  rowHeight,
  type FlatProject,
  type LayoutRow,
  type PipelineStage,
  type StagedGroup,
  type GroupDim,
  type DimSortKey,
  type ViewPreset,
} from "./capacity-utils";
import { DemandChart, DemandAxisLabels, type OverlayBand } from "./demand-chart";
import {
  Chk,
  ChevronIcon,
  StageChips,
  ViewsDropdown,
  GroupByDropdown,
  FilterDropdown,
} from "./project-sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// SSR-safe useLayoutEffect
const useBrowserLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Fixed height for the demand section
const DEMAND_H = 250;

// ─── Tick labels row ───

function TickLabels({ ticks, bottom }: { ticks: Tick[]; bottom: boolean }) {
  return (
    <div className="relative h-6">
      {ticks
        .filter((t) => t.label)
        .map((t, i) => (
          <div
            key={`${bottom ? "b" : "t"}-${i}`}
            className="absolute whitespace-nowrap"
            style={{
              left: t.px,
              fontSize: t.isMonth ? 12 : 11,
              fontWeight: t.isMonth ? 700 : 500,
              color: "var(--muted-foreground)",
              borderLeft: t.isMonth
                ? "1px solid var(--border)"
                : "1px solid rgba(74,91,108,0.3)",
              paddingLeft: 5,
              ...(bottom
                ? { top: 0, paddingTop: 4 }
                : { bottom: 0, paddingBottom: 4 }),
            }}
          >
            {t.label}
          </div>
        ))}
    </div>
  );
}

// ─── Types ───

interface GanttTimelineProps {
  // Sidebar state
  companies: Company[];
  filteredCompanies: Company[];
  stagedCompanies: StagedGroup[];
  allProjects: FlatProject[];
  enabled: Record<string, boolean>;
  expanded: Record<string, boolean>;
  hovProj: string | null;
  hovCompany: string | null;
  selectedId: string | null;
  selectedCoId: string | null;
  hoverData: DailyPoint | null;
  viewFilter: string;
  stageOrder: PipelineStage[];
  stageVisible: Record<PipelineStage, boolean>;
  groupOrder: GroupDim[];
  groupEnabled: Record<GroupDim, boolean>;
  groupSort: Record<GroupDim, DimSortKey>;
  onToggleEn: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
  onToggleExpand: (key: string) => void;
  onSelectProject: (pid: string) => void;
  onSelectCompany: (cid: string) => void;
  onSetHovProj: (id: string | null) => void;
  onSetHovCompany: (id: string | null) => void;
  onSetViewFilter: (f: string) => void;
  onSetStageOrder: (order: PipelineStage[]) => void;
  onSetStageVisible: (vis: Record<PipelineStage, boolean>) => void;
  onSetGroupOrder: (order: GroupDim[]) => void;
  onSetGroupEnabled: (enabled: Record<GroupDim, boolean>) => void;
  onSetGroupSort: (sort: Record<GroupDim, DimSortKey>) => void;
  onApplyView: (view: ViewPreset) => void;
  // Gantt state
  active: FlatProject[];
  daily: DailyPoint[];
  gran: string;
  onHoverChange: (data: DailyPoint | null, x: number | null) => void;
}

// ─── Component ───

export function GanttTimeline({
  companies,
  filteredCompanies,
  stagedCompanies,
  allProjects,
  enabled,
  expanded,
  hovProj,
  hovCompany,
  selectedId,
  selectedCoId,
  hoverData,
  viewFilter,
  stageOrder,
  stageVisible,
  groupOrder,
  groupEnabled,
  groupSort,
  onToggleEn,
  onToggleGroup,
  onToggleExpand,
  onSelectProject,
  onSelectCompany,
  onSetHovProj,
  onSetHovCompany,
  onSetViewFilter,
  onSetStageOrder,
  onSetStageVisible,
  onSetGroupOrder,
  onSetGroupEnabled,
  onSetGroupSort,
  onApplyView,
  active,
  daily,
  gran,
  onHoverChange,
}: GanttTimelineProps) {
  const ganttScrollRef = useRef<HTMLDivElement>(null);
  const demandScrollRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const [labelW, setLabelW] = useState(LABEL_W_DEFAULT);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [scrollX, setScrollX] = useState(0);
  const [containerW, setContainerW] = useState(0);
  const [now, setNow] = useState(T_START.getTime());

  // Build unified row list
  const rowList = useMemo(
    () =>
      buildRowList({
        stagedCompanies,
        filteredCompanies,
        allProjects,
        companies,
        groupOrder,
        groupEnabled,
        groupSort,
        viewFilter,
        expanded,
      }),
    [stagedCompanies, filteredCompanies, allProjects, companies, groupOrder, groupEnabled, groupSort, viewFilter, expanded]
  );

  // Measure gantt scroll container
  useBrowserLayoutEffect(() => {
    const el = ganttScrollRef.current;
    if (!el) return;
    setContainerW(el.clientWidth);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    const el = ganttScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track horizontal scroll position
  useEffect(() => {
    const el = ganttScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      setScrollX(el.scrollLeft);
      setContainerW(el.clientWidth);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // ─── Scroll sync: gantt horizontal ↔ demand horizontal ───
  useEffect(() => {
    const gantt = ganttScrollRef.current;
    const demand = demandScrollRef.current;
    if (!gantt || !demand) return;
    let source: "gantt" | "demand" | null = null;
    const syncFromGantt = () => {
      if (source === "demand") return;
      source = "gantt";
      demand.scrollLeft = gantt.scrollLeft;
      requestAnimationFrame(() => { source = null; });
    };
    const syncFromDemand = () => {
      if (source === "gantt") return;
      source = "demand";
      gantt.scrollLeft = demand.scrollLeft;
      requestAnimationFrame(() => { source = null; });
    };
    gantt.addEventListener("scroll", syncFromGantt, { passive: true });
    demand.addEventListener("scroll", syncFromDemand, { passive: true });
    return () => {
      gantt.removeEventListener("scroll", syncFromGantt);
      demand.removeEventListener("scroll", syncFromDemand);
    };
  }, []);

  // Timeline dimensions
  const totalDays = (T_END.getTime() - T_START.getTime()) / 864e5;
  const ppd = GRANS.find((g) => g.key === gran)!.ppd;
  const visibleGanttW = Math.max(0, containerW - labelW);
  const timelineWidth = useMemo(
    () => Math.max(visibleGanttW || 800, totalDays * ppd),
    [visibleGanttW, totalDays, ppd]
  );

  const ticks = useMemo(() => getTicks(gran, timelineWidth), [gran, timelineWidth]);
  const majorTicks = useMemo(() => ticks.filter((t) => t.isMonth), [ticks]);

  // Chart scaling
  const maxD = Math.max(...daily.map((d) => d.raw), SUPPLY + 2);
  const chartMax = Math.ceil(maxD / 5) * 5;

  // Today marker
  const todayPx = ((now - T_START.getTime()) / T_MS) * timelineWidth;

  // Timeline overlay bands
  const overlayBands = useMemo<OverlayBand[]>(() => {
    return (DATA.overlays || []).map((o) => {
      const l = Math.max(0, ((new Date(o.start).getTime() - T_START.getTime()) / T_MS) * timelineWidth);
      const r = Math.min(timelineWidth, ((new Date(o.end).getTime() - T_START.getTime()) / T_MS) * timelineWidth);
      return {
        id: o.id,
        label: o.label,
        leftPx: l,
        widthPx: r - l,
        color: o.color || "rgba(255,255,255,0.05)",
      };
    });
  }, [timelineWidth]);

  // Find nearest daily point
  const findNearest = useCallback(
    (frac: number) => {
      let best = daily[0];
      let bd = Infinity;
      for (const d of daily) {
        const dist = Math.abs(d.frac - frac);
        if (dist < bd) {
          bd = dist;
          best = d;
        }
      }
      return best;
    },
    [daily]
  );

  // Hover handler for gantt area
  // In the unified layout, content x includes the sidebar (0..labelW) + timeline (labelW..)
  // The sidebar is sticky-left, so viewport x < labelW = sidebar area
  const onGanttHover = useCallback(
    (e: React.MouseEvent) => {
      const el = ganttScrollRef.current;
      if (!el) return;
      const containerRect = el.getBoundingClientRect();
      const vx = e.clientX - containerRect.left; // viewport-relative x within container
      if (vx < labelW) {
        // Over the sticky sidebar, ignore for crosshair
        return;
      }
      // Timeline x = (viewport x within gantt area) + scrollLeft
      const timelineX = (vx - labelW) + el.scrollLeft;
      // Content-space x (for crosshair positioning in the content div)
      const contentX = labelW + timelineX;
      setHoverX(contentX);
      const frac = Math.max(0, Math.min(1, timelineX / timelineWidth));
      onHoverChange(findNearest(frac), contentX);
    },
    [labelW, timelineWidth, findNearest, onHoverChange]
  );

  // Hover handler for demand area (no sidebar offset)
  const onDemandHover = useCallback(
    (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      // Demand content x maps directly to timeline x
      setHoverX(labelW + x); // Convert to gantt content-space for consistent display
      const frac = Math.max(0, Math.min(1, x / timelineWidth));
      onHoverChange(findNearest(frac), x);
    },
    [labelW, timelineWidth, findNearest, onHoverChange]
  );

  const clearHover = useCallback(() => {
    setHoverX(null);
    onHoverChange(null, null);
  }, [onHoverChange]);

  // Scroll to today on mount / gran change
  useEffect(() => {
    if (!ganttScrollRef.current || containerW === 0) return;
    const tp = ((Date.now() - T_START.getTime()) / T_MS) * timelineWidth;
    ganttScrollRef.current.scrollLeft = Math.max(0, tp - visibleGanttW * 0.25);
    if (demandScrollRef.current) {
      demandScrollRef.current.scrollLeft = ganttScrollRef.current.scrollLeft;
    }
  }, [gran, timelineWidth, containerW, visibleGanttW]);

  // Label column drag resize
  const startLabelDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      const startX = e.clientX;
      const startW = labelW;
      const onMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = ev.clientX - startX;
        setLabelW(Math.max(180, Math.min(350, startW + delta)));
      };
      const onUp = () => {
        isDraggingRef.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [labelW]
  );

  // Content width = sidebar + timeline
  const contentW = labelW + timelineWidth;

  // ─── Render helpers ───

  function renderSidebarCell(row: LayoutRow) {
    if (row.type === "stage-header") {
      const meta = STAGE_META[row.stage];
      return (
        <div className="flex items-center gap-2 px-2.5 pt-2 pb-1 h-full">
          <div className="flex-1 h-px" style={{ background: `${meta.color}30` }} />
          <span
            className="text-[9px] font-bold tracking-[0.08em] whitespace-nowrap"
            style={{ color: `${meta.color}99` }}
          >
            {meta.label}
          </span>
          <div className="flex-1 h-px" style={{ background: `${meta.color}30` }} />
        </div>
      );
    }

    if (row.type === "stage-divider") {
      const meta = STAGE_META[row.stage];
      return (
        <div className="flex items-center gap-1.5 px-4 pt-1.5 pb-0.5 h-full">
          <span
            className="text-[8px] font-bold tracking-[0.06em] whitespace-nowrap"
            style={{ color: `${meta.color}80` }}
          >
            {meta.shortLabel}
          </span>
          <div className="flex-1 h-px" style={{ background: `${meta.color}20` }} />
        </div>
      );
    }

    if (row.type === "company-header") {
      const co = row.company;
      const projIds = row.projIds;
      const allOn = projIds.every((id) => enabled[id]);
      const someOn = projIds.some((id) => enabled[id]);
      const coProjs = projIds.map((id) => allProjects.find((p) => p.id === id)).filter(Boolean) as FlatProject[];
      const topProb = coProjs.length > 0 ? Math.max(...coProjs.map((p) => p.prob)) : 0;
      const color = getPS(topProb).bar;
      const expKey = `co-${co.id}`;
      const isExp = expanded[expKey] !== false;
      const coHov = hovCompany === co.id;
      const isClientFilter = viewFilter === co.id;

      return (
        <div
          onMouseEnter={() => onSetHovCompany(co.id)}
          onMouseLeave={() => onSetHovCompany(null)}
          className={`flex h-full cursor-pointer select-none items-center gap-1.5 px-2.5 transition-colors duration-100 ${
            isClientFilter ? "bg-primary/[0.06]" : coHov ? "bg-white/[0.03]" : ""
          }`}
        >
          <div className="flex items-center" onClick={() => onToggleExpand(expKey)}>
            <ChevronIcon open={isExp} color="var(--muted-foreground)" />
          </div>
          <Chk
            on={allOn}
            indeterminate={!allOn && someOn}
            color={color}
            size={12}
            onClick={(e) => { e.stopPropagation(); onToggleGroup(projIds); }}
          />
          <span
            onClick={() => onSelectCompany(co.id)}
            className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-bold transition-colors duration-100"
            style={{
              color: coHov || isClientFilter ? "#fff" : allOn ? "var(--foreground)" : someOn ? "var(--muted-foreground)" : "var(--muted-foreground)",
            }}
          >
            {co.name}
          </span>
          {projIds.length > 1 && (
            <span className="text-[10px] text-muted-foreground">{projIds.length}</span>
          )}
        </div>
      );
    }

    if (row.type === "project") {
      const p = row.project;
      const ps = getPS(p.prob);
      const tm = TIER_META[p.tier];
      const on = enabled[p.id];
      const hov = hovProj === p.id || hovCompany === p.companyId;
      const sel = selectedId === p.id;
      const atCross = isAtCross(p, hoverData);
      const lit = hov || atCross;

      return (
        <div
          onMouseEnter={() => onSetHovProj(p.id)}
          onMouseLeave={() => onSetHovProj(null)}
          className={`flex h-full cursor-pointer items-center gap-[5px] transition-colors duration-100 ${
            sel ? "border-l-2 border-l-primary bg-primary/[0.08]" : lit ? "border-l-2 border-l-transparent bg-white/[0.03]" : "border-l-2 border-l-transparent"
          }`}
          style={{ padding: `0 10px 0 ${row.indent}px` }}
        >
          <Chk on={on} indeterminate={false} color={ps.bar} size={11} onClick={(e) => { e.stopPropagation(); onToggleEn(p.id); }} />
          <div
            className="shrink-0 rounded-full"
            style={{
              width: 6,
              height: 6,
              background: tm?.color || "var(--muted-foreground)",
              opacity: on ? 0.8 : 0.3,
            }}
          />
          <span
            onClick={() => onSelectProject(p.id)}
            className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium transition-colors duration-100"
            style={{
              color: lit ? "#fff" : on ? "var(--foreground)" : "var(--muted-foreground)",
              textDecoration: on ? "none" : "line-through",
            }}
          >
            {row.showClient && (
              <span className="text-muted-foreground mr-1">{p.client} /</span>
            )}
            {p.name}
          </span>
          <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
            {p.seats}s&middot;{p.prob}%
          </span>
        </div>
      );
    }

    return null;
  }

  function renderGanttCell(row: LayoutRow, h: number) {
    if (row.type === "stage-header") {
      const meta = STAGE_META[row.stage];
      return (
        <div className="flex items-end h-full">
          <div className="w-full h-px" style={{ background: `${meta.color}30` }} />
        </div>
      );
    }

    if (row.type === "stage-divider") {
      const meta = STAGE_META[row.stage];
      return (
        <div className="flex items-center h-full">
          <div className="w-full h-px" style={{ background: `${meta.color}20` }} />
        </div>
      );
    }

    if (row.type === "company-header") {
      // Empty gantt cell for company headers
      return null;
    }

    if (row.type === "project") {
      const p = row.project;
      const ps = getPS(p.prob);
      const lPx = Math.max(0, ((new Date(p.start).getTime() - T_START.getTime()) / T_MS) * timelineWidth);
      const rPx = Math.min(timelineWidth, ((new Date(p.end).getTime() - T_START.getTime()) / T_MS) * timelineWidth);
      const wPx = rPx - lPx;
      const hov = hovProj === p.id;
      const companyHov = hovCompany === p.companyId;
      const atCross = hoverData
        ? new Date(p.start) <= hoverData.date && new Date(p.end) >= hoverData.date
        : false;
      const lit = hov || companyHov || atCross || selectedId === p.id;

      // Bar label centering (relative to visible gantt area)
      const visL = Math.max(lPx, scrollX);
      const visR = Math.min(lPx + wPx, scrollX + visibleGanttW);
      const visCenter = (visL + visR) / 2;
      const labelOff = Math.max(35, Math.min(wPx - 35, visCenter - lPx));

      return (
        <div className="relative h-full">
          {/* Month grid lines */}
          {majorTicks.map((t, i) => (
            <div
              key={i}
              className="absolute inset-y-0 border-l border-border opacity-25"
              style={{ left: t.px }}
            />
          ))}
          {/* Today marker */}
          <div
            className="absolute inset-y-0 z-[2] border-l-2 border-dashed border-primary opacity-35"
            style={{ left: todayPx }}
          />
          {/* Bar */}
          <div
            className="absolute overflow-hidden rounded cursor-pointer transition-colors duration-100"
            style={{
              left: lPx,
              width: Math.max(wPx, 4),
              top: 3,
              bottom: 3,
              background: lit ? ps.bar : ps.bg,
              border: `1.5px solid ${ps.bar}`,
              boxShadow: hov ? `0 0 14px ${ps.bar}50` : "none",
              opacity: lit ? 1 : 0.85,
            }}
            onMouseEnter={() => onSetHovProj(p.id)}
            onMouseLeave={() => onSetHovProj(null)}
            onClick={() => onSelectProject(p.id)}
          >
            {wPx > 60 && (
              <span
                className="absolute top-1/2 whitespace-nowrap text-[11px] font-bold"
                style={{
                  color: lit ? "#000" : ps.bar,
                  left: labelOff,
                  transform: "translate(-50%, -50%)",
                }}
              >
                {p.seats}s &middot; {p.prob}%
              </span>
            )}
          </div>
        </div>
      );
    }

    return null;
  }

  // Demand hover x (needs to be in timeline-space for the demand chart, not content-space)
  const demandHoverX = hoverX !== null ? hoverX - labelW : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      {/* ─── Fixed header (controls) ─── */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center justify-between px-3 pb-1.5 pt-1 relative z-[200]">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold tracking-[0.06em] text-muted-foreground">PROJECTS</span>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-help items-center">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-muted-foreground">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M8 7.5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="8" cy="5.5" r="0.9" fill="currentColor" />
                  </svg>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6} className="bg-[#1C2127] border border-border text-foreground p-2 max-w-[220px]" style={{ "--tooltip-bg": "#1C2127" } as React.CSSProperties}>
                <p className="text-xs leading-snug">Sorted by active clients first, then pipeline, speculative, and internal projects at the bottom.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-0.5">
            <ViewsDropdown
              groupOrder={groupOrder}
              groupEnabled={groupEnabled}
              groupSort={groupSort}
              stageVisible={stageVisible}
              onApplyView={onApplyView}
            />
            <GroupByDropdown
              groupOrder={groupOrder}
              groupEnabled={groupEnabled}
              groupSort={groupSort}
              onSetGroupOrder={onSetGroupOrder}
              onSetGroupEnabled={onSetGroupEnabled}
              onSetGroupSort={onSetGroupSort}
            />
            <FilterDropdown
              companies={companies}
              viewFilter={viewFilter}
              onSetViewFilter={onSetViewFilter}
            />
          </div>
        </div>
        <StageChips
          stageOrder={stageOrder}
          stageVisible={stageVisible}
          onSetStageOrder={onSetStageOrder}
          onSetStageVisible={onSetStageVisible}
        />
      </div>

      {/* ─── Shared scroll container (sidebar + gantt bars) ─── */}
      <div
        ref={ganttScrollRef}
        className="flex-1 min-h-0 overflow-auto scrollbar-thin"
        style={{ overscrollBehavior: "none" }}
        onMouseMove={onGanttHover}
        onMouseLeave={clearHover}
      >
        <div className="relative cursor-crosshair" style={{ width: contentW }}>
          {/* Crosshair (spans full height, only in gantt area) */}
          {hoverX !== null && hoverX >= labelW && (
            <div
              className="pointer-events-none absolute inset-y-0 z-20"
              style={{ left: hoverX, width: 1, background: "rgba(255,255,255,0.4)" }}
            />
          )}

          {/* Timeline overlay bands */}
          {overlayBands.map((o) => (
            <div
              key={`ov-${o.id}`}
              className="absolute top-0 bottom-0 pointer-events-none z-[1]"
              style={{
                left: labelW + o.leftPx,
                width: o.widthPx,
                background: o.color,
                borderLeft: "1px dashed rgba(255,255,255,0.1)",
                borderRight: "1px dashed rgba(255,255,255,0.1)",
              }}
            >
              <div className="sticky top-8 px-1.5 py-0.5" style={{ width: "fit-content" }}>
                <span
                  className="text-[9px] font-semibold uppercase tracking-wider"
                  style={{ color: "rgba(255,255,255,0.35)" }}
                >
                  {o.label}
                </span>
              </div>
            </div>
          ))}

          {/* Tick labels row (sticky top, positioned over gantt area) */}
          <div className="sticky top-0 z-10 flex h-7 items-end" style={{ background: "#1C2127" }}>
            {/* Spacer for sidebar */}
            <div className="shrink-0" style={{ width: labelW }} />
            <TickLabels ticks={ticks} bottom={false} />
          </div>

          {/* Row list */}
          {rowList.map((row, i) => {
            const h = rowHeight(row);
            const key = row.type === "project"
              ? row.project.id
              : row.type === "company-header"
                ? `co-${row.company.id}`
                : `${row.type}-${i}`;

            return (
              <div key={key} className="flex" style={{ height: h }}>
                {/* Sidebar cell — sticky left */}
                <div
                  className="shrink-0 z-[5]"
                  style={{
                    width: labelW,
                    minWidth: labelW,
                    position: "sticky",
                    left: 0,
                    background: "#1C2127",
                  }}
                >
                  {renderSidebarCell(row)}
                </div>
                {/* Gantt cell */}
                <div style={{ width: timelineWidth }}>
                  {renderGanttCell(row, h)}
                </div>
              </div>
            );
          })}

          {/* Bottom spacer */}
          <div className="h-5" />
        </div>
      </div>

      {/* ─── Separator ─── */}
      <div className="shrink-0 border-t border-border" />

      {/* ─── Demand section ─── */}
      <div className="shrink-0 flex" style={{ height: DEMAND_H }}>
        {/* Corner: demand axis labels */}
        <div className="shrink-0 relative flex flex-col" style={{ width: labelW }}>
          <div className="relative flex-1">
            <DemandAxisLabels chartMax={chartMax} />
          </div>
          <div className="h-6 shrink-0" />
          {/* Drag handle */}
          <div
            onMouseDown={startLabelDrag}
            className="absolute inset-y-0 -right-[3px] z-10 flex w-1.5 cursor-col-resize items-center justify-center"
          >
            <div className="h-full w-px bg-border transition-colors hover:bg-primary" />
          </div>
        </div>
        {/* Demand scroll */}
        <div
          ref={demandScrollRef}
          className="flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin"
        >
          <div
            onMouseMove={onDemandHover}
            onMouseLeave={clearHover}
            className="relative flex h-full cursor-crosshair flex-col"
            style={{ width: timelineWidth }}
          >
            {/* Demand crosshair */}
            {demandHoverX !== null && demandHoverX >= 0 && (
              <div
                className="pointer-events-none absolute inset-y-0 z-20"
                style={{ left: demandHoverX, width: 1, background: "rgba(255,255,255,0.4)" }}
              />
            )}

            <DemandChart
              active={active}
              daily={daily}
              gran={gran}
              timelineWidth={timelineWidth}
              chartMax={chartMax}
              hovProj={hovProj}
              selectedId={selectedId}
              hoverData={hoverData}
              hoverX={demandHoverX}
              todayPx={todayPx}
              majorTicks={majorTicks}
              overlayBands={overlayBands}
            />

            {/* Bottom tick labels */}
            <TickLabels ticks={ticks} bottom={true} />
          </div>
        </div>
      </div>
    </div>
  );
}
