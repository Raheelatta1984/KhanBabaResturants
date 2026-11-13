import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { SCHEMA_SQL } from "./schema";
import { getDataDir } from "./paths";

export type Db = Database.Database;

const globalForDb = globalThis as unknown as { __kbDb?: Database.Database };

function createConnection(): Database.Database {
  const dir = getDataDir();
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
  const db = new Database(path.join(dir, "khanbaba.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  // The schema is embedded at build time — serverless bundles do not reliably
  // include loose .sql files next to the function.
  db.exec(SCHEMA_SQL);
  seedDatabase(db);
  return db;
}

/** Lazily create (and migrate/seed) the single SQLite connection for this process. */
export function getDb(): Database.Database {
  if (!globalForDb.__kbDb) {
    globalForDb.__kbDb = createConnection();
  }
  return globalForDb.__kbDb;
}

export function resetDbForTests(): void {
  if (globalForDb.__kbDb) {
    globalForDb.__kbDb.close();
    globalForDb.__kbDb = undefined;
  }
}
