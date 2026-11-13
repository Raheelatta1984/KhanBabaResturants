import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";

export type Db = Database.Database;

const globalForDb = globalThis as unknown as { __kbDb?: Db };

function dataDir(): string {
  return process.env.KB_DATA_DIR || path.join(process.cwd(), "data");
}

function createConnection(): Db {
  const dir = dataDir();
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
  const db = new Database(path.join(dir, "khanbaba.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "db", "schema.sql"), "utf8");
  db.exec(schema);
  seedDatabase(db);
  return db;
}

/** Lazily create (and migrate/seed) the single SQLite connection for this process. */
export function getDb(): Db {
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
