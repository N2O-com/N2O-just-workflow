import DataLoader from "dataloader";
import type Database from "better-sqlite3";

// Task loader: batches by "sprint|taskNum" composite key
export function createTaskLoader(db: Database.Database) {
  return new DataLoader<string, any>(async (keys) => {
    const placeholders = keys.map(() => "(?, ?)").join(", ");
    const params = keys.flatMap((k) => {
      const [sprint, taskNum] = k.split("|");
      return [sprint, parseInt(taskNum)];
    });
    const rows = db
      .prepare(
        `SELECT * FROM tasks WHERE (sprint, task_num) IN (VALUES ${placeholders})`
      )
      .all(...params);
    const map = new Map(rows.map((r: any) => [`${r.sprint}|${r.task_num}`, r]));
    return keys.map((k) => map.get(k) ?? null);
  });
}

// Developer loader: batches by name
export function createDeveloperLoader(db: Database.Database) {
  return new DataLoader<string, any>(async (names) => {
    const placeholders = names.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT * FROM developers WHERE name IN (${placeholders})`)
      .all(...names);
    const map = new Map(rows.map((r: any) => [r.name, r]));
    return names.map((n) => map.get(n) ?? null);
  });
}

// Sprint loader: batches by name
export function createSprintLoader(db: Database.Database) {
  return new DataLoader<string, any>(async (names) => {
    const placeholders = names.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT * FROM sprints WHERE name IN (${placeholders})`)
      .all(...names);
    const map = new Map(rows.map((r: any) => [r.name, r]));
    return names.map((n) => map.get(n) ?? null);
  });
}

// Project loader: batches by id
export function createProjectLoader(db: Database.Database) {
  return new DataLoader<string, any>(async (ids) => {
    const placeholders = ids.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT * FROM projects WHERE id IN (${placeholders})`)
      .all(...ids);
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

export function createLoaders(db: Database.Database): Loaders {
  return {
    task: createTaskLoader(db),
    developer: createDeveloperLoader(db),
    sprint: createSprintLoader(db),
    project: createProjectLoader(db),
  };
}
