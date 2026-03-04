"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Sidebar } from "./sidebar";
import { AskRuntimeProvider, AskContent } from "@/components/ask-panel";
import { createChat, type ChatEntry } from "@/lib/ask/chat-store";

const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 750;
const DEFAULT_PANEL_WIDTH = 380;

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAskPage = pathname === "/ask";

  const [askOpen, setAskOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [chatKey, setChatKey] = useState(0);
  const [chatId, setChatId] = useState<string | null>(null);

  // On /ask page, read ?chat=ID from URL
  useEffect(() => {
    if (isAskPage) {
      const urlChatId = searchParams.get("chat");
      if (urlChatId && urlChatId !== chatId) {
        setChatId(urlChatId);
        setChatKey((k) => k + 1);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAskPage, searchParams]);

  // Auto-create a chat entry when the panel opens (if none exists)
  useEffect(() => {
    if ((askOpen || isAskPage) && !chatId) {
      const chat = createChat();
      setChatId(chat.id);
      if (isAskPage) {
        router.replace(`/ask?chat=${chat.id}`, { scroll: false });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askOpen, isAskPage, chatId]);

  // If navigating to /ask, ensure askOpen is true so the provider stays mounted
  useEffect(() => {
    if (isAskPage) {
      setAskOpen(true);
    }
  }, [isAskPage]);

  // Check if we should open the panel after navigating back from /ask
  useEffect(() => {
    if (!isAskPage && typeof sessionStorage !== "undefined") {
      const flag = sessionStorage.getItem("n2o-ask-panel-open");
      if (flag === "true") {
        setAskOpen(true);
        sessionStorage.removeItem("n2o-ask-panel-open");
      }
    }
  }, [isAskPage]);

  // ── Drag resize ──────────────────────────────────
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartWidth.current = panelWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    },
    [panelWidth]
  );

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
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

  // Fullscreen = navigate to /ask page with current chat ID
  const handleFullscreen = useCallback(() => {
    if (chatId) {
      router.push(`/ask?chat=${chatId}`);
    } else {
      router.push("/ask");
    }
  }, [router, chatId]);

  // Minimize = go back from /ask page, keep panel open
  const handleMinimize = useCallback(() => {
    sessionStorage.setItem("n2o-ask-panel-open", "true");
    router.back();
  }, [router]);

  // Close the ask panel entirely
  const handleClose = useCallback(() => {
    setAskOpen(false);
    if (isAskPage) {
      router.back();
    }
  }, [isAskPage, router]);

  // New chat = reset the runtime + create a fresh chat entry
  const handleNewChat = useCallback(() => {
    const chat = createChat();
    setChatId(chat.id);
    setChatKey((k) => k + 1);
    if (isAskPage) {
      router.replace(`/ask?chat=${chat.id}`, { scroll: false });
    }
  }, [isAskPage, router]);

  // Select a past chat = load its messages into the runtime
  const handleSelectChat = useCallback(
    (chat: ChatEntry) => {
      setChatId(chat.id);
      setChatKey((k) => k + 1);
      if (isAskPage) {
        router.replace(`/ask?chat=${chat.id}`, { scroll: false });
      }
    },
    [isAskPage, router]
  );

  // Show the ask UI? Either as panel (non-/ask pages) or fullscreen (/ask page)
  const showAsk = askOpen || isAskPage;

  // On /ask page, render fullscreen mode with no sidebar/main
  if (isAskPage) {
    return (
      <AskRuntimeProvider key={chatKey} chatId={chatId}>
        <div className="flex h-screen w-full flex-col">
          <AskContent
            mode="fullscreen"
            onClose={handleClose}
            onNewChat={handleNewChat}
            onSelectChat={handleSelectChat}
            onFullscreen={() => {}}
            onMinimize={handleMinimize}
          />
        </div>
      </AskRuntimeProvider>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        onAskToggle={() => setAskOpen((o) => !o)}
        expanded={sidebarExpanded}
        onToggleExpanded={() => setSidebarExpanded((e) => !e)}
      />
      <main
        className="flex-1 overflow-y-auto p-4 min-h-0"
        style={{
          marginRight: showAsk && !isAskPage ? `${panelWidth}px` : "0px",
        }}
      >
        {children}
      </main>

      {/* Ask panel overlay */}
      {showAsk && (
        <div
          className="fixed right-0 top-0 z-50 flex h-screen"
          style={{ width: `${panelWidth}px` }}
        >
          {/* Drag handle (left edge) */}
          <div
            onMouseDown={handleMouseDown}
            className="w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0"
          />
          <div className="flex-1 min-w-0 min-h-0">
            <AskRuntimeProvider key={chatKey} chatId={chatId}>
              <AskContent
                mode="panel"
                onClose={handleClose}
                onNewChat={handleNewChat}
                onSelectChat={handleSelectChat}
                onFullscreen={handleFullscreen}
                onMinimize={handleClose}
              />
            </AskRuntimeProvider>
          </div>
        </div>
      )}
    </div>
  );
}
