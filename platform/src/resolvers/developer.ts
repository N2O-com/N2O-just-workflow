import type { Context } from "../context.js";
import { mapDeveloper, mapTask } from "./mappers.js";

export { mapDeveloper };

export const developerResolvers = {
  Query: {
    developer: (_: any, args: { name: string }, ctx: Context) => {
      const row = ctx.db
        .prepare("SELECT * FROM developers WHERE name = ?")
        .get(args.name);
      return mapDeveloper(row);
    },

    developers: (_: any, __: any, ctx: Context) => {
      return ctx.db
        .prepare("SELECT * FROM developers ORDER BY name")
        .all()
        .map(mapDeveloper);
    },
  },

  Developer: {
    skills: (dev: any, _: any, ctx: Context) => {
      return ctx.db
        .prepare(
          `SELECT * FROM developer_skills WHERE developer = ? ORDER BY category, skill`
        )
        .all(dev.name)
        .map((row: any) => ({
          developer: row.developer,
          category: row.category,
          skill: row.skill,
          rating: row.rating,
          source: row.source,
          evidence: row.evidence,
          assessedAt: row.assessed_at,
        }));
    },

    tasks: (
      dev: any,
      args: { status?: string; sprint?: string },
      ctx: Context
    ) => {
      const conditions = ["owner = ?"];
      const params: any[] = [dev.name];

      if (args.status) {
        conditions.push("status = ?");
        params.push(args.status);
      }
      if (args.sprint) {
        conditions.push("sprint = ?");
        params.push(args.sprint);
      }

      return ctx.db
        .prepare(
          `SELECT * FROM tasks WHERE ${conditions.join(" AND ")} ORDER BY sprint, task_num`
        )
        .all(...params)
        .map(mapTask);
    },

    availability: (dev: any, args: { date?: string }, ctx: Context) => {
      const date = args.date ?? new Date().toISOString().split("T")[0];
      const row = ctx.db
        .prepare(
          `SELECT * FROM contributor_availability WHERE developer = ? AND date = ?`
        )
        .get(dev.name, date) as any;

      if (!row) return null;
      return {
        developer: row.developer,
        date: row.date,
        expectedMinutes: row.expected_minutes,
        effectiveness: row.effectiveness,
        status: row.status,
        notes: row.notes,
      };
    },

    context: (dev: any, args: { latest?: boolean }, ctx: Context) => {
      const limit = args.latest ? "LIMIT 1" : "LIMIT 20";
      return ctx.db
        .prepare(
          `SELECT * FROM developer_context WHERE developer = ? ORDER BY recorded_at DESC ${limit}`
        )
        .all(dev.name)
        .map((row: any) => ({
          id: row.id,
          developer: row.developer,
          recordedAt: row.recorded_at,
          concurrentSessions: row.concurrent_sessions,
          hourOfDay: row.hour_of_day,
          alertness: row.alertness,
          environment: row.environment,
          notes: row.notes,
        }));
    },

    velocity: (dev: any, _: any, ctx: Context) => {
      const row = ctx.db
        .prepare(
          `SELECT
            ROUND(AVG(actual_minutes)) as avg_minutes,
            ROUND(AVG(blow_up_ratio), 2) as blow_up_ratio,
            COUNT(*) as total
           FROM effective_velocity
           WHERE owner = ?`
        )
        .get(dev.name) as any;

      if (!row || row.total === 0) {
        // Fall back to basic velocity view
        const basic = ctx.db
          .prepare(
            `SELECT avg_hours, completed_tasks FROM developer_velocity WHERE owner = ?`
          )
          .get(dev.name) as any;

        if (!basic) {
          return { avgMinutes: null, blowUpRatio: null, totalTasksCompleted: 0 };
        }
        return {
          avgMinutes: basic.avg_hours ? basic.avg_hours * 60 : null,
          blowUpRatio: null,
          totalTasksCompleted: basic.completed_tasks ?? 0,
        };
      }

      return {
        avgMinutes: row.avg_minutes,
        blowUpRatio: row.blow_up_ratio,
        totalTasksCompleted: row.total,
      };
    },
  },
};
