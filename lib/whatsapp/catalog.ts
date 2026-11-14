import type { Db } from "../db";
import { getBaseUrl } from "../url";
import { getSettings, settingValue } from "../settings";
import { whatsappConfig, logWhatsAppMessage, normalisePhone } from "./client";

/**
 * Centrally managed product publishing and inventory.
 *
 * The menu in this portal is the single source of truth: an editor saves a dish
 * once and the website, the WhatsApp catalogue and the POS bridge all read the
 * same row. `channel_publications` keeps the per-channel mapping (the external
 * product id, the last result, the exact payload that was sent) so a failed
 * WhatsApp push is visible and retryable instead of silently drifting.
 *
 * Availability on WhatsApp is derived, never typed twice:
 *   published && is_available && (not track_stock || stock_qty > 0)
 */

export type CatalogItemRow = {
  id: number;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  image: string | null;
  category_name: string | null;
  is_available: boolean;
  published: boolean;
  whatsapp_publish: boolean;
  track_stock: boolean;
  stock_qty: number | null;
  low_stock_level: number;
  min_price: number | null;
  default_variant_id: number | null;
  default_variant_label: string | null;
  publication_status: string | null;
  external_id: string | null;
  publication_message: string | null;
  published_at: string | null;
  updated_at: string | null;
};

const CATALOG_SELECT = `
  SELECT mi.id, mi.slug, mi.name, mi.tagline, mi.description, mi.image,
         c.name AS category_name, mi.is_available, mi.published, mi.whatsapp_publish,
         mi.track_stock, mi.stock_qty, mi.low_stock_level,
         (SELECT MIN(price_cents) FROM item_variants v WHERE v.item_id = mi.id AND v.active) AS min_price,
         (SELECT v.id FROM item_variants v WHERE v.item_id = mi.id AND v.active
            ORDER BY v.is_default DESC, v.sort_order, v.id LIMIT 1) AS default_variant_id,
         (SELECT v.label FROM item_variants v WHERE v.item_id = mi.id AND v.active
            ORDER BY v.is_default DESC, v.sort_order, v.id LIMIT 1) AS default_variant_label,
         cp.status AS publication_status, cp.external_id,
         cp.message AS publication_message, cp.published_at, cp.updated_at
    FROM menu_items mi
    LEFT JOIN categories c ON c.id = mi.category_id
    LEFT JOIN channel_publications cp
      ON cp.channel = 'whatsapp' AND cp.entity = 'item' AND cp.entity_ref = mi.id::text
`;

/** Every dish with its stock state and WhatsApp publication state. */
export async function catalogForPublishing(db: Db): Promise<CatalogItemRow[]> {
  return db.query<CatalogItemRow>(`${CATALOG_SELECT} ORDER BY c.sort_order, mi.sort_order, mi.id`);
}

export async function catalogItem(db: Db, itemId: number): Promise<CatalogItemRow | null> {
  return db.maybeOne<CatalogItemRow>(`${CATALOG_SELECT} WHERE mi.id = $1`, [itemId]);
}

/** The one availability rule used by every channel. */
export function isSellable(item: {
  published: boolean;
  is_available: boolean;
  track_stock: boolean;
  stock_qty: number | null;
}): boolean {
  if (!item.published || !item.is_available) return false;
  if (item.track_stock && item.stock_qty !== null && item.stock_qty <= 0) return false;
  return true;
}

