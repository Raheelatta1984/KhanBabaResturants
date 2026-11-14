import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getDb, type Db } from "../db";
import { getSetting } from "../settings";

/**
 * Square POS bridge — deliberately DETACHED from the order engine.
 *
 * The restaurant platform never reads these tables to place, cook or deliver
 * an order. This module only copies data across a boundary:
 *
 *   outbound  completed/paid local orders → Square Orders
 *   inbound   Square Payments             → square_transactions
 *   webhook   Square POS events           → square_transactions + sync log
 *   catalogue menu variants               → Square Catalog (opt-in)
 *
 * Every transfer is recorded in `square_sync_records` with its payload, so the
 * bridge is auditable, retryable and idempotent (external ids are unique).
 * With no credentials it runs in "sandbox mirror" mode: local shadow records
 * demonstrate the data flow without ever calling Square. Turning
 * `square_enabled` off makes this module a no-op — delete this folder and the
 * two square_* tables and the rest of the platform is unchanged.
 */

const API_VERSION = "2024-12-18";

type SquareCredentials = {
  accessToken: string;
  locationId: string;
  environment: "production" | "sandbox";
  webhookKey: string;
};

async function credentials(): Promise<SquareCredentials> {
  const environment =
    process.env.SQUARE_ENVIRONMENT ||
    (await getSetting("square_environment", "sandbox"));
  return {
    accessToken:
      process.env.SQUARE_ACCESS_TOKEN ||
      (await getSetting("square_access_token")),
    locationId:
      process.env.SQUARE_LOCATION_ID ||
      (await getSetting("square_location_id")),
    environment: environment === "production" ? "production" : "sandbox",
    webhookKey:
      process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ||
      (await getSetting("square_webhook_signature_key")),
  };
}

export function squareApiBase(environment: string): string {
  return environment === "production"
    ? "https://connect.squareup.com/v2"
    : "https://connect.squareupsandbox.com/v2";
}

export async function squareConfigured(): Promise<boolean> {
  const creds = await credentials();
  return Boolean(creds.accessToken && creds.locationId);
}

export type SquareMode = "live" | "sandbox" | "sandbox-api" | "disabled";

export async function squareMode(): Promise<SquareMode> {
  if ((await getSetting("square_enabled", "1")) === "0") return "disabled";
  return (await squareConfigured())
    ? (await credentials()).environment === "production"
      ? "live"
      : "sandbox-api"
    : "sandbox";
}

