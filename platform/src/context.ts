import type Database from "better-sqlite3";
import type { Loaders } from "./loaders.js";

export interface Context {
  db: Database.Database;
  loaders: Loaders;
}
