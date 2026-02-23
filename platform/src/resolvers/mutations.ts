import type { Context } from "../context.js";

export const mutationResolvers = {
  Mutation: {
    setAvailability: (
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
      ctx.db
        .prepare(
          `INSERT INTO contributor_availability (developer, date, expected_minutes, effectiveness, status, notes)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(developer, date) DO UPDATE SET
             expected_minutes = excluded.expected_minutes,
             effectiveness = COALESCE(excluded.effectiveness, effectiveness),
             status = COALESCE(excluded.status, status),
             notes = COALESCE(excluded.notes, notes)`
        )
        .run(
          args.developer,
          args.date,
          args.expectedMinutes,
          args.effectiveness ?? 1.0,
          args.status ?? "available",
          args.notes ?? null
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

    setSkill: (
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
      ctx.db
        .prepare(
          `INSERT INTO developer_skills (developer, category, skill, rating, source, assessed_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(developer, category, skill) DO UPDATE SET
             rating = excluded.rating,
             source = COALESCE(excluded.source, source),
             assessed_at = CURRENT_TIMESTAMP`
        )
        .run(
          args.developer,
          args.category,
          args.skill,
          args.rating,
          args.source ?? "manager"
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

    recordContext: (
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
      const result = ctx.db
        .prepare(
          `INSERT INTO developer_context (developer, concurrent_sessions, hour_of_day, alertness, environment)
           VALUES (?, ?, ?, ?, ?)
           RETURNING *`
        )
        .get(
          args.developer,
          args.concurrentSessions ?? 1,
          args.hourOfDay ?? new Date().getHours(),
          args.alertness ?? null,
          args.environment ?? null
        ) as any;

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

    logActivity: (
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
      const result = ctx.db
        .prepare(
          `INSERT INTO activity_log (developer, action, sprint, task_num, summary, metadata)
           VALUES (?, ?, ?, ?, ?, ?)
           RETURNING *`
        )
        .get(
          args.developer ?? null,
          args.action,
          args.sprint ?? null,
          args.taskNum ?? null,
          args.summary ?? null,
          args.metadata ?? null
        ) as any;

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
