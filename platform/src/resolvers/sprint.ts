import type { Context } from "../context.js";
import { mapSprint, mapProject, mapTask } from "./mappers.js";

export const sprintResolvers = {
  Query: {
    sprint: (_: any, args: { name: string }, ctx: Context) => {
      const row = ctx.db
        .prepare("SELECT * FROM sprints WHERE name = ?")
        .get(args.name);
      return mapSprint(row);
    },

    sprints: (
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
      return ctx.db
        .prepare(`SELECT * FROM sprints ${where} ORDER BY start_at DESC`)
        .all(...params)
        .map(mapSprint);
    },
  },

  Sprint: {
    project: async (sprint: any, _: any, ctx: Context) => {
      if (!sprint.projectId) return null;
      const row = await ctx.loaders.project.load(sprint.projectId);
      return mapProject(row);
    },

    tasks: (sprint: any, args: { status?: string }, ctx: Context) => {
      let sql = `SELECT * FROM tasks WHERE sprint = ?`;
      const params: any[] = [sprint.name];
      if (args.status) {
        sql += ` AND status = ?`;
        params.push(args.status);
      }
      sql += ` ORDER BY priority ASC NULLS LAST, task_num`;
      return ctx.db.prepare(sql).all(...params).map(mapTask);
    },

    progress: (sprint: any, _: any, ctx: Context) => {
      const row = ctx.db
        .prepare("SELECT * FROM sprint_progress WHERE sprint = ?")
        .get(sprint.name) as any;

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

      const forecast = ctx.db
        .prepare("SELECT remaining_minutes FROM sprint_forecast WHERE sprint = ?")
        .get(sprint.name) as any;

      return {
        totalTasks: row.total_tasks,
        pending: row.pending,
        red: row.red,
        green: row.green,
        blocked: row.blocked,
        percentComplete: row.percent_complete,
        remainingMinutes: forecast?.remaining_minutes ?? null,
      };
    },
  },
};
