import type { SupabasePool } from "./db.js";
import type { Loaders } from "./loaders.js";

export interface Context {
  db: SupabasePool;
  loaders: Loaders;
}
