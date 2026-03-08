"use client";

import { useState } from "react";
import type { Project, Company } from "./capacity-data";
import { getPS, TIER_META } from "./capacity-utils";

// ─── SVG primitives ───

function CheckIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" className="block">
      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DashIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" className="block">
      <path d="M3 6H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ open, color }: { open: boolean; color: string }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      className="shrink-0 transition-transform duration-150"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
    >
      <path d="M3 1.5L7 5L3 8.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Checkbox ───

function Chk({
  on,
  indeterminate,
  color,
  size = 12,
  onClick,
}: {
  on: boolean;
  indeterminate: boolean;
  color: string;
  size?: number;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex shrink-0 cursor-pointer items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: 3,
        background: on ? color : "transparent",
        border: `2px solid ${on ? color : indeterminate ? color : "var(--muted-foreground)"}`,
      }}
    >
      {on ? (
        <span style={{ color: "var(--background)" }}>
          <CheckIcon size={size - 4} />
        </span>
      ) : indeterminate ? (
        <span style={{ color }}>
          <DashIcon size={size - 4} />
        </span>
      ) : null}
    </div>
  );
}

// ─── Types ───

export type FlatProject = Project & { client: string; companyId: string };

interface ProjectSidebarProps {
  companies: Company[];
  allProjects: FlatProject[];
  enabled: Record<string, boolean>;
  expanded: Record<string, boolean>;
  hovProj: string | null;
  selectedId: string | null;
  selectedCoId: string | null;
  groupBy: "company" | "status";
  onToggleEn: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
  onToggleExpand: (key: string) => void;
  onSelectProject: (pid: string) => void;
  onSelectCompany: (cid: string) => void;
  onSetGroupBy: (g: "company" | "status") => void;
  onSetHovProj: (id: string | null) => void;
}

// ─── Project row ───

function ProjectRow({
  p,
  indent,
  on,
  hov,
  sel,
  onHover,
  onLeave,
  onToggle,
  onSelect,
}: {
  p: FlatProject;
  indent: number;
  on: boolean;
  hov: boolean;
  sel: boolean;
  onHover: () => void;
  onLeave: () => void;
  onToggle: (e: React.MouseEvent) => void;
  onSelect: () => void;
}) {
  const ps = getPS(p.prob);
  const tm = TIER_META[p.tier];

  return (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className={`flex cursor-pointer items-center gap-[5px] ${
        sel ? "border-l-2 border-l-primary bg-primary/[0.08]" : hov ? "border-l-2 border-l-transparent bg-white/[0.02]" : "border-l-2 border-l-transparent"
      }`}
      style={{ padding: `3px 10px 3px ${indent}px` }}
    >
      <Chk on={on} indeterminate={false} color={ps.bar} size={11} onClick={onToggle} />
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
        onClick={onSelect}
        className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium"
        style={{
          color: on ? "var(--foreground)" : "var(--muted-foreground)",
          textDecoration: on ? "none" : "line-through",
        }}
      >
        {p.name}
      </span>
      <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
        {p.seats}s&middot;{p.prob}%
      </span>
    </div>
  );
}

// ─── Main sidebar ───

