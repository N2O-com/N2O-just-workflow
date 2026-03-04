import type { ChatModelAdapter } from "@assistant-ui/react";

// Use `any` for the accumulated parts array to avoid deep readonly type conflicts
// with assistant-ui's ThreadAssistantMessagePart. The runtime validates at render time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Part = any;

export const askAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages.map((m) => ({
          role: m.role,
          content:
            m.content
              ?.filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("") ?? "",
        })),
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      yield {
        content: [
          {
            type: "text" as const,
            text: `Error: API returned ${response.status}. Please try again.`,
          },
        ],
      };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    // Accumulate content parts across the entire stream (including tool call loops)
    const finalized: Part[] = [];
    let currentText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        if (event.type === "text_delta") {
          currentText += event.content;
          yield {
            content: [
              ...finalized,
              { type: "text" as const, text: currentText },
            ],
          };
        } else if (event.type === "tool_call") {
          if (currentText) {
            finalized.push({ type: "text" as const, text: currentText });
            currentText = "";
          }
          finalized.push({
            type: "tool-call" as const,
            toolCallId: event.tool_use_id as string,
            toolName: event.name as string,
            args: event.input as Record<string, unknown>,
            argsText: JSON.stringify(event.input),
            result: event.result,
          });
          yield { content: [...finalized] };
        }
      }
    }

    // Final yield with everything accumulated
    if (currentText) {
      finalized.push({ type: "text" as const, text: currentText });
    }
    if (finalized.length > 0) {
      yield { content: [...finalized] };
    }
  },
};
