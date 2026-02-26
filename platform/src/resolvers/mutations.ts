import type { Context } from "../context.js";
import { queryOne } from "../db-adapter.js";

export const mutationResolvers = {
  Mutation: {
    setAvailability: async (
      _: any,
      args: {
        developer: string;
        date: string;
        expectedMinutes: number;
        effectiveness?: number;
        status?: string;
        notes?: string;
      },
      ctx: Context
    ) => {
      await ctx.db.query(
        `INSERT INTO contributor_availability (developer, date, expected_minutes, effectiveness, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT(developer, date) DO UPDATE SET
           expected_minutes = excluded.expected_minutes,
           effectiveness = COALESCE(excluded.effectiveness, contributor_availability.effectiveness),
           status = COALESCE(excluded.status, contributor_availability.status),
           notes = COALESCE(excluded.notes, contributor_availability.notes)`,
        [
          args.developer,
          args.date,
          args.expectedMinutes,
          args.effectiveness ?? 1.0,
          args.status ?? "available",
          args.notes ?? null,
        ]
      );

      return {
        developer: args.developer,
        date: args.date,
        expectedMinutes: args.expectedMinutes,
        effectiveness: args.effectiveness ?? 1.0,
        status: args.status ?? "available",
        notes: args.notes ?? null,
      };
    },

    setSkill: async (
      _: any,
      args: {
        developer: string;
        category: string;
        skill: string;
        rating: number;
        source?: string;
      },
      ctx: Context
    ) => {
      await ctx.db.query(
        `INSERT INTO developer_skills (developer, category, skill, rating, source, assessed_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT(developer, category, skill) DO UPDATE SET
           rating = excluded.rating,
           source = COALESCE(excluded.source, developer_skills.source),
           assessed_at = NOW()`,
        [
          args.developer,
          args.category,
          args.skill,
          args.rating,
          args.source ?? "manager",
        ]
      );

      return {
        developer: args.developer,
        category: args.category,
        skill: args.skill,
        rating: args.rating,
        source: args.source ?? "manager",
        assessedAt: new Date().toISOString(),
      };
    },

    recordContext: async (
      _: any,
      args: {
        developer: string;
        concurrentSessions?: number;
        hourOfDay?: number;
        alertness?: number;
        environment?: string;
      },
      ctx: Context
    ) => {
      const { rows } = await ctx.db.query(
        `INSERT INTO developer_context (developer, concurrent_sessions, hour_of_day, alertness, environment)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          args.developer,
          args.concurrentSessions ?? 1,
          args.hourOfDay ?? new Date().getHours(),
          args.alertness ?? null,
          args.environment ?? null,
        ]
      );
      const result = rows[0];

      return {
        id: result.id,
        developer: result.developer,
        recordedAt: result.recorded_at,
        concurrentSessions: result.concurrent_sessions,
        hourOfDay: result.hour_of_day,
        alertness: result.alertness,
        environment: result.environment,
        notes: result.notes,
      };
    },

    logActivity: async (
      _: any,
      args: {
        developer?: string;
        action: string;
        sprint?: string;
        taskNum?: number;
        summary?: string;
        metadata?: string;
      },
      ctx: Context
    ) => {
      const { rows } = await ctx.db.query(
        `INSERT INTO activity_log (developer, action, sprint, task_num, summary, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          args.developer ?? null,
          args.action,
          args.sprint ?? null,
          args.taskNum ?? null,
          args.summary ?? null,
          args.metadata ?? null,
        ]
      );
      const result = rows[0];

      return {
        id: result.id,
        timestamp: result.timestamp,
        developer: result.developer,
        action: result.action,
        sprint: result.sprint,
        taskNum: result.task_num,
        summary: result.summary,
        metadata: result.metadata,
      };
    },
  },
};
