"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Sidebar } from "./sidebar";
import { AskPanel } from "@/components/ask-panel";

const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 800;
const DEFAULT_PANEL_WIDTH = 380;

export function Shell({ children }: { children: React.ReactNode }) {
  const [askOpen, setAskOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  // ── Drag resize ──────────────────────────────────
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isFullscreen) return;
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartWidth.current = panelWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    },
    [panelWidth, isFullscreen]
  );

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      // Dragging left edge: moving cursor left = wider panel
      const delta = dragStartX.current - e.clientX;
      const newWidth = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, dragStartWidth.current + delta)
      );
      setPanelWidth(newWidth);
    }

    function handleMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const effectiveWidth = isFullscreen
    ? "100vw"
    : askOpen
      ? `${panelWidth}px`
      : "0px";

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        onAskToggle={() => setAskOpen((o) => !o)}
        expanded={sidebarExpanded}
        onToggleExpanded={() => setSidebarExpanded((e) => !e)}
      />
      <main
        className="flex-1 overflow-y-auto p-4 transition-[margin] duration-200"
        style={{
          marginRight: askOpen && !isFullscreen ? `${panelWidth}px` : "0px",
        }}
      >
        {children}
      </main>

      {/* Ask panel overlay */}
      <div
        className="fixed right-0 top-0 z-50 flex h-screen"
        style={{ width: effectiveWidth }}
      >
        {/* Drag handle (left edge) */}
        {askOpen && !isFullscreen && (
          <div
            onMouseDown={handleMouseDown}
            className="w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <AskPanel
            open={askOpen}
            onClose={() => setAskOpen(false)}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen((f) => !f)}
          />
        </div>
      </div>
    </div>
  );
}
