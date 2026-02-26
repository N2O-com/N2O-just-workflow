import DataLoader from "dataloader";
import type { SupabasePool } from "./db.js";

// Task loader: batches by "sprint|taskNum" composite key
export function createTaskLoader(pool: SupabasePool) {
  return new DataLoader<string, any>(async (keys) => {
    const values = keys.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ");
    const params = keys.flatMap((k) => {
      const [sprint, taskNum] = k.split("|");
      return [sprint, parseInt(taskNum)];
    });
    const { rows } = await pool.query(
      `SELECT * FROM tasks WHERE (sprint, task_num) IN (VALUES ${values})`,
      params
    );
    const map = new Map(rows.map((r: any) => [`${r.sprint}|${r.task_num}`, r]));
    return keys.map((k) => map.get(k) ?? null);
  });
}

// Developer loader: batches by name
export function createDeveloperLoader(pool: SupabasePool) {
  return new DataLoader<string, any>(async (names) => {
    const placeholders = names.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await pool.query(
      `SELECT * FROM developers WHERE name IN (${placeholders})`,
      [...names]
    );
    const map = new Map(rows.map((r: any) => [r.name, r]));
    return names.map((n) => map.get(n) ?? null);
  });
}

// Sprint loader: batches by name
export function createSprintLoader(pool: SupabasePool) {
  return new DataLoader<string, any>(async (names) => {
    const placeholders = names.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await pool.query(
      `SELECT * FROM sprints WHERE name IN (${placeholders})`,
      [...names]
    );
    const map = new Map(rows.map((r: any) => [r.name, r]));
    return names.map((n) => map.get(n) ?? null);
  });
}

// Project loader: batches by id
export function createProjectLoader(pool: SupabasePool) {
  return new DataLoader<string, any>(async (ids) => {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await pool.query(
      `SELECT * FROM projects WHERE id IN (${placeholders})`,
      [...ids]
    );
    const map = new Map(rows.map((r: any) => [r.id, r]));
    return ids.map((id) => map.get(id) ?? null);
  });
}

export interface Loaders {
  task: ReturnType<typeof createTaskLoader>;
  developer: ReturnType<typeof createDeveloperLoader>;
  sprint: ReturnType<typeof createSprintLoader>;
  project: ReturnType<typeof createProjectLoader>;
}

export function createLoaders(pool: SupabasePool): Loaders {
  return {
    task: createTaskLoader(pool),
    developer: createDeveloperLoader(pool),
    sprint: createSprintLoader(pool),
    project: createProjectLoader(pool),
  };
}
