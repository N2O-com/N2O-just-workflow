import type { Context } from "../context.js";
import { queryAll, queryOne } from "../db-adapter.js";
import { mapSprint, mapProject, mapTask } from "./mappers.js";

export const sprintResolvers = {
  Query: {
    sprint: async (_: any, args: { name: string }, ctx: Context) => {
      const row = await queryOne(
        ctx.db,
        "SELECT * FROM sprints WHERE name = ?",
        [args.name]
      );
      return mapSprint(row);
    },

    sprints: async (
      _: any,
      args: { status?: string; projectId?: string },
      ctx: Context
    ) => {
      const conditions: string[] = [];
      const params: any[] = [];

      if (args.status) {
        conditions.push("status = ?");
        params.push(args.status);
      }
      if (args.projectId) {
        conditions.push("project_id = ?");
        params.push(args.projectId);
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const rows = await queryAll(
        ctx.db,
        `SELECT * FROM sprints ${where} ORDER BY start_at DESC`,
        params
      );
      return rows.map(mapSprint);
    },
  },

  Sprint: {
    project: async (sprint: any, _: any, ctx: Context) => {
      if (!sprint.projectId) return null;
      const row = await ctx.loaders.project.load(sprint.projectId);
      return mapProject(row);
    },

    tasks: async (sprint: any, args: { status?: string }, ctx: Context) => {
      let sql = `SELECT * FROM tasks WHERE sprint = ?`;
      const params: any[] = [sprint.name];
      if (args.status) {
        sql += ` AND status = ?`;
        params.push(args.status);
      }
      sql += ` ORDER BY priority ASC NULLS LAST, task_num`;
      const rows = await queryAll(ctx.db, sql, params);
      return rows.map(mapTask);
    },

    progress: async (sprint: any, _: any, ctx: Context) => {
      const row = await queryOne(
        ctx.db,
        "SELECT * FROM sprint_progress WHERE sprint = ?",
        [sprint.name]
      );

      if (!row) {
        return {
          totalTasks: 0,
          pending: 0,
          red: 0,
          green: 0,
          blocked: 0,
          percentComplete: 0,
          remainingMinutes: null,
        };
      }

      const forecast = await queryOne(
        ctx.db,
        "SELECT remaining_minutes FROM sprint_forecast WHERE sprint = ?",
        [sprint.name]
      );

      return {
        totalTasks: parseInt(row.total_tasks),
        pending: parseInt(row.pending),
        red: parseInt(row.red),
        green: parseInt(row.green),
        blocked: parseInt(row.blocked),
        percentComplete: parseFloat(row.percent_complete),
        remainingMinutes: forecast?.remaining_minutes
          ? parseFloat(forecast.remaining_minutes)
          : null,
      };
    },
  },
};
