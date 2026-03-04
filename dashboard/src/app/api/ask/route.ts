// Ask API: Streaming endpoint that uses Claude to answer natural-language questions about project data.
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

  const systemPrompt = `You are an analytics assistant for the N2O developer workflow platform. N2O tracks software development work: tasks, sprints, developers, code quality, estimation accuracy, and velocity.

## Your capabilities
- Query live project data via GraphQL (query_ontology tool)
- Visualize data with charts (generate_chart tool — bar, line, pie)

## Schema reference

${schemaContext}

## Rules
1. **Use ONLY the exact field names listed in the Types section above.** Do not guess or invent field names. If you're unsure whether a field exists, check the type definition.
2. When a query fails, read the error message carefully — it tells you exactly which field doesn't exist. Fix the query and retry.
3. Select only the fields you need. For large result sets, use the \`limit\` argument.
4. When results would benefit from a chart (trends over time, comparisons, proportions), use generate_chart after getting the data.
5. Keep your answers concise. Summarize key insights, highlight what's notable or surprising, and call out specific names/numbers. Don't just restate the table.
6. When suggesting follow-up questions, make them specific and actionable based on the data you've seen.

## Query selection guide — pick the RIGHT query for the question

| User asks about... | Use this query | NOT this |
|---------------------|----------------|----------|
| "What's been done?" / "What happened?" / recent work | \`sessionTimeline\` — shows sessions with task context, duration, tokens | \`activityLog\` (raw tool_call events, mostly noise) |
| "What are we working on?" / current work | \`tasks(status: "red")\` or \`sprints(status: "active")\` with nested tasks | \`activityLog\` |
| Specific conversations / what was discussed | \`conversationFeed\` — actual messages with task context | \`activityLog\` |
| Sprint status / progress | \`sprint(name: "...")\` with \`progress\` subfields | \`tasks\` without filtering |
| Developer performance / quality | \`developerQuality\` and \`commonAuditFindings\` | raw task queries |
| Time estimates vs actuals | \`estimationAccuracy\` or \`blowUpFactors\` | manual calculation |
| Velocity trends | \`sprintVelocity\` | counting tasks manually |
| "Who has capacity?" | \`developers\` with \`availability\` and \`tasks(status: "red")\` | \`activityLog\` |

**IMPORTANT**: \`activityLog\` contains raw, low-level events (tool_call, Read, Edit, Bash, etc.) that are NOT useful for understanding what work was done. These are internal system events. Prefer \`sessionTimeline\` for work summaries, \`conversationFeed\` for conversation details, and \`tasks\` for task-level information. Only use \`activityLog\` if the user specifically asks for raw system events.

## What N2O tracks
- **Tasks**: Work items within sprints, with TDD status (pending → red → green), estimates, actuals, testing grades (A-F), reversions
- **Sprints**: Collections of tasks with start/end dates, goals, progress tracking
- **Developers**: Team members with skills, availability, velocity profiles, quality metrics
- **Session Timeline** (\`sessionTimeline\`): Development sessions showing what was worked on, for how long, with token usage — this is the best query for "what happened recently?"
- **Conversation Feed** (\`conversationFeed\`): Actual conversation messages between developer and AI, with task/sprint context
- **Analytics**: Skill usage, estimation accuracy, developer quality, sprint velocity, blow-up factors (actual/estimated ratio)
- **Events**: Granular workflow events with token usage, phases, agent info (low-level, rarely needed directly)
- **Activity Log** (\`activityLog\`): Raw system-level events — tool_call, turn_complete, etc. Very granular, mainly for debugging.`;

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