async function squareFetch(
  creds: SquareCredentials,
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(`${squareApiBase(creds.environment)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": API_VERSION,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const errors = (json as { errors?: { detail?: string }[] } | null)?.errors;
    throw new Error(errors?.[0]?.detail ?? `Square API error ${res.status}`);
  }
  return (json ?? {}) as Record<string, unknown>;
}

export async function logSync(
  db: Db,
  entry: {
    direction: "outbound" | "inbound" | "webhook" | "test";
    entity: string;
    entityRef?: string;
    externalId?: string;
    status: "ok" | "pending" | "skipped" | "error";
    message?: string;
    payload?: unknown;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO square_sync_records (direction, entity, entity_ref, external_id, status, message, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      entry.direction,
      entry.entity,
      entry.entityRef ?? null,
      entry.externalId ?? null,
      entry.status,
      entry.message?.slice(0, 500) ?? null,
      entry.payload === undefined ? null : JSON.stringify(entry.payload),
    ],
  );
}

/** Square signs `x-square-hmacsha256-signature` over URL + raw body. */
export async function verifySquareWebhook(
  requestUrl: string,
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  const key = (await credentials()).webhookKey;
  if (!key) return false; // sandbox mode: unsigned events are rejected in prod
  if (!signature) return false;
  const expected = createHmac("sha256", key)
    .update(requestUrl + rawBody)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

function shadowTransaction(db: Db, order: Record<string, unknown>) {
  const code = String(order.code);
  const amount = Number(order.total_cents ?? 0);
  return db.query(
    `INSERT INTO square_transactions (external_id, kind, source, order_code, location_id,
      amount_cents, currency, status, occurred_at, raw)
     VALUES ($1,'order','local',$2,$3,$4,'AUD',$5,now(),$6)
     ON CONFLICT (external_id) DO NOTHING`,
    [
      `sandbox-${code}`,
      code,
      "sandbox",
      amount,
      "mirrored",
      JSON.stringify({ mode: "sandbox-mirror", order: code }),
    ],
  );
}

/** Push one local order into Square (or the sandbox mirror). */
export async function pushOrderToSquare(
  db: Db,
  orderCode: string,
): Promise<{ status: string; externalId: string; message: string }> {
  const enabled = (await getSetting("square_enabled", "1")) !== "0";
  if (!enabled) {
    await logSync(db, {
      direction: "outbound",
      entity: "order",
      entityRef: orderCode,
      status: "skipped",
      message: "Square bridge is disabled",
    });
    return { status: "skipped", externalId: "", message: "Bridge disabled" };
  }
  const order = await db.maybeOne<Record<string, unknown>>(
    "SELECT * FROM orders WHERE code = $1",
    [orderCode.trim().toUpperCase()],
  );
  if (!order) throw new Error(`Order ${orderCode} not found`);
  const items = await db.query<{
    name: string;
    qty: number;
    unit_price_cents: number;
    variant_label: string | null;
    square_variation_id: string | null;
  }>(
    `SELECT oi.name, oi.qty, oi.unit_price_cents, oi.variant_label, iv.square_variation_id
      FROM order_items oi LEFT JOIN item_variants iv ON iv.id = oi.variant_id
      WHERE oi.order_id = $1 ORDER BY oi.id`,
    [order.id],
  );

  const payload = {
    idempotency_key: `kb-${String(order.code)}-${randomUUID().slice(0, 8)}`,
    order: {
      location_id: (await credentials()).locationId || "sandbox",
      reference_id: String(order.code),
      customer_id: undefined,
      line_items: items.map((item) => ({
        name: item.name,
        quantity: String(item.qty),
        ...(item.square_variation_id
          ? { catalog_object_id: item.square_variation_id }
          : {
              base_price_money: {
                amount: Number(item.unit_price_cents),
                currency: "AUD",
              },
            }),
        note: item.variant_label ?? undefined,
      })),
      metadata: {
        khan_baba_order: String(order.code),
        channel: String(order.channel),
        payment_status: String(order.payment_status),
      },
      state: "OPEN",
    },
  };

  if (!(await squareConfigured())) {
    await shadowTransaction(db, order);
    await logSync(db, {
      direction: "outbound",
      entity: "order",
      entityRef: String(order.code),
      externalId: `sandbox-${String(order.code)}`,
      status: "ok",
      message: "Sandbox mirror — set SQUARE_ACCESS_TOKEN + SQUARE_LOCATION_ID for live POS sync",
      payload,
    });
    return {
      status: "ok",
      externalId: `sandbox-${String(order.code)}`,
      message: "Mirrored locally (no Square credentials)",
    };
  }

  try {
    const creds = await credentials();
    const json = await squareFetch(creds, "/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const squareOrder = (json.order ?? {}) as { id?: string };
    const externalId = String(squareOrder.id ?? "");
    await db.query(
      `INSERT INTO square_transactions (external_id, kind, source, order_code, square_order_id,
        location_id, amount_cents, currency, status, occurred_at, raw)
       VALUES ($1,'order','square',$2,$3,$4,$5,'AUD',$6,now(),$7)
       ON CONFLICT (external_id) DO NOTHING`,
      [
        externalId,
        String(order.code),
        externalId,
        creds.locationId,
        Number(order.total_cents ?? 0),
        "synced",
        JSON.stringify(json),
      ],
    );
    await logSync(db, {
      direction: "outbound",
      entity: "order",
      entityRef: String(order.code),
      externalId,
      status: "ok",
      message: "Order created in Square POS",
      payload: json,
    });
    return { status: "ok", externalId, message: "Pushed to Square POS" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Square push failed";
    await logSync(db, {
      direction: "outbound",
      entity: "order",
      entityRef: String(order.code),
      status: "error",
      message,
      payload,
    });
    return { status: "error", externalId: "", message };
  }
}

/** Import Square payments since a point in time; idempotent on external id. */
export async function pullSquarePayments(
  db: Db,
  sinceDays = 7,
): Promise<number> {
  if (!(await squareConfigured())) return 0;
  const creds = await credentials();
  const begin = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const params = new URLSearchParams({
    begin_time: begin,
    sort_order: "DESC",
    location_id: creds.locationId,
  });
  const json = await squareFetch(creds, `/payments?${params.toString()}`, {
    method: "GET",
  });
  const payments = (json.payments ?? []) as {
    id?: string;
    order_id?: string;
    amount_money?: { amount?: number; currency?: string };
    status?: string;
    created_at?: string;
    reference_id?: string;
  }[];
  let imported = 0;
  for (const payment of payments) {
    if (!payment.id) continue;
    const inserted = await db.run(
      `INSERT INTO square_transactions (external_id, kind, source, order_code, square_order_id,
        location_id, amount_cents, currency, status, occurred_at, raw)
       VALUES ($1,'payment','square',$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (external_id) DO NOTHING`,
      [
        payment.id,
        payment.reference_id ?? null,
        payment.order_id ?? null,
        creds.locationId,
        Number(payment.amount_money?.amount ?? 0),
        payment.amount_money?.currency ?? "AUD",
        payment.status ?? null,
        payment.created_at ?? null,
        JSON.stringify(payment),
      ],
    );
    imported += inserted;
  }
  await logSync(db, {
    direction: "inbound",
    entity: "payments",
    status: "ok",
    message: `${imported} new Square payment(s) imported`,
    payload: { since: begin, returned: payments.length, imported },
  });
  return imported;
}

/** Push catalogue variants into Square Catalog (opt-in, live credentials only). */
export async function syncSquareCatalog(db: Db): Promise<number> {
  if ((await getSetting("square_sync_catalog", "0")) !== "1") return 0;
  if (!(await squareConfigured())) return 0;
  const variants = await db.query<{
    id: number;
    name: string;
    label: string;
    price_cents: number;
  }>(
    `SELECT iv.id, mi.name, iv.label, iv.price_cents FROM item_variants iv
      JOIN menu_items mi ON mi.id = iv.item_id
      WHERE iv.active AND iv.square_variation_id IS NULL LIMIT 50`,
  );
  if (variants.length === 0) return 0;
  const creds = await credentials();
  const objects = variants.map((variant) => ({
    type: "ITEM",
    id: `#kb-variant-${variant.id}`,
    item_data: {
      name: `${variant.name} — ${variant.label}`,
      variations: [
        {
          type: "ITEM_VARIATION",
          id: `#kb-price-${variant.id}`,
          item_variation_data: {
            name: variant.label,
            pricing_type: "FIXED_PRICING",
            price_money: { amount: variant.price_cents, currency: "AUD" },
          },
        },
      ],
    },
  }));
  const json = await squareFetch(creds, "/catalog/batch-upsert", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: `kb-catalog-${randomUUID().slice(0, 8)}`,
      batches: [{ objects }],
    }),
  });
  const idMap = ((json.id_mappings ?? []) as {
    client_object_id?: string;
    object_id?: string;
  }[]).reduce<Record<string, string>>((acc, mapping) => {
    if (mapping.client_object_id && mapping.object_id)
      acc[mapping.client_object_id] = mapping.object_id;
    return acc;
  }, {});
  for (const variant of variants) {
    const objectId = idMap[`#kb-price-${variant.id}`];
    if (objectId)
      await db.query(
        "UPDATE item_variants SET square_variation_id = $1 WHERE id = $2",
        [objectId, variant.id],
      );
  }
  await logSync(db, {
    direction: "outbound",
    entity: "catalog",
    status: "ok",
    message: `${variants.length} menu variant(s) mapped to Square Catalog`,
    payload: { mappings: idMap },
  });
  return variants.length;
}

