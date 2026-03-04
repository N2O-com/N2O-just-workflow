"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
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
  useThread,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from "@assistant-ui/react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { askAdapter } from "@/lib/ask/chat-adapter";
import { useQueryOntologyToolUI } from "@/components/ask-tool-ui";
import { useGenerateChartToolUI } from "@/components/ask-chart-ui";
import {
  getChats,
  getChat,
  createChat,
  updateChat,
  titleFromMessage,
  type ChatEntry,
} from "@/lib/ask/chat-store";

function ToolRegistration() {
  useQueryOntologyToolUI();
  useGenerateChartToolUI();
  return null;
}

/** Persist chat messages to localStorage whenever the thread updates.
 *  Lazily creates the chat entry on the first real message. */
function ChatPersistence({
  chatId,
  onChatCreated,
}: {
  chatId: string | null;
  onChatCreated: (id: string) => void;
}) {
  const thread = useThread();
  const createdRef = useRef<string | null>(chatId);

  // Keep ref in sync when chatId prop changes (e.g. selecting a past chat)
  useEffect(() => {
    createdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    if (!thread.messages || thread.messages.length === 0) return;
    if (thread.isRunning) return;

    const messages = thread.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content:
          m.content
            ?.filter(
              (p: { type: string }) => p.type === "text"
            )
            .map((p: { type: string; text?: string }) => p.text ?? "")
            .join("") ?? "",
      }))
      .filter((m) => m.content.length > 0);

    if (messages.length === 0) return;

    // Lazily create the chat entry on first message
    let id = createdRef.current;
    if (!id) {
      const chat = createChat();
      id = chat.id;
      createdRef.current = id;
      onChatCreated(id);
    }

    const title = titleFromMessage(messages[0].content);
    updateChat(id, { title, messages });
  }, [thread.messages, thread.isRunning, onChatCreated]);

  return null;
}

function UserMessage() {
  return (
    <div className="flex justify-end mb-3">
      <div className="max-w-[85%] rounded-md bg-primary/15 px-3 py-2 text-sm text-foreground">
        <MessagePrimitive.Content components={{ Text: MarkdownText }} />
      </div>
    </div>
  );
}

function AssistantMessage() {
  return (
    <div className="mb-3">
      <div className="max-w-[85%] rounded-md px-3 py-2 text-sm text-foreground/90">
        <MessagePrimitive.Content components={{ Text: MarkdownText }} />
      </div>
    </div>
  );
}

/** Thread used in sidebar panel mode (compact) */
function AskThread() {
  return (
    <ThreadPrimitive.Root className="flex flex-col h-full min-h-0">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-3 py-4 min-h-0">
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
          components={{ UserMessage, AssistantMessage }}
        />
      </ThreadPrimitive.Viewport>
      <div className="border-t border-border p-3 flex-shrink-0">
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

/** Thread used in fullscreen page mode (centered, wider) */
function FullscreenThread() {
  return (
    <ThreadPrimitive.Root className="flex flex-col h-full min-h-0">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto min-h-0">
        <div className="mx-auto max-w-2xl px-4 py-8">
          <ThreadPrimitive.Empty>
            <div className="flex flex-col items-center justify-center pt-32 text-muted-foreground gap-4">
              <h1 className="text-xl font-medium text-foreground">
                Hi, how can I help?
              </h1>
              <div className="flex flex-col gap-2 w-full max-w-md">
                {[
                  "How\u2019s the current sprint going?",
                  "Show me developer quality metrics",
                  "What tasks are blocked right now?",
                ].map((q) => (
                  <div
                    key={q}
                    className="rounded-md border border-border px-4 py-2.5 text-sm text-foreground/80 hover:bg-secondary cursor-default"
                  >
                    {q}
                  </div>
                ))}
              </div>
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages
            components={{ UserMessage, AssistantMessage }}
          />
        </div>
      </ThreadPrimitive.Viewport>
      <div className="border-t border-border flex-shrink-0">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <ComposerPrimitive.Root className="flex items-end gap-2">
            <ComposerPrimitive.Input
              placeholder="Ask a question"
              className="flex-1 resize-none rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
            <ComposerPrimitive.Send className="rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              Send
            </ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </div>
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
  onSelectChat,
  onFullscreen,
  onMinimize,
  isFullscreen,
}: {
  onClose: () => void;
  onNewChat: () => void;
  onSelectChat: (chat: ChatEntry) => void;
  onFullscreen: () => void;
  onMinimize: () => void;
  isFullscreen: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);

  const handleSelectChat = useCallback(
    (chat: ChatEntry) => {
      onSelectChat(chat);
    },
    [onSelectChat]
  );

  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2.5 flex-shrink-0">
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
        {isFullscreen ? (
          <button
            onClick={onMinimize}
            title="Minimize to panel"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Minimize2 size={15} />
          </button>
        ) : (
          <button
            onClick={onFullscreen}
            title="Open fullscreen"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Maximize2 size={15} />
          </button>
        )}
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

// ── Ask Content (used by Shell in both panel and fullscreen modes) ────

export function AskContent({
  mode,
  onClose,
  onNewChat,
  onSelectChat,
  onFullscreen,
  onMinimize,
}: {
  mode: "panel" | "fullscreen";
  onClose: () => void;
  onNewChat: () => void;
  onSelectChat: (chat: ChatEntry) => void;
  onFullscreen: () => void;
  onMinimize: () => void;
}) {
  const isFullscreen = mode === "fullscreen";

  return (
    <div
      className={`flex h-full w-full flex-col bg-background min-h-0 ${
        !isFullscreen ? "border-l border-border" : ""
      }`}
    >
      <PanelHeader
        onClose={onClose}
        onNewChat={onNewChat}
        onSelectChat={onSelectChat}
        onFullscreen={onFullscreen}
        onMinimize={onMinimize}
        isFullscreen={isFullscreen}
      />
      {isFullscreen ? <FullscreenThread /> : <AskThread />}
    </div>
  );
}

// ── Runtime Provider (wraps content, owned by Shell) ─────────────────

export function AskRuntimeProvider({
  chatId,
  children,
}: {
  chatId: string | null;
  children: React.ReactNode;
}) {
  const initialMessages = useMemo(() => {
    if (!chatId) return undefined;
    const chat = getChat(chatId);
    if (!chat || chat.messages.length === 0) return undefined;
    return chat.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
  }, [chatId]);

  const runtime = useLocalRuntime(askAdapter, { initialMessages });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ToolRegistration />
      <ChatPersistence chatId={chatId} />
      {children}
    </AssistantRuntimeProvider>
  );
}

// ── Legacy exports for backward compat (not used by new Shell) ───────

export function AskPanel({
  open,
  onClose,
  onFullscreen,
}: {
  open: boolean;
  onClose: () => void;
  onFullscreen: () => void;
}) {
  if (!open) return null;
  return (
    <AskRuntimeProvider chatId={null}>
      <AskContent
        mode="panel"
        onClose={onClose}
        onNewChat={() => {}}
        onSelectChat={() => {}}
        onFullscreen={onFullscreen}
        onMinimize={onClose}
      />
    </AskRuntimeProvider>
  );
}

export function AskFullscreenPage({
  onClose,
  onMinimize,
}: {
  onClose: () => void;
  onMinimize: () => void;
}) {
  return (
    <AskRuntimeProvider chatId={null}>
      <AskContent
        mode="fullscreen"
        onClose={onClose}
        onNewChat={() => {}}
        onSelectChat={() => {}}
        onFullscreen={() => {}}
        onMinimize={onMinimize}
      />
    </AskRuntimeProvider>
  );
}
