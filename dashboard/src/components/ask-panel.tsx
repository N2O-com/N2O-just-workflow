"use client";

import { X } from "lucide-react";
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
        <MessagePrimitive.Content
          components={{ Text: TextPart }}
        />
      </div>
    </div>
  );
}

function AssistantMessage() {
  return (
    <div className="mb-3">
      <div className="max-w-[85%] rounded-md px-3 py-2 text-sm text-foreground/90">
        <MessagePrimitive.Content
          components={{ Text: TextPart }}
        />
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

function AskPanelContent({ onClose }: { onClose: () => void }) {
  const runtime = useLocalRuntime(askAdapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ToolRegistration />
      <div className="flex h-screen w-[350px] flex-col border-l border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">Ask N2O</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
        <AskThread />
      </div>
    </AssistantRuntimeProvider>
  );
}

export function AskPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <AskPanelContent onClose={onClose} />;
}
