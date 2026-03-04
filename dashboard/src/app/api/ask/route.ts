import Anthropic from "@anthropic-ai/sdk";
import { getSchemaContext } from "@/lib/ask/schema-context";
import { executeQuery } from "@/lib/ask/execute-query";

const anthropic = new Anthropic();

const QUERY_TOOL: Anthropic.Tool = {
  name: "query_ontology",
  description:
    "Execute a GraphQL query against the N2O data platform API to retrieve developer activity, sprint progress, velocity, quality metrics, and more.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "The GraphQL query to execute",
      },
      variables: {
        type: "object",
        description: "Optional GraphQL variables",
      },
    },
    required: ["query"],
  },
};

const CHART_TOOL: Anthropic.Tool = {
  name: "generate_chart",
  description:
    "Generate a data visualization chart. Use after querying data with query_ontology to present results visually. Choose the chart type based on the data: line for trends over time, bar for comparisons, pie for proportions.",
  input_schema: {
    type: "object" as const,
    properties: {
      type: {
        type: "string",
        enum: ["bar", "line", "pie"],
        description:
          "Chart type: bar for comparisons, line for trends, pie for proportions",
      },
      title: {
        type: "string",
        description: "Chart title displayed above the visualization",
      },
      data: {
        type: "array",
        items: { type: "object" },
        description: "Array of data objects to plot",
      },
      xKey: {
        type: "string",
        description: "Key in data objects for x-axis labels",
      },
      yKey: {
        description:
          "Key(s) in data objects for y-axis values. String for single series, array for multiple.",
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
      },
      colors: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional hex color array for series. Defaults to Palantir theme colors.",
      },
    },
    required: ["type", "title", "data", "xKey", "yKey"],
  },
};

type MessageParam = Anthropic.MessageParam;

export async function POST(request: Request) {
  const body = await request.json();
  const { messages: clientMessages } = body as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (
    !clientMessages ||
    !Array.isArray(clientMessages) ||
    clientMessages.length === 0
  ) {
    return Response.json(
      { error: "messages array is required" },
      { status: 400 }
    );
  }

  // Try to get schema context; fall back to a minimal prompt if platform is down
  let schemaContext: string;
  try {
    schemaContext = await getSchemaContext();
  } catch (err) {
    schemaContext =
      "Schema introspection failed — the data platform may be offline. " +
      "Let the user know you cannot query data right now.";
  }

  const systemPrompt = `You are an analytics assistant for the N2O workflow platform. You have access to a GraphQL API that tracks developer activity, sprint progress, velocity, and quality metrics.

Here is the schema:

${schemaContext}

When a user asks a question about their data, use the query_ontology tool to execute a GraphQL query and get real results. Then summarize the results clearly.

When results would benefit from a visual representation (trends, comparisons, proportions), use the generate_chart tool to create a chart. The chart renders inline in the chat.

Be concise and direct. When relevant, suggest follow-up questions the user could ask.`;

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      }

      try {
        // Build conversation messages — filter out any with empty content
        const messages: MessageParam[] = clientMessages
          .filter((m) => m.content && m.content.trim().length > 0)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

        if (messages.length === 0) {
          send({ type: "error", error: "No valid messages provided" });
          controller.close();
          return;
        }

        // Tool call loop: Claude may call tools multiple times
        let continueLoop = true;
        const MAX_ITERATIONS = 5;
        let iteration = 0;

        while (continueLoop && iteration < MAX_ITERATIONS) {
          iteration++;

          const stream = anthropic.messages.stream({
            model: "claude-sonnet-4-5-20250929",
            max_tokens: 2048,
            system: systemPrompt,
            messages,
            tools: [QUERY_TOOL, CHART_TOOL],
          });

          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              send({ type: "text_delta", content: event.delta.text });
            }
          }

          const finalMessage = await stream.finalMessage();

          if (finalMessage.stop_reason === "tool_use") {
            const toolUseBlocks = finalMessage.content.filter(
              (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
            );

            // Add assistant response to conversation
            messages.push({
              role: "assistant",
              content: finalMessage.content,
            });

            // Execute each tool call and add results
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const toolUse of toolUseBlocks) {
              if (toolUse.name === "query_ontology") {
                const input = toolUse.input as {
                  query: string;
                  variables?: Record<string, unknown>;
                };

                const result = await executeQuery(
                  input.query,
                  input.variables
                );

                send({
                  type: "tool_call",
                  name: toolUse.name,
                  tool_use_id: toolUse.id,
                  input: input,
                  result: result,
                });

                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: JSON.stringify(result),
                });
              } else if (toolUse.name === "generate_chart") {
                send({
                  type: "tool_call",
                  name: toolUse.name,
                  tool_use_id: toolUse.id,
                  input: toolUse.input,
                  result: { rendered: true },
                });

                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: "Chart rendered successfully.",
                });
              }
            }

            // Add tool results to conversation
            messages.push({ role: "user", content: toolResults });
          } else {
            // No more tool calls — done
            continueLoop = false;
            send({ type: "done", stop_reason: finalMessage.stop_reason });
          }
        }

        if (iteration >= MAX_ITERATIONS) {
          send({
            type: "text_delta",
            content:
              "\n\n(Stopped after too many tool calls. Please try a simpler question.)",
          });
          send({ type: "done", stop_reason: "max_iterations" });
        }

        controller.close();
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        send({ type: "error", error: msg });
        // Also send as text so the user sees it in the chat
        send({
          type: "text_delta",
          content: `Sorry, something went wrong: ${msg}`,
        });
        send({ type: "done", stop_reason: "error" });
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
