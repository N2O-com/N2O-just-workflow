// Toggl Sync Service — syncs time tracking data from Toggl into Postgres.
// Runs on a 5-minute interval; reference data first, then entries in batches.

import type { SupabasePool } from "../db.js";
import {
  fetchToggl,
  getToken,
  TOGGL_API_BASE,
  TOGGL_REPORTS_BASE,
} from "./toggl-api.js";

export interface SyncResult {
  status: "success" | "already_syncing" | "error";
  entriesUpserted: number;
  error?: string;
  lastSyncAt?: string;
}

let _syncing = false;
let _intervalHandle: ReturnType<typeof setInterval> | null = null;

export function isSyncing(): boolean {
  return _syncing;
}

// ── Helpers ────────────────────────────────────────────────

async function getWorkspaceId(token: string): Promise<number> {
  const workspaces = await fetchToggl(`${TOGGL_API_BASE}/workspaces`, token);
  if (!workspaces?.length) throw new Error("No Toggl workspaces found");
  return workspaces[0].id;
}

const BATCH_SIZE = 200;

// ── Reference data sync ───────────────────────────────────

async function syncRefData(
  pool: SupabasePool,
  token: string,
  wsId: number,
): Promise<{ projects: number; clients: number; tags: number }> {
  const projects = await fetchToggl(
    `${TOGGL_API_BASE}/workspaces/${wsId}/projects`,
    token,
  );
  for (const p of projects || []) {
    await pool.query(
      `INSERT INTO tt_projects (id, name, client_id, color, active, synced_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, client_id = EXCLUDED.client_id,
         color = EXCLUDED.color, active = EXCLUDED.active, synced_at = NOW()`,
      [p.id, p.name, p.client_id ?? null, p.color ?? null, p.active ?? true],
    );
  }

  const clients = await fetchToggl(
    `${TOGGL_API_BASE}/workspaces/${wsId}/clients`,
    token,
  );
  for (const c of clients || []) {
    await pool.query(
      `INSERT INTO tt_clients (id, name, synced_at) VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, synced_at = NOW()`,
      [c.id, c.name],
    );
  }

  const tags = await fetchToggl(
    `${TOGGL_API_BASE}/workspaces/${wsId}/tags`,
    token,
  );
  for (const t of tags || []) {
    await pool.query(
      `INSERT INTO tt_tags (id, name, synced_at) VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, synced_at = NOW()`,
      [t.id, t.name],
    );
  }

  return {
    projects: (projects || []).length,
    clients: (clients || []).length,
    tags: (tags || []).length,
  };
}

// ── Entry batch upsert ────────────────────────────────────

interface FlatEntry {
  id: number;
  description: string;
  start: string;
  stop: string | null;
  seconds: number;
  userId: number;
  projectId: number | null;
  tagIds: number[];
}

async function upsertEntryBatch(
  pool: SupabasePool,
  entries: FlatEntry[],
): Promise<number> {
  if (!entries.length) return 0;

  const valueClauses: string[] = [];
  const params: any[] = [];

  for (let i = 0; i < entries.length; i++) {
    const off = i * 8;
    valueClauses.push(
      `($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5}, $${off + 6}, $${off + 7}, $${off + 8})`,
    );
    const e = entries[i];
    params.push(e.id, e.description, e.start, e.stop, e.seconds, e.userId, e.projectId, e.tagIds);
  }

  const sql = `INSERT INTO tt_entries (id, description, start, stop, seconds, user_id, project_id, tag_ids)
    VALUES ${valueClauses.join(", ")}
    ON CONFLICT (id) DO UPDATE SET
      description = EXCLUDED.description, start = EXCLUDED.start,
      stop = EXCLUDED.stop, seconds = EXCLUDED.seconds,
      user_id = EXCLUDED.user_id, project_id = EXCLUDED.project_id,
      tag_ids = EXCLUDED.tag_ids, synced_at = NOW()`;

  await pool.query(sql, params);
  return entries.length;
}

// ── Entry sync ────────────────────────────────────────────

async function syncEntries(
  pool: SupabasePool,
  token: string,
  wsId: number,
): Promise<number> {
  const endDate = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(start.getDate() - 90);
  const startDate = start.toISOString().slice(0, 10);

  const data = await fetchToggl(
    `${TOGGL_REPORTS_BASE}/workspace/${wsId}/search/time_entries`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        start_date: startDate,
        end_date: endDate,
        page_size: 5000,
      }),
    },
  );

  // Flatten grouped response (same double-loop as timeTrackingEntries resolver)
  const items = (Array.isArray(data) ? data : []).flat();
  const entries: FlatEntry[] = [];
  for (const item of items) {
    for (const te of item.time_entries || []) {
      entries.push({
        id: te.id,
        description: item.description || "",
        start: te.start,
        stop: te.stop || null,
        seconds: te.seconds ?? 0,
        userId: item.user_id,
        projectId: item.project_id || null,
        tagIds: item.tag_ids || [],
      });
    }
  }

  // Batch upsert (200 rows per batch)
  let totalUpserted = 0;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    try {
      totalUpserted += await upsertEntryBatch(pool, batch);
    } catch (err) {
      console.warn("Batch upsert failed:", err);
    }
  }

  return totalUpserted;
}

// ── Public API ────────────────────────────────────────────

export async function runSync(pool: SupabasePool): Promise<SyncResult> {
  if (_syncing) {
    return { status: "already_syncing", entriesUpserted: 0 };
  }
  _syncing = true;

  const startedAt = new Date().toISOString();
  let entriesUpserted = 0;
  let error: string | undefined;

  try {
    // Create sync log entry
    await pool.query(
      `INSERT INTO tt_sync_log (started_at, sync_type) VALUES ($1, 'incremental')`,
      [startedAt],
    );

    const token = getToken();
    const wsId = await getWorkspaceId(token);

    // Reference data first (hard-fail gate — skip entries if this fails)
    try {
      await syncRefData(pool, token, wsId);
    } catch (e: any) {
      error = e.message || "Reference sync failed";
      return { status: "error", entriesUpserted: 0, error };
    }

    // Sync time entries
    entriesUpserted = await syncEntries(pool, token, wsId);

    // Bust SupabasePool query cache so resolvers see fresh data
    pool.clearCache();

    return {
      status: "success",
      entriesUpserted,
      lastSyncAt: new Date().toISOString(),
    };
  } catch (e: any) {
    error = e.message || "Sync failed";
    return { status: "error", entriesUpserted, error };
  } finally {
    // Always finalize sync log (try/catch/finally guarantee)
    try {
      await pool.query(
        `UPDATE tt_sync_log SET completed_at = $1, entries_upserted = $2, error = $3
         WHERE started_at = $4`,
        [new Date().toISOString(), entriesUpserted, error ?? null, startedAt],
      );
    } catch {
      // Don't let sync_log finalization crash
    }
    _syncing = false;
  }
}

export function startSyncLoop(
  pool: SupabasePool,
  intervalMs: number,
): ReturnType<typeof setInterval> {
  _intervalHandle = setInterval(() => {
    runSync(pool).catch((err) => {
      console.error("Sync loop error:", err);
    });
  }, intervalMs);
  return _intervalHandle;
}

export function stopSyncLoop(): void {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}
