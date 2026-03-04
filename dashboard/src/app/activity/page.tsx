// Activity: Scrollable conversation feed showing developer session messages, tool calls, and timestamps.
"use client";

import { useQuery } from "@apollo/client/react";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { CONVERSATION_FEED_QUERY } from "@/lib/graphql/queries";

// ── Types ───────────────────────────────────────────────

type ToolCall = { name: string; summary: string | null };
type Message = {
  role: string;
  content: string | null;
  timestamp: string | null;
  toolCalls: ToolCall[];
};
type Session = {
  sessionId: string;
  developer: string | null;
  sprint: string | null;
  taskNum: number | null;
  taskTitle: string | null;
  startedAt: string | null;
  endedAt: string | null;
  model: string | null;
  messages: Message[];
};

// ── Helpers ─────────────────────────────────────────────

function fmtTime(ts: string | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString([], opts);
}

function fmtDateKey(ts: string): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt || !endedAt) return "";
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function sessionLabel(s: Session): string {
  const parts: string[] = [];
  if (s.sprint) parts.push(`${s.sprint}${s.taskNum != null ? `#${s.taskNum}` : ""}`);
  if (s.taskTitle) parts.push(s.taskTitle);
  // Use first non-empty user prompt as label
  if (!parts.length) {
    const firstPrompt = s.messages.find((m) => m.role === "user" && m.content?.trim())?.content;
    if (firstPrompt) {
      const preview = firstPrompt.substring(0, 80).replace(/\n/g, " ");
      parts.push(preview + (firstPrompt.length > 80 ? "..." : ""));
    } else {
      const firstAssistant = s.messages.find((m) => m.role === "assistant" && m.content?.trim())?.content;
      if (firstAssistant) {
        const preview = firstAssistant.substring(0, 60).replace(/\n/g, " ");
        parts.push(preview + (firstAssistant.length > 60 ? "..." : ""));
      } else {
        parts.push(fmtTime(s.startedAt) || "Session");
      }
    }
  }
  return parts.join(" \u00b7 ");
}

const TOOL_COLORS: Record<string, string> = {
  Read: "#2D72D2", Edit: "#EC9A3C", Write: "#EC9A3C",
  Bash: "#238551", Grep: "#7157D9", Glob: "#7157D9",
  Task: "#238551", Skill: "#7157D9", WebSearch: "#2D72D2",
  WebFetch: "#2D72D2", NotebookEdit: "#EC9A3C",
  AskUserQuestion: "#EC9A3C", EnterPlanMode: "#2D72D2",
};

// Date header height in px (py-1.5 = 6px top+bottom + 11px font + border = ~25px)
const DATE_HEADER_H = 25;

// ── Page ────────────────────────────────────────────────

export default function ActivityPage() {
  const { data, loading, error } = useQuery<any>(CONVERSATION_FEED_QUERY, {
    variables: { limit: 100 },
    pollInterval: 10000,
  });

  const [devFilter, setDevFilter] = useState<string>("");
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  const sessions: Session[] = data?.conversationFeed ?? [];

  // Auto-scroll to bottom on first data load
  useEffect(() => {
    if (sessions.length > 0 && !hasScrolledRef.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
      hasScrolledRef.current = true;
    }
  }, [sessions.length]);

  const developers = useMemo(() => {
    const s = new Set<string>();
    for (const sess of sessions) if (sess.developer) s.add(sess.developer);
    return [...s].sort();
  }, [sessions]);

  const filtered = useMemo(() => {
    if (!devFilter) return sessions;
    return sessions.filter((s) => s.developer === devFilter);
  }, [sessions, devFilter]);

  const dateGroups = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of filtered) {
      const dk = s.startedAt ? fmtDateKey(s.startedAt) : null;
      if (!dk) continue;
      if (!map.has(dk)) map.set(dk, []);
      map.get(dk)!.push(s);
    }
    for (const sessions of map.values()) {
      sessions.sort((a, b) =>
        new Date(a.startedAt!).getTime() - new Date(b.startedAt!).getTime()
      );
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dk, sessions]) => ({
        dateKey: dk,
        date: fmtDate(sessions[0].startedAt!),
        sessions,
      }));
  }, [filtered]);

  const isSessionExpanded = useCallback((id: string) => {
    if (allExpanded) return true;
    return expandedSessions.has(id);
  }, [allExpanded, expandedSessions]);

  const toggleSession = useCallback((id: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (allExpanded) setAllExpanded(false);
  }, [allExpanded]);

  const toggleAll = useCallback(() => {
    if (allExpanded) {
      setAllExpanded(false);
      setExpandedSessions(new Set());
    } else {
      setAllExpanded(true);
    }
  }, [allExpanded]);

  const scrollToBottom = useCallback(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, []);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground font-mono text-sm">
        Loading sessions...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-[#CD4246] font-mono text-sm">
        Error: {error.message}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#1C2127]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 shrink-0 border-b border-border/40 bg-[#252A31]">
        <h1 className="text-sm font-semibold leading-none">Activity</h1>
        <span className="text-xs text-muted-foreground font-mono leading-none">
          {filtered.length} Session{filtered.length !== 1 ? "s" : ""}
        </span>

        <button
          onClick={toggleAll}
          className="text-[10px] px-2 py-0.5 rounded-sm text-muted-foreground hover:text-foreground border border-border/30 hover:border-border/60 transition-colors leading-none"
        >
          {allExpanded ? "Collapse All" : "Expand All"}
        </button>

        <button
          onClick={scrollToBottom}
          className="text-[10px] px-2 py-0.5 rounded-sm text-muted-foreground hover:text-foreground border border-border/30 hover:border-border/60 transition-colors leading-none"
        >
          Latest
        </button>

        {developers.length > 0 && (
          <select
            className="text-xs bg-[#1C2127] border border-border rounded-sm px-2 py-1 text-foreground ml-auto leading-none"
            value={devFilter}
            onChange={(e) => setDevFilter(e.target.value)}
          >
            <option value="">All Developers</option>
            {developers.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
      </div>

      {/* Feed */}
      <div ref={feedRef} className="flex-1 min-h-0 overflow-y-auto font-mono text-xs" id="activity-feed">
        {dateGroups.length === 0 ? (
          <p className="text-muted-foreground p-6">No sessions yet.</p>
        ) : (
          dateGroups.map((dg) => (
            <div key={dg.dateKey}>
              {/* Date header — fixed height so session headers align */}
              <div
                className="sticky top-0 z-20 px-4 text-[11px] font-semibold text-muted-foreground bg-[#1C2127] border-b border-border/30 flex items-center"
                style={{ height: DATE_HEADER_H }}
              >
                {dg.date}
              </div>

              {dg.sessions.map((session, idx) => (
                <SessionBlock
                  key={`${session.sessionId}-${idx}`}
                  session={session}
                  expanded={isSessionExpanded(session.sessionId)}
                  onToggle={() => toggleSession(session.sessionId)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Session ─────────────────────────────────────────────

function SessionBlock({
  session,
  expanded,
  onToggle,
}: {
  session: Session;
  expanded: boolean;
  onToggle: () => void;
}) {
  const userCount = session.messages.filter((m) => m.role === "user").length;
  const duration = fmtDuration(session.startedAt, session.endedAt);

  return (
    <div className="border-b border-border/15">
      {/* Session header — sticks below date header */}
      <div
        className="sticky z-10 flex items-center gap-2 px-4 py-1.5 bg-[#252A31] border-b border-border/15 cursor-pointer select-none hover:bg-[#2A3038] transition-colors"
        style={{ top: DATE_HEADER_H }}
        onClick={onToggle}
      >
        <span className="text-muted-foreground/60 w-3 shrink-0 text-[10px]">
          {expanded ? "\u25BE" : "\u25B8"}
        </span>
        <span className="text-[11px] text-foreground/80 truncate flex-1 min-w-0">
          {sessionLabel(session)}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground/50">
          {fmtTime(session.startedAt)}
          {session.endedAt ? `\u2013${fmtTime(session.endedAt)}` : ""}
        </span>
        {duration && (
          <span className="shrink-0 text-[10px] text-muted-foreground/40">
            {duration}
          </span>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground/40">
          {userCount} prompt{userCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Messages */}
      {expanded && (
        <div className="py-0.5">
          {session.messages.map((msg, i) => (
            <MessageRow key={i} message={msg} developer={session.developer} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Message row ─────────────────────────────────────────

function MessageRow({ message, developer }: { message: Message; developer: string | null }) {
  const [showFull, setShowFull] = useState(false);
  const isUser = message.role === "user";
  const hasText = !!message.content?.trim();
  const toolCount = message.toolCalls.length;

  if (!isUser && !hasText && toolCount === 0) return null;

  const time = fmtTime(message.timestamp);
  const userName = developer?.toUpperCase() || "YOU";

  if (isUser) {
    return (
      <div className="flex gap-0 border-l-2 border-[#2D72D2] bg-[#2D72D206] mx-1 my-px">
        <div className="shrink-0 w-[82px] pt-1.5 pr-2 text-right">
          <div className="text-[10px] font-bold text-[#2D72D2]">{userName}</div>
          <div className="text-[9px] text-muted-foreground/40">{time}</div>
        </div>
        <div className="flex-1 min-w-0 py-1.5 pr-3 text-foreground leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant
  const text = message.content || "";
  const isLong = text.length > 500;
  const displayText = isLong && !showFull ? text.substring(0, 400) + "..." : text;

  return (
    <div className="flex gap-0 mx-1 my-px">
      <div className="shrink-0 w-[82px] pt-1.5 pr-2 text-right">
        {(hasText || toolCount === 0) && (
          <>
            <div className="text-[10px] font-bold text-muted-foreground/50">CLAUDE</div>
            <div className="text-[9px] text-muted-foreground/30">{time}</div>
          </>
        )}
      </div>
      <div className="flex-1 min-w-0 py-1 pr-3">
        {hasText && (
          <div className="text-muted-foreground/70 leading-relaxed whitespace-pre-wrap break-words">
            {displayText}
            {isLong && (
              <button
                onClick={() => setShowFull(!showFull)}
                className="text-[10px] text-[#2D72D2] ml-1 hover:underline"
              >
                {showFull ? "less" : "more"}
              </button>
            )}
          </div>
        )}

        {toolCount > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            {message.toolCalls.map((tc, j) => {
              const color = TOOL_COLORS[tc.name] || "#738694";
              return (
                <span
                  key={j}
                  className="inline-flex items-center gap-1 text-[9px] px-1 py-0 rounded-sm"
                  style={{ backgroundColor: `${color}10`, color: `${color}CC` }}
                >
                  <span className="font-semibold">{tc.name}</span>
                  {tc.summary && (
                    <span className="opacity-50 truncate max-w-[200px]">{tc.summary}</span>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
