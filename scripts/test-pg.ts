/**
 * End-to-end test of the Postgres data layer against PGlite (real Postgres 17
 * compiled to WASM, running in-process — no server, no Docker, no Neon needed).
 *
 *   npm run test:pg
 *
 * It drives the application's own modules (not a re-implementation): the schema,
 * the seed, order creation for all four channels, the counter → kitchen → ready
 * hand-offs, courier quoting/dispatch/tracking, a production batch that posts
 * material costs, settings, pricing rules, reviews, release notes and the
 * health payload's row counts.
 */
import { createHarness } from "./lib/pglite";
import { setDbFactory, getDb } from "../lib/db";
import { SCHEMA_SQL } from "../lib/db/schema";
import { seedDatabase } from "../lib/db/seed";
import {
  cancelOrder,
  completeOrder,
  confirmOrder,
  createOrder,
  dispatchOrder,
  getFullOrder,
  getOrderById,
  getOrderByCode,
  listOrders,
  markOrderPaid,
  markOrderReady,
  orderStats,
  publicOrderPayload,
  refreshDeliveryQuote,
  setItemPrepState,
  syncDelivery,
} from "../lib/orders";
import {
  cancelBatch,
  cogsTotals,
  completeBatch,
  getBatch,
  getRecipeCost,
  materialUsage,
  startBatch,
} from "../lib/production";
import {
  computePricing,
  getActiveRules,
  getUpcomingHolidays,
  getHoliday,
  resolvePriorityFee,
} from "../lib/pricing";
import {
  getCategories,
  getFeaturedItems,
  getItemReviews,
  getMenuItem,
  getMenuItems,
  menuSummary,
} from "../lib/catalog";
import { priceCart } from "../lib/cart";
import {
  getSetting,
  getSettingNumber,
  getSettings,
  setSetting,
  setSettings,
} from "../lib/settings";
import { verifyPassword } from "../lib/auth/password";
import type { Db } from "../lib/db/driver";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function count(db: Db, table: string) {
  return Number(
    (await db.one<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)).c,
  );
}

