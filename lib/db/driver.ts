import { Pool, types as pgTypes, type PoolConfig } from "pg";

/**
 * The tiny database interface the whole application talks to.
 *
 * Every query is async and uses numbered placeholders ($1). There is one
 * production implementation for Postgres — Supabase, but any Postgres works —
 * (`createPostgresDb`), one for the test harness (`createPgliteDb`, Postgres in
 * WASM), which is why this module only depends on the driver — never on the
 * schema or on application code.
 */
export type Row = Record<string, unknown>;

export interface Sql {
  /** Run a statement and return every row. */
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Run a statement expected to return exactly one row (throws when it does not). */
  one<T = Row>(text: string, params?: unknown[]): Promise<T>;
  /** Run a statement and return the first row, or null. */
  maybeOne<T = Row>(text: string, params?: unknown[]): Promise<T | null>;
  /** Run an INSERT … RETURNING id and return the new primary key. */
  insert(text: string, params?: unknown[]): Promise<number>;
  /** Run an INSERT/UPDATE/DELETE and return the number of affected rows. */
  run(text: string, params?: unknown[]): Promise<number>;
  /** Run several statements as one script (no placeholders) — used for the schema. */
  exec(text: string): Promise<void>;
  /**
   * Run `fn` inside a real transaction. The callback receives a `Sql` bound to
   * the transaction — always query through it, never through the outer handle.
   * BEGIN/COMMIT/ROLLBACK are handled for you; no `db.transaction(fn)` sync API.
   */
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}

export type Db = Sql;

/** What a driver reports back for one statement. */
export type QueryResult = { rows: Row[]; rowCount: number };

/**
 * Postgres returns timestamptz as a JS Date. The rest of the application (and the
 * browser payloads it produces) expects an ISO-8601 string, so normalise here
 * once instead of at 40 call sites. `date` columns are selected with an explicit
 * `::text` cast where they are used.
 */
function normaliseValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normaliseValue);
  return value;
}

function normaliseRows<T>(rows: Row[]): T[] {
  return rows.map((row) => {
    const out: Row = {};
    for (const key of Object.keys(row)) out[key] = normaliseValue(row[key]);
    return out as T;
  });
}

/**
 * Postgres `count()`/`sum()` come back as int8 and `avg()` as numeric, which
 * node-postgres parses as strings. The SQLite code this replaced always had
 * numbers, so keep that contract: int8 and numeric become JS numbers.
 *
 * Passed per-pool (`new Pool({ types })`) rather than through the global
 * `pg.types` so nothing else in the process is affected.
 */
export const customTypes = {
  getTypeParser: (id: number, format?: "text" | "binary") => {
    if (id === 20) return (value: string) => Number(value); // int8 → count/sum
    if (id === 1700) return (value: string) => Number(value); // numeric → avg
    if (id === 1016)
      return (value: string) =>
        value.replace(/[{}]/g, "").split(",").filter(Boolean).map(Number);
    return pgTypes.getTypeParser(id as never, format as never);
  },
};

/** Split a SQL script into individual statements (comments and quotes aware). */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (dollarTag) {
      if (char === "$" && sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
        continue;
      }
      current += char;
      continue;
    }
    if (!inSingle && char === "-" && next === "-") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (!inSingle && char === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (!inSingle && char === "$") {
      const match = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }
    if (char === "'" && sql[i - 1] !== "\\") inSingle = !inSingle;
    if (char === ";" && !inSingle) {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

/** A raw Postgres client: one statement in, rows plus a row count out. */
export interface PgClient {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
  /** Optional: run a multi-statement script in one round trip. */
  exec?: (text: string) => Promise<void>;
}

function wrap(client: PgClient): Sql {
  const sql: Sql = {
    async query<T>(text: string, params: unknown[] = []) {
      return normaliseRows<T>((await client.query(text, params)).rows);
    },
    async one<T>(text: string, params: unknown[] = []) {
      const rows = await sql.query<T>(text, params);
      if (rows.length !== 1)
        throw new Error(
          `Expected exactly one row, received ${rows.length}: ${text.slice(0, 120)}`,
        );
      return rows[0];
    },
    async maybeOne<T>(text: string, params: unknown[] = []) {
      const rows = await sql.query<T>(text, params);
      return rows[0] ?? null;
    },
    async insert(text: string, params: unknown[] = []) {
      const rows = await sql.query<{ id: number }>(text, params);
      if (rows.length === 0 || rows[0].id == null) {
        throw new Error(
          `INSERT did not return an id (add RETURNING id): ${text.slice(0, 120)}`,
        );
      }
      return Number(rows[0].id);
    },
    async run(text: string, params: unknown[] = []) {
      const result = await client.query(text, params);
      return result.rowCount ?? result.rows.length;
    },
    async exec(text: string) {
      if (client.exec) {
        await client.exec(text);
        return;
      }
      for (const statement of splitStatements(text)) {
        await client.query(statement);
      }
    },
    async transaction<T>(fn: (tx: Sql) => Promise<T>) {
      // Already inside a transaction: reuse the same connection instead of
      // nesting. Postgres has no nested BEGIN, and our call graph never
      // depends on a nested rollback.
      return fn(sql);
    },
  };
  return sql;
}

function isServerless(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY,
  );
}

function hasExplicitSsl(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    return ["ssl", "sslmode", "sslrootcert", "sslnegotiation"].some((key) =>
      url.searchParams.has(key),
    );
  } catch {
    return false;
  }
}

function hostOf(connectionString: string): string {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return "";
  }
}

/**
 * Supabase's pooler (Supavisor) — `…pooler.supabase.com`, port 6543 in
 * transaction mode or 5432 in session mode — as opposed to the direct host
 * `db.<ref>.supabase.co`, which is IPv6-only and therefore unreachable from many
 * CI runners and home networks.
 */
