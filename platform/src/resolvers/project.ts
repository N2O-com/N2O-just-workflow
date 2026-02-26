import type { Context } from "../context.js";
import { queryAll, queryOne } from "../db-adapter.js";
import { mapProject, mapSprint } from "./mappers.js";

export { mapProject };

export const projectResolvers = {
  Query: {
    project: async (_: any, args: { id: string }, ctx: Context) => {
      const row = await queryOne(
        ctx.db,
        "SELECT * FROM projects WHERE id = ?",
        [args.id]
      );
      return mapProject(row);
    },

    projects: async (_: any, __: any, ctx: Context) => {
      const rows = await queryAll(
        ctx.db,
        "SELECT * FROM projects ORDER BY name"
      );
      return rows.map(mapProject);
    },
  },

  Project: {
    sprints: async (project: any, args: { status?: string }, ctx: Context) => {
      let sql = `SELECT * FROM sprints WHERE project_id = ?`;
      const params: any[] = [project.id];
      if (args.status) {
        sql += ` AND status = ?`;
        params.push(args.status);
      }
      sql += ` ORDER BY start_at DESC`;
      const rows = await queryAll(ctx.db, sql, params);
      return rows.map(mapSprint);
    },
  },
};