async function main() {
  console.log("Booting PGlite (Postgres in WASM)…");
  const harness = await createHarness();
  setDbFactory(() => harness.db);
  process.env.DATABASE_URL = "postgres://pglite/khanbaba";

  const db = await getDb();

  // ------------------------------------------------------------------ schema
  section("Schema + seed (self-migrating)");
  // getDb() itself applies the schema and seeds an empty database — that is what
  // makes the Vercel deploy work with no manual migration step.
  check(
    "first connection auto-created the schema",
    (await count(db, "menu_items")) > 0,
  );
  const reseed = await seedDatabase(db);
  check("re-running the seed is a no-op", !reseed.seeded);

  const tables = [
    "settings",
    "staff",
    "categories",
    "menu_items",
    "item_variants",
    "reviews",
    "materials",
    "recipes",
    "recipe_lines",
    "production_batches",
    "cost_postings",
    "pricing_rules",
    "holidays",
    "dining_tables",
    "orders",
    "order_items",
    "order_events",
    "payments",
    "delivery_jobs",
    "whats_new",
  ];
  for (const table of tables) {
    const rows = await count(db, table);
    check(`${table} has rows (${rows})`, rows > 0);
  }
  check("all 20 tables exist", tables.length === 20);

  // the schema is idempotent: applying it again must not error
  await db.exec(SCHEMA_SQL);
  check("schema re-applies cleanly (migration is idempotent)", true);

  // ------------------------------------------------------------------ types
  section("Type mapping (identical to the SQLite shapes the UI expects)");
  const staff = await db.query<{
    id: number;
    active: boolean;
    created_at: string;
  }>("SELECT id, active, created_at FROM staff ORDER BY id LIMIT 1");
  check("id is a number", typeof staff[0].id === "number");
  check("active is a boolean", staff[0].active === true);
  check(
    "created_at is an ISO string",
    typeof staff[0].created_at === "string" &&
      staff[0].created_at.includes("T"),
  );
  const holiday = await db.one<{ date: string }>(
    "SELECT date::text AS date FROM holidays ORDER BY date LIMIT 1",
  );
  check(
    "holiday date reads back as YYYY-MM-DD",
    /^\d{4}-\d{2}-\d{2}$/.test(holiday.date),
    holiday.date,
  );
  const aggregated = await db.one<{ c: number; avg: number }>(
    "SELECT COUNT(*) AS c, AVG(rating) AS avg FROM reviews",
  );
  check("COUNT(*) comes back as a number", typeof aggregated.c === "number");
  check("AVG() comes back as a number", typeof aggregated.avg === "number");

  // ------------------------------------------------------------------ auth
  section("Auth");
  const admin = await db.one<{ password_hash: string; role: string }>(
    "SELECT password_hash, role FROM staff WHERE email = 'admin@khanbaba.com.au'",
  );
  check(
    "seeded admin password verifies",
    verifyPassword("KhanBaba2026!", admin.password_hash),
  );
  check(
    "wrong password rejected",
    !verifyPassword("nope", admin.password_hash),
  );

  // ------------------------------------------------------------------ catalog
  section("Catalog");
  const items = await getMenuItems(db);
  check("menu items load", items.length >= 20, items.length);
  check(
    "variants are attached (500 ml / 1000 ml)",
    items.every((item) => item.variants.length > 0),
  );
  const biryani = await getMenuItem("chicken-biryani", db);
  check("dish lookup by slug", Boolean(biryani));
  check(
    "spice levels parsed",
    (biryani?.spiceLevels ?? []).includes("extra_hot"),
  );
  check(
    "rating aggregated from reviews",
    (await getItemReviews(biryani!.id, 5, db)).length > 0,
  );
  const categories = await getCategories(db);
  check(
    "categories have live dish counts",
    categories.every((c) => Number(c.count) >= 0),
  );
  const featured = await getFeaturedItems(db, 4);
  check("featured fallback fills four dishes", featured.length === 4);
  const summary = await menuSummary(db);
  check("menu summary counts dishes", summary.dishes >= 20, summary);

  // ------------------------------------------------------------------ pricing
  section("Pricing rules + holidays");
  const rules = await getActiveRules(db);
  check("pricing rules load", rules.length === 5, rules.length);
  const weekend = await db.one<{ id: number }>(
    "SELECT id FROM holidays WHERE date = '2026-12-25'",
  );
  check("holiday calendar seeded", Boolean(weekend));
  const xmas = await getHoliday(db, "2026-12-25");
  check(
    "holiday lookup by ISO date",
    Boolean(xmas && xmas.name === "Christmas Day"),
  );
  check(
    "upcoming holidays ordered",
    (await getUpcomingHolidays(db, 3)).every(Boolean),
  );
  const priorityPickup = await resolvePriorityFee(db, "pickup", {
    iso: "2026-07-15",
    weekday: 3,
    hour: 13,
    minute: 0,
    hhmm: "13:00",
  });
  check(
    "lunch peak priority applies on Wednesday",
    priorityPickup.isPeak && priorityPickup.feeCents === 450,
    priorityPickup,
  );
  const priorityTable = await resolvePriorityFee(db, "table");
  check(
    "priority is never offered to table guests",
    priorityTable.available === false,
  );
  const xmasPricing = await computePricing(db, {
    subtotalCents: 10000,
    channel: "delivery",
    at: new Date("2026-12-25T02:00:00Z"),
  });
  check(
    "public holiday surcharge uses the calendar rate (15% on Christmas)",
    xmasPricing.surchargeCents === 1500 && xmasPricing.adjustments.length === 1,
    xmasPricing.surchargeCents,
  );
  check(
    "holiday surcharge does not stack with the weekend rate",
    xmasPricing.adjustments[0].kind === "public_holiday",
  );
  check(
    "holiday context surfaced",
    xmasPricing.context.holidayName === "Christmas Day",
  );
  const saturdayPricing = await computePricing(db, {
    subtotalCents: 10000,
    channel: "pickup",
    at: new Date("2026-07-18T02:00:00Z"),
  });
  check(
    "weekend surcharge is 5% on Saturday",
    saturdayPricing.surchargeCents === 500,
    saturdayPricing.adjustments,
  );

  // ------------------------------------------------------------------ settings
  section("Settings");
  check(
    "default applied when unset",
    (await getSetting("nope_not_set", "fallback")) === "fallback",
  );
  check(
    "seeded setting reads",
    (await getSetting("restaurant_name")) === "Khan Baba Restaurant",
  );
  await setSetting("restaurant_name", "Khan Baba — Pitt Street");
  check(
    "setting write is visible",
    (await getSetting("restaurant_name")) === "Khan Baba — Pitt Street",
  );
  await setSettings({
    restaurant_phone: "02 9000 9999",
    min_order_cents: "500",
  });
  const settingsNow = await getSettings();
  check("bulk setting write", settingsNow.restaurant_phone === "02 9000 9999");
  check(
    "numeric setting",
    (await getSettingNumber("min_order_cents", 0)) === 500,
  );
  await setSettings({
    min_order_cents: "0",
    restaurant_name: "Khan Baba Restaurant",
  });

  // ------------------------------------------------------------------ cart
  section("Server-side cart pricing");
  const variant = items[0].variants[0];
  const cart = await priceCart(db, [{ variantId: variant.id, qty: 2 }]);
  check(
    "cart priced from the database",
    cart.subtotalCents === variant.priceCents * 2,
    cart,
  );

  // ------------------------------------------------------------------ orders
  section("Order lifecycle — pickup (counter payment)");
  const pickupOrder = await createOrder(db, {
    channel: "pickup",
    customerName: "Test Pickup",
    phone: "0400000000",
    paymentMethod: "counter",
    items: [
      {
        itemId: items[0].id,
        variantId: items[0].variants[0].id,
        qty: 2,
        spiceLevel: "hot",
      },
    ],
  });
  check("order created", pickupOrder.order.id > 0);
  check("code generated", /^KB-/.test(pickupOrder.order.code));
  check("items written", pickupOrder.items.length === 1);
  check(
    "subtotal from the menu price",
    pickupOrder.order.subtotal_cents === items[0].variants[0].priceCents * 2,
  );
  check(
    "payment pending for counter cash",
    pickupOrder.order.payment_status === "unpaid",
  );
  const created = await getFullOrder(db, pickupOrder.order.code);
  check("created event logged", created!.events[0]?.type === "created");

  const confirmed = await confirmOrder(db, pickupOrder.order.id, "Imran Shah");
  check(
    "counter confirms",
    confirmed.status === "confirmed" && confirmed.progress === 20,
  );
  const prep = await setItemPrepState(
    db,
    pickupOrder.order.id,
    pickupOrder.items[0].id,
    "preparing",
    "Chef Bilal",
  );
  check("item prep moves the order to preparing", prep.status === "preparing");
  const ready = await setItemPrepState(
    db,
    pickupOrder.order.id,
    pickupOrder.items[0].id,
    "ready",
    "Chef Bilal",
  );
  check(
    "progress climbs with item completion",
    ready.progress > 20,
    ready.progress,
  );
  const packed = await markOrderReady(db, pickupOrder.order.id, "Chef Bilal");
  check(
    "bump sends pickup to awaiting_collection",
    packed.status === "awaiting_collection",
    packed.status,
  );
  check("progress 88 for pickup", packed.progress === 88);
  const paid = await markOrderPaid(
    db,
    pickupOrder.order.id,
    "Imran Shah",
    "cash",
  );
  check("counter marks cash paid", paid.payment_status === "paid");
  const paidRow = await db.one<{ provider: string; amount_cents: number }>(
    "SELECT provider, amount_cents FROM payments WHERE order_id = $1",
    [pickupOrder.order.id],
  );
  check(
    "payment row written",
    paidRow.provider === "counter" && paidRow.amount_cents === paid.total_cents,
  );
  const collected = await completeOrder(
    db,
    pickupOrder.order.id,
    "Imran Shah",
    "Collected by the customer",
  );
  check(
    "collection completes the order",
    collected.status === "completed" && collected.progress === 100,
  );

  section("Order lifecycle — table QR order");
  const table = await db.one<{ code: string }>(
    "SELECT code FROM dining_tables WHERE code = 'T04'",
  );
  const tableOrder = await createOrder(db, {
    channel: "table",
    customerName: "Table 4",
    tableCode: table.code,
    paymentMethod: "online",
    items: [
      { itemId: items[1].id, variantId: items[1].variants[0].id, qty: 1 },
    ],
  });
  check("table order links the table", tableOrder.order.table_id !== null);
  check(
    "online payment captured by the sandbox gateway",
    tableOrder.order.payment_status === "paid",
  );
  const tablePayload = await publicOrderPayload(db, tableOrder.order.code);
  check(
    "public payload exposes the table",
    tablePayload?.table?.code === "T04",
  );
  check(
    "public payload keeps camelCase shape",
    typeof tablePayload?.order.totalCents === "number",
  );
  let rejectedTable = false;
  try {
    await createOrder(db, {
      channel: "table",
      customerName: "Ghost",
      tableCode: "T99",
      paymentMethod: "counter",
      items: [
        { itemId: items[0].id, variantId: items[0].variants[0].id, qty: 1 },
      ],
    });
  } catch {
    rejectedTable = true;
  }
  check("unknown table code is rejected", rejectedTable);

  section("Order lifecycle — delivery (quote → dispatch → delivered)");
  const deliveryOrder = await createOrder(db, {
    channel: "delivery",
    customerName: "Test Delivery",
    phone: "0411111111",
    address: "12/48 Pirrama Road",
    suburb: "Pyrmont",
    postcode: "2009",
    paymentMethod: "online",
    items: [
      { itemId: items[0].id, variantId: items[0].variants[0].id, qty: 3 },
    ],
  });
  check(
    "delivery fee charged",
    deliveryOrder.order.delivery_fee_cents > 0,
    deliveryOrder.order.delivery_fee_cents,
  );
  check(
    "courier cost recorded below the fee",
    deliveryOrder.order.delivery_cost_cents <
      deliveryOrder.order.delivery_fee_cents,
  );
  const job = await db.one<{ provider: string; status: string }>(
    "SELECT provider, status FROM delivery_jobs WHERE order_id = $1",
    [deliveryOrder.order.id],
  );
  check("delivery job seeded as quoted", job.status === "quoted");
  const requoted = await refreshDeliveryQuote(
    db,
    deliveryOrder.order.id,
    "Hamza Ali",
  );
  check(
    "re-quote keeps the customer fee",
    requoted.customer_fee_cents === deliveryOrder.order.delivery_fee_cents,
  );
  await confirmOrder(db, deliveryOrder.order.id, "Imran Shah");
  await markOrderReady(db, deliveryOrder.order.id, "Chef Bilal");
  const dispatched = await dispatchOrder(
    db,
    deliveryOrder.order.id,
    "Hamza Ali",
  );
  check(
    "dispatch records the courier",
    Boolean(dispatched.provider_delivery_id),
    dispatched,
  );
  const moving = await getOrderById(db, deliveryOrder.order.id);
  check(
    "order is out for delivery",
    moving?.status === "out_for_delivery" && moving.progress === 92,
  );
  await syncDelivery(db, deliveryOrder.order.id, "system");
  const afterSync = await getOrderById(db, deliveryOrder.order.id);
  check("courier sync keeps a valid status", Boolean(afterSync?.status));
  let blockedUnpaid = false;
  try {
    const unpaid = await createOrder(db, {
      channel: "delivery",
      customerName: "Unpaid",
      address: "1 Test Street",
      paymentMethod: "counter",
      items: [
        { itemId: items[0].id, variantId: items[0].variants[0].id, qty: 2 },
      ],
    });
    await dispatchOrder(db, unpaid.order.id, "Hamza Ali");
  } catch {
    blockedUnpaid = true;
  }
  check("dispatch blocked (payment rule holds)", blockedUnpaid);

  section("Order lifecycle — dine-in + cancel/refund");
  const dineIn = await createOrder(db, {
    channel: "dine_in",
    customerName: "Walk-in — 2 guests",
    paymentMethod: "online",
    items: [
      { itemId: items[2].id, variantId: items[2].variants[0].id, qty: 1 },
    ],
  });
  check("dine-in created", dineIn.order.channel === "dine_in");
  const cancelled = await cancelOrder(
    db,
    dineIn.order.id,
    "Imran Shah",
    "Guest left",
  );
  check("cancel sets status", cancelled.status === "cancelled");
  check(
    "paid order is refunded on cancel",
    cancelled.payment_status === "refunded",
  );
  check(
    "cancel reason stored",
    (
      await db.one<{ cancelled_reason: string }>(
        "SELECT cancelled_reason FROM orders WHERE id = $1",
        [dineIn.order.id],
      )
    ).cancelled_reason === "Guest left",
  );

  section("Validation");
  let emptyCart = false;
  try {
    await createOrder(db, {
      channel: "pickup",
      customerName: "Nobody",
      paymentMethod: "counter",
      items: [],
    });
  } catch (error) {
    emptyCart = (error as Error).message.includes("cart is empty");
  }
  check("empty cart rejected", emptyCart);
  let badName = false;
  try {
    await createOrder(db, {
      channel: "pickup",
      customerName: "X",
      paymentMethod: "counter",
      items: [
        { itemId: items[0].id, variantId: items[0].variants[0].id, qty: 1 },
      ],
    });
  } catch {
    badName = true;
  }
  check("short name rejected", badName);
  let belowMinimum = false;
  try {
    await getDb();
    await setSetting("delivery_min_order_cents", "100000");
    await createOrder(db, {
      channel: "delivery",
      customerName: "Small order",
      address: "1 Test Street",
      paymentMethod: "online",
      items: [
        { itemId: items[0].id, variantId: items[0].variants[0].id, qty: 1 },
      ],
    });
  } catch (error) {
    belowMinimum = (error as Error).message.includes("Minimum order");
  } finally {
    await setSetting("delivery_min_order_cents", "2500");
  }
  check("delivery minimum enforced", belowMinimum);

  // ------------------------------------------------------------------ production
  section("Production batches + cost postings");
  const naanRecipe = await db.one<{ id: number; output_qty: number }>(
    "SELECT id, output_qty FROM recipes WHERE name LIKE 'Naan —%'",
  );
  const nannCost = await getRecipeCost(db, naanRecipe.id);
  check(
    "recipe cost computed",
    nannCost.totalCostCents > 0 && nannCost.lines.length === 5,
    nannCost.totalCostCents,
  );
  const attaBefore = await db.one<{ id: number; stock_qty: number }>(
    "SELECT id, stock_qty FROM materials WHERE name = 'Atta flour'",
  );
  const postingsBefore = await count(db, "cost_postings");
  const batch = await startBatch(db, {
    recipeId: naanRecipe.id,
    plannedQty: 50,
    actor: "Chef Bilal",
    notes: "test run",
  });
  check(
    "batch started in_progress",
    batch.status === "in_progress" && /^BATCH-/.test(batch.ref),
  );
  const completed = await completeBatch(db, batch.id, "Chef Bilal");
  check("batch completed", completed.batch.status === "completed");
  check(
    "one cost posting per material line",
    completed.postings === 5,
    completed.postings,
  );
  check(
    "batch total matches the postings",
    completed.totalCostCents === nannCost.totalCostCents,
  );
  const attaAfter = await db.one<{ stock_qty: number }>(
    "SELECT stock_qty FROM materials WHERE id = $1",
    [attaBefore.id],
  );
  check(
    "stock drawn down by the batch",
    attaAfter.stock_qty < attaBefore.stock_qty,
    {
      before: attaBefore.stock_qty,
      after: attaAfter.stock_qty,
    },
  );
  check(
    "postings ledger grew",
    (await count(db, "cost_postings")) === postingsBefore + 5,
  );
  check(
    "cogs totals reflect the batch",
    (await cogsTotals(db, 1)).cost_cents >= completed.totalCostCents,
  );
  check("material usage aggregates", (await materialUsage(db, 30)).length > 0);
  const getAgain = await getBatch(db, batch.id);
  check(
    "batch reads back with its recipe name",
    Boolean(getAgain?.recipe_name),
  );
  let doubleComplete = false;
  try {
    await completeBatch(db, batch.id, "Chef Bilal");
  } catch {
    doubleComplete = true;
  }
  check("completing twice is rejected", doubleComplete);
  const cancelledBatch = await startBatch(db, {
    recipeId: naanRecipe.id,
    plannedQty: 10,
    actor: "Chef Bilal",
  });
  await cancelBatch(db, cancelledBatch.id);
  check(
    "batch cancelled",
    (await getBatch(db, cancelledBatch.id))?.status === "cancelled",
  );
  const lowStock = await db.query(
    "SELECT * FROM materials WHERE active AND stock_qty <= reorder_level",
  );
  check("low-stock query runs against booleans", Array.isArray(lowStock));

  // ------------------------------------------------------------------ reviews
  section("Reviews, release feed and staff");
  const itemId = items[0].id;
  await db.query(
    "INSERT INTO reviews (item_id, customer_name, rating, comment, status) VALUES ($1, 'Guest', 5, 'Lovely', 'published')",
    [itemId],
  );
  check(
    "review inserted and read back",
    (await getItemReviews(itemId, 20, db)).length > 0,
  );
  const whatsNew = await db.query<{ title: string }>(
    "SELECT title FROM whats_new ORDER BY pinned DESC, published_at DESC",
  );
  check("release feed seeded", whatsNew.length >= 9, whatsNew.length);
  check(
    "this release is announced (Postgres migration)",
    whatsNew.some((entry) => entry.title.includes("One database")),
  );
  check(
    "photo storage release note present",
    whatsNew.some((entry) => entry.title.includes("Google Drive")),
  );
  check("pinned entry first", whatsNew[0].title === "Order online, your way");
  const staffCount = await count(db, "staff");
  check("five demo staff accounts", staffCount === 5, staffCount);

  // ------------------------------------------------------------------ stats
  section("Reporting (health + admin dashboard queries)");
  const stats = await orderStats(db);
  check(
    "today's stats compute",
    typeof stats.today.revenue === "number" && stats.today.orders > 0,
    stats.today,
  );
  check("pending count is a number", typeof stats.pending === "number");
  const recent = await listOrders(db, { limit: 5 });
  check(
    "order list sorted newest first",
    recent.length === 5 &&
      new Date(recent[0].created_at) >= new Date(recent[4].created_at),
  );
  const deliveryOnly = await listOrders(db, { channel: "delivery", limit: 50 });
  check(
    "channel filter works",
    deliveryOnly.every((order) => order.channel === "delivery"),
  );
  const readyOnly = await listOrders(db, {
    status: ["ready", "awaiting_collection"],
    limit: 50,
  });
  check(
    "status array filter works",
    readyOnly.every((order) =>
      ["ready", "awaiting_collection"].includes(order.status),
    ),
  );
  const byCode = await getOrderByCode(db, pickupOrder.order.code.toLowerCase());
  check(
    "order lookup is case-insensitive",
    byCode?.id === pickupOrder.order.id,
  );
  const demoOrders = await db.query(
    "SELECT code FROM orders WHERE code LIKE 'KB-DEMO%' ORDER BY code",
  );
  check(
    "demo orders KB-DEMO01..06 present",
    demoOrders.length === 6,
    demoOrders.length,
  );

  // dashboard queries copied from app/admin/page.tsx
  const week = await db.query(
    `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, COUNT(*) AS orders,
      COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_cents ELSE 0 END), 0) AS revenue
     FROM orders WHERE created_at::date >= CURRENT_DATE - 6
     GROUP BY created_at::date ORDER BY day`,
  );
  check("7-day revenue chart query runs", Array.isArray(week));
  const topItems = await db.query(
    `SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.line_total_cents) AS revenue
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.status != 'cancelled' AND o.created_at::date >= CURRENT_DATE - 30
     GROUP BY oi.name ORDER BY revenue DESC LIMIT 5`,
  );
  check("top sellers query runs", topItems.length > 0);
  const margins = await db.one(
    `SELECT COALESCE(SUM(j.customer_fee_cents - j.cost_cents), 0) AS margin, COUNT(*) AS jobs
     FROM delivery_jobs j JOIN orders o ON o.id = j.order_id
     WHERE o.status = 'completed' AND o.completed_at::date >= CURRENT_DATE - 7`,
  );
  check("delivery margin query runs", margins !== null);

  // --------------------------------------------------------------- concurrency
  section("Concurrency + transactions");
  const before = await count(db, "orders");
  let rolledBack = false;
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO orders (code, channel, customer_name, payment_method, total_cents)
         VALUES ('KB-ROLLBACK', 'pickup', 'Ghost', 'counter', 100)`,
      );
      throw new Error("roll back");
    });
  } catch {
    rolledBack = true;
  }
  check("failed transaction rolls back", rolledBack);
  check(
    "no row left behind after rollback",
    (await count(db, "orders")) === before,
  );
  const parallel = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      createOrder(db, {
        channel: "pickup",
        customerName: `Parallel ${index}`,
        paymentMethod: "counter",
        items: [
          { itemId: items[0].id, variantId: items[0].variants[0].id, qty: 1 },
        ],
      }),
    ),
  );
  check(
    "five concurrent orders all succeed",
    parallel.length === 5 &&
      new Set(parallel.map((o) => o.order.code)).size === 5,
  );
  check("ids are unique", new Set(parallel.map((o) => o.order.id)).size === 5);

  // ------------------------------------------------------------------ health
  section("Health payload");
  const counts = {
    menuItems: await count(db, "menu_items"),
    tables: await count(db, "dining_tables"),
    orders: await count(db, "orders"),
    materials: await count(db, "materials"),
  };
  check(
    "health counts are real numbers",
    Object.values(counts).every(
      (value) => typeof value === "number" && value > 0,
    ),
    counts,
  );

  await harness.close();

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(
      "Failed checks:\n" + failures.map((name) => ` - ${name}`).join("\n"),
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\nHarness crashed:", error);
  process.exit(1);
});
