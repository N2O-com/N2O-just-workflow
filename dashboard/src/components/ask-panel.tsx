"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  X,
  Maximize2,
  Minimize2,
  SquarePen,
  ChevronDown,
} from "lucide-react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useMessagePartText,
} from "@assistant-ui/react";
import { askAdapter } from "@/lib/ask/chat-adapter";
import { useQueryOntologyToolUI } from "@/components/ask-tool-ui";
import { useGenerateChartToolUI } from "@/components/ask-chart-ui";
import {
  getChats,
  createChat,
  type ChatEntry,
} from "@/lib/ask/chat-store";

function ToolRegistration() {
  useQueryOntologyToolUI();
  useGenerateChartToolUI();
  return null;
}

function TextPart() {
  const { text } = useMessagePartText();
  return <span>{text}</span>;
}

function UserMessage() {
  return (
    <div className="flex justify-end mb-3">
      <div className="max-w-[85%] rounded-md bg-primary/15 px-3 py-2 text-sm text-foreground">
        <MessagePrimitive.Content components={{ Text: TextPart }} />
      </div>
    </div>
  );
}

function AssistantMessage() {
  return (
    <div className="mb-3">
      <div className="max-w-[85%] rounded-md px-3 py-2 text-sm text-foreground/90">
        <MessagePrimitive.Content components={{ Text: TextPart }} />
      </div>
    </div>
  );
}

function AskThread() {
  return (
    <ThreadPrimitive.Root className="flex flex-col h-full">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-3 py-4">
        <ThreadPrimitive.Empty>
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2">
            <p>What would you like to know?</p>
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground/70">Try asking:</span>
              <span>&ldquo;How&rsquo;s the current sprint?&rdquo;</span>
              <span>&ldquo;Who has capacity?&rdquo;</span>
              <span>&ldquo;Show me today&rsquo;s activity&rdquo;</span>
            </div>
          </div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
          }}
        />
      </ThreadPrimitive.Viewport>
      <div className="border-t border-border p-3">
        <ComposerPrimitive.Root className="flex items-end gap-2">
          <ComposerPrimitive.Input
            placeholder="Ask a question..."
            className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
          <ComposerPrimitive.Send className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            Send
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
}

// ── Past Chats Dropdown ──────────────────────────────

function PastChatsDropdown({
  onSelect,
  onClose,
}: {
  onSelect: (chat: ChatEntry) => void;
  onClose: () => void;
}) {
  const chats = getChats();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  if (chats.length === 0) {
    return (
      <div
        ref={ref}
        className="absolute left-0 top-full mt-1 z-50 w-64 rounded-md border border-border bg-background shadow-lg py-2 px-3 text-sm text-muted-foreground"
      >
        No past chats
      </div>
    );
  }

  // Group by recency
  const now = Date.now();
  const DAY = 86400000;
  const recent = chats.filter(
    (c) => now - new Date(c.createdAt).getTime() < 30 * DAY
  );
  const older = chats.filter(
    (c) => now - new Date(c.createdAt).getTime() >= 30 * DAY
  );

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full mt-1 z-50 w-64 max-h-80 overflow-y-auto rounded-md border border-border bg-background shadow-lg py-1"
    >
      {recent.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-xs text-muted-foreground">
            Past 30 days
          </div>
          {recent.map((chat) => (
            <button
              key={chat.id}
              onClick={() => {
                onSelect(chat);
                onClose();
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-secondary truncate"
            >
              {chat.title}
            </button>
          ))}
        </>
      )}
      {older.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-xs text-muted-foreground">
            Older
          </div>
          {older.map((chat) => (
            <button
              key={chat.id}
              onClick={() => {
                onSelect(chat);
                onClose();
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-secondary truncate"
            >
              {chat.title}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

// ── Panel Header ─────────────────────────────────────

function PanelHeader({
  onClose,
  onNewChat,
  onToggleFullscreen,
  isFullscreen,
}: {
  onClose: () => void;
  onNewChat: () => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);

  const handleSelectChat = useCallback(
    (_chat: ChatEntry) => {
      // For now, just start a new chat (full chat restore would need
      // runtime message injection which LocalRuntime doesn't support)
      onNewChat();
    },
    [onNewChat]
  );

  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
      <div className="relative">
        <button
          onClick={() => setShowHistory((o) => !o)}
          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-sm font-medium text-foreground hover:bg-secondary"
        >
          New chat
          <ChevronDown size={14} className="text-muted-foreground" />
        </button>
        {showHistory && (
          <PastChatsDropdown
            onSelect={handleSelectChat}
            onClose={() => setShowHistory(false)}
          />
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onNewChat}
          title="New chat"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <SquarePen size={15} />
        </button>
        <button
          onClick={onToggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button
          onClick={onClose}
          title="Close"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────

function AskPanelContent({
  onClose,
  isFullscreen,
  onToggleFullscreen,
}: {
  onClose: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const [chatKey, setChatKey] = useState(0);
  const runtime = useLocalRuntime(askAdapter);

  const handleNewChat = useCallback(() => {
    createChat();
    // Force a new runtime by bumping key
    setChatKey((k) => k + 1);
  }, []);

  return (
    <AssistantRuntimeProvider key={chatKey} runtime={runtime}>
      <ToolRegistration />
      <div className="flex h-screen w-full flex-col border-l border-border bg-background">
        <PanelHeader
          onClose={onClose}
          onNewChat={handleNewChat}
          onToggleFullscreen={onToggleFullscreen}
          isFullscreen={isFullscreen}
        />
        <AskThread />
      </div>
    </AssistantRuntimeProvider>
  );
}

export function AskPanel({
  open,
  onClose,
  isFullscreen,
  onToggleFullscreen,
}: {
  open: boolean;
  onClose: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  if (!open) return null;
  return (
    <AskPanelContent
      onClose={onClose}
      isFullscreen={isFullscreen}
      onToggleFullscreen={onToggleFullscreen}
    />
  );
}
