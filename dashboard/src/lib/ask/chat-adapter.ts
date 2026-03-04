import type { ChatModelAdapter } from "@assistant-ui/react";

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
      throw new Error(`Ask API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);

        if (event.type === "text_delta") {
          yield { content: [{ type: "text" as const, text: event.content }] };
        } else if (event.type === "tool_call") {
          yield {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: event.tool_use_id,
                toolName: event.name,
                args: event.input,
                argsText: JSON.stringify(event.input),
                result: event.result,
              },
            ],
          };
        }
      }
    }
  },
};
