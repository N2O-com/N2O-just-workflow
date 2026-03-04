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
        description: "Chart type: bar for comparisons, line for trends, pie for proportions",
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
        description: "Key(s) in data objects for y-axis values. String for single series, array for multiple.",
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
      },
      colors: {
        type: "array",
        items: { type: "string" },
        description: "Optional hex color array for series. Defaults to Palantir theme colors.",
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

  const schemaContext = await getSchemaContext();

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
        // Build conversation messages
        const messages: MessageParam[] = clientMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        // Tool call loop: Claude may call tools multiple times
        let continueLoop = true;
        while (continueLoop) {
          const stream = anthropic.messages.stream({
            model: "claude-sonnet-4-5-20250929",
            max_tokens: 2048,
            system: systemPrompt,
            messages,
            tools: [QUERY_TOOL, CHART_TOOL],
          });

          // Collect the full response for tool call handling
          const assistantBlocks: Anthropic.ContentBlock[] = [];

          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              send({ type: "text_delta", content: event.delta.text });
            }
          }

          const finalMessage = await stream.finalMessage();
          assistantBlocks.push(...finalMessage.content);

          if (finalMessage.stop_reason === "tool_use") {
            // Find tool use blocks
            const toolUseBlocks = finalMessage.content.filter(
              (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
            );

            // Add assistant response to conversation
            messages.push({ role: "assistant", content: finalMessage.content });

            // Execute each tool call and add results
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const toolUse of toolUseBlocks) {
              if (toolUse.name === "query_ontology") {
                const input = toolUse.input as {
                  query: string;
                  variables?: Record<string, unknown>;
                };

                const result = await executeQuery(input.query, input.variables);

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
                // Chart tool: data comes from the LLM, render on client
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

            // Continue loop — Claude will process tool results
          } else {
            // No more tool calls — we're done
            continueLoop = false;
            send({ type: "done", stop_reason: finalMessage.stop_reason });
          }
        }

        controller.close();
      } catch (error) {
        send({
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
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
