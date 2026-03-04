import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ApolloServer } from "@apollo/server";
import { typeDefs } from "../schema/typeDefs.js";
import { resolvers } from "../resolvers/index.js";
import { createTestDb, seedTestData } from "./test-helpers.js";
import type { Context } from "../context.js";
import type Database from "better-sqlite3";
import { createLoaders } from "../loaders.js";
import { buildSchemaContext } from "../schema-context.js";

let db: Database.Database;
let server: ApolloServer<Context>;

beforeAll(() => {
  db = createTestDb();
  seedTestData(db);
  server = new ApolloServer<Context>({ typeDefs, resolvers });
});

afterAll(() => {
  db.close();
});

async function introspect() {
  const INTROSPECTION_QUERY = `
    query IntrospectionQuery {
      __schema {
        queryType {
          fields {
            name
            description
            args {
              name
              type {
                name
                kind
                ofType { name kind }
              }
            }
            type {
              name
              kind
              ofType {
                name
                kind
                ofType {
                  name
                  kind
                  ofType { name kind }
                }
              }
            }
          }
        }
      }
    }
  `;
  const res = await server.executeOperation(
    { query: INTROSPECTION_QUERY },
    { contextValue: { db, loaders: createLoaders(db) } }
  );
  return (res.body as any).singleResult.data.__schema.queryType.fields;
}

describe("buildSchemaContext", () => {
  let context: string;

  beforeAll(async () => {
    const fields = await introspect();
    context = buildSchemaContext(fields);
  });

  it("includes all core entity queries with parameter signatures", () => {
    expect(context).toContain("task(sprint: String!, taskNum: Int!): Task");
    expect(context).toContain("tasks(sprint: String, status: String");
    expect(context).toContain("developers:");
    expect(context).toContain("sprints(status: String");
    expect(context).toContain("projects:");
    // Verify return types include the entity names
    const tasksLine = context.split("\n").find((l) => l.trimStart().startsWith("tasks("));
    expect(tasksLine).toContain("Task");
    const devsLine = context.split("\n").find((l) => l.trimStart().startsWith("developers"));
    expect(devsLine).toContain("Developer");
  });

  it("includes analytics queries with their descriptions", () => {
    expect(context).toMatch(/skillUsage.*invocation|frequency/i);
    expect(context).toMatch(/developerQuality.*quality|reversion/i);
    expect(context).toMatch(/commonAuditFindings.*audit|finding/i);
    expect(context).toMatch(/blowUpFactors.*exceed|blow/i);
    expect(context).toMatch(/estimationAccuracy.*estimation|accuracy/i);
    expect(context).toMatch(/sprintVelocity.*velocity|completed/i);
    expect(context).toMatch(/sessionTimeline.*timeline|session/i);
  });

  it("formats required parameters with ! suffix and optional without", () => {
    // task has required params
    expect(context).toMatch(/task\(sprint: String!, taskNum: Int!\)/);
    // developerQuality has optional params
    expect(context).toMatch(/developerQuality\(owner: String, dateFrom: String, dateTo: String\)/);
  });

  it("formats return types correctly for scalars, lists, and non-null", () => {
    // Nullable single: task returns Task (nullable)
    const taskLine = context.split("\n").find((l) => l.trimStart().startsWith("task("));
    expect(taskLine).toContain(": Task");
    expect(taskLine).not.toContain("["); // Not a list
    // Non-null scalar: dataHealth returns DataHealth!
    expect(context).toContain("dataHealth: DataHealth!");
    // List return type for tasks
    const tasksLine = context.split("\n").find((l) => l.trimStart().startsWith("tasks("));
    expect(tasksLine).toContain("[Task]");
  });

  it("groups queries under the correct category headers", () => {
    const lines = context.split("\n");
    function findSection(header: string): string[] {
      const start = lines.findIndex((l) => l === `## ${header}`);
      if (start === -1) return [];
      const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
      return lines.slice(start, end === -1 ? undefined : end);
    }

    const tasks = findSection("Tasks").join("\n");
    expect(tasks).toContain("task(");
    expect(tasks).toContain("tasks(");
    expect(tasks).toContain("availableTasks");
    expect(tasks).not.toContain("skillUsage");

    const quality = findSection("Analytics — Quality").join("\n");
    expect(quality).toContain("developerQuality");
    expect(quality).toContain("commonAuditFindings");
    expect(quality).not.toContain("tasks(");

    const velocity = findSection("Analytics — Velocity").join("\n");
    expect(velocity).toContain("blowUpFactors");
    expect(velocity).toContain("developerLearningRate");
  });

  it("includes example queries with valid GraphQL field selections", () => {
    expect(context).toContain("## Example Queries");
    // Verify actual example query structure
    expect(context).toContain('tasks(sprint: "my-sprint")');
    expect(context).toContain("taskNum title status type");
    expect(context).toContain("owner { name role }");
    expect(context).toContain("developerQuality { owner totalTasks totalReversions aGradePct }");
    expect(context).toContain("sprintVelocity { sprint completedTasks");
  });

  it("is concise enough for LLM context but not truncated", () => {
    // Must fit in system prompt alongside instructions
    expect(context.length).toBeLessThan(6000);
    // But should include enough content to be useful (all 30+ queries + examples)
    expect(context.length).toBeGreaterThan(1500);
  });

  it("descriptions propagate from schema introspection into output", () => {
    // Descriptions from typeDefs should appear after the em-dash
    expect(context).toMatch(/developerQuality\(.*\).*—.*quality.*reversion/i);
    expect(context).toMatch(/blowUpFactors\(.*\).*—.*exceed/i);
    expect(context).toMatch(/sessionTimeline\(.*\).*—.*timeline.*gantt/i);
  });
});
