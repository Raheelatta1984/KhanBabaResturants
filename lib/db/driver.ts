import {
  neon,
  neonConfig,
  Client,
  types as pgTypes,
} from "@neondatabase/serverless";

/**
 * The tiny database interface the whole application talks to.
 *
 * Every query is async and uses numbered placeholders ($1). There is one
 * implementation for Neon (`createNeonDb`) and one in the test harness for
 * PGlite (`scripts/lib/pglite.ts`), which is why this module only depends on the
 * driver — never on the schema or on application code.
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

/**
 * Neon returns timestamptz as a JS Date. The rest of the application (and the
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
 */
const customTypes = {
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

function wrap(client: {
  query: (text: string, params?: unknown[]) => Promise<Row[]>;
  exec?: (text: string) => Promise<void>;
}): Sql {
  const run = async (text: string, params: unknown[] = []) =>
    client.query(text, params);

  const sql: Sql = {
    async query<T>(text: string, params: unknown[] = []) {
      return normaliseRows<T>(await run(text, params));
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
      return (await sql.query(text, params)).length;
    },
    async exec(text: string) {
      if (client.exec) {
        await client.exec(text);
        return;
      }
      for (const statement of splitStatements(text)) {
        await run(statement);
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

/**
 * Neon over HTTP: one HTTPS round trip per statement, no socket to leak, which
 * is the right model for Vercel functions. Transactions need a session, so they
 * open a short-lived WebSocket client for BEGIN/COMMIT/ROLLBACK and close it
 * again — never a long-lived TCP pool.
 */
export function createNeonDb(connectionString: string): Db {
  const httpSql = neon(connectionString, { types: customTypes });
  const httpExec = neon(connectionString, {
    types: customTypes,
    fullResults: true,
  });

  const base: Sql = wrap({
    query: async (text, params = []) =>
      (await httpSql.query(text, params)) as Row[],
  });

  const db: Sql = {
    ...base,
    async exec(text: string) {
      const statements = splitStatements(text);
      if (statements.length === 0) return;
      // One HTTPS request per chunk of statements (Neon allows a batch per call).
      await httpSql.transaction(
        statements.map((statement) => httpSql.query(statement)),
      );
    },
    async transaction<T>(fn: (tx: Sql) => Promise<T>) {
      ensureWebSocket();
      const client = new Client({ connectionString, types: customTypes });
      await client.connect();
      const tx = wrap({
        query: async (text, params = []) =>
          (await client.query(text, params)).rows as Row[],
      });
      try {
        await client.query("BEGIN");
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* connection already gone — the transaction is aborted server-side */
        }
        throw error;
      } finally {
        await client.end().catch(() => undefined);
      }
    },
    async run(text: string, params: unknown[] = []) {
      // `fullResults` gives the row count for UPDATE/DELETE without a SELECT.
      const result = (await httpExec.query(text, params)) as unknown as {
        rowCount?: number;
      };
      return result.rowCount ?? 0;
    },
  };

  return db;
}

/**
 * PGlite: Postgres compiled to WebAssembly, in-process. Used when DATABASE_URL
 * points at a host called `pglite` (e.g. `postgres://pglite/khanbaba`) — CI's
 * smoke test and `npm run test:pg` run the app against a real Postgres engine
 * without any server. Never used in production, where the URL is Neon's.
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

  // node-postgres (and therefore Neon) hands back numeric/int8 as strings by
  // default; the type overrides in `customTypes` turn them into numbers, so the
  // harness has to match or the two environments would disagree.
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

let webSocketReady = false;

/** Node 22 ships a global WebSocket; give the Neon socket client one to use. */
function ensureWebSocket() {
  if (webSocketReady) return;
  const ctor = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (!ctor) {
    throw new Error(
      "This Node runtime has no global WebSocket, so Neon transactions cannot open a socket. Upgrade to Node 22 or add a WebSocket polyfill.",
    );
  }
  neonConfig.webSocketConstructor = ctor as never;
  webSocketReady = true;
}

/**
 * Build a `Sql` handle around any Postgres client. Used by the Neon driver above
 * and by the PGlite harness (scripts/lib/pglite.ts), so the application code is
 * exercised through exactly the same interface in tests and in production.
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
    query: async (text, params = []) => client.query(text, params),
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
            query: async (text, params = []) => inner.query(text, params),
          }),
        ),
      );
    },
  };
}