function priceLabel(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

/** The exact Meta Commerce product payload for a dish. */
export function whatsappProductPayload(
  item: CatalogItemRow,
  options: { baseUrl: string; currency: string },
): Record<string, unknown> {
  const sellable = isSellable(item);
  return {
    retailer_id: `kb-item-${item.id}`,
    name: item.name.slice(0, 200),
    description: [item.tagline, item.description].filter(Boolean).join(" — ").slice(0, 5000),
    availability: sellable ? "in stock" : "out of stock",
    condition: "new",
    price: priceLabel(item.min_price ?? 0, options.currency),
    currency: options.currency,
    link: `${options.baseUrl}/menu/${item.slug}`,
    image_link: item.image
      ? item.image.startsWith("http")
        ? item.image
        : `${options.baseUrl}${item.image}`
      : `${options.baseUrl}/images/feast.jpg`,
    brand: "Khan Baba",
  };
}

export type PublishResult = {
  itemId: number;
  name: string;
  status: "published" | "error" | "removed" | "pending";
  externalId: string | null;
  message: string;
  sandbox: boolean;
};

/**
 * Publish (or remove) one dish on the WhatsApp catalogue.
 *
 * With credentials this POSTs the product to the Meta Commerce catalogue —
 * creating it the first time and updating the existing product afterwards.
 * Without credentials it records a sandbox publication carrying the exact
 * payload, so the integration can be reviewed end-to-end with no Meta app.
 */
export async function publishMenuItem(
  db: Db,
  itemId: number,
  actor: string,
  options: { remove?: boolean } = {},
): Promise<PublishResult> {
  const settings = await getSettings();
  const enabled = settingValue(settings, "whatsapp_publish_enabled", "1") !== "0";
  const config = await whatsappConfig();
  const item = await catalogItem(db, itemId);
  if (!item) throw new Error("Dish not found");

  if (!enabled) {
    await recordPublication(db, item, {
      status: "skipped",
      externalId: null,
      message: "Publishing is switched off in WhatsApp settings",
      payload: null,
    });
    return {
      itemId,
      name: item.name,
      status: "pending",
      externalId: null,
      message: "Publishing is switched off",
      sandbox: true,
    };
  }

  // Removing from the catalogue is explicit: a dish that is merely sold out is
  // updated to "out of stock" and comes back automatically on restock.
  if (options.remove) {
    const graph = config.configured && config.catalogId && item.external_id;
    let message = "Removed from the WhatsApp catalogue (sandbox — no Meta call)";
    let ok = true;
    if (graph) {
      const result = await metaRequest(
        config.accessToken,
        `POST`,
        item.external_id as string,
        { availability: "out of stock" },
        config,
      );
      ok = result.ok;
      message = ok ? "Marked out of stock on WhatsApp" : result.error ?? "Meta rejected the update";
    }
    await recordPublication(db, item, {
      status: ok ? "removed" : "error",
      externalId: item.external_id,
      message,
      payload: { retailer_id: `kb-item-${item.id}`, availability: "out of stock" },
    });
    return {
      itemId,
      name: item.name,
      status: ok ? "removed" : "error",
      externalId: item.external_id,
      message,
      sandbox: !graph,
    };
  }

  const baseUrl = await getBaseUrl();
  const payload = whatsappProductPayload(item, { baseUrl, currency: config.currency });

  if (!config.configured || !config.catalogId) {
    const message = !config.configured
      ? "Sandbox — payload prepared, nothing sent to Meta (add WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN)"
      : "Sandbox — add WHATSAPP_CATALOG_ID to push to the Meta Commerce catalogue";
    await recordPublication(db, item, {
      status: "published",
      externalId: `sandbox-kb-item-${item.id}`,
      message,
      payload,
    });
    await db.query(
      `INSERT INTO whatsapp_messages (direction, wa_id, kind, body, status, payload)
       VALUES ('outbound', $1, 'catalog', $2, 'logged', $3)`,
      [
        normalisePhone(config.counterNumber) || "catalog",
        `Catalog publish: ${item.name} → ${payload.availability} · ${payload.price}`,
        JSON.stringify(payload),
      ],
    );
    return {
      itemId,
      name: item.name,
      status: "published",
      externalId: `sandbox-kb-item-${item.id}`,
      message,
      sandbox: true,
    };
  }

  // Meta Commerce: POST to the catalogue to create, POST to the product to update.
  const isExisting = Boolean(item.external_id && !item.external_id.startsWith("sandbox-"));
  const path = isExisting
    ? (item.external_id as string)
    : `${config.catalogId}/products`;
  const result = await metaRequest(config.accessToken, "POST", path, payload, config);
  const externalId =
    (result.data.id as string | undefined) ?? item.external_id ?? `kb-item-${item.id}`;
  const message = result.ok
    ? `${isExisting ? "Updated" : "Published"} on WhatsApp · ${payload.availability} · ${payload.price}`
    : result.error ?? "Meta rejected the product";
  await recordPublication(db, item, {
    status: result.ok ? "published" : "error",
    externalId,
    message,
    payload,
  });
  if (!result.ok) {
    await db.query(
      `INSERT INTO whatsapp_messages (direction, wa_id, kind, body, status, error, payload)
       VALUES ('outbound', $1, 'catalog', $2, 'failed', $3, $4)`,
      [
        normalisePhone(config.counterNumber) || "catalog",
        `Catalog publish failed: ${item.name}`,
        result.error ?? null,
        JSON.stringify(payload),
      ],
    );
  }
  return {
    itemId,
    name: item.name,
    status: result.ok ? "published" : "error",
    externalId,
    message,
    sandbox: false,
  };
}

async function recordPublication(
  db: Db,
  item: CatalogItemRow,
  input: {
    status: string;
    externalId: string | null;
    message: string;
    payload: unknown;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO channel_publications (channel, entity, entity_ref, external_id, status,
        message, payload, published_at, updated_at)
     VALUES ('whatsapp','item',$1,$2,$3,$4,$5,now(),now())
     ON CONFLICT (channel, entity, entity_ref) DO UPDATE SET
       external_id = COALESCE(EXCLUDED.external_id, channel_publications.external_id),
       status = EXCLUDED.status,
       message = EXCLUDED.message,
       payload = EXCLUDED.payload,
       published_at = CASE WHEN EXCLUDED.status = 'published' THEN now() ELSE channel_publications.published_at END,
       updated_at = now()`,
    [
      String(item.id),
      input.externalId,
      input.status,
      input.message,
      input.payload ? JSON.stringify(input.payload) : null,
    ],
  );
}

async function metaRequest(
  token: string,
  method: "POST" | "GET",
  path: string,
  body: unknown,
  config: { catalogId: string },
): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }> {
  try {
    const url = `https://graph.facebook.com/v21.0/${path.replace(/^\//, "")}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return {
        ok: false,
        data,
        error:
          (data.error as { message?: string } | undefined)?.message ??
          `Meta returned ${response.status}`,
      };
    }
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      data: {},
      error: error instanceof Error ? error.message : "Meta request failed",
    };
  }
}