export function isSupabasePooler(connectionString: string): boolean {
  return /pooler\.supabase\.(com|net)$/i.test(hostOf(connectionString));
}

function poolConfig(connectionString: string, max?: number): PoolConfig {
  const host = hostOf(connectionString);
  const local = host === "localhost" || host === "127.0.0.1" || host === "";
  const config: PoolConfig = {
    connectionString,
    // One connection per function instance is all a request needs, and a small
    // cap keeps a traffic spike from exhausting the database's connection limit.
    max: max ?? Number(process.env.DATABASE_POOL_MAX ?? (isServerless() ? 1 : 5)),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: true,
    application_name: "khanbaba",
    types: customTypes,
  };
  // Supabase requires TLS. When the URL carries no sslmode (a copy/paste of the
  // bare "postgresql://…@…pooler.supabase.com:6543/postgres"), enable it here so
  // the connection fails with a clear authentication error instead of hang.
  if (!local && !hasExplicitSsl(connectionString))
    config.ssl = { rejectUnauthorized: false };
  return config;
}

/**
 * Postgres over TCP, pooled — Supabase in production, local Postgres in
 * development, PGlite never (it has its own driver).
 *
 * Supavisor's transaction mode (port 6543) hands each statement to whichever
 * backend is free, so this driver uses node-postgres' unnamed statements only
 * — no named prepared statements, no session state, no LISTEN. Everything the
 * app does (schema, seed, orders, transactions) works in that mode, because a
 * transaction is pinned to the one connection checked out for it.
 */
export function createPostgresDb(
  connectionString: string,
  options: { max?: number } = {},
): Db {
  const pool = new Pool(poolConfig(connectionString, options.max));

  // A pooled client can die between requests (Supabase restarts, network blip).
  // Without a listener that surfaces as an unhandled 'error' event and takes the
  // whole function down; with one, the pool discards it and the next query runs
  // on a fresh connection.
  pool.on("error", (error) => {
    console.error("[khanbaba] idle Postgres client error", error.message);
  });

  const client: PgClient = {
    query: async (text, params = []) => {
      const result = await pool.query(text, params as never[]);
      return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
    },
  };

  const base = wrap(client);

  return {
    ...base,
    async transaction<T>(fn: (tx: Sql) => Promise<T>) {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        const tx = wrap({
          query: async (text, params = []) => {
            const result = await connection.query(text, params as never[]);
            return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
          },
        });
        const result = await fn(tx);
        await connection.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await connection.query("ROLLBACK");
        } catch {
          /* connection already gone — the transaction is aborted server-side */
        }
        throw error;
      } finally {
        // Returning it to the pool (never `end()`): the socket is reused by the
        // next request on this instance.
        connection.release();
      }
    },
  };
}

/**
 * PGlite: Postgres compiled to WebAssembly, in-process. Used when DATABASE_URL
 * points at a host called `pglite` (e.g. `postgres://pglite/khanbaba`) — CI's
 * smoke test and `npm run test:pg` run the app against a real Postgres engine
 * without any server. Never used in production.
 */
export function isPgliteUrl(url: string): boolean {
  if (url.startsWith("pglite:")) return true;
  try {
    return new URL(url).hostname === "pglite";
  } catch {
    return false;
  }
}

export async function createPgliteDb(url: string): Promise<Db> {
  // Loaded dynamically so the 7 MB wasm engine is only fetched in this mode.
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = process.env.KB_PGLITE_DIR?.trim();
  const pglite = dataDir ? new PGlite(dataDir) : new PGlite();
  await pglite.waitReady;
  if (!dataDir) console.log(`[khanbaba] PGlite in-memory Postgres for ${url}`);

  // node-postgres hands back numeric/int8 as strings by default; the type
  // overrides in `customTypes` turn them into numbers, so the harness has to
  // match or the two environments would disagree.
  const asNumber = (value: string) =>
    value.trim() !== "" && !Number.isNaN(Number(value)) ? Number(value) : value;
  pglite.parsers[1700] = asNumber;
  pglite.parsers[20] = asNumber;

  return createSqlFromClient({
    query: async (text, params = []) =>
      (await pglite.query(text, params as never[])).rows as Row[],
    exec: async (text) => {
      for (const statement of splitStatements(text))
        await pglite.exec(statement);
    },
    transaction: async (fn) =>
      pglite.transaction(async (tx) =>
        fn({
          query: async (text, params = []) =>
            (await tx.query(text, params as never[])).rows as Row[],
        }),
      ),
  });
}

/**
 * Build a `Sql` handle around any Postgres client. Used by the PGlite driver
 * above, so the application code is exercised through exactly the same
 * interface in tests and in production.
 */
export function createSqlFromClient(client: {
  query: (text: string, params?: unknown[]) => Promise<Row[]>;
  exec?: (text: string) => Promise<void>;
  transaction?: <T>(
    fn: (tx: {
      query: (text: string, params?: unknown[]) => Promise<Row[]>;
    }) => Promise<T>,
  ) => Promise<T>;
}): Sql {
  const base = wrap({
    query: async (text, params = []) => ({
      rows: await client.query(text, params),
      rowCount: 0,
    }),
    exec: client.exec,
  });

  if (!client.transaction) {
    return {
      ...base,
      async transaction<T>(fn: (tx: Sql) => Promise<T>) {
        return fn(base);
      },
    };
  }

  const outer = client.transaction.bind(client);
  return {
    ...base,
    async transaction<T>(fn: (tx: Sql) => Promise<T>) {
      return outer(async (inner) =>
        fn(
          wrap({
            query: async (text, params = []) => ({
              rows: await inner.query(text, params),
              rowCount: 0,
            }),
          }),
        ),
      );
    },
  };
}
