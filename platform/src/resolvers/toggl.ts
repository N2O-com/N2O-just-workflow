// Toggl GraphQL resolvers — live API calls with rate limiting and caching.
// Replaces the stale pre-synced resolver with direct Toggl API access.
import type { Context } from "../context.js";
import { queryAll, queryOne } from "../db-adapter.js";
import {
  fetchToggl,
  cacheGet,
  cacheSet,
  getToken,
  TOGGL_API_BASE,
  TOGGL_REPORTS_BASE,
} from "../services/toggl-api.js";

const ONE_HOUR = 60 * 60 * 1000;
const FOUR_MIN = 4 * 60 * 1000;

// Cached workspace ID — fetched once then reused.
let cachedWorkspaceId: number | null = null;

async function getWorkspaceId(token: string): Promise<number> {
  if (cachedWorkspaceId) return cachedWorkspaceId;
  const workspaces = await fetchToggl(`${TOGGL_API_BASE}/workspaces`, token);
  if (!workspaces?.length) throw new Error("No Toggl workspaces found");
  const id: number = workspaces[0].id;
  cachedWorkspaceId = id;
  return id;
}

export const togglResolvers = {
  Query: {
    togglMe: async () => {
      const token = getToken();
      const cacheKey = "toggl:me";
      const cached = cacheGet(cacheKey, ONE_HOUR);
      if (cached) return cached;

      const me = await fetchToggl(`${TOGGL_API_BASE}/me`, token);
      const result = { id: me.id, fullname: me.fullname, email: me.email };
      cacheSet(cacheKey, result);
      return result;
    },

    togglWorkspace: async () => {
      const token = getToken();
      const cacheKey = "toggl:workspace";
      const cached = cacheGet(cacheKey, ONE_HOUR);
      if (cached) return cached;

      const workspaces = await fetchToggl(`${TOGGL_API_BASE}/workspaces`, token);
      if (!workspaces?.length) return null;
      const ws = workspaces[0];
      const result = { id: ws.id, name: ws.name };
      cacheSet(cacheKey, result);
      cachedWorkspaceId = ws.id;
      return result;
    },

    togglMembers: async (_: any, __: any, ctx: Context) => {
      const rows = await queryAll(
        ctx.db,
        `SELECT id, toggl_name, email, role, active FROM toggl_members ORDER BY role, toggl_name`
      );
      return rows.map((r: any) => ({
        id: r.id,
        togglName: r.toggl_name,
        email: r.email,
        role: r.role,
        active: !!r.active,
      }));
    },

    togglTimeEntries: async (_: any, args: { startDate: string; endDate: string }) => {
      const token = getToken();
      const wsId = await getWorkspaceId(token);
      const cacheKey = `toggl:entries:${args.startDate}:${args.endDate}`;
      const cached = cacheGet(cacheKey, FOUR_MIN);
      if (cached) return cached;

      const data = await fetchToggl(
        `${TOGGL_REPORTS_BASE}/workspace/${wsId}/search/time_entries`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            start_date: args.startDate,
            end_date: args.endDate,
          }),
        }
      );

      // Flatten paginated response — Reports API returns array of arrays
      const entries = (Array.isArray(data) ? data : []).flat().map((e: any) => ({
        id: e.id,
        description: e.description || "",
        start: e.start,
        stop: e.stop,
        seconds: e.time_entries?.[0]?.seconds ?? e.dur ?? 0,
        projectId: e.project_id,
        tagIds: e.tag_ids || [],
        userId: e.user_id,
      }));

      cacheSet(cacheKey, entries);
      return entries;
    },

    togglProjects: async () => {
      const token = getToken();
      const wsId = await getWorkspaceId(token);
      const cacheKey = "toggl:projects";
      const cached = cacheGet(cacheKey, ONE_HOUR);
      if (cached) return cached;

      const projects = await fetchToggl(
        `${TOGGL_API_BASE}/workspaces/${wsId}/projects`,
        token
      );
      const result = (projects || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        clientId: p.client_id,
        color: p.color,
        active: p.active,
      }));
      cacheSet(cacheKey, result);
      return result;
    },

    togglClients: async () => {
      const token = getToken();
      const wsId = await getWorkspaceId(token);
      const cacheKey = "toggl:clients";
      const cached = cacheGet(cacheKey, ONE_HOUR);
      if (cached) return cached;

      const clients = await fetchToggl(
        `${TOGGL_API_BASE}/workspaces/${wsId}/clients`,
        token
      );
      const result = (clients || []).map((c: any) => ({
        id: c.id,
        name: c.name,
      }));
      cacheSet(cacheKey, result);
      return result;
    },

    togglTags: async () => {
      const token = getToken();
      const wsId = await getWorkspaceId(token);
      const cacheKey = "toggl:tags";
      const cached = cacheGet(cacheKey, ONE_HOUR);
      if (cached) return cached;

      const tags = await fetchToggl(
        `${TOGGL_API_BASE}/workspaces/${wsId}/tags`,
        token
      );
      const result = (tags || []).map((t: any) => ({
        id: t.id,
        name: t.name,
      }));
      cacheSet(cacheKey, result);
      return result;
    },

    togglCurrentTimer: async () => {
      const token = getToken();
      // No cache — always fetch fresh for current timer
      const entry = await fetchToggl(
        `${TOGGL_API_BASE}/me/time_entries/current`,
        token
      );
      if (!entry) return null;
      return {
        description: entry.description,
        start: entry.start,
        duration: entry.duration,
        projectId: entry.project_id,
      };
    },

    togglDashboardActivity: async () => {
      const token = getToken();
      const wsId = await getWorkspaceId(token);
      const cacheKey = "toggl:dashboard_activity";
      const cached = cacheGet(cacheKey, FOUR_MIN);
      if (cached) return cached;

      const activity = await fetchToggl(
        `${TOGGL_API_BASE}/workspaces/${wsId}/dashboard/all_activity`,
        token
      );
      const result = (activity || []).map((a: any) => ({
        userId: a.user_id,
        description: a.description,
        duration: a.duration,
        projectId: a.project_id,
        start: a.start,
        stop: a.stop,
      }));
      cacheSet(cacheKey, result);
      return result;
    },
  },

  Mutation: {
    updateTogglMember: async (
      _: any,
      args: { id: number; role?: string; active?: boolean },
      ctx: Context
    ) => {
      const existing = await queryOne(
        ctx.db,
        `SELECT * FROM toggl_members WHERE id = ?`,
        [args.id]
      );
      if (!existing) throw new Error("Member not found");

      const updates: string[] = [];
      const params: any[] = [];

      if (args.role !== undefined) {
        updates.push("role = ?");
        params.push(args.role);
      }
      if (args.active !== undefined) {
        updates.push("active = ?");
        params.push(args.active);
      }
      if (updates.length === 0) throw new Error("No fields to update");

      params.push(args.id);
      await queryAll(
        ctx.db,
        `UPDATE toggl_members SET ${updates.join(", ")} WHERE id = ?`,
        params
      );

      const member = await queryOne(
        ctx.db,
        `SELECT id, toggl_name, email, role, active FROM toggl_members WHERE id = ?`,
        [args.id]
      );
      return {
        id: member.id,
        togglName: member.toggl_name,
        email: member.email,
        role: member.role,
        active: !!member.active,
      };
    },
  },
};