/** One sync run: push unpaid-for orders, then import POS payments. */
export async function syncSquare(
  db: Db,
  options: { limit?: number; sinceDays?: number } = {},
): Promise<{ pushed: number; failed: number; imported: number; mode: string }> {
  const mode = await squareMode();
  if (mode === "disabled")
    return { pushed: 0, failed: 0, imported: 0, mode };
  const pending = await db.query<{ code: string }>(
    `SELECT o.code FROM orders o
      WHERE o.status IN ('completed','ready','out_for_delivery','awaiting_collection')
        AND NOT EXISTS (SELECT 1 FROM square_sync_records s
          WHERE s.direction = 'outbound' AND s.entity = 'order'
            AND s.entity_ref = o.code AND s.status = 'ok')
      ORDER BY o.created_at DESC LIMIT $1`,
    [options.limit ?? 25],
  );
  let pushed = 0;
  let failed = 0;
  for (const row of pending) {
    const result = await pushOrderToSquare(db, row.code);
    if (result.status === "ok") pushed += 1;
    if (result.status === "error") failed += 1;
  }
  let imported = 0;
  if (await squareConfigured()) {
    try {
      imported = await pullSquarePayments(db, options.sinceDays ?? 7);
      await syncSquareCatalog(db);
    } catch (error) {
      await logSync(db, {
        direction: "inbound",
        entity: "payments",
        status: "error",
        message: error instanceof Error ? error.message : "Square pull failed",
      });
    }
  }
  return { pushed, failed, imported, mode };
}

