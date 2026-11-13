import { createPgliteDb } from "../../lib/db/driver";
import type { Db } from "../../lib/db/driver";

/**
 * PGlite — Postgres 17 compiled to WebAssembly — running in-process.
 *
 * This is how the suite proves the port without a Neon project: the app's real
 * modules (schema → seed → orders → kitchen → delivery → production) run against
 * a genuine Postgres engine through the same `Sql` interface the Neon driver
 * implements. The one thing it cannot prove is Neon's network transport; that
 * needs a real DATABASE_URL.
 *
 * The client itself lives in lib/db/driver.ts so `DATABASE_URL=postgres://pglite/…`
 * can boot the whole app the same way (used by the CI smoke test).
 */
export type Harness = {
  db: Db;
  close: () => Promise<void>;
};

export async function createHarness(): Promise<Harness> {
  const db = await createPgliteDb("postgres://pglite/khanbaba");
  return { db, close: async () => undefined };
}
