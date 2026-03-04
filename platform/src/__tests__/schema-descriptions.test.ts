import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ApolloServer } from "@apollo/server";
import { typeDefs } from "../schema/typeDefs.js";
import { resolvers } from "../resolvers/index.js";
import { createTestDb, seedTestData } from "./test-helpers.js";
import type { Context } from "../context.js";
import type Database from "better-sqlite3";
import { createLoaders } from "../loaders.js";

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

function executeQuery(query: string, variables?: Record<string, any>) {
  return server.executeOperation(
    { query, variables },
    { contextValue: { db, loaders: createLoaders(db) } }
  );
}

// ── Schema Description Tests ──────────────────────────────

describe("GraphQL schema descriptions", () => {
  let queryFields: Array<{ name: string; description: string | null }>;

  beforeAll(async () => {
    const res = await executeQuery(`
      query IntrospectQueryFields {
        __type(name: "Query") {
          fields {
            name
            description
          }
        }
      }
    `);
    const data = (res.body as any).singleResult.data;
    queryFields = data.__type.fields;
  });

  it("returns descriptions for all Query fields via introspection", () => {
    const fieldsWithoutDescription = queryFields.filter(
      (f) => !f.description || f.description.trim() === ""
    );
    expect(fieldsWithoutDescription).toEqual([]);
  });

  it("core entity queries have descriptions explaining their purpose", () => {
    const taskField = queryFields.find((f) => f.name === "task");
    expect(taskField?.description).toMatch(/single task.*sprint/i);

    const tasksField = queryFields.find((f) => f.name === "tasks");
    expect(tasksField?.description).toMatch(/list.*tasks.*filter/i);

    const developersField = queryFields.find((f) => f.name === "developers");
    expect(developersField?.description).toMatch(/developer/i);

    const sprintsField = queryFields.find((f) => f.name === "sprints");
    expect(sprintsField?.description).toMatch(/sprint/i);
  });

  it("analytics queries describe the metrics they return", () => {
    const checks: Record<string, RegExp> = {
      skillUsage: /usage|frequency|invocation/i,
      developerQuality: /quality|reversion|A-grade/i,
      commonAuditFindings: /audit|finding|fake test|violation/i,
      blowUpFactors: /exceed|blow.?up|estimate/i,
      estimationAccuracy: /estimation|accuracy|estimated.*actual/i,
      sprintVelocity: /velocity|completed|hours|minutes/i,
      sessionTimeline: /timeline|session|gantt/i,
    };

    for (const [queryName, pattern] of Object.entries(checks)) {
      const field = queryFields.find((f) => f.name === queryName);
      expect(field, `Missing field: ${queryName}`).toBeDefined();
      expect(field?.description).toMatch(pattern);
    }
  });

  it("descriptions are meaningful, not just field names repeated", () => {
    const developerQuality = queryFields.find(
      (f) => f.name === "developerQuality"
    );
    expect(developerQuality?.description?.length).toBeGreaterThan(20);
    expect(developerQuality?.description).not.toBe("developerQuality");
    expect(developerQuality?.description).toMatch(/reversion.*A-grade|A-grade.*reversion/i);

    const blowUp = queryFields.find((f) => f.name === "blowUpFactors");
    expect(blowUp?.description?.length).toBeGreaterThan(20);
    expect(blowUp?.description).toMatch(/exceed|blow.?up/i);
  });
});
