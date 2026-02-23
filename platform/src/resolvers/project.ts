import type { Context } from "../context.js";
import { mapProject, mapSprint } from "./mappers.js";

export { mapProject };

export const projectResolvers = {
  Query: {
    project: (_: any, args: { id: string }, ctx: Context) => {
      const row = ctx.db
        .prepare("SELECT * FROM projects WHERE id = ?")
        .get(args.id);
      return mapProject(row);
    },

    projects: (_: any, __: any, ctx: Context) => {
      return ctx.db
        .prepare("SELECT * FROM projects ORDER BY name")
        .all()
        .map(mapProject);
    },
  },

  Project: {
    sprints: (project: any, args: { status?: string }, ctx: Context) => {
      let sql = `SELECT * FROM sprints WHERE project_id = ?`;
      const params: any[] = [project.id];
      if (args.status) {
        sql += ` AND status = ?`;
        params.push(args.status);
      }
      sql += ` ORDER BY start_at DESC`;
      return ctx.db
        .prepare(sql)
        .all(...params)
        .map(mapSprint);
    },
  },
};