/** Push the whole menu (only dishes flagged for WhatsApp). Returns a summary. */
export async function syncWhatsAppCatalog(
  db: Db,
  actor: string,
): Promise<{ published: number; failed: number; skipped: number; results: PublishResult[] }> {
  const items = await db.query<{ id: number }>(
    "SELECT id FROM menu_items WHERE whatsapp_publish AND published ORDER BY id",
  );
  const results: PublishResult[] = [];
  let published = 0;
  let failed = 0;
  let skipped = 0;
  for (const item of items) {
    const result = await publishMenuItem(db, item.id, actor);
    results.push(result);
    if (result.status === "published") published += 1;
    else if (result.status === "error") failed += 1;
    else skipped += 1;
  }
  return { published, failed, skipped, results };
}

/** Counts for the WhatsApp console. */
export async function catalogStats(db: Db): Promise<{
  dishes: number;
  publishable: number;
  published: number;
  errors: number;
  tracked: number;
  lowStock: number;
  outOfStock: number;
}> {
  const row = await db.one<{
    dishes: number;
    publishable: number;
    published: number;
    errors: number;
    tracked: number;
    low: number;
    out: number;
  }>(
    `SELECT
       COUNT(*) AS dishes,
       COUNT(*) FILTER (WHERE mi.published AND mi.whatsapp_publish) AS publishable,
       COUNT(*) FILTER (WHERE cp.status = 'published') AS published,
       COUNT(*) FILTER (WHERE cp.status = 'error') AS errors,
       COUNT(*) FILTER (WHERE mi.track_stock) AS tracked,
       COUNT(*) FILTER (WHERE mi.track_stock AND mi.stock_qty IS NOT NULL
                          AND mi.stock_qty <= mi.low_stock_level AND mi.stock_qty > 0) AS low,
       COUNT(*) FILTER (WHERE mi.track_stock AND mi.stock_qty IS NOT NULL AND mi.stock_qty <= 0) AS out
     FROM menu_items mi
     LEFT JOIN channel_publications cp
       ON cp.channel = 'whatsapp' AND cp.entity = 'item' AND cp.entity_ref = mi.id::text`,
  );
  return {
    dishes: Number(row.dishes),
    publishable: Number(row.publishable),
    published: Number(row.published),
    errors: Number(row.errors),
    tracked: Number(row.tracked),
    lowStock: Number(row.low),
    outOfStock: Number(row.out),
  };
}

/**
 * Take stock off the shelf when an order is accepted. Idempotent per order:
 * `inventory_movements` carries the order id, and the caller only runs this once
 * (the order status transition is the guard).
 */