/** Store an inbound webhook event and mirror its payment/order locally. */
export async function recordSquareWebhook(
  db: Db,
  payload: { event_type?: string; data?: { object?: Record<string, unknown> } },
): Promise<void> {
  const type = payload.event_type ?? "unknown";
  const object = payload.data?.object ?? {};
  const nested = (object.payment ?? object.order ?? object) as Record<
    string,
    unknown
  >;
  const id = String(nested.id ?? "");
  const amountMoney = nested.amount_money as
    | { amount?: number; currency?: string }
    | undefined;
  const totalMoney = nested.total_money as { amount?: number } | undefined;
  const amountCents = Number(
    amountMoney?.amount ?? totalMoney?.amount ?? 0,
  );
  await logSync(db, {
    direction: "webhook",
    entity: type.split(".")[0] ?? "event",
    entityRef: String(nested.reference_id ?? ""),
    externalId: id,
    status: "ok",
    message: type,
    payload,
  });
  if (id) {
    await db.query(
      `INSERT INTO square_transactions (external_id, kind, source, order_code, square_order_id,
        amount_cents, currency, status, occurred_at, raw)
       VALUES ($1,$2,'square',$3,$4,$5,$6,$7,now(),$8)
       ON CONFLICT (external_id) DO UPDATE SET status = excluded.status, raw = excluded.raw`,
      [
        id,
        type.includes("payment") ? "payment" : "order",
        String(nested.reference_id ?? ""),
        String(nested.order_id ?? nested.id ?? ""),
        amountCents,
        amountMoney?.currency ?? "AUD",
        String(nested.status ?? type),
        JSON.stringify(nested),
      ],
    );
  }
}

export async function testSquareConnection(): Promise<{
  ok: boolean;
  mode: string;
  message: string;
}> {
  const db = await getDb();
  const mode = await squareMode();
  if (mode === "disabled") {
    await logSync(db, {
      direction: "test",
      entity: "connection",
      status: "skipped",
      message: "Bridge disabled",
    });
    return { ok: false, mode, message: "Square bridge is disabled" };
  }
  if (!(await squareConfigured())) {
    await logSync(db, {
      direction: "test",
      entity: "connection",
      status: "ok",
      message: "Sandbox mirror ready (no credentials configured)",
    });
    return {
      ok: true,
      mode,
      message: "Sandbox mirror ready — add credentials for live POS sync",
    };
  }
  try {
    const creds = await credentials();
    const json = await squareFetch(creds, "/locations", { method: "GET" });
    const locations = (json.locations ?? []) as { id?: string; name?: string }[];
    await logSync(db, {
      direction: "test",
      entity: "connection",
      status: "ok",
      message: `${locations.length} Square location(s) reachable`,
      payload: json,
    });
    return {
      ok: true,
      mode,
      message: `Connected to ${creds.environment} — ${locations.length} location(s)`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection failed";
    await logSync(db, {
      direction: "test",
      entity: "connection",
      status: "error",
      message,
    });
    return { ok: false, mode, message };
  }
}

export async function squareStatus(db: Db) {
  const [summary, last] = await Promise.all([
    db.one<{ records: number; transactions: number; errors: number; outbound: number }>(
      `SELECT COUNT(*) AS records,
        (SELECT COUNT(*) FROM square_transactions) AS transactions,
        COUNT(*) FILTER (WHERE status = 'error') AS errors,
        COUNT(*) FILTER (WHERE direction = 'outbound' AND status = 'ok') AS outbound
       FROM square_sync_records`,
    ),
    db.maybeOne<{ created_at: string; status: string; message: string | null }>(
      "SELECT created_at, status, message FROM square_sync_records ORDER BY id DESC LIMIT 1",
    ),
  ]);
  return {
    mode: await squareMode(),
    configured: await squareConfigured(),
    records: Number(summary.records),
    transactions: Number(summary.transactions),
    errors: Number(summary.errors),
    outbound: Number(summary.outbound),
    last,
  };
}