export function ProjectSidebar({
  companies,
  allProjects,
  enabled,
  expanded,
  hovProj,
  selectedId,
  selectedCoId,
  groupBy,
  onToggleEn,
  onToggleGroup,
  onToggleExpand,
  onSelectProject,
  onSelectCompany,
  onSetGroupBy,
  onSetHovProj,
}: ProjectSidebarProps) {
  return (
    <div className="flex w-[250px] min-w-[250px] shrink-0 flex-col border-r border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pb-1.5 pt-1 relative z-[200]">
        <span className="text-[10px] font-bold tracking-[0.1em] text-muted-foreground">PROJECTS</span>
        <div className="flex gap-0.5">
          <GroupByButton active={groupBy === "company"} onClick={() => onSetGroupBy("company")} title="Group by company">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <rect x="5" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </GroupByButton>
          <GroupByButton active={groupBy === "status"} onClick={() => onSetGroupBy("status")} title="Group by status">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </GroupByButton>
        </div>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin min-h-0 py-1">
        {groupBy === "company"
          ? companies.map((co) => {
              const coProjs = co.projects
                .map((p) => allProjects.find((ap) => ap.id === p.id))
                .filter((p): p is FlatProject => p != null);
              if (coProjs.length === 0) return null;
              const coIds = coProjs.map((p) => p.id);
              const allOn = coIds.every((id) => enabled[id]);
              const someOn = coIds.some((id) => enabled[id]);
              const topProb = Math.max(...coProjs.map((p) => p.prob));
              const color = getPS(topProb).bar;
              const expKey = `co-${co.id}`;
              const isExp = expanded[expKey] !== false;
              const isSel = selectedCoId === co.id && !selectedId;

              return (
                <div key={co.id} className="mb-0.5">
                  <div
                    className={`flex cursor-pointer select-none items-center gap-1.5 px-2.5 pb-[3px] pt-[5px] ${
                      isSel ? "bg-primary/[0.06]" : ""
                    }`}
                  >
                    <div className="flex items-center" onClick={() => onToggleExpand(expKey)}>
                      <ChevronIcon open={isExp} color={allOn ? "var(--muted-foreground)" : "var(--muted-foreground)"} />
                    </div>
                    <Chk
                      on={allOn}
                      indeterminate={!allOn && someOn}
                      color={color}
                      size={12}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleGroup(coIds);
                      }}
                    />
                    <span
                      onClick={() => onSelectCompany(co.id)}
                      className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-bold"
                      style={{
                        color: allOn ? "var(--foreground)" : someOn ? "var(--muted-foreground)" : "var(--muted-foreground)",
                      }}
                    >
                      {co.name}
                    </span>
                    {coProjs.length > 1 && (
                      <span className="text-[10px] text-muted-foreground">{coProjs.length}</span>
                    )}
                  </div>
                  {isExp &&
                    coProjs.map((p) => (
                      <ProjectRow
                        key={p.id}
                        p={p}
                        indent={34}
                        on={enabled[p.id]}
                        hov={hovProj === p.id}
                        sel={selectedId === p.id}
                        onHover={() => onSetHovProj(p.id)}
                        onLeave={() => onSetHovProj(null)}
                        onToggle={(e) => {
                          e.stopPropagation();
                          onToggleEn(p.id);
                        }}
                        onSelect={() => onSelectProject(p.id)}
                      />
                    ))}
                </div>
              );
            })
          : (["active", "pipeline", "speculative", "internal"] as const).map((tk) => {
              const tm = TIER_META[tk];
              const tierProjs = allProjects.filter((p) => p.tier === tk);
              if (tierProjs.length === 0) return null;
              const tierIds = tierProjs.map((p) => p.id);
              const allOn = tierIds.every((id) => enabled[id]);
              const someOn = tierIds.some((id) => enabled[id]);
              const expKey = `tier-${tk}`;
              const isExp = expanded[expKey] !== false;

              return (
                <div key={tk} className="mb-0.5">
                  <div className="flex cursor-pointer select-none items-center gap-1.5 px-2.5 pb-[3px] pt-[5px]">
                    <div className="flex items-center" onClick={() => onToggleExpand(expKey)}>
                      <ChevronIcon open={isExp} color={allOn ? tm.color : "var(--muted-foreground)"} />
                    </div>
                    <Chk
                      on={allOn}
                      indeterminate={!allOn && someOn}
                      color={tm.color}
                      size={12}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleGroup(tierIds);
                      }}
                    />
                    <span
                      onClick={() => onToggleExpand(expKey)}
                      className="flex-1 text-[11px] font-bold uppercase tracking-[0.04em]"
                      style={{
                        color: allOn ? tm.color : someOn ? tm.color : "var(--muted-foreground)",
                        opacity: allOn ? 1 : someOn ? 0.7 : 0.4,
                      }}
                    >
                      {tm.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{tierProjs.length}</span>
                  </div>
                  {isExp &&
                    tierProjs.map((p) => {
                      const ps = getPS(p.prob);
                      const on = enabled[p.id];
                      const hov = hovProj === p.id;
                      const sel = selectedId === p.id;

                      return (
                        <div
                          key={p.id}
                          onMouseEnter={() => onSetHovProj(p.id)}
                          onMouseLeave={() => onSetHovProj(null)}
                          className={`flex cursor-pointer items-center gap-[5px] pl-[34px] pr-2.5 py-[3px] ${
                            sel ? "border-l-2 border-l-primary bg-primary/[0.08]" : hov ? "border-l-2 border-l-transparent bg-white/[0.02]" : "border-l-2 border-l-transparent"
                          }`}
                        >
                          <Chk
                            on={on}
                            indeterminate={false}
                            color={ps.bar}
                            size={11}
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleEn(p.id);
                            }}
                          />
                          <span
                            onClick={() => onSelectProject(p.id)}
                            className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium"
                            style={{
                              color: on ? "var(--foreground)" : "var(--muted-foreground)",
                              textDecoration: on ? "none" : "line-through",
                            }}
                          >
                            {p.name}
                          </span>
                          <span className="mr-1 shrink-0 text-[9px] text-muted-foreground">{p.client}</span>
                          <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                            {p.seats}s&middot;{p.prob}%
                          </span>
                        </div>
                      );
                    })}
                </div>
              );
            })}
      </div>
    </div>
  );
}

// ─── GroupBy toggle button ───

function GroupByButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded text-[13px] transition-colors ${
        active
          ? "bg-primary/15 text-primary border border-primary/25"
          : "text-muted-foreground border border-transparent"
      }`}
    >
      {children}
    </button>
  );
}