export async function consumeStockForOrder(
  db: Db,
  orderId: number,
  actor: string,
): Promise<{ consumed: number; soldOut: number[] }> {
  const lines = await db.query<{ item_id: number | null; name: string; qty: number }>(
    `SELECT item_id, name, SUM(qty) AS qty
       FROM order_items WHERE order_id = $1 AND item_id IS NOT NULL
      GROUP BY item_id, name`,
    [orderId],
  );
  const existing = await db.one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM inventory_movements WHERE order_id = $1 AND reason = 'order'",
    [orderId],
  );
  if (Number(existing.c) > 0) return { consumed: 0, soldOut: [] };

  let consumed = 0;
  const soldOut: number[] = [];
  for (const line of lines) {
    const item = await db.maybeOne<{ id: number; track_stock: boolean; stock_qty: number | null }>(
      "SELECT id, track_stock, stock_qty FROM menu_items WHERE id = $1",
      [line.item_id],
    );
    if (!item || !item.track_stock || item.stock_qty === null) continue;
    const after = item.stock_qty - Number(line.qty);
    await db.query("UPDATE menu_items SET stock_qty = $1, updated_at = now() WHERE id = $2", [
      after,
      item.id,
    ]);
    await db.query(
      `INSERT INTO inventory_movements (item_id, delta, stock_after, reason, order_id, actor)
       VALUES ($1,$2,$3,'order',$4,$5)`,
      [item.id, -Number(line.qty), after, orderId, actor],
    );
    consumed += Number(line.qty);
    if (after <= 0) {
      await db.query("UPDATE menu_items SET is_available = FALSE, updated_at = now() WHERE id = $1", [
        item.id,
      ]);
      soldOut.push(item.id);
      await publishMenuItem(db, item.id, actor).catch(() => null);
    }
  }
  return { consumed, soldOut };
}

/** Restock, correct, or set the count for one dish, then re-publish it. */
export async function setItemStock(
  db: Db,
  itemId: number,
  actor: string,
  input: {
    stockQty?: number | null;
    trackStock?: boolean;
    lowStockLevel?: number;
    available?: boolean;
    publish?: boolean;
  },
): Promise<CatalogItemRow> {
  const before = await catalogItem(db, itemId);
  if (!before) throw new Error("Dish not found");
  const nextStock =
    input.stockQty === undefined ? before.stock_qty : input.stockQty;
  const trackStock = input.trackStock ?? before.track_stock;
  const lowStockLevel = input.lowStockLevel ?? before.low_stock_level;
  // Availability follows the count unless a staff member sets it explicitly:
  // a tracked dish at zero is sold out, and restocking it comes back on its own.
  const autoSoldOut = trackStock && nextStock !== null && nextStock <= 0;
  const autoBack = trackStock && nextStock !== null && nextStock > 0 && (before.stock_qty ?? 0) <= 0;
  const available =
    input.available ?? (autoSoldOut ? false : autoBack ? true : before.is_available);
  await db.query(
    `UPDATE menu_items SET stock_qty = $1, track_stock = $2, low_stock_level = $3,
       is_available = $4, whatsapp_publish = COALESCE($5, whatsapp_publish), updated_at = now()
     WHERE id = $6`,
    [nextStock, trackStock, Math.max(0, lowStockLevel), available, input.publish ?? null, itemId],
  );
  if (nextStock !== before.stock_qty && nextStock !== null) {
    await db.query(
      `INSERT INTO inventory_movements (item_id, delta, stock_after, reason, actor)
       VALUES ($1,$2,$3,'correction',$4)`,
      [itemId, nextStock - (before.stock_qty ?? 0), nextStock, actor],
    );
  }
  const after = await catalogItem(db, itemId);
  if (after && (input.publish !== false)) {
    await publishMenuItem(db, itemId, actor).catch(() => null);
  }
  return (await catalogItem(db, itemId))!;
}

/** Recent stock movements for the console. */
export async function recentStockMovements(db: Db, limit = 12) {
  return db.query<{
    id: number;
    item_id: number | null;
    delta: number;
    stock_after: number | null;
    reason: string;
    actor: string;
    created_at: string;
    item_name: string | null;
  }>(
    `SELECT m.*, mi.name AS item_name
       FROM inventory_movements m
       LEFT JOIN menu_items mi ON mi.id = m.item_id
      ORDER BY m.id DESC LIMIT $1`,
    [limit],
  );
}
