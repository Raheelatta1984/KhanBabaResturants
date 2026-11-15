/**
 * End-to-end test of the Postgres data layer against PGlite (real Postgres 17
 * compiled to WASM, running in-process — no server, no Docker, no Supabase needed).
 *
 *   npm run test:pg
 *
 * It drives the application's own modules (not a re-implementation): the schema,
 * the seed, order creation for all four channels, the counter → kitchen → ready
 * hand-offs, courier quoting/dispatch/tracking, a production batch that posts
 * material costs, settings, pricing rules, reviews, release notes, the ERP
 * expansion modules and the health payload's row counts.
 */
import assert from "node:assert/strict";
import { createHarness } from "./lib/pglite";
import {
  listDeliveryZones,
  quoteFromZones,
} from "../lib/delivery/zones";
import { quoteDelivery } from "../lib/delivery";
import {
  broadcastRecipients,
  menuBlog,
  menuBroadcastBody,
  menuCaption,
  menuHashtags,
  saveDraft,
  todayMenu,
} from "../lib/marketing/engine";
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
  DEFAULT_COMMUNITY_AUTO_REPLY,
  deleteSetting,
  getSetting,
  getSettingNumber,
  getSettings,
  setSetting,
  setSettings,
} from "../lib/settings";
import { verifyPassword } from "../lib/auth/password";
import {
  claimOrdersForEmail,
  createClaimToken,
  publicCustomer,
  getCustomerByEmail,
  redeemClaimToken,
  setCustomerPassword,
  signinCustomer,
  signupCustomer,
  upsertGuestCustomer,
  verifyCustomerToken,
} from "../lib/auth/customer";
import { signToken, verifyToken } from "../lib/auth/token";
import {
  DEMO_PASSWORD,
  UserAdminError,
  changeOwnPassword,
  createStaff,
  deleteStaff,
  demoLoginsEnabled,
  demoStatus,
  goLive,
  liveStaffSession,
  passwordFingerprint,
  resetCustomerPassword,
  resetStaffPassword,
  setCustomerActive,
  setStaffActive,
  updateStaff,
} from "../lib/auth/users";
import type { StaffSession } from "../lib/auth/core";
import {
  getOrderByTrackingToken,
  listCustomerOrders,
  resolveOrderRef,
} from "../lib/orders";
import {
  createSqlFromClient,
  customTypes,
  isSupabasePooler,
  postgresConfig,
  splitStatements,
  type Db,
} from "../lib/db/driver";
import {
  databaseConfigured,
  databaseProjectRef,
  databaseUrl,
  describeDatabaseTarget,
  supabaseUrlProjectRef,
} from "../lib/db";
import { PAYMENT_OPTIONS, enabledPaymentOptions } from "../lib/payments";
import { validatePromotion } from "../lib/promotions";
import {
  atoReportCsv,
  driverAtoReport,
  financialYear,
} from "../lib/drivers";
import {
  claimOfferByToken,
  publicOffers,
} from "../lib/community";
import { squareStatus, syncSquare } from "../lib/integrations/square";
import {
  approveMusicRequest,
  clearEncouragement,
  getNowPlaying,
  pauseMusic,
  playCollection,
  resumeMusic,
  scheduledCollection,
  setMusicVolume,
  submitMusicRequest,
  triggerTableEncouragement,
} from "../lib/music";
import {
  catalogItem,
  consumeStockForOrder,
  publishMenuItem,
  setItemStock,
} from "../lib/whatsapp/catalog";
import {
  handleInboundWhatsApp,
  parseOrderText,
  requestOrderPayment,
} from "../lib/whatsapp/orders";
import { whatsappConfig } from "../lib/whatsapp/client";
import { parkOrder, settleTableOrder } from "../lib/dine-in";
import {
  feedbackInviteByToken,
  submitFeedback,
} from "../lib/feedback";

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
    "customers",
    "customer_activity",
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
  check("all 22 tables exist", tables.length === 22);

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

  section("Customer accounts, tracking links and claiming");
  // 1. The signed-token primitive: a token signed for one audience must not be
  //    accepted as another, and tampering must fail.
  const staffish = await signToken({ id: 1, name: "x", aud: "staff" }, 60);
  check(
    "a staff-audience token is not a customer session",
    (await verifyCustomerToken(staffish)) === null,
  );
  const customerTok = await signToken({ id: 1, name: "x", aud: "customer" }, 60);
  check(
    "a customer token verifies",
    (await verifyCustomerToken(customerTok))?.email === "x" ||
      (await verifyCustomerToken(customerTok)) !== null,
  );
  check(
    "tampering with the payload invalidates the signature",
    (await verifyToken(customerTok.replace(/.$/, (c) => (c === "A" ? "B" : "A")))) === null,
  );
  check(
    "an expired token is rejected",
    (await verifyToken(await signToken({ id: 1 }, -5))) === null,
  );

  // 2. Sign-up, sign-in and the guest-to-account upgrade path.
  const signup = await signupCustomer(db, {
    name: "Test Diner",
    email: "Test.Diner@Example.com",
    password: "correct horse battery",
    phone: "0411 000 111",
  });
  check("signup creates an account", signup.customer.id > 0);
  check(
    "the email is normalised to lowercase",
    signup.customer.email === "test.diner@example.com",
  );
  check(
    "signup issues a customer-audience session",
    (await verifyCustomerToken(signup.token))?.id === signup.customer.id,
  );
  check(
    "the public customer shape never includes the password hash",
    !("password_hash" in publicCustomer(signup.customer)) &&
      "email" in publicCustomer(signup.customer),
  );
  let duplicateRejected = false;
  try {
    await signupCustomer(db, {
      name: "Impostor",
      email: "test.diner@example.com",
      password: "another password",
    });
  } catch {
    duplicateRejected = true;
  }
  check("a duplicate signup is rejected", duplicateRejected);
  let weakRejected = false;
  try {
    await signupCustomer(db, { name: "Short", email: "s@e.com", password: "1234" });
  } catch {
    weakRejected = true;
  }
  check("a short password is rejected", weakRejected);
  const signin = await signinCustomer(db, {
    email: "test.diner@example.com",
    password: "correct horse battery",
  });
  check("sign-in works with the same password", signin.customer.id === signup.customer.id);
  let wrongRejected = false;
  try {
    await signinCustomer(db, {
      email: "test.diner@example.com",
      password: "wrong password",
    });
  } catch {
    wrongRejected = true;
  }
  check("the wrong password is rejected", wrongRejected);

  // 3. An anonymous checkout creates a guest row; registering upgrades it in
  //    place and pulls the earlier order into the account.
  const guest = await upsertGuestCustomer(db, {
    name: "Guest Orders",
    email: "guest@example.com",
    phone: "0422 333 444",
  });
  check("checkout creates a guest customer row", guest?.guest === true);
  const guestOrder = await createOrder(db, {
    channel: "pickup",
    customerName: "Guest Orders",
    email: "guest@example.com",
    phone: "0422 333 444",
    paymentMethod: "counter",
    items: [{ itemId: items[0].id, variantId: items[0].variants[0].id, qty: 1 }],
  });
  check(
    "the guest order is attached to the guest customer",
    guestOrder.order.customer_id === guest!.id,
  );
  check(
    "every order gets an unguessable tracking token",
    Boolean(guestOrder.trackingToken) && guestOrder.trackingToken!.length >= 20,
  );
  const upgraded = await signupCustomer(db, {
    name: "Guest Orders",
    email: "guest@example.com",
    password: "now-i-have-a-password",
  });
  check(
    "signing up with the guest email upgrades the same row",
    upgraded.customer.id === guest!.id && upgraded.customer.guest === false,
  );
  const guestHistory = await listCustomerOrders(db, upgraded.customer.id);
  check(
    "the earlier guest order is now in the account history",
    guestHistory.some((entry) => entry.order.code === guestOrder.order.code),
  );

  // 4. Tracking tokens: resolve by token, by code, and via the generic ref.
  const byToken = await getOrderByTrackingToken(db, guestOrder.trackingToken!);
  check("an order resolves from its tracking token", byToken?.code === guestOrder.order.code);
  check(
    "resolveOrderRef handles a code",
    (await resolveOrderRef(db, guestOrder.order.code))?.id === guestOrder.order.id,
  );
  check(
    "resolveOrderRef handles a token",
    (await resolveOrderRef(db, guestOrder.trackingToken!))?.id === guestOrder.order.id,
  );
  check(
    "a made-up token finds nothing",
    (await getOrderByTrackingToken(db, "not-a-real-token")) === null,
  );
  const payload = await publicOrderPayload(db, guestOrder.order.code);
  check(
    "the public payload carries the tracking token",
    payload?.trackingToken === guestOrder.trackingToken,
  );

  // 5. Claim links: single use, hashed at rest.
  const claimOrder = await createOrder(db, {
    channel: "pickup",
    customerName: "Claim Me",
    email: "claim@example.com",
    phone: "0433 000 111",
    paymentMethod: "counter",
    items: [{ itemId: items[0].id, variantId: items[0].variants[0].id, qty: 1 }],
  });
  const claimToken = await createClaimToken(db, {
    id: claimOrder.order.id,
    code: claimOrder.order.code,
    email: "claim@example.com",
  });
  check("a claim link is issued for an order with an email", Boolean(claimToken));
  const storedClaim = await db.one<{ token_hash: string }>(
    "SELECT token_hash FROM order_claims WHERE order_id = $1",
    [claimOrder.order.id],
  );
  check(
    "only the hash of the claim token is stored",
    storedClaim.token_hash !== claimToken && /^[0-9a-f]{64}$/.test(storedClaim.token_hash),
  );
  const redeemed = await redeemClaimToken(db, claimToken!);
  check(
    "redeeming a claim link signs in the guest",
    redeemed.customer.email === "claim@example.com",
  );
  check(
    "redeeming attaches the order to the account",
    (await getOrderById(db, claimOrder.order.id))?.customer_id === redeemed.customer.id,
  );
  const withPassword = await setCustomerPassword(
    db,
    redeemed.customer.id,
    "brand new password",
  );
  check(
    "a claimed guest can set a password and stop being a guest",
    withPassword.guest === false && Boolean(withPassword.password_hash),
  );
  check(
    "the new password signs in",
    (await signinCustomer(db, {
      email: redeemed.customer.email,
      password: "brand new password",
    })).customer.id === redeemed.customer.id,
  );
  check(
    "the claim signs in with a working session",
    (await verifyCustomerToken(redeemed.token))?.id === redeemed.customer.id,
  );
  let replayRejected = false;
  try {
    await redeemClaimToken(db, claimToken!);
  } catch {
    replayRejected = true;
  }
  check("a claim link cannot be used twice", replayRejected);
  let bogusRejected = false;
  try {
    await redeemClaimToken(db, "not-a-token");
  } catch {
    bogusRejected = true;
  }
  check("an invented claim token is rejected", bogusRejected);

  // 6. Claiming by sign-up attaches unclaimed orders with the same email.
  const orphan = await createOrder(db, {
    channel: "pickup",
    customerName: "Orphan Order",
    email: "orphan@example.com",
    paymentMethod: "counter",
    items: [{ itemId: items[0].id, variantId: items[0].variants[0].id, qty: 1 }],
  });
  const orphanCustomer = await upsertGuestCustomer(db, {
    name: "Orphan Order",
    email: "orphan@example.com",
  });
  await db.query("UPDATE orders SET customer_id = NULL WHERE id = $1", [orphan.order.id]);
  const claimedCount = await claimOrdersForEmail(db, orphanCustomer!);
  check(
    "claimOrdersForEmail sweeps up unlinked orders",
    claimedCount >= 1 &&
      (await getOrderById(db, orphan.order.id))?.customer_id === orphanCustomer!.id,
  );
  check(
    "the claim is recorded in the customer's activity log",
    (await count(db, "customer_activity")) > 0,
  );
  check(
    "seeded demo customers exist with password hashes",
    Boolean((await getCustomerByEmail(db, "ayesha@example.com"))?.password_hash),
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
  // House rule: a guest at a table never pays online — the ticket is settled at
  // the counter after the meal.
  check(
    "a table order is forced to pay at the counter",
    tableOrder.order.payment_method === "counter" && tableOrder.order.payment_status === "unpaid",
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
    // A real Western Sydney address inside a published zone. This test used a
    // Pyrmont address (2009) because the kitchen used to be assumed to be in
    // the CBD; the kitchen is in Whalan 2770, and 2009 is correctly refused now.
    address: "7 Bulolo Drive",
    suburb: "Whalan",
    postcode: "2770",
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
    paymentMethod: "counter",
    items: [
      { itemId: items[2].id, variantId: items[2].variants[0].id, qty: 1 },
    ],
  });
  check("dine-in created", dineIn.order.channel === "dine_in");
  await markOrderPaid(db, dineIn.order.id, "Rina Patel", "cash");
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
  check(
    "the Supabase migration is announced",
    whatsNew.some((entry) => entry.title.includes("Supabase")),
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
    "demo orders KB-DEMO01..07 present",
    ["KB-DEMO01", "KB-DEMO02", "KB-DEMO03", "KB-DEMO04", "KB-DEMO05", "KB-DEMO06", "KB-DEMO07"].every(
      (code) => demoOrders.some((row) => row.code === code),
    ),
    demoOrders.map((row) => row.code),
  );
  check(
    "the v3 demo orders are seeded too",
    ["KB-DEMO08", "KB-DEMO09", "KB-DEMO10"].every((code) =>
      demoOrders.some((row) => row.code === code),
    ),
    demoOrders.map((row) => row.code),
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
    drivers: await count(db, "drivers"),
    promotions: await count(db, "promotions"),
    communityOffers: await count(db, "community_offers"),
    squareTransactions: await count(db, "square_transactions"),
    deliveryJobs: await count(db, "delivery_jobs"),
  };
  check(
    "health counts are real numbers",
    Object.values(counts).every(
      (value) => typeof value === "number" && value > 0,
    ),
    counts,
  );

  // --------------------------------------------------------- ERP expansion
  section("ERP expansion (drivers, promotions, community, Square)");
  const approvedDriver = await db.one<{ id: number; status: string }>(
    "SELECT id, status FROM drivers WHERE code = 'KB-DRV-001'",
  );
  const verifiedDocs = await db.one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM driver_documents WHERE driver_id = $1 AND status = 'verified'",
    [approvedDriver.id],
  );
  check(
    "approved driver passed all seven verification checks",
    approvedDriver.status === "approved" && Number(verifiedDocs.c) === 7,
    verifiedDocs.c,
  );
  const ato = await driverAtoReport(db, approvedDriver.id, financialYear());
  check(
    "ATO report uses 91c/km and the 5,000 km cap",
    ato.rate === 91 && ato.capKm === 5000 && ato.totalKm === 3.8 && ato.claimCents === 346,
    ato,
  );
  check(
    "ATO CSV includes the trip and a TOTAL row",
    atoReportCsv(ato).includes("KB-DEMO06") && atoReportCsv(ato).includes("TOTAL"),
  );
  const liveJob = await db.one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM delivery_jobs j JOIN orders o ON o.id = j.order_id
      WHERE o.code = 'KB-DEMO07' AND j.driver_id = $1 AND j.status = 'dropoff'`,
    [approvedDriver.id],
  );
  const pings = await db.one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM driver_location_pings WHERE driver_id = $1",
    [approvedDriver.id],
  );
  check(
    "live own-fleet job has GPS breadcrumbs for the map",
    Number(liveJob.c) === 1 && Number(pings.c) >= 4,
    { liveJob: liveJob.c, pings: pings.c },
  );

  const promotion = await validatePromotion(db, "welcome10", {
    subtotalCents: 3000,
    channel: "pickup",
  });
  check(
    "customer promotion re-validates on the server",
    promotion.discountCents === 300 && promotion.promotion.code === "WELCOME10",
    promotion.discountCents,
  );
  const settings = await getSettings();
  const enabled = enabledPaymentOptions(settings);
  check(
    "Visa, Mastercard, Amex, Afterpay and PayPal are available",
    ["card_visa", "card_mastercard", "card_amex", "afterpay", "paypal"].every(
      (id) => PAYMENT_OPTIONS.some((option) => option.id === id) && enabled.includes(id as never),
    ),
    enabled,
  );

  const offers = await publicOffers(db);
  const openOffer = offers.find((offer) => offer.status === "posted");
  check(
    "community board exposes posted and claimed offers",
    offers.length >= 2 && Boolean(openOffer),
    offers.map((offer) => ({ status: offer.status, token: offer.token })),
  );
  if (openOffer) {
    const claimed = await claimOfferByToken(db, openOffer.token, {
      name: "Test Neighbour",
      keyword: "MINE",
    });
    check(
      "first claim wins, closes comments and uses the exact auto-reply",
      claimed.status === "claimed" &&
        claimed.comments_closed &&
        claimed.auto_reply_text === DEFAULT_COMMUNITY_AUTO_REPLY &&
        Boolean(claimed.claim_order_code?.startsWith("KB-GIVE-")),
      { status: claimed.status, autoReply: claimed.auto_reply_text },
    );
    const autoReply = await db.one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM community_offer_events
        WHERE offer_id = $1 AND kind = 'auto_reply' AND detail = $2`,
      [claimed.id, DEFAULT_COMMUNITY_AUTO_REPLY],
    );
    check(
      "the exact thank-you comment is written to the audit log",
      Number(autoReply.c) === 1,
      autoReply.c,
    );
    if (claimed.claim_order_code) {
      const ticket = await db.one<{ channel: string; total_cents: number }>(
        "SELECT channel, total_cents FROM orders WHERE code = $1",
        [claimed.claim_order_code],
      );
      check(
        "community claim creates a zero-cost click & collect ticket",
        ticket.channel === "pickup" && ticket.total_cents === 0,
        ticket,
      );
    }
    let secondClaimRejected = false;
    try {
      await claimOfferByToken(db, openOffer.token, {
        name: "Too Late",
        keyword: "MINE",
      });
    } catch {
      secondClaimRejected = true;
    }
    check("a second claim is refused", secondClaimRejected);
  }

  const ordersBeforeSquare = await count(db, "orders");
  const squareBefore = await squareStatus(db);
  const squareSync = await syncSquare(db, { limit: 5, sinceDays: 2 });
  const squareAfter = await squareStatus(db);
  check(
    "Square sync runs out-of-band without changing orders",
    squareSync.mode !== "disabled" &&
      squareAfter.records > squareBefore.records &&
      (await count(db, "orders")) === ordersBeforeSquare,
    { before: squareBefore.records, after: squareAfter.records, sync: squareSync },
  );
  check(
    "Square POS data is mirrored in its own detached tables",
    squareAfter.transactions > 0 && squareAfter.outbound > 0,
    squareAfter,
  );

  // ------------------------------------------------------- connection wiring
  // The live outage was not a query bug: DATABASE_URL existed in Vercel with an
  // empty value, so every `if (!process.env.DATABASE_URL)` said "configured"
  // while the driver had nothing to dial. These checks pin the resolution rules.
  section("Connection resolution (Supabase)");
  const saved = { ...process.env };
  const pooler =
    "postgresql://postgres.phjsppfyhlgeznhiaqsc:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres";

  for (const key of ["DATABASE_URL", "POSTGRES_URL", "SUPABASE_DB_URL"]) {
    delete process.env[key];
  }
  check("no variable at all → not configured", !databaseConfigured());
  check("no variable → target says so", describeDatabaseTarget() === "not configured");
  check("no variable → no project ref", databaseProjectRef() === null);

  process.env.DATABASE_URL = "   ";
  check("whitespace-only variable → not configured", !databaseConfigured());

  process.env.DATABASE_URL = pooler;
  check("pooler string is recognised", isSupabasePooler(databaseUrl()));
  check("pooler string is configured", databaseConfigured());
  check(
    "target names region pool and never the password",
    describeDatabaseTarget().includes("pooler.supabase.com") &&
      describeDatabaseTarget().includes("pooler/transaction") &&
      !describeDatabaseTarget().includes("pw"),
    describeDatabaseTarget(),
  );
  check(
    "project ref comes from the postgres.<ref> username",
    databaseProjectRef() === "phjsppfyhlgeznhiaqsc",
  );

  process.env.SUPABASE_URL = "https://phjsppfyhlgeznhiaqsc.supabase.co";
  check(
    "SUPABASE_URL project ref matches",
    supabaseUrlProjectRef() === "phjsppfyhlgeznhiaqsc",
  );
  process.env.SUPABASE_URL = "https://someoneelse.supabase.co";
  check(
    "a mismatched SUPABASE_URL is detectable",
    supabaseUrlProjectRef() !== databaseProjectRef(),
  );

  process.env.DATABASE_URL = "";
  process.env.SUPABASE_DB_URL = pooler;
  check(
    "an empty DATABASE_URL falls through to the next variable",
    databaseUrl() === pooler,
  );
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  check(
    "transaction-mode template/comment script splits cleanly",
    splitStatements(
      "-- a comment; with a semicolon\nCREATE TABLE a (x TEXT DEFAULT 'y;z'); /* b; */ SELECT 1;",
    ).length === 2,
  );
  // pg re-parses connectionString over an explicit `ssl` option, and Supabase's
  // copy-button string includes ?sslmode=require — which pg turns into "verify
  // the certificate", failing against Supavisor's chain. These pin the split.
  const poolerBare =
    "postgresql://postgres.phjsppfyhlgeznhiaqsc:p%40ss@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres";
  const bareConfig = postgresConfig(poolerBare, 2);
  check(
    "connection string is split into fields",
    bareConfig.host === "aws-1-ap-southeast-2.pooler.supabase.com" &&
      bareConfig.port === 6543 &&
      bareConfig.user === "postgres.phjsppfyhlgeznhiaqsc" &&
      bareConfig.database === "postgres",
    bareConfig,
  );
  check(
    "URL-encoded password is decoded exactly once",
    bareConfig.password === "p@ss",
    bareConfig.password,
  );
  check(
    "no sslmode → TLS without CA verification",
    (bareConfig.ssl as { rejectUnauthorized?: boolean }).rejectUnauthorized ===
      false,
  );
  for (const mode of ["require", "prefer", "no-verify"]) {
    const config = postgresConfig(`${poolerBare}?sslmode=${mode}`);
    check(
      `sslmode=${mode} still connects (certificate not rejected)`,
      (config.ssl as { rejectUnauthorized?: boolean }).rejectUnauthorized ===
        false,
    );
  }
  check(
    "sslmode=verify-full is respected when asked for",
    (
      postgresConfig(`${poolerBare}?sslmode=verify-full`).ssl as {
        rejectUnauthorized?: boolean;
      }
    ).rejectUnauthorized === true,
  );
  check(
    "sslmode=disable turns TLS off",
    postgresConfig(`${poolerBare}?sslmode=disable`).ssl === false,
  );
  check(
    "localhost needs no TLS",
    postgresConfig("postgresql://u:p@localhost:5432/khanbaba").ssl === false,
  );
  check(
    "pool size is capped for serverless",
    postgresConfig(poolerBare, 1).max === 1,
  );

  check(
    "int8 and numeric parse as JS numbers",
    customTypes.getTypeParser(20)("42") === 42 &&
      customTypes.getTypeParser(1700)("1.5") === 1.5,
  );
  const fake = createSqlFromClient({
    query: async () => [{ id: 7, created_at: new Date(0) }],
  });
  const row = await fake.one<{ id: number; created_at: string }>("SELECT 1");
  check(
    "rows normalise timestamps to ISO strings",
    row.created_at === new Date(0).toISOString(),
  );
  check("insert() reads RETURNING id", (await fake.insert("INSERT ...")) === 7);


  {
    // ------------------------------------------------------------ user admin
    section("Users & access (roles, password resets, going live)");
    const staffRow = (email: string) =>
      db.one<{
        id: number;
        name: string;
        email: string;
        role: StaffSession["role"];
        active: boolean;
        password_hash: string;
      }>("SELECT * FROM staff WHERE email = $1", [email]);
    const rejects = async (fn: () => Promise<unknown>, status?: number) => {
      try {
        await fn();
        return false;
      } catch (error) {
        return (
          error instanceof UserAdminError &&
          (status === undefined || error.status === status)
        );
      }
    };
    const adminRow = await staffRow("admin@khanbaba.com.au");
    const managerRow = await staffRow("manager@khanbaba.com.au");
    const kitchenRow = await staffRow("kitchen@khanbaba.com.au");
    const asAdmin = { id: adminRow.id, role: "admin" as const };
    const asManager = { id: managerRow.id, role: "manager" as const };

    const before = await demoStatus(db);
    check("demo logins are advertised on a fresh database", before.enabled);
    check(
      "all five seeded staff are flagged as on the demo password",
      before.staffIds.length === 5,
      before.staffIds,
    );
    check("both demo customers are counted", before.customers === 2);

    const newId = await createStaff(db, asAdmin, {
      name: "Nadia Qureshi",
      email: "Nadia@KhanBaba.com.au",
      role: "counter",
      password: "first-password-1",
    });
    const nadia = await staffRow("nadia@khanbaba.com.au");
    check("staff created with a lowercased email", nadia.id === newId);
    check(
      "duplicate email rejected",
      await rejects(
        () =>
          createStaff(db, asAdmin, {
            name: "Other",
            email: "nadia@khanbaba.com.au",
            password: "first-password-1",
          }),
        409,
      ),
    );
    check(
      "the demo password cannot be chosen for a new account",
      await rejects(() =>
        createStaff(db, asAdmin, {
          name: "Lazy",
          email: "lazy@khanbaba.com.au",
          password: DEMO_PASSWORD,
        }),
      ),
    );
    check(
      "a manager cannot create an administrator",
      await rejects(
        () =>
          createStaff(db, asManager, {
            name: "Sneaky",
            email: "sneaky@khanbaba.com.au",
            role: "admin",
            password: "first-password-1",
          }),
        403,
      ),
    );

    await updateStaff(db, asManager, newId, { role: "kitchen", name: "Nadia Q" });
    const promoted = await staffRow("nadia@khanbaba.com.au");
    check(
      "a manager can change a team member's role and name",
      promoted.role === "kitchen" && promoted.name === "Nadia Q",
    );
    check(
      "a manager cannot promote anyone to administrator",
      await rejects(() => updateStaff(db, asManager, newId, { role: "admin" }), 403),
    );
    check(
      "a manager cannot reset an administrator's password",
      await rejects(
        () => resetStaffPassword(db, asManager, adminRow.id, "takeover-pass-1"),
        403,
      ),
    );
    check(
      "a manager cannot disable or delete an administrator",
      (await rejects(() => setStaffActive(db, asManager, adminRow.id, false), 403)) &&
        (await rejects(() => deleteStaff(db, asManager, adminRow.id), 403)),
    );
    check(
      "nobody can change their own role",
      await rejects(() => updateStaff(db, asAdmin, adminRow.id, { role: "manager" })),
    );
    check(
      "nobody can disable or delete their own account",
      (await rejects(() => setStaffActive(db, asAdmin, adminRow.id, false))) &&
        (await rejects(() => deleteStaff(db, asAdmin, adminRow.id))),
    );
    check(
      "email clash on edit rejected",
      await rejects(
        () => updateStaff(db, asAdmin, newId, { email: "kitchen@khanbaba.com.au" }),
        409,
      ),
    );
    check(
      "unknown staff id is a 404",
      await rejects(() => resetStaffPassword(db, asAdmin, 999999, "whatever-1"), 404),
    );

    // The last active administrator can never be removed, even by another one.
    const secondAdminId = await createStaff(db, asAdmin, {
      name: "Second Admin",
      email: "second@khanbaba.com.au",
      role: "admin",
      password: "second-admin-1",
    });
    const asSecond = { id: secondAdminId, role: "admin" as const };
    await setStaffActive(db, asAdmin, secondAdminId, false);
    check(
      "a disabled administrator does not count: the only active one cannot be demoted",
      await rejects(() => updateStaff(db, asSecond, adminRow.id, { role: "manager" })),
    );
    check(
      "…or disabled, or deleted",
      (await rejects(() => setStaffActive(db, asSecond, adminRow.id, false))) &&
        (await rejects(() => deleteStaff(db, asSecond, adminRow.id))),
    );
    await deleteStaff(db, asAdmin, secondAdminId);
    check(
      "a spare administrator account can be deleted",
      (await db.maybeOne("SELECT id FROM staff WHERE id = $1", [secondAdminId])) === null,
    );

    // Sessions follow the database, not the 12-hour cookie.
    const sessionFor = (row: Awaited<ReturnType<typeof staffRow>>): StaffSession => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      pv: passwordFingerprint(row.password_hash),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const kitchenSession = sessionFor(kitchenRow);
    check(
      "a live session resolves",
      (await liveStaffSession(db, kitchenSession))?.role === "kitchen",
    );
    await updateStaff(db, asAdmin, kitchenRow.id, { role: "counter" });
    check(
      "a role change reaches an already-issued session",
      (await liveStaffSession(db, kitchenSession))?.role === "counter",
    );
    await resetStaffPassword(db, asAdmin, kitchenRow.id, "kitchen-reset-1");
    const kitchenAfter = await staffRow("kitchen@khanbaba.com.au");
    check(
      "reset password verifies and the old one does not",
      verifyPassword("kitchen-reset-1", kitchenAfter.password_hash) &&
        !verifyPassword(DEMO_PASSWORD, kitchenAfter.password_hash),
    );
    check(
      "a password reset signs out the older session",
      (await liveStaffSession(db, kitchenSession)) === null,
    );
    const freshKitchen = sessionFor(kitchenAfter);
    await setStaffActive(db, asAdmin, kitchenRow.id, false);
    check(
      "disabling an account signs it out",
      (await liveStaffSession(db, freshKitchen)) === null,
    );
    await setStaffActive(db, asAdmin, kitchenRow.id, true);
    check(
      "re-enabling restores it",
      (await liveStaffSession(db, freshKitchen)) !== null,
    );
    check(
      "a session without a fingerprint (issued before this release) still works",
      (await liveStaffSession(db, { ...freshKitchen, pv: undefined })) !== null,
    );

    // Changing your own password needs the current one.
    check(
      "own password change rejects a wrong current password",
      await rejects(
        () => changeOwnPassword(db, kitchenRow.id, "wrong", "another-pass-1"),
        403,
      ),
    );
    const ownHash = await changeOwnPassword(
      db,
      kitchenRow.id,
      "kitchen-reset-1",
      "kitchen-own-pass-1",
    );
    check(
      "own password change takes effect",
      verifyPassword("kitchen-own-pass-1", ownHash) &&
        (await staffRow("kitchen@khanbaba.com.au")).password_hash === ownHash,
    );

    // Customer logins.
    const ayesha = (await getCustomerByEmail(db, "ayesha@example.com"))!;
    await resetCustomerPassword(db, ayesha.id, "customer-reset-1", "Raheel Atta");
    check(
      "customer password reset lets them sign in with the new password",
      (await signinCustomer(db, {
        email: "ayesha@example.com",
        password: "customer-reset-1",
      })).customer.id === ayesha.id,
    );
    await setCustomerActive(db, ayesha.id, false, "Raheel Atta");
    let disabledSignin = false;
    try {
      await signinCustomer(db, { email: "ayesha@example.com", password: "customer-reset-1" });
    } catch {
      disabledSignin = true;
    }
    check("a disabled customer login cannot sign in", disabledSignin);
    const activity = await db.query<{ kind: string }>(
      "SELECT kind FROM customer_activity WHERE customer_id = $1",
      [ayesha.id],
    );
    check(
      "staff actions are written to the customer's activity log",
      activity.some((row) => row.kind === "password_reset") &&
        activity.some((row) => row.kind === "account_disabled"),
    );
    check(
      "unknown customer id is a 404",
      await rejects(() => resetCustomerPassword(db, 999999, "whatever-12"), 404),
    );

    // Going live.
    check(
      "only an administrator can retire the demo credentials",
      await rejects(() => goLive(db, asManager, "manager-new-1"), 403),
    );
    check(
      "an administrator still on the demo password must choose a new one",
      await rejects(() => goLive(db, asAdmin)),
    );
    check(
      "…and it cannot be the demo password again",
      await rejects(() => goLive(db, asAdmin, DEMO_PASSWORD)),
    );
    check(
      "a refused go-live changed nothing",
      (await demoLoginsEnabled(db)) && (await demoStatus(db)).customers === 2,
    );
    const demoOrdersBefore = await count(db, "orders");
    const live = await goLive(db, asAdmin, "owner-real-pass-1");
    const after = await demoStatus(db);
    const adminAfter = await staffRow("admin@khanbaba.com.au");
    check(
      "go-live sets the administrator's new password",
      live.passwordHash === adminAfter.password_hash &&
        verifyPassword("owner-real-pass-1", adminAfter.password_hash),
    );
    check(
      "go-live disables the other accounts still on the demo password (manager, counter, delivery)",
      live.disabledStaff === 3,
      live.disabledStaff,
    );
    const stillActive = await db.query<{ email: string }>(
      "SELECT email FROM staff WHERE active = TRUE ORDER BY email",
    );
    check(
      "accounts with their own password stay active",
      stillActive.map((row) => row.email).join(",") ===
        "admin@khanbaba.com.au,kitchen@khanbaba.com.au,nadia@khanbaba.com.au",
      stillActive,
    );
    check("go-live removes the demo customers", live.removedCustomers === 2 && after.customers === 0);
    check("…but keeps their orders", (await count(db, "orders")) === demoOrdersBefore);
    check("the sign-in page stops advertising demo logins", !after.enabled);
    check(
      "no active account is left on the demo password",
      (
        await db.query<{ password_hash: string }>(
          "SELECT password_hash FROM staff WHERE active = TRUE",
        )
      ).every((row) => !verifyPassword(DEMO_PASSWORD, row.password_hash)),
    );
    check(
      "a disabled demo account cannot be re-enabled until its password is reset",
      await rejects(() => setStaffActive(db, asAdmin, managerRow.id, true)),
    );
    await resetStaffPassword(db, asAdmin, managerRow.id, "manager-real-1");
    await setStaffActive(db, asAdmin, managerRow.id, true);
    check(
      "…and can be once it has a real password",
      (await staffRow("manager@khanbaba.com.au")).active,
    );
    const again = await goLive(db, asAdmin);
    check(
      "go-live is safe to run twice",
      again.disabledStaff === 0 && again.removedCustomers === 0 && again.passwordHash === null,
    );

    // ---------------------------------------------------- v3 modules
    section("Lahore music system");

    const musicTracks = await count(db, "music_tracks");
    check("the library is seeded with music and religious tracks", musicTracks >= 7, musicTracks);
    check(
      "religious tracks are a separate kind",
      (
        await db.one<{ c: number }>(
          "SELECT COUNT(*) AS c FROM music_tracks WHERE kind = 'religious'",
        )
      ).c > 0,
    );

    const evening = await db.one<{ id: number }>(
      "SELECT id FROM music_collections WHERE slug = 'lahore-evening'",
    );
    const naatCollection = await db.one<{ id: number }>(
      "SELECT id FROM music_collections WHERE slug = 'friday-naat'",
    );

    await playCollection(db, "Counter Tester", { collectionId: evening.id });
    const playingNow = await getNowPlaying(db);
    check("the shared player reports what is playing", playingNow.status === "playing");
    check("the default volume stays low", playingNow.volume <= 60, playingNow.volume);
    check(
      "the counter can pause the room",
      (await pauseMusic(db, "Counter Tester")).status === "paused",
    );
    check(
      "and resume it",
      (await resumeMusic(db, "Counter Tester")).status === "playing",
    );
    check(
      "volume cannot be wound past a comfortable level",
      (await setMusicVolume(db, "Counter Tester", 95)).volume === 60,
    );

    const fridayEvening = await scheduledCollection(
      db,
      new Date("2026-11-13T07:00:00Z"), // Friday 18:00 in Sydney (AEDT)
    );
    check(
      "a Friday evening schedule picks the religious collection",
      fridayEvening?.collection.kind === "religious",
      fridayEvening?.collection.name,
    );

    await playCollection(db, "Counter Tester", { collectionId: naatCollection.id });
    await triggerTableEncouragement(db, tableOrder.order.id, "test");
    const religiousNow = await getNowPlaying(db);
    check(
      "the table-order music stays silent during a religious set",
      religiousNow.isReligious && !religiousNow.encouragement?.active,
    );
    await clearEncouragement(db);

    let badRequestRejected = false;
    try {
      await submitMusicRequest(db, {
        customerName: "Guest Tester",
        title: "No link",
        url: "not-a-url",
      });
    } catch {
      badRequestRejected = true;
    }
    check("a song request needs a real URL", badRequestRejected);

    const songRequest = await submitMusicRequest(db, {
      customerName: "Guest Tester",
      title: "Test Qawwali",
      url: "https://example.com/test-qawwali.mp3",
      tableCode: "T04",
      orderId: tableOrder.order.id,
    });
    check("a request waits for staff approval", songRequest.status === "pending");
    const approved = await approveMusicRequest(db, "Counter Tester", songRequest.id, {
      chargeCents: 750,
      playNow: false,
    });
    check("approval turns the request into a playable track", approved.trackId > 0);
    const chargedBill = await getOrderById(db, tableOrder.order.id);
    check(
      "the on-demand charge is posted to the bill",
      chargedBill?.music_charge_cents === 750,
      chargedBill?.music_charge_cents,
    );

    const secondRequest = await submitMusicRequest(db, {
      customerName: "Guest Tester",
      title: "A gift",
      url: "https://example.com/gift.mp3",
    });
    const waived = await approveMusicRequest(db, "Counter Tester", secondRequest.id, {
      chargeCents: 0,
      playNow: false,
    });
    check("staff can waive the charge entirely", waived.request.charge_cents === 0);

    section("WhatsApp Business commerce");

    const parsed = await parseOrderText(db, "2 chicken biryani and 1 garlic naan");
    check(
      "a WhatsApp message is matched against the live menu",
      parsed.length >= 2 && parsed.some((line) => line.qty === 2),
      parsed,
    );
    const inbound = await handleInboundWhatsApp(
      db,
      { from: "61400000111", name: "Wa Guest", text: "1 butter chicken table 4" },
      "http://localhost:3000",
    );
    check("an inbound WhatsApp message becomes an order", Boolean(inbound.orderCode), inbound);
    const waOrder = inbound.orderCode ? await getOrderByCode(db, inbound.orderCode) : null;
    check(
      "the order is sourced to WhatsApp and unpaid",
      waOrder?.source === "whatsapp" && waOrder?.payment_status === "unpaid",
    );
    check(
      "the counter is notified on WhatsApp (sandbox logged)",
      (await count(db, "whatsapp_messages")) > 0,
    );
    const payLink = await requestOrderPayment(
      db,
      waOrder!.id,
      "Counter Tester",
      "http://localhost:3000",
    );
    check(
      "a secure payment link is minted for the guest",
      Boolean(payLink.token && payLink.url?.includes("/pay/")),
      payLink.url,
    );
    check(
      "the payment link is stored on the order",
      (await getOrderById(db, waOrder!.id))?.payment_link_token === payLink.token,
    );

    const published = await publishMenuItem(db, items[0].id, "Manager Tester");
    check(
      "a dish publishes to the WhatsApp catalogue (sandbox)",
      published.status === "published" && published.sandbox,
      published,
    );

    const sandboxConfig = await whatsappConfig();
    check(
      "with no credentials the channel reports sandbox and says what is missing",
      sandboxConfig.mode === "sandbox" &&
        sandboxConfig.sources.phoneNumberId === "none" &&
        sandboxConfig.sources.counterNumber === "settings",
      sandboxConfig.sources,
    );
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789012345";
    process.env.WHATSAPP_ACCESS_TOKEN = "test-permanent-token";
    const envConfig = await whatsappConfig();
    check(
      "Vercel environment variables win over portal settings and flip the channel live",
      envConfig.mode === "live" &&
        envConfig.sources.phoneNumberId === "env" &&
        envConfig.sources.accessToken === "env" &&
        envConfig.sources.counterNumber === "settings",
      envConfig.sources,
    );
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    check(
      "unsetting them returns the channel to sandbox",
      (await whatsappConfig()).mode === "sandbox",
    );
    const tracked = await setItemStock(db, items[0].id, "Manager Tester", {
      stockQty: 2,
      trackStock: true,
      lowStockLevel: 1,
    });
    check("central stock is recorded", tracked.stock_qty === 2 && tracked.track_stock);

    const stockOrder = await createOrder(db, {
      channel: "pickup",
      customerName: "Stock Tester",
      paymentMethod: "counter",
      items: [{ itemId: items[0].id, variantId: items[0].variants[0].id, qty: 1 }],
    });
    await confirmOrder(db, stockOrder.order.id, "Counter Tester");
    const afterStock = await catalogItem(db, items[0].id);
    check(
      "accepting an order takes stock off the shelf",
      afterStock?.stock_qty === 1,
      afterStock?.stock_qty,
    );
    await consumeStockForOrder(db, stockOrder.order.id, "Counter Tester");
    check(
      "consuming the same order twice does not double-count",
      (await catalogItem(db, items[0].id))?.stock_qty === 1,
    );
    await setItemStock(db, items[0].id, "Manager Tester", {
      stockQty: 0,
      trackStock: true,
    });
    check(
      "zero stock makes the dish unavailable everywhere",
      (await catalogItem(db, items[0].id))?.is_available === false,
    );
    await setItemStock(db, items[0].id, "Manager Tester", {
      stockQty: 20,
      available: true,
      trackStock: true,
    });

    section("Dine-in settlement, parking and feedback");

    const parked = await parkOrder(
      db,
      tableOrder.order.id,
      "Counter Tester",
      "Guest is still eating",
    );
    check("a table bill can be parked at the counter", parked.parked === true);
    const settled = await settleTableOrder(
      db,
      tableOrder.order.id,
      "Counter Tester",
      "cash",
      "http://localhost:3000",
    );
    check(
      "settling takes the payment, releases the park and completes the table",
      settled.order.payment_status === "paid" &&
        settled.order.status === "completed" &&
        settled.order.parked === false,
    );
    check(
      "a feedback link is prepared on settlement",
      Boolean(settled.feedbackUrl),
      settled.feedbackUrl,
    );

    const feedbackToken = settled.feedbackUrl?.split("/feedback/")[1] ?? "";
    const inviteView = await feedbackInviteByToken(db, feedbackToken);
    check(
      "the feedback link resolves the real order",
      inviteView?.order.code === tableOrder.order.code,
    );
    const submitted = await submitFeedback(db, feedbackToken, {
      rating: 5,
      comment: "The biryani was the proper Lahori thing.",
      highlights: ["Chicken Biryani"],
      partySize: 3,
    });
    const draft = await db.one<{
      body: string;
      party_size: number;
      bill_cents: number;
      status: string;
    }>("SELECT body, party_size, bill_cents, status FROM google_review_drafts WHERE id = $1", [
      submitted.draftId,
    ]);
    check(
      "the Google review draft states the party size",
      draft.party_size === 3 && draft.body.includes("3 people"),
      draft.body,
    );
    check(
      "the draft names the dishes and the bill range",
      draft.body.includes("Chicken Biryani") && /\$[0-9]+\.[0-9]{2}–\$[0-9]+\.[0-9]{2}/.test(draft.body),
      draft.body,
    );
    check("the draft waits for the team", draft.status === "draft");

    // ------------------------------------------------- upgrading an old database
    section("Upgrading a database created by an earlier release");
    const old = (await createHarness()).db;
    // The orders table exactly as it shipped before customer accounts existed.
    const legacyOrders = SCHEMA_SQL.slice(
      SCHEMA_SQL.indexOf("CREATE TABLE IF NOT EXISTS orders ("),
      SCHEMA_SQL.indexOf("CREATE INDEX IF NOT EXISTS idx_orders_status"),
    )
      .split("\n")
      .filter(
        (line) =>
          !line.includes("customer_id INTEGER") &&
          !line.includes("tracking_token TEXT") &&
          !line.startsWith("ALTER TABLE") &&
          !line.startsWith("--"),
      )
      .join("\n");
    await old.exec(
      "CREATE TABLE dining_tables (id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, zone TEXT, seats INTEGER NOT NULL DEFAULT 4, active BOOLEAN NOT NULL DEFAULT TRUE);",
    );
    await old.exec(legacyOrders);
    await old.query(
      "INSERT INTO orders (code, channel, customer_name, payment_method) VALUES ('KB-OLD1', 'pickup', 'Before Accounts', 'counter')",
    );
    const legacyColumns = async () =>
      (
        await old.query<{ column_name: string }>(
          "SELECT column_name FROM information_schema.columns WHERE table_name = 'orders'",
        )
      ).map((row) => row.column_name);
    check(
      "the legacy orders table really lacks the new columns",
      !(await legacyColumns()).includes("tracking_token"),
    );
    let upgradeError: unknown = null;
    try {
      await old.exec(SCHEMA_SQL);
      await old.exec(SCHEMA_SQL);
    } catch (error) {
      upgradeError = error;
    }
    check("the schema applies over an older database", upgradeError === null, upgradeError);
    const upgraded = await legacyColumns();
    check(
      "missing columns were added to the existing table",
      upgraded.includes("customer_id") && upgraded.includes("tracking_token"),
    );
    check(
      "existing rows survive the upgrade",
      (await old.one<{ code: string }>("SELECT code FROM orders")).code === "KB-OLD1",
    );
  }

  // ── Delivery zones ────────────────────────────────────────────────────────
  // The rate card is the answer when no courier partner can quote. Before it
  // existed the fallback fee was a hash of the address, so 2770 and 2000 were
  // priced identically and nothing could refuse an address outside the area.
  {
    section("Delivery zones: postcode rate card and serviceability");
    const db = await getDb();
    const zones = await listDeliveryZones(db);
    check("Western Sydney delivery zones are seeded", zones.length >= 4, zones.length);
    check(
      "the kitchen's own postcode 2770 is served",
      zones.some((zone) => zone.postcodes.split(",").map((p) => p.trim()).includes("2770")),
    );
    check(
      "the zone list is not the old Sydney CBD one",
      !zones.some((zone) => zone.postcodes.includes("2000")),
      zones.map((zone) => zone.name),
    );

    const whalan = await quoteFromZones(db, {
      address: "1/53 Bulolo Dr",
      suburb: "Whalan",
      postcode: "2770",
      orderValueCents: 4500,
    });
    check("the kitchen's own suburb is serviceable", whalan.serviceable);
    check(
      "2770 resolves to the local zone",
      /Whalan|Mount Druitt/i.test(whalan.zoneName),
      whalan.zoneName,
    );
    check(
      "the local zone has no per-km charge on an estimated pin",
      whalan.feeCents === whalan.zone?.base_fee_cents,
      { fee: whalan.feeCents, base: whalan.zone?.base_fee_cents },
    );

    // A real Pin: Whalan High School ~1 km from the kitchen. With verified
    // coordinates the distance is charged, and the fee must reflect that the
    // address is close, not 39 km away in the CBD.
    const near = await quoteFromZones(db, {
      address: "1/53 Bulolo Dr",
      suburb: "Whalan",
      postcode: "2770",
      lat: -33.7595,
      lng: 150.8105,
      orderValueCents: 4500,
    });
    check("a verified pin near the kitchen is serviceable", near.serviceable);
    check(
      "a verified pin near the kitchen measures only a few km",
      (near.distanceKm ?? 99) < 5,
      near.distanceKm,
    );

    const blacktown = await quoteFromZones(db, {
      address: "1 Main Street",
      suburb: "Blacktown",
      postcode: "2148",
      orderValueCents: 4500,
    });
    check("Blacktown 2148 is serviceable", blacktown.serviceable);
    check(
      "a further zone costs more than the local one",
      blacktown.feeCents > whalan.feeCents,
      { whalan: whalan.feeCents, blacktown: blacktown.feeCents },
    );

    const parramatta = await quoteFromZones(db, {
      address: "1 Church Street",
      suburb: "Parramatta",
      postcode: "2150",
      orderValueCents: 4500,
    });
    check("Parramatta 2150 is serviceable", parramatta.serviceable);

    const unknown = await quoteFromZones(db, {
      address: "1 Nowhere Road",
      suburb: "Byron Bay",
      postcode: "2481",
      orderValueCents: 4500,
    });
    check("an unserved postcode is refused, not guessed", !unknown.serviceable);
    check("the refusal explains itself", unknown.note.length > 10, unknown.note);

    // Sydney CBD is 39 km from this kitchen. It must not be quietly servable.
    const cbd = await quoteFromZones(db, {
      address: "25 Harris Street",
      suburb: "Pyrmont",
      postcode: "2009",
      orderValueCents: 4500,
    });
    check(
      "the Sydney CBD is outside this kitchen's delivery area",
      !cbd.serviceable,
      cbd.note,
    );

    const free = await quoteFromZones(db, {
      address: "1/53 Bulolo Dr",
      postcode: "2770",
      orderValueCents: 99000,
    });
    check("free delivery applies above the zone threshold", free.freeDelivery && free.feeCents === 0);

    // A live backstop: with no courier partner able to quote at all,
    // quoteDelivery must price from the zone rate card rather than the sandbox
    // hash. Turning our own fleet off is how a real quiet morning looks — no
    // driver online — so this is the path a customer actually hits.
    await db.query(
      "INSERT INTO settings (key, value) VALUES ('own_fleet_enabled','0') ON CONFLICT (key) DO UPDATE SET value = '0'",
    );
    await db.query(
      "INSERT INTO settings (key, value) VALUES ('delivery_provider','auto') ON CONFLICT (key) DO UPDATE SET value = 'auto'",
    );
    const quoted = await quoteDelivery({
      orderCode: "ZONE-TEST",
      customerName: "Zone Test",
      dropoffAddress: "12 Luxford Road",
      dropoffSuburb: "Mount Druitt",
      dropoffPostcode: "2770",
      orderValueCents: 4500,
    });
    check(
      "the fallback quote comes from the zone rate card",
      quoted.provider === "zone_rate_card",
      quoted.provider,
    );
    await assert.rejects(
      () =>
        quoteDelivery({
          orderCode: "ZONE-FAR",
          customerName: "Far Test",
          dropoffAddress: "25 Harris Street",
          dropoffSuburb: "Pyrmont",
          dropoffPostcode: "2009",
          orderValueCents: 4500,
        }),
      /do not deliver|Outside/i,
    );
    check("an address outside every zone is refused, not priced", true);
  }

  // ── Content engine ────────────────────────────────────────────────────────
  {
    section("AI content engine: today's menu, broadcast and blog");
    const db = await getDb();
    const menu = await todayMenu(db, "https://khanbabaresturants.vercel.app");
    check("today's menu reads the live dishes", menu.totalDishes > 0, menu.totalDishes);
    check("chef's picks are populated", menu.featured.length > 0);

    const body = menuBroadcastBody(menu);
    check("the broadcast body names real dishes", body.includes(menu.featured[0].name), menu.featured[0].name);
    check("the broadcast stays inside WhatsApp's limit", body.length <= 4096, body.length);
    check("the broadcast includes an unsubscribe line", /STOP/i.test(body));

    const tags = menuHashtags(menu);
    check("fifteen hashtags are generated", tags.length === 15, tags.length);
    check("hashtags carry no leading #", tags.every((tag) => !tag.startsWith("#")));

    const blog = menuBlog(menu);
    check("the blog slug is date-stamped", /^todays-menu-\d{4}-\d{2}-\d{2}$/.test(blog.slug), blog.slug);
    check("the blog names the restaurant", blog.body.includes(menu.restaurantName));

    const draft = await saveDraft(db, {
      kind: "menu",
      title: "Test draft",
      caption: menuCaption(menu),
      hashtags: tags,
      blogSlug: blog.slug,
      blogBody: blog.body,
      actor: "test",
    });
    check("a draft is persisted", draft.id > 0);
    const stored = await db.one<{ status: string }>(
      "SELECT status FROM social_posts WHERE id = $1",
      [draft.id],
    );
    check("a generated post starts as a draft, never published", stored.status === "draft", stored.status);
    const post = await db.one<{ status: string }>(
      "SELECT status FROM blog_posts WHERE slug = $1",
      [blog.slug],
    );
    check("the blog version is saved alongside it", post.status === "draft");

    // Consent: only customers with marketing_opt_in should ever be targeted.
    await db.query(
      "UPDATE customers SET marketing_opt_in = TRUE WHERE phone IN ('0451195192','0466 555 444')",
    );
    const audience = await broadcastRecipients(db, 100);
    const optedPhones = await db.query<{ phone: string }>(
      "SELECT phone FROM customers WHERE marketing_opt_in",
    );
    const optedDigits = new Set(
      optedPhones.map((row) => row.phone.replace(/[^0-9]/g, "")),
    );
    check(
      "every broadcast recipient has opted in",
      audience.every((row) => optedDigits.has(row.wa_id)),
      audience.map((row) => row.wa_id),
    );
  }

  // -------------------------------------------------------------------------
  // Credential resolution: which token is read, and from where
  // -------------------------------------------------------------------------
  section("WhatsApp credential resolution");

  // The incident this guards: a stale `sensitive` Vercel variable beat a good
  // token in the portal, the portal showed a green tick, and Meta answered 190.
  const { resolveTokenAlias, tokenFingerprint, credentialMode: modeOf } = await import(
    "../lib/whatsapp/client"
  );

  check("the token alias defaults to the primary variable", resolveTokenAlias("") === "primary");
  check("an unknown alias cannot smuggle in a third variable", resolveTokenAlias("WHATEVER") === "primary");
  check("the spare alias is selectable", resolveTokenAlias("new") === "new");

  const fingerprint = tokenFingerprint("primary", "EAAG-super-secret-token-ab12");
  check("a fingerprint ends in the last four characters", fingerprint === "primary:ab12", fingerprint);
  check("a fingerprint never contains the whole token", !fingerprint.includes("super-secret"));
  check("an empty token has no fingerprint", tokenFingerprint("primary", "") === "");
  check(
    "two different tokens with the same tail still differ by alias",
    tokenFingerprint("primary", "aaa-ab12") !== tokenFingerprint("new", "bbb-ab12"),
  );

  check("the default mode is auto", modeOf("") === "auto");
  check("a garbage mode falls back to auto rather than breaking sends", modeOf("hunter2") === "auto");
  check("settings mode is honoured", modeOf("settings") === "settings");

  // End-to-end through the real resolver: env must win in auto, portal in settings.
  const previousToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const previousNew = process.env.WHATSAPP_ACCESS_TOKEN_NEW;
  const previousPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const previousCatalog = process.env.WHATSAPP_CATALOG_ID;
  try {
    await setSetting("whatsapp_phone_number_id", "1111222233334444", db);
    await setSetting("whatsapp_access_token", "PORTAL-TOKEN-9999", db);
    await setSetting("whatsapp_credential_mode", "auto", db);
    await setSetting("whatsapp_env_alias", "primary", db);
    await deleteSetting("whatsapp_source_accessToken", db);
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1111222233334444";
    process.env.WHATSAPP_ACCESS_TOKEN = "VERCEL-TOKEN-1111";

    const auto = await whatsappConfig();
    check("in auto mode the Vercel token wins", auto.accessToken === "VERCEL-TOKEN-1111", auto.sources.accessToken);
    check("the portal token is reported as shadowed, not hidden", auto.shadowed.includes("accessToken"));
    check("the resolver names the variable it read", auto.tokenEnvKey === "WHATSAPP_ACCESS_TOKEN", auto.tokenEnvKey);

    await setSetting("whatsapp_credential_mode", "settings", db);
    const portal = await whatsappConfig();
    check("in settings mode the portal token wins", portal.accessToken === "PORTAL-TOKEN-9999", portal.sources.accessToken);
    check("the overridden Vercel value is reported as shadowed", portal.shadowed.includes("accessToken"));

    // The alias switch is the whole point: same deploy, different variable.
    await setSetting("whatsapp_credential_mode", "auto", db);
    process.env.WHATSAPP_ACCESS_TOKEN_NEW = "NEWVERCEL-TOKEN-2222";
    await setSetting("whatsapp_env_alias", "new", db);
    const spare = await whatsappConfig();
    check("switching the alias reads the spare variable", spare.accessToken === "NEWVERCEL-TOKEN-2222", spare.accessToken);
    check("the spare alias is reported honestly", spare.tokenEnvKey === "WHATSAPP_ACCESS_TOKEN_NEW", spare.tokenEnvKey);
    check("switching the alias needs no redeploy", spare.tokenAlias === "new");

    // A token is only "verified" when the stored proof matches the token in use.
    await setSetting("whatsapp_verified_token", "new:2222", db);
    check("the token in use is reported as proven", (await whatsappConfig()).tokenVerified === true);
    await setSetting("whatsapp_verified_token", "primary:1111", db);
    const stale = await whatsappConfig();
    check("proof for a different token is not mistaken for this one", stale.tokenVerified === false);

    // The regression this guards: the probe used to fingerprint the *resolved*
    // token, so when the winner came from Vercel it recorded proof against a
    // different token — showing a green tick on a token that did not work.
    process.env.WHATSAPP_ACCESS_TOKEN = "VERCEL-TOKEN-3333";
    process.env.WHATSAPP_ACCESS_TOKEN_NEW = "NEWVERCEL-TOKEN-2222";
    await setSetting("whatsapp_env_alias", "new", db);
    await setSetting("whatsapp_credential_mode", "auto", db);
    // Proof recorded against the alias the winner came from must match.
    await setSetting("whatsapp_verified_token", tokenFingerprint("new", "NEWVERCEL-TOKEN-2222"), db);
    check(
      "proof recorded for the spare alias matches the token in use",
      (await whatsappConfig()).tokenVerified === true,
    );
    check(
      "the same last four on the other alias is not accepted as proof",
      tokenFingerprint("primary", "NEWVERCEL-TOKEN-2222") !==
        tokenFingerprint("new", "NEWVERCEL-TOKEN-2222"),
    );
    check("the stale proof is still shown so the UI can explain it", stale.verifiedToken === "primary:1111");

    // Per-field override: read the catalogue id from Vercel, the token from the portal.
    await setSetting("whatsapp_credential_mode", "settings", db);
    process.env.WHATSAPP_CATALOG_ID = "5555666677";
    await setSetting("whatsapp_catalog_id", "8888999900", db);
    const mixedDefault = await whatsappConfig();
    check("without an override the catalogue follows the global mode", mixedDefault.catalogId === "8888999900", mixedDefault.catalogId);
    await setSetting("whatsapp_source_catalogId", "env", db);
    const overridden = await whatsappConfig();
    check("a single field can be pinned to Vercel while the token stays in the portal", overridden.catalogId === "5555666677", overridden.catalogId);
    check("the pin leaves the token reading from the portal", overridden.accessToken === "PORTAL-TOKEN-9999", overridden.sources.accessToken);
    check("the override is reported per field", overridden.fieldSources.catalogId === "env");
    await deleteSetting("whatsapp_source_catalogId", db);
    check("clearing the pin returns the field to the global mode", (await whatsappConfig()).catalogId === "8888999900");
  } finally {
    // Put the environment back exactly as it was: this harness shares the
    // process with every later check.
    if (previousToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
    else process.env.WHATSAPP_ACCESS_TOKEN = previousToken;
    if (previousNew === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN_NEW;
    else process.env.WHATSAPP_ACCESS_TOKEN_NEW = previousNew;
    if (previousPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = previousPhone;
    if (previousCatalog === undefined) delete process.env.WHATSAPP_CATALOG_ID;
    else process.env.WHATSAPP_CATALOG_ID = previousCatalog;
    deleteSetting("whatsapp_source_accessToken", db).catch(() => {});
    setSetting("whatsapp_credential_mode", "auto", db).catch(() => {});
    setSetting("whatsapp_env_alias", "primary", db).catch(() => {});
    setSetting("whatsapp_verified_token", "", db).catch(() => {});
    deleteSetting("whatsapp_catalog_id", db).catch(() => {});
    deleteSetting("whatsapp_phone_number_id", db).catch(() => {});
    deleteSetting("whatsapp_access_token", db).catch(() => {});
  }

  // -------------------------------------------------------------------------
  // Seven-day content calendar
  // -------------------------------------------------------------------------
  section("Seven-day content calendar");

  const { buildCalendar, calendarMarkdown } = await import("../lib/marketing/calendar");
  const { describeDeliveryArea } = await import("../lib/marketing/engine");

  const calMenu = await todayMenu(db, "https://khanbabaresturants.vercel.app");
  const calStart = new Date("2026-11-16T00:00:00Z"); // a Monday
  const cal = buildCalendar(calMenu, { start: calStart });

  check("the calendar has seven days", cal.days.length === 7, cal.days.length);
  check(
    "it starts on Monday and ends on Sunday",
    cal.days[0].weekday === "Monday" && cal.days[6].weekday === "Sunday",
    [cal.days[0].weekday, cal.days[6].weekday],
  );
  check(
    "consecutive days are consecutive dates",
    cal.days.every((day, index) =>
      index === 0
        ? true
        : (new Date(`${day.date}T00:00:00Z`).getTime() -
            new Date(`${cal.days[index - 1].date}T00:00:00Z`).getTime()) === 86_400_000,
    ),
  );
  check("every day has a theme", cal.days.every((day) => day.theme.length > 3));
  check("every day has a caption", cal.days.every((day) => day.caption.length > 40));
  check("every day has a call to action", cal.days.every((day) => day.cta.length > 3));
  check("every day has a posting time", cal.days.every((day) => /^\d{2}:\d{2}$/.test(day.bestTime)));
  check("every day has at least one channel", cal.days.every((day) => day.channels.length > 0));
  check("every day has hashtags", cal.days.every((day) => day.hashtags.length > 0));
  check(
    "hashtags are capped at fifteen for every day",
    cal.days.every((day) => day.hashtags.length <= 15),
  );
  check(
    "every caption carries the menu link",
    cal.days.every((day) => day.caption.includes("/menu")),
  );
  check(
    "no caption promises delivery across Sydney",
    cal.days.every((day) => !/across Sydney/i.test(day.caption)),
    cal.days.map((day) => day.caption).filter((c) => /across Sydney/i.test(c)),
  );

  // Determinism matters: an unstable generator churns the file on every run.
  const calAgain = buildCalendar(calMenu, { start: calStart });
  check("the calendar is deterministic for a given date", calendarMarkdown(cal, {}) === calendarMarkdown(calAgain, {}));

  // The delivery area must come from the zones, not a hard-coded string.
  check(
    "the delivery area is derived from the real zones",
    cal.deliveryArea === "across Western Sydney" || /^to .+ and nearby suburbs$/.test(cal.deliveryArea),
    cal.deliveryArea,
  );
  check("no zones falls back to a phrase, not a false promise", describeDeliveryArea([]) === "in our delivery area");
  check(
    "western suburbs are described as Western Sydney",
    describeDeliveryArea(["Whalan", "Mount Druitt"]) === "across Western Sydney",
  );
  check(
    "unfamiliar suburbs are named instead of guessed",
    describeDeliveryArea(["Byron Bay"]).includes("Byron Bay"),
  );

  // The Markdown is the deliverable, so it has to be usable on its own.
  const md = calendarMarkdown(cal, { restaurant_address: "1/53 Bulolo Dr, Whalan NSW 2770" });
  check("the markdown names the kitchen address", md.includes("1/53 Bulolo Dr, Whalan NSW 2770"));
  check("the markdown has a row per day", (md.match(/^## (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) /gm) ?? []).length === 7);
  check("the markdown carries each caption", cal.days.every((day) => md.includes(day.caption.split("\n")[0])));
  check("the markdown warns that it is generated", /generated/i.test(md));
  check("the markdown does not promise results", !/guarantee/i.test(md) || /does not promise results/i.test(md));
  check("the markdown has no unrendered template holes", !md.includes("undefined") && !md.includes("[object Object]"));

  // -------------------------------------------------------------------------
  // Courier addresses must not be the old CBD shopfront
  // -------------------------------------------------------------------------
  section("Courier pickup address");

  const courierSettings = await getSettings();
  check(
    "the kitchen address is the Whalan shop",
    /Whalan NSW 2770/.test(courierSettings.restaurant_address ?? ""),
    courierSettings.restaurant_address,
  );
  check(
    "the stored address is not the old CBD shopfront",
    !/Pitt Street|Sydney NSW 2000/.test(courierSettings.restaurant_address ?? ""),
    courierSettings.restaurant_address,
  );

  // -------------------------------------------------------------------------
  // Release notes ship inside the build
  // -------------------------------------------------------------------------
  section("Release notes");

  const nodeFs = await import("node:fs");
  const nodePath = await import("node:path");
  const read = (file: string) => nodeFs.readFileSync(nodePath.join(process.cwd(), file), "utf8");

  const { bundledReleaseNotes, publishReleaseNotes, unpublishedReleaseNotes } = await import("../lib/whats-new");

  const bundled = bundledReleaseNotes();
  check("the build carries release notes", bundled.length >= 5, bundled.length);
  check(
    "every note has a title and a summary",
    bundled.every((entry) => entry.note.title.length > 5 && entry.note.summary.length > 10),
  );
  check(
    "every note names a PR number",
    bundled.every((entry) => Number.isInteger(entry.prNumber) && entry.prNumber > 0),
  );
  check(
    "summaries stay short enough to fit the feed",
    bundled.every((entry) => entry.note.summary.length <= 320),
    bundled.map((entry) => entry.note.summary.length),
  );
  check(
    "versions look like semver",
    bundled.every((entry) => !entry.note.version || /^\d+\.\d+\.\d+$/.test(entry.note.version)),
  );

  // The bug this section exists for. The notes were read from disk at runtime;
  // on Vercel the directory is not in the function, the read failed quietly and
  // nothing published — while this suite, which runs from the checkout, passed.
  // So the test no longer asks "can the folder be read". It asks whether the
  // module the server imports matches the folder, and whether the publisher
  // touches the file system at all.
  const noteFiles = nodeFs
    .readdirSync(nodePath.join(process.cwd(), "whats-new"))
    .filter((name) => /^pr-\d+\.json$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  check(
    "every whats-new/pr-<n>.json is compiled into the build",
    noteFiles.length === bundled.length &&
      noteFiles.every((name, index) => Number(name.match(/\d+/)?.[0]) === bundled[index].prNumber),
    { files: noteFiles, bundled: bundled.map((entry) => entry.prNumber) },
  );
  check(
    "the compiled notes say what the files say (run `npm run notes:build` if not)",
    noteFiles.every((name, index) => {
      const onDisk = JSON.parse(read(`whats-new/${name}`)) as { title: string; summary: string; version?: string };
      const inBuild = bundled[index].note;
      return onDisk.title === inBuild.title && onDisk.summary === inBuild.summary && onDisk.version === inBuild.version;
    }),
  );
  // Code only: the file's own comment explains the old readdir, by name.
  const publisherSource = read("lib/whats-new.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  check(
    "the publisher does not read the file system",
    !/from\s+["']node:(fs|path)|from\s+["'](fs|path)["']|require\(|readdir|readFile|process\.cwd/.test(publisherSource),
  );
  check(
    "the publisher imports the compiled notes",
    /from\s+["']\.\/whats-new-notes["']/.test(publisherSource),
  );

  const feedPrs = await db.query<{ pr_number: number }>(
    "SELECT pr_number FROM whats_new WHERE pr_number IS NOT NULL",
  );
  const seenPrs = new Set(feedPrs.map((row) => Number(row.pr_number)));
  const missingNotes = bundled.map((entry) => entry.prNumber).filter((pr) => !seenPrs.has(pr));
  check("every bundled note reached the feed on first boot", missingNotes.length === 0, missingNotes);
  check("nothing is reported unpublished", (await unpublishedReleaseNotes(db)).length === 0);

  const newestBundled = Math.max(...bundled.map((entry) => entry.prNumber));
  const latestNote = await db.maybeOne<{ pr_number: number }>(
    "SELECT pr_number FROM whats_new WHERE pr_number IS NOT NULL ORDER BY pr_number DESC LIMIT 1",
  );
  check(
    "the newest release in the feed is the newest bundled PR",
    Number(latestNote?.pr_number) === newestBundled,
    [latestNote?.pr_number, newestBundled],
  );

  // Two notes published by the same boot must still read newest-first. They
  // used to share one now() and tie; the page then fell back to insertion order.
  const feedOrder = await db.query<{ pr_number: number }>(
    "SELECT pr_number FROM whats_new WHERE pr_number IS NOT NULL AND NOT pinned ORDER BY published_at DESC, id DESC LIMIT 2",
  );
  check(
    "notes published together are ordered newest PR first",
    Number(feedOrder[0]?.pr_number) === newestBundled && Number(feedOrder[1]?.pr_number) < newestBundled,
    feedOrder,
  );

  // Publishing must be idempotent, or every cold start duplicates the feed.
  const again = await publishReleaseNotes(db);
  check("publishing twice writes nothing the second time", again === 0, again);
  const countAfter = Number(
    (await db.one<{ c: number }>("SELECT COUNT(*) AS c FROM whats_new WHERE pr_number IN (20,21,22)")).c,
  );
  check("the three backfilled notes exist exactly once each", countAfter === 3, countAfter);

  // A note that is missing is found, published once, and not twice — even when
  // two instances start at the same moment, which is what a deploy looks like.
  await db.query("DELETE FROM whats_new WHERE pr_number = $1", [newestBundled]);
  const reported = await unpublishedReleaseNotes(db);
  check("a missing note is reported by PR number", reported.length === 1 && reported[0] === newestBundled, reported);
  const racing = await Promise.all([publishReleaseNotes(db), publishReleaseNotes(db), publishReleaseNotes(db)]);
  check("three simultaneous boots publish it once between them", racing.reduce((sum, n) => sum + n, 0) === 1, racing);
  const restored = Number(
    (await db.one<{ c: number }>("SELECT COUNT(*) AS c FROM whats_new WHERE pr_number = $1", [newestBundled])).c,
  );
  check("the note exists exactly once afterwards", restored === 1, restored);

  // Version numbers must move forward; a feed that goes 3.2.1 -> 2.1.0 reads as
  // a downgrade and undermines trust in the release history.
  const { BUILD, buildLabel, compareVersions } = await import("../lib/build");
  const versions = await db.query<{ pr_number: number; version: string | null }>(
    "SELECT pr_number, version FROM whats_new WHERE pr_number >= 18 ORDER BY pr_number",
  );
  const versionList = versions.filter((row) => row.version).map((row) => row.version as string);
  check(
    "release versions never go backwards",
    versionList.every((value, index) => index === 0 || compareVersions(value, versionList[index - 1]) >= 0),
    versions,
  );

  // -------------------------------------------------------------------------
  // The build says what it is
  // -------------------------------------------------------------------------
  section("Build stamp");

  const highest = [...bundled]
    .filter((entry) => entry.note.version)
    .sort((a, b) => compareVersions(a.note.version as string, b.note.version as string))
    .pop();
  check("the build version is the highest bundled release", BUILD.version === highest?.note.version, [
    BUILD.version,
    highest?.note.version,
  ]);
  check("the build names the PR that produced it", BUILD.pr === highest?.prNumber, BUILD.pr);
  check("the label starts with the version", buildLabel().startsWith(`v${BUILD.version}`), buildLabel());
  check("versions compare numerically, not as text", compareVersions("3.10.0", "3.9.0") > 0);
  check(
    "next.config stamps the commit and build time into the bundle",
    /KB_BUILD_SHA/.test(read("next.config.mjs")) && /KB_BUILD_TIME/.test(read("next.config.mjs")),
  );
  check(
    "the public footer, the staff bar and the health check all print the build",
    /build/.test(read("components/SiteFooter.tsx")) &&
      /build/.test(read("components/portal/PortalNav.tsx")) &&
      /buildLabel\(\)/.test(read("app/api/health/route.ts")),
  );

  // -------------------------------------------------------------------------
  // Navigation: one list, and nothing unreachable
  // -------------------------------------------------------------------------
  section("Navigation");

  const { ADMIN_NAV, adminNavLinks, sidebarNav, activeHref } = await import("../lib/nav");
  const { PORTAL_LINKS } = await import("../lib/auth/core");

  /** Every static page under a directory, as a route. Dynamic segments are children of a linked page. */
  const pagesUnder = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (current: string) => {
      for (const entry of nodeFs.readdirSync(current, { withFileTypes: true })) {
        const full = nodePath.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "page.tsx") {
          out.push("/" + nodePath.relative(nodePath.join(process.cwd(), "app"), current).split(nodePath.sep).join("/"));
        }
      }
    };
    walk(nodePath.join(process.cwd(), "app", dir));
    return out;
  };
  const pageFileFor = (route: string) => nodePath.join("app", route.replace(/^\//, ""), "page.tsx");
  const routeExists = (route: string) => nodeFs.existsSync(nodePath.join(process.cwd(), pageFileFor(route)));

  const navLinks = adminNavLinks();
  const linkedPaths = new Set(navLinks.map((link) => link.href.split("#")[0]));

  // The fault that was reported: a page that exists and that nothing links to.
  const adminPages = pagesUnder("admin").filter((route) => !/\[|\/new$/.test(route));
  const unlinked = adminPages.filter((route) => !linkedPaths.has(route));
  check("every admin page is reachable from the navigation", unlinked.length === 0, unlinked);
  check("the admin has a page for every navigation link", navLinks.every((link) => routeExists(link.href.split("#")[0])),
    navLinks.filter((link) => !routeExists(link.href.split("#")[0])).map((link) => link.href));

  // The other fault: links to a #section that no page defines.
  const deadAnchors = navLinks
    .filter((link) => link.href.includes("#"))
    .filter((link) => {
      const [route, anchor] = link.href.split("#");
      return !new RegExp(`id=["'{]+${anchor}["'}]`).test(read(pageFileFor(route)));
    })
    .map((link) => link.href);
  check("every #section a link names exists on its page", deadAnchors.length === 0, deadAnchors);

  check("Marketing has its own group", ADMIN_NAV.some((group) => group.id === "marketing" && group.links.length >= 3));
  check(
    "the operational log is in the navigation",
    navLinks.some((link) => link.href === "/admin/logs"),
  );
  check("no link appears twice", new Set(navLinks.map((link) => link.href)).size === navLinks.length);
  check(
    "the sidebar omits only the customer-facing extras",
    sidebarNav().flatMap((group) => group.links).length === navLinks.filter((link) => !link.hubOnly).length &&
      sidebarNav().flatMap((group) => group.links).every((link) => !link.hubOnly),
  );

  // The Command centre promises "every option in one place". It kept its own
  // list of tiles, and that list is where Marketing and the log were missing.
  const hubSource = read("app/admin/hub/page.tsx");
  check("the Command centre draws its tiles from the shared list", /ADMIN_NAV/.test(hubSource));
  check("the Command centre keeps no list of its own", !/href:\s*["']\//.test(hubSource));
  check("the sidebar draws from the shared list", /sidebarNav\(\)/.test(read("components/portal/AdminSide.tsx")));

  const topBar = (role: string) => PORTAL_LINKS.filter((link) => (link.roles as string[]).includes(role)).map((link) => link.href);
  check(
    "an administrator's top bar includes Marketing and Logs",
    topBar("admin").includes("/admin/marketing") && topBar("admin").includes("/admin/logs"),
    topBar("admin"),
  );
  check("a manager sees the same top bar as an administrator", topBar("manager").join() === topBar("admin").join());
  check("kitchen staff are not offered admin screens", topBar("kitchen").every((href) => !href.startsWith("/admin")), topBar("kitchen"));
  check("every top-bar link has a page", PORTAL_LINKS.every((link) => routeExists(link.href)));

  const sidebarHrefs = sidebarNav().flatMap((group) => group.links).map((link) => link.href);
  check(
    "on the Marketing page the Marketing tab is the active one, not Admin",
    activeHref("/admin/marketing", topBar("admin")) === "/admin/marketing",
    activeHref("/admin/marketing", topBar("admin")),
  );
  check("a dish editor keeps Menu highlighted", activeHref("/admin/menu/12", sidebarHrefs) === "/admin/menu");
  check("the overview does not light up on every admin page", activeHref("/admin/orders", sidebarHrefs) === "/admin/orders");
  check("an unknown path highlights nothing", activeHref("/somewhere/else", sidebarHrefs) === null);

  // A course of action that says "go to /admin/xyz" must lead somewhere. Every
  // in-app path written into the playbook and the audit is checked against the
  // pages that exist, including its #section.
  const PATH = /\/(?:admin|counter|kitchen|delivery|staff|menu|checkout|whats-new)(?:\/[a-z-]+)*(?:#[a-z-]+)?/g;
  const whereTargets = new Set<string>();
  for (const file of ["lib/ops/playbook.ts", "lib/ops/log.ts"]) {
    for (const match of read(file).matchAll(/where:\s*(?:"([^"]*)"|`([^`]*)`)/g)) {
      for (const found of (match[1] ?? match[2] ?? "").match(PATH) ?? []) whereTargets.add(found);
    }
  }
  check("the playbook points at in-app screens", whereTargets.size >= 12, whereTargets.size);
  const deadTargets = [...whereTargets].filter((target) => {
    const [route, anchor] = target.split("#");
    if (!routeExists(route)) return true;
    return anchor ? !new RegExp(`id=["'{]+${anchor}["'}]`).test(read(pageFileFor(route))) : false;
  });
  check("every screen a course of action names exists", deadTargets.length === 0, deadTargets);

  // -------------------------------------------------------------------------
  // Settings: a saved value must not be served stale
  // -------------------------------------------------------------------------
  section("Settings freshness");

  const { SETTINGS_TTL_MS } = await import("../lib/settings");
  await setSetting("restaurant_phone", "02 5550 0001");
  check("a value written through the app is read back at once", (await getSettings()).restaurant_phone === "02 5550 0001");

  // The live fault: the write happens in one serverless instance, the read in
  // another, so nothing clears the reader's copy. Simulated here with a write
  // the settings module does not see.
  await getSettings();
  await db.query("UPDATE settings SET value = $1 WHERE key = 'restaurant_phone'", ["02 5550 0002"]);
  check("the reader's copy lives for a bounded time", SETTINGS_TTL_MS > 0 && SETTINGS_TTL_MS <= 5000, SETTINGS_TTL_MS);
  await new Promise((resolve) => setTimeout(resolve, SETTINGS_TTL_MS + 150));
  check(
    "a value changed by another instance is picked up after the bound",
    (await getSettings()).restaurant_phone === "02 5550 0002",
    (await getSettings()).restaurant_phone,
  );
  check(
    "page renders are scoped to the request, not to the process",
    /requestScope\(\)/.test(read("lib/settings.ts")) && /from "react"/.test(read("lib/settings.ts")),
  );
  await setSetting("restaurant_phone", "0461 382 923");

  // -------------------------------------------------------------------------
  // Operational log, part one: findings
  // -------------------------------------------------------------------------
  section("Operational log: findings");

  const {
    auditChecks,
    ensureFreshAudit,
    inspectSystem,
    lastAuditAt,
    logSummary,
    openLogs,
    closedLogs,
    recordFindings,
    referenceFor,
    runAudit,
    setLogStatus,
  } = await import("../lib/ops/log");

  // A reference must be stable and quotable: the same subject yields the same
  // handle every time, or a reopened fault forks into duplicates.
  const refA = referenceFor({ kind: "whatsapp", title: "Token rejected", subject: "whatsapp:token" });
  const refB = referenceFor({ kind: "whatsapp", title: "A different wording", subject: "whatsapp:token" });
  check("the same subject yields the same reference", refA === refB, [refA, refB]);
  check("a reference is readable and prefixed by kind", /^LOG-WA-/.test(refA), refA);
  const refC = referenceFor({ kind: "menu", title: "Token rejected", subject: "whatsapp:token" });
  check("a different kind yields a different reference", refA !== refC, [refA, refC]);
  check("the reference is short enough to say out loud", refA.length <= 24, refA);
  check("the reference names the subject, not the table prefix", /^LOG-WA-TOKEN-/.test(refA), refA);

  // Every finding must carry a course of action as ordered steps. That is the
  // point of the table: an entry that only names a symptom moves the problem.
  const inspection = await inspectSystem(db);
  const findings = inspection.findings;
  check("every audit check ran", inspection.failed.length === 0, inspection.failed);
  check("the audit finds something worth reporting", findings.length > 0, findings.length);
  check(
    "every finding has a machine-readable code",
    findings.every((finding) => /^[A-Z][A-Z0-9_]{3,}$/.test(finding.code ?? "")),
    findings.filter((finding) => !finding.code).map((finding) => finding.title),
  );
  check(
    "every finding has ordered steps, each with an owner",
    findings.every(
      (finding) =>
        (finding.steps?.length ?? 0) > 0 &&
        finding.steps!.every((step) => step.do.length > 8 && typeof step.owner === "string" && step.owner.length > 0),
    ),
    findings.filter((finding) => !finding.steps?.length).map((finding) => finding.title),
  );
  check(
    "every finding says how to confirm the fix",
    findings.every((finding) => finding.steps!.some((step) => Boolean(step.verify))),
    findings.filter((finding) => !finding.steps!.some((step) => Boolean(step.verify))).map((finding) => finding.code),
  );
  check("every finding still carries the course as one paragraph", findings.every((finding) => finding.action.length > 30));
  check(
    "every finding has a severity from the allowed set",
    findings.every((finding) => ["info", "warning", "error", "critical"].includes(finding.severity)),
  );
  check("every finding has a title that names the problem", findings.every((finding) => finding.title.length > 10));
  check(
    "findings are not duplicated within one audit",
    new Set(findings.map((finding) => referenceFor(finding))).size === findings.length,
  );

  // The Whalan kitchen is the standing example: an address fault must be caught.
  const addressFinding = findings.find((finding) => finding.subject?.startsWith("settings:address"));
  check(
    "the audit checks the kitchen address",
    Boolean(addressFinding) || /Whalan/.test((await getSettings()).restaurant_address ?? ""),
    (await getSettings()).restaurant_address,
  );

  // A published password on a live login is the most serious thing the audit
  // can find, and before this release nothing reported it. Go-live ran earlier
  // in this suite, so the starting point is the clean one.
  const { hashPassword } = await import("../lib/auth/password");
  check("after go-live no login is reported as using the demo password", !findings.some((finding) => finding.code === "SEC_DEMO_PASSWORD"));
  const floorLogin = await db.one<{ id: number; email: string; password_hash: string; active: boolean }>(
    "SELECT id, email, password_hash, active FROM staff WHERE role NOT IN ('admin','manager') ORDER BY id LIMIT 1",
  );
  const adminLogin = await db.one<{ id: number; email: string; password_hash: string; active: boolean }>(
    "SELECT id, email, password_hash, active FROM staff WHERE role = 'admin' ORDER BY id LIMIT 1",
  );
  const demoFinding = async () => (await inspectSystem(db)).findings.find((finding) => finding.code === "SEC_DEMO_PASSWORD");
  await db.query("UPDATE staff SET password_hash = $1, active = TRUE WHERE id = $2", [hashPassword(DEMO_PASSWORD), floorLogin.id]);
  const floorFinding = await demoFinding();
  check("an active login on the published demo password is reported", Boolean(floorFinding), floorFinding?.title);
  check("…as an error, naming the account", floorFinding?.severity === "error" && (floorFinding?.detail ?? "").includes(floorLogin.email), [floorFinding?.severity, floorFinding?.detail]);
  check("…with go-live as the first step, for the owner", /Go live/.test(floorFinding?.steps?.[0]?.do ?? "") && floorFinding?.steps?.[0]?.owner === "owner", floorFinding?.steps?.[0]);
  await db.query("UPDATE staff SET password_hash = $1, active = TRUE WHERE id = $2", [hashPassword(DEMO_PASSWORD), adminLogin.id]);
  const adminFinding = await demoFinding();
  check("…and as critical once an administrator is on it", adminFinding?.severity === "critical", adminFinding?.severity);
  check("the finding never contains the password itself", !JSON.stringify(adminFinding).includes(DEMO_PASSWORD));
  await db.query("UPDATE staff SET active = FALSE WHERE id = $1", [floorLogin.id]);
  await db.query("UPDATE staff SET password_hash = $1, active = $2 WHERE id = $3", [adminLogin.password_hash, adminLogin.active, adminLogin.id]);
  check("a disabled login on the demo password is not reported: it cannot sign in", !(await demoFinding()));
  await db.query("UPDATE staff SET password_hash = $1, active = $2 WHERE id = $3", [floorLogin.password_hash, floorLogin.active, floorLogin.id]);

  // Supabase serves every table in `public` through its Data API. A table
  // without row level security is then readable with the project's public key.
  // The engine under test has no API roles, so the check must stay silent here…
  check("outside Supabase the API-exposure check reports nothing", !findings.some((finding) => finding.code === "SEC_TABLES_OPEN_TO_API"));
  // …and must speak up once they exist, as they do in production.
  await db.exec("CREATE ROLE anon NOLOGIN; GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon; GRANT INSERT ON whatsapp_messages TO anon;");
  const exposure = (await inspectSystem(db)).findings.find((finding) => finding.code === "SEC_TABLES_OPEN_TO_API");
  const exposedTables = (exposure?.evidence?.tables ?? []) as string[];
  check("a table the public API role can read, with row level security off, is reported", exposedTables.includes("whatsapp_messages") && exposedTables.includes("orders"), exposedTables.length);
  check("…as critical when it holds personal data", exposure?.severity === "critical", exposure?.severity);
  check("…noting which tables that role can also write to", JSON.stringify(exposure?.evidence?.writable) === JSON.stringify(["whatsapp_messages"]), exposure?.evidence?.writable);
  check("…with the exact statement that closes each one", ((exposure?.evidence?.fix ?? []) as string[]).includes("ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;"));
  check(
    "the two log tables are not among them: the schema closes those itself",
    !exposedTables.includes("action_logs") && !exposedTables.includes("operation_logs"),
    exposedTables.filter((name) => name.endsWith("_logs")),
  );
  await db.exec("ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;");
  const afterOne = (await inspectSystem(db)).findings.find((finding) => finding.code === "SEC_TABLES_OPEN_TO_API");
  check("enabling row level security on a table takes it off the list", !((afterOne?.evidence?.tables ?? []) as string[]).includes("whatsapp_messages"));
  check(
    "…and the application, as owner, still reads and writes that table",
    Number((await db.one<{ c: number }>("SELECT COUNT(*) AS c FROM whatsapp_messages")).c) >= 0,
  );
  await db.exec("ALTER TABLE whatsapp_messages DISABLE ROW LEVEL SECURITY; REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon; DROP ROLE anon;");
  check("with the API role gone the finding is gone", !(await inspectSystem(db)).findings.some((finding) => finding.code === "SEC_TABLES_OPEN_TO_API"));

  // The schema is applied one statement at a time on real Postgres. Its one
  // DO block must survive the splitter whole, or the site would not start.
  const schemaStatements = splitStatements(SCHEMA_SQL);
  const doBlocks = schemaStatements.filter((statement) => statement.startsWith("DO $$"));
  check(
    "the schema's DO block reaches Postgres as one statement",
    doBlocks.length === 1 && /END \$\$$/.test(doBlocks[0]) && !schemaStatements.some((statement) => /^(END|EXCEPTION|FOREACH|EXECUTE|DECLARE|RAISE)\b/.test(statement)),
    doBlocks.length,
  );
  // …and it must not be able to stop the site from starting. Run it as a role
  // that may not alter the tables, which is the failure it has to survive.
  const logRls = async () =>
    (await db.query<{ relname: string; on: boolean }>(
      "SELECT relname, relrowsecurity AS on FROM pg_class WHERE relname IN ('action_logs', 'operation_logs') ORDER BY relname",
    )).map((row) => `${row.relname}=${row.on}`).join(" ");
  await db.exec("ALTER TABLE action_logs DISABLE ROW LEVEL SECURITY; CREATE ROLE kb_not_owner NOLOGIN; GRANT USAGE ON SCHEMA public TO kb_not_owner;");
  let refused: unknown = null;
  try {
    await db.exec("SET ROLE kb_not_owner");
    await db.exec(doBlocks[0]);
  } catch (error) {
    refused = error;
  } finally {
    await db.exec("RESET ROLE");
  }
  check("a role that may not alter the log tables gets a notice from the schema, not an error", refused === null, refused);
  check("…and the table is left as it was, for the audit to report", (await logRls()) === "action_logs=false operation_logs=true", await logRls());
  await db.exec(doBlocks[0]);
  check("…and the next start, as the owner, closes it", (await logRls()) === "action_logs=true operation_logs=true", await logRls());
  await db.exec("REVOKE USAGE ON SCHEMA public FROM kb_not_owner; DROP ROLE kb_not_owner;");

  // First audit writes; the second only refreshes.
  const firstAudit = await runAudit(db);
  check("the first audit writes one row per finding", firstAudit.written === findings.length, firstAudit);
  check("the first audit clears nothing", firstAudit.cleared === 0, firstAudit.cleared);
  const secondAudit = await runAudit(db);
  check("the second audit writes nothing new", secondAudit.written === 0, secondAudit);
  check("the second audit refreshes the existing rows", secondAudit.updated === findings.length, secondAudit);
  const occurrences = await db.one<{ c: number }>("SELECT COUNT(*) AS c FROM operation_logs WHERE occurrences >= 2");
  check("re-seeing a finding increments its occurrence count", Number(occurrences.c) === findings.length, occurrences.c);
  check("each audit records when it ran", Boolean(await lastAuditAt(db)));

  const open = await openLogs(db);
  check("open findings are readable", open.length === findings.length, open.length);
  check(
    "the worst severity sorts first",
    open.every((row, index) => {
      if (index === 0) return true;
      const rank: Record<string, number> = { critical: 0, error: 1, warning: 2, info: 3 };
      return rank[open[index - 1].severity] <= rank[row.severity];
    }),
  );
  check("every stored row keeps its steps", open.every((row) => JSON.parse(row.steps ?? "[]").length > 0));
  check("every stored row keeps its code", open.every((row) => Boolean(row.code)));

  // "Resolved" is a claim, and the audit checks it. Marking a fault resolved
  // while it is still there used to hide it for ever.
  const target = open[0];
  check("a finding can be resolved", (await setLogStatus(db, target.id, "resolved", "test-harness", "verified in the harness")) === true);
  check("a resolved finding leaves the open list", !(await openLogs(db)).some((row) => row.id === target.id));
  const afterResolve = await runAudit(db);
  check("a resolved finding that is still true is reopened by the audit", afterResolve.reopened === 1, afterResolve);
  const reopenedRow = await db.one<{ status: string; note: string | null; resolved_at: string | null; reference: string }>(
    "SELECT status, resolution_note AS note, resolved_at::text AS resolved_at, reference FROM operation_logs WHERE id = $1",
    [target.id],
  );
  check("…and is open again under the same reference", reopenedRow.status === "open" && reopenedRow.reference === target.reference, reopenedRow);
  check("…with the reason recorded, including who had closed it", /Reopened by the audit/.test(reopenedRow.note ?? "") && /test-harness/.test(reopenedRow.note ?? ""), reopenedRow.note);
  check("…and no resolution timestamp", reopenedRow.resolved_at === null, reopenedRow.resolved_at);

  // "Ignored" is the deliberate mute, and it must hold.
  const muted = open[open.length - 1];
  await setLogStatus(db, muted.id, "ignored", "test-harness", "accepted for now");
  const afterIgnore = await runAudit(db);
  check("an ignored finding is left alone by the audit", afterIgnore.skipped === 1 && afterIgnore.reopened === 0, afterIgnore);
  check(
    "…and stays ignored",
    (await db.one<{ status: string }>("SELECT status FROM operation_logs WHERE id = $1", [muted.id])).status === "ignored",
  );
  check("a finding can be reopened by hand", (await setLogStatus(db, muted.id, "open", "test-harness", "looking again")) === true);
  check(
    "reopening by hand clears the resolution timestamp",
    (await db.one<{ t: string | null }>("SELECT resolved_at::text AS t FROM operation_logs WHERE id = $1", [muted.id])).t === null,
  );
  check("a missing log id is refused", (await setLogStatus(db, 999999, "resolved", "t", "note")) === false);

  // A fault that goes away must leave the open list without anyone closing it.
  const dish = await db.one<{ id: number; name: string }>(
    "SELECT id, name FROM menu_items WHERE published AND is_available ORDER BY id LIMIT 1",
  );
  await db.query("UPDATE menu_items SET is_available = FALSE WHERE id = $1", [dish.id]);
  const hidden = await runAudit(db);
  const dishReference = referenceFor({ kind: "menu", title: "", subject: `menu_item:${dish.id}` });
  check("hiding a dish raises a finding for that dish", hidden.written === 1 && hidden.findings.some((f) => f.subject === `menu_item:${dish.id}`), hidden);
  await db.query("UPDATE menu_items SET is_available = TRUE WHERE id = $1", [dish.id]);
  const shown = await runAudit(db);
  check("making it available again clears the finding", shown.cleared === 1, shown);
  const clearedRow = await db.one<{ status: string; by: string | null; note: string | null }>(
    "SELECT status, resolved_by AS by, resolution_note AS note FROM operation_logs WHERE reference = $1",
    [dishReference],
  );
  check("…closed by the audit, with the reason", clearedRow.status === "resolved" && clearedRow.by === "audit" && /no longer observes/.test(clearedRow.note ?? ""), clearedRow);
  check("…and kept in the history", (await closedLogs(db)).some((row) => row.reference === dishReference));
  await db.query("UPDATE menu_items SET is_available = FALSE WHERE id = $1", [dish.id]);
  const hiddenAgain = await runAudit(db);
  check("the same fault returning reopens the same row instead of adding one", hiddenAgain.reopened === 1 && hiddenAgain.written === 0, hiddenAgain);

  // A check that crashes must not be read as "the fault went away". Without
  // this, one bad query would silently close every finding of that kind.
  const broken = auditChecks().map((entry) =>
    entry.name === "menu"
      ? { ...entry, run: async () => { throw new Error("relation \"menu_items\" does not exist"); } }
      : entry,
  );
  const crashed = await runAudit(db, broken);
  check("a crashing check is named in the result", crashed.failedChecks.length === 1 && crashed.failedChecks[0].check === "menu", crashed.failedChecks);
  check("…and raises a finding of its own", crashed.findings.some((f) => f.code === "SYS_AUDIT_CHECK_FAILED"), crashed.findings.map((f) => f.code));
  check(
    "…and does not close the findings it could not check",
    (await db.one<{ status: string }>("SELECT status FROM operation_logs WHERE reference = $1", [dishReference])).status === "open",
  );
  await db.query("UPDATE menu_items SET is_available = TRUE WHERE id = $1", [dish.id]);
  const recovered = await runAudit(db);
  check("once the check runs again, both the crash finding and the stale one close", recovered.cleared === 2 && recovered.failedChecks.length === 0, recovered);

  // An order nobody accepted. The first version of this check asked for a
  // status called `pending`, which does not exist, so it could never fire.
  const probeDish = await db.one<{ item_id: number; variant_id: number }>(
    `SELECT mi.id AS item_id, v.id AS variant_id FROM menu_items mi
       JOIN item_variants v ON v.item_id = mi.id AND v.active
      WHERE mi.published AND mi.is_available AND NOT mi.track_stock
      ORDER BY mi.id, v.id LIMIT 1`,
  );
  const waiting = (
    await createOrder(db, {
      channel: "pickup",
      customerName: "Audit Probe",
      phone: "0400000111",
      paymentMethod: "counter",
      items: [{ itemId: probeDish.item_id, variantId: probeDish.variant_id, qty: 1 }],
    })
  ).order;
  const orderReference = referenceFor({ kind: "orders", title: "", subject: `order:${waiting.code}` });
  check("a new order waits in the status the audit looks for", waiting.status === "pending_confirm", waiting.status);
  check("an order placed a moment ago is not reported", !(await inspectSystem(db)).findings.some((f) => f.subject === `order:${waiting.code}`));
  await db.query("UPDATE orders SET created_at = now() - interval '2 hours' WHERE id = $1", [waiting.id]);
  const stale = await runAudit(db);
  const staleFinding = stale.findings.find((f) => f.subject === `order:${waiting.code}`);
  check("an order left unaccepted for two hours is reported", staleFinding?.code === "ORD_NOT_ACCEPTED", stale.findings.map((f) => f.code));
  check("…as an error, with the counter as the owner of the first step", staleFinding?.severity === "error" && staleFinding?.steps?.[0]?.owner === "counter", staleFinding?.steps?.[0]);
  await cancelOrder(db, waiting.id, "test-harness", "audit probe");
  await runAudit(db);
  const orderRow = await db.one<{ status: string; by: string | null }>(
    "SELECT status, resolved_by AS by FROM operation_logs WHERE reference = $1",
    [orderReference],
  );
  check("cancelling it clears the finding", orderRow.status === "resolved" && orderRow.by === "audit", orderRow);

  // The fault behind "I still can't see the new changes", reported by the system itself.
  await db.query("DELETE FROM whats_new WHERE pr_number = $1", [newestBundled]);
  const unpublished = await runAudit(db);
  const releaseFinding = unpublished.findings.find((f) => f.code === "REL_NOTES_UNPUBLISHED");
  check("a release note missing from the feed is reported", Boolean(releaseFinding), unpublished.findings.map((f) => f.code));
  check("…naming the PR", new RegExp(`#${newestBundled}\\b`).test(releaseFinding?.detail ?? ""), releaseFinding?.detail);
  await publishReleaseNotes(db);
  check("publishing it clears the finding", (await runAudit(db)).cleared === 1);

  const logStats = await logSummary(db);
  check("the summary counts open findings", logStats.open === (await openLogs(db)).length && logStats.open > 0, logStats.open);
  check("the summary groups by kind", logStats.byKind.length > 0, logStats.byKind);

  // The page audits on arrival, at most every ten minutes, and never twice at once.
  check("a fresh audit is not repeated", (await ensureFreshAudit(db)).ran === false);
  await db.query("UPDATE settings SET value = $1 WHERE key = 'ops_last_audit_at'", [
    new Date(Date.now() - 11 * 60_000).toISOString(),
  ]);
  const simultaneous = await Promise.all([ensureFreshAudit(db), ensureFreshAudit(db), ensureFreshAudit(db)]);
  check("a stale audit re-runs when a page asks, once between simultaneous page views", simultaneous.filter((entry) => entry.ran).length === 1, simultaneous.map((entry) => entry.ran));
  await db.query("DELETE FROM settings WHERE key = 'ops_last_audit_at'");
  check("a system that has never been audited is audited on the first page view", (await ensureFreshAudit(db)).ran === true);

  // -------------------------------------------------------------------------
  // Operational log, part two: the action log
  // -------------------------------------------------------------------------
  section("Operational log: actions");

  const { classify, courseForAction, levelFor, outcomeFor } = await import("../lib/ops/playbook");
  const {
    actionSummary,
    deriveTarget,
    getAction,
    listActions,
    newActionReference,
    parseCourse,
    pruneActions,
    recordAction,
    redact,
    scrubText,
    UNKNOWN_ACCOUNT,
    withActionLog,
  } = await import("../lib/ops/actions");
  const { actionsCsv, actionsNdjson, findingsCsv, formatActionText, formatFindingText } = await import("../lib/ops/format");
  const { createSessionToken, SESSION_COOKIE } = await import("../lib/auth/core");

  // --- what an HTTP result means
  check("2xx is ok", outcomeFor(200) === "ok" && outcomeFor(201) === "ok");
  check("a validation failure is rejected, not failed", outcomeFor(400) === "rejected" && outcomeFor(409) === "rejected");
  check("401, 403 and 429 are denied", outcomeFor(401) === "denied" && outcomeFor(403) === "denied" && outcomeFor(429) === "denied");
  check("5xx and a thrown error are failed", outcomeFor(500) === "failed" && outcomeFor(null, true) === "failed");

  const ctx = (over: Partial<Parameters<typeof classify>[0]>) => ({
    component: "whatsapp",
    action: "whatsapp.send",
    outcome: "failed" as const,
    httpStatus: 502,
    error: "",
    ...over,
  });
  check(
    "Meta's expired token is recognised whatever status wraps it",
    classify(ctx({ error: "(#190) Error validating access token: Session has expired", httpStatus: 400, outcome: "rejected" })) === "META_190",
  );
  check("a closed 24-hour window is recognised", classify(ctx({ error: "131047 Re-engagement message" })) === "META_131047");
  check("a wrong password is BAD_CREDENTIALS", classify(ctx({ component: "auth", action: "auth.login", outcome: "denied", httpStatus: 401 })) === "BAD_CREDENTIALS");
  check("no session elsewhere is AUTH_REQUIRED", classify(ctx({ component: "menu", action: "menu.save", outcome: "denied", httpStatus: 401 })) === "AUTH_REQUIRED");
  // The diagnosis has to be the right one, or the steps send someone to fix
  // the wrong thing. These three were all misread on the first real run.
  check(
    "a password change refused for an ended session is not called a wrong password",
    classify(ctx({ component: "auth", action: "auth.change-password", outcome: "denied", httpStatus: 401, error: "Not authorised" })) === "AUTH_REQUIRED",
  );
  const wrongCurrent = courseForAction(ctx({ component: "auth", action: "auth.change-password", outcome: "denied", httpStatus: 403, error: "Your current password is not correct", actorRole: "kitchen" }));
  check(
    "a mistyped current password is not called a permissions problem",
    wrongCurrent.code === "WRONG_CURRENT_PASSWORD" && /Caps Lock/.test(wrongCurrent.steps[0].do) && wrongCurrent.steps[0].owner === "kitchen",
    wrongCurrent,
  );
  const refusedSession = courseForAction(ctx({ component: "staff", action: "staff.create", outcome: "denied", httpStatus: 401, error: "Not authorised", actorRole: "kitchen" }));
  const noSession = courseForAction(ctx({ component: "staff", action: "staff.create", outcome: "denied", httpStatus: 401, error: "Not authorised", actorRole: null }));
  check(
    "a refused request says whether a session was presented, and for which role",
    /A kitchen session was presented and refused/.test(refusedSession.summary) && /kitchen role is not allowed/.test(refusedSession.steps[1].do) && /no valid staff session/.test(noSession.summary),
    [refusedSession.summary, noSession.summary],
  );
  const knownAccount = courseForAction(ctx({ component: "auth", action: "auth.login", outcome: "denied", httpStatus: 401, target: "staff:kitchen@khanbaba.com.au" }));
  const unknownAccount = courseForAction(ctx({ component: "auth", action: "auth.login", outcome: "denied", httpStatus: 401, target: null }));
  check(
    "a refused sign-in is explained differently for a real account and for one that does not exist",
    /kitchen@khanbaba\.com\.au/.test(knownAccount.summary) && /Reset password/.test(knownAccount.steps[1].where ?? "") && /no staff account that exists/.test(unknownAccount.summary) && !unknownAccount.steps.some((step) => /reset/i.test(step.do)),
    [knownAccount.summary, unknownAccount.summary],
  );
  check("404 is NOT_FOUND and 400 is INVALID_INPUT", classify(ctx({ outcome: "rejected", httpStatus: 404 })) === "NOT_FOUND" && classify(ctx({ outcome: "rejected", httpStatus: 400 })) === "INVALID_INPUT");
  check("an unexplained 500 is SERVER_ERROR", classify(ctx({ httpStatus: 500, error: "boom" })) === "SERVER_ERROR");
  check("a database outage is recognised", classify(ctx({ httpStatus: 500, error: "connect ECONNREFUSED 10.0.0.1:6543" })) === "DB_UNREACHABLE");

  // Every row carries a course of action — including the ones that worked.
  const matrix = [
    ctx({ error: "(#190) Error validating access token" }),
    ctx({ error: "131047" }),
    ctx({ error: "131030 not in allowed list" }),
    ctx({ error: "(#100) Unsupported post request" }),
    ctx({ error: "rate limit hit" }),
    ctx({ error: "ECONNREFUSED" }),
    ctx({ error: "WhatsApp is not configured" }),
    ctx({ error: "Chicken Karahi is sold out" }),
    ctx({ error: "We do not deliver to that postcode" }),
    ctx({ component: "auth", action: "auth.login", outcome: "denied", httpStatus: 401 }),
    ctx({ component: "auth", action: "auth.login", outcome: "denied", httpStatus: 429 }),
    ctx({ component: "menu", action: "menu.save", outcome: "denied", httpStatus: 401 }),
    ctx({ outcome: "denied", httpStatus: 403 }),
    ctx({ outcome: "rejected", httpStatus: 404 }),
    ctx({ outcome: "rejected", httpStatus: 409 }),
    ctx({ outcome: "rejected", httpStatus: 413 }),
    ctx({ outcome: "rejected", httpStatus: 400, error: "Name is required" }),
    ctx({ httpStatus: 500, error: "boom" }),
    ctx({ component: "orders", action: "orders.confirm", outcome: "ok", httpStatus: 200 }),
    ctx({ component: "music", action: "music.create-track", outcome: "ok", httpStatus: 200 }),
    ctx({ component: "settings", action: "settings.update", outcome: "ok", httpStatus: 200, keys: ["whatsapp_access_token", "restaurant_address"] }),
  ];
  const courses = matrix.map((entry) => courseForAction(entry));
  check(
    "every outcome has a course of action with at least one owned step",
    courses.every((course) => course.code.length > 1 && course.summary.length > 10 && course.steps.length > 0 && course.steps.every((step) => step.do.length >= 5 && step.owner.length > 0)),
    courses.filter((course) => !(course.steps.length > 0 && course.steps.every((step) => step.do.length >= 5 && step.owner.length > 0))).map((course) => course.code),
  );
  check("the failure classes are distinct", new Set(courses.slice(0, 18).map((course) => course.code)).size === 18, courses.slice(0, 18).map((course) => course.code));
  check(
    "changing a WhatsApp credential asks for it to be tested, and an address for a re-quote",
    courses[20].steps.some((step) => /Test live connection/.test(step.do)) && courses[20].steps.some((step) => /Re-quote/.test(step.do)),
    courses[20].steps.map((step) => step.do),
  );
  check("a routine success says plainly that nothing is left to do", /No follow-up/.test(courses[19].summary));

  check("a dead Meta token that stops a send is critical", levelFor(matrix[0], "META_190") === "critical");
  check("a refused request is a warning", levelFor(matrix[16], "INVALID_INPUT") === "warning");
  check("a settings change that worked is a notice, so the trail can be filtered", levelFor(matrix[20], "OK") === "notice");
  check("a routine success is info", levelFor(matrix[18], "OK") === "info");

  // --- references
  const actionRef = newActionReference("orders", new Date("2026-11-15T02:03:04Z"));
  check("an action reference names the component and the UTC date", /^ACT-OR-261115-[0-9A-HJKMNP-TV-Z]{5}$/.test(actionRef), actionRef);
  check("an unknown component still yields a two-letter code", /^ACT-ZZ-\d{6}-/.test(newActionReference("zz-new-thing")), newActionReference("zz-new-thing"));

  // --- nothing secret is stored
  const SECRETS = ["hunter2-PASSWORD", "EAAGm0PX4ZCpsBAsecrettoken123456", "sk_live_51secret", "P@ssw0rd.inEmailBox", "4242424242424242"];
  const scrubbed = redact({
    action: "create",
    password: SECRETS[0],
    newPassword: SECRETS[0],
    accessToken: SECRETS[1],
    stripe_secret_key: SECRETS[2],
    cardNumber: SECRETS[4],
    values: { whatsapp_access_token: SECRETS[1], restaurant_name: "Khan Baba" },
    nested: { authorization: `Bearer ${SECRETS[1]}`, keep: "visible" },
  }) as Record<string, unknown>;
  const scrubbedText = JSON.stringify(scrubbed);
  check("no secret survives redaction", SECRETS.every((secret) => !scrubbedText.includes(secret)), scrubbedText);
  check("a setting is recorded by key, never by value", JSON.stringify(scrubbed.values) === JSON.stringify({ whatsapp_access_token: "[changed]", restaurant_name: "[changed]" }), scrubbed.values);
  check("ordinary fields are kept", scrubbed.action === "create" && (scrubbed.nested as Record<string, unknown>).keep === "visible");

  const contact = redact({ email: "ayesha.khan@example.com", phone: "+61 412 345 678", to: "0412345678" }) as Record<string, string>;
  check("an email keeps its first letter and domain only", contact.email === "a***@example.com", contact.email);
  check("a phone number keeps its last three digits only", contact.phone === "…678" && contact.to === "…678", contact);
  check(
    "text in an email field that is not an address is not echoed",
    redact({ email: "P@ssw0rd" }) !== null && (redact({ email: "P@ssw0rd" }) as Record<string, string>).email === "[not an email]",
    redact({ email: "P@ssw0rd" }),
  );

  const person = redact(
    { action: "create", firstName: "Bilal", lastName: "Ahmed", licenceNumber: "NSW1234567", address: "12 Example St", notes: "gate code 4411", driverId: 7, status: "active", deliveryLat: -33.7 },
    "", 0, "drivers",
  ) as Record<string, unknown>;
  check(
    "for records about a person, only named-safe fields are stored",
    person.firstName === "[withheld]" && person.licenceNumber === "[withheld]" && person.address === "[withheld]" && person.notes === "[withheld]" && person.deliveryLat === "[withheld]",
    person,
  );
  check("…while the identifiers that make the row useful are kept", person.action === "create" && person.driverId === 7 && person.status === "active", person);

  const scrubbedError = scrubText(
    `GET https://graph.facebook.com/v20.0/123/messages?access_token=${SECRETS[1]} failed for ayesha.khan@example.com on 0412 345 678 with Bearer ${SECRETS[1]}`,
  );
  check(
    "error text is scrubbed of tokens, addresses and numbers",
    !scrubbedError.includes(SECRETS[1]) && !scrubbedError.includes("ayesha.khan") && !scrubbedError.includes("345 678") && scrubbedError.includes("graph.facebook.com"),
    scrubbedError,
  );

  // --- the wrapper, end to end
  const adminStaff = await db.one<{ id: number; name: string; email: string }>(
    "SELECT id, name, email FROM staff WHERE role = 'admin' ORDER BY id LIMIT 1",
  );
  const sessionCookie = `${SESSION_COOKIE}=${await createSessionToken({ id: adminStaff.id, name: adminStaff.name, email: adminStaff.email, role: "admin" })}`;
  const useDb = { db: async () => db };
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://local.test/api/ops/orders/42", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const routeContext = { params: Promise.resolve({ id: "42" }) };
  const newest = async () => (await listActions(db, { limit: 1 })).rows[0];
  const countActions = async () => Number((await db.one<{ c: number }>("SELECT COUNT(*) AS c FROM action_logs")).c);

  const actionsBefore = await countActions();
  const okHandler = withActionLog(
    "orders",
    async (request: Request) => {
      const body = (await request.json()) as { action: string };
      return Response.json({ ok: true, echoed: body.action }, { status: 200 });
    },
    useDb,
  );
  const okResponse = await okHandler(post({ action: "confirm", note: "table 4" }, { cookie: sessionCookie, "x-vercel-id": "syd1::abc-123" }), routeContext);
  const okBody = (await okResponse.json()) as { ok: boolean; echoed: string };
  check("the handler still reads its own request body", okBody.echoed === "confirm", okBody);
  check("the response is returned untouched", okResponse.status === 200 && okBody.ok === true);
  check("one action writes exactly one row", (await countActions()) === actionsBefore + 1);
  const okRow = await newest();
  check("the action is named component.verb", okRow.action === "orders.confirm" && okRow.component === "orders", okRow.action);
  check("the outcome and status are recorded", okRow.outcome === "ok" && okRow.http_status === 200 && okRow.level === "info", [okRow.outcome, okRow.http_status, okRow.level]);
  check("the actor is the signed-in member of staff", okRow.actor === adminStaff.email && okRow.actor_role === "admin", [okRow.actor, okRow.actor_role]);
  check("the target comes from the route", okRow.target === "order:42", okRow.target);
  check("the request is traceable to the function log and the build", okRow.request_id === "syd1::abc-123" && okRow.build === buildLabel() && okRow.route === "/api/ops/orders/42" && okRow.method === "POST", [okRow.request_id, okRow.build, okRow.route]);
  check("the duration is measured", typeof okRow.duration_ms === "number" && okRow.duration_ms >= 0, okRow.duration_ms);
  check("a success stores no error code", okRow.error_code === null, okRow.error_code);
  check("the course of action is stored with the row", parseCourse(okRow.course).steps.length > 0 && /kitchen/i.test(parseCourse(okRow.course).steps[0].do), okRow.course);
  check("the row can be fetched by the reference somebody quotes", (await getAction(db, okRow.reference))?.id === okRow.id);

  // Five random characters will, eventually, be drawn twice on the same day.
  // The reference is unique, so without a redraw that action would vanish.
  let draws = 0;
  const redrawn = await recordAction(
    db,
    { component: "orders", action: "ready", outcome: "ok", httpStatus: 200, actor: adminStaff.email, actorRole: "admin" },
    (component, at) => ((draws += 1) <= 2 ? okRow.reference : newActionReference(component, at)),
  );
  check("a reference that is already taken is drawn again rather than losing the row", redrawn !== null && redrawn !== okRow.reference && draws === 3, [redrawn, draws]);
  check("…and the row that already held it is untouched", (await getAction(db, okRow.reference))?.action === "orders.confirm");
  check("…and the new row is stored under the reference that was returned", (await getAction(db, redrawn as string))?.action === "orders.ready");
  const silenced = console.error;
  console.error = () => undefined;
  const exhausted = await recordAction(db, { component: "orders", action: "ready", outcome: "ok", httpStatus: 200 }, () => okRow.reference);
  console.error = silenced;
  check("if no reference is free the write is abandoned without throwing", exhausted === null);

  const rejecting = withActionLog("menu", async () => Response.json({ error: "A dish needs a name" }, { status: 400 }), useDb);
  await rejecting(post({ action: "save", item: { name: "" } }, { cookie: sessionCookie }), routeContext);
  const rejectedRow = await newest();
  check("a refused request is recorded as rejected, with its class", rejectedRow.outcome === "rejected" && rejectedRow.error_code === "INVALID_INPUT" && rejectedRow.level === "warning", [rejectedRow.outcome, rejectedRow.error_code, rejectedRow.level]);
  check("the message quotes what the server said", /A dish needs a name/.test(rejectedRow.message), rejectedRow.message);

  const denying = withActionLog("menu", async () => Response.json({ error: "Not authorised" }, { status: 401 }), useDb);
  await denying(post({ action: "delete", id: 3 }), routeContext);
  const deniedRow = await newest();
  check("a request with no session is recorded as denied and anonymous", deniedRow.outcome === "denied" && deniedRow.actor === "anonymous" && deniedRow.error_code === "AUTH_REQUIRED", [deniedRow.outcome, deniedRow.actor, deniedRow.error_code]);
  check("…and its first step is to sign in", /Sign in again/.test(parseCourse(deniedRow.course).steps[0].do));

  const boom = new Error("connect ECONNREFUSED 10.0.0.1:6543");
  const throwing = withActionLog("orders", async () => { throw boom; }, useDb);
  let rethrown: unknown = null;
  try {
    await throwing(post({ action: "dispatch" }, { cookie: sessionCookie }), routeContext);
  } catch (error) {
    rethrown = error;
  }
  const failedRow = await newest();
  check("a handler that throws still throws the same error", rethrown === boom);
  check("…and the failure is recorded, classified and critical", failedRow.outcome === "failed" && failedRow.error_code === "DB_UNREACHABLE" && failedRow.level === "critical" && failedRow.http_status === null, [failedRow.outcome, failedRow.error_code, failedRow.level]);

  // A forged cookie must not put someone else's name in the log.
  await denying(post({ action: "delete", id: 3 }, { cookie: `${SESSION_COOKIE}=forged.token.value` }), routeContext);
  check("a forged session cookie is not believed", (await newest()).actor === "anonymous");

  // Sign-in: the actor is the account that was named, if it exists. Nothing
  // else typed into the form is stored — a password can look exactly like an
  // address, so the only safe test is whether the staff table knows it.
  const login = withActionLog("auth", async () => Response.json({ error: "Those details do not match" }, { status: 401 }), { ...useDb, fallback: "login" });
  const loginRequest = (email: string) =>
    new Request("http://local.test/api/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: SECRETS[0] }) });
  const otherStaff = await db.one<{ email: string }>("SELECT email FROM staff WHERE role <> 'admin' ORDER BY id LIMIT 1");
  await login(loginRequest(` ${otherStaff.email.toUpperCase()} `), { params: Promise.resolve({}) });
  const loginRow = await newest();
  check(
    "a failed sign-in names the staff account that was tried",
    loginRow.action === "auth.login" && loginRow.actor === otherStaff.email.toLowerCase() && loginRow.target === `staff:${otherStaff.email.toLowerCase()}` && loginRow.error_code === "BAD_CREDENTIALS",
    [loginRow.action, loginRow.actor, loginRow.target, loginRow.error_code],
  );
  check("…and has no role, because none was granted", loginRow.actor_role === null, loginRow.actor_role);
  for (const typed of [SECRETS[3], "P@ssw0rd.2026", "not-an-account@example.com", "hunter2"]) {
    await login(loginRequest(typed), { params: Promise.resolve({}) });
    const row = await newest();
    check(
      `“${typed.slice(0, 2)}…” typed into the email box is stored nowhere`,
      row.actor === UNKNOWN_ACCOUNT && row.target === null && !JSON.stringify(row).includes(typed.slice(1)),
      [row.actor, row.target, row.detail],
    );
  }
  const granting = withActionLog("auth", async () => Response.json({ ok: true, role: "admin", redirectTo: "/admin" }), { ...useDb, fallback: "login" });
  await granting(loginRequest(adminStaff.email), { params: Promise.resolve({}) });
  const grantedRow = await newest();
  check("a successful sign-in records who signed in and the role granted", grantedRow.outcome === "ok" && grantedRow.actor === adminStaff.email.toLowerCase() && grantedRow.actor_role === "admin", [grantedRow.outcome, grantedRow.actor, grantedRow.actor_role]);

  // The whole table, searched for every secret that went through the wrapper.
  const settingsHandler = withActionLog("settings", async () => Response.json({ ok: true, updated: 2 }), { ...useDb, fallback: "update" });
  await settingsHandler(
    new Request("http://local.test/api/ops/settings", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({ values: { whatsapp_access_token: SECRETS[1], stripe_secret_key: SECRETS[2] } }),
    }),
    { params: Promise.resolve({}) },
  );
  const settingsRow = await newest();
  check("a settings change records which keys changed", settingsRow.action === "settings.update" && settingsRow.target === "settings:whatsapp_access_token,stripe_secret_key" && settingsRow.level === "notice", [settingsRow.action, settingsRow.target, settingsRow.level]);
  const staffHandler = withActionLog("staff", async () => Response.json({ ok: true }), useDb);
  await staffHandler(post({ action: "password", id: 2, password: SECRETS[0] }, { cookie: sessionCookie }), { params: Promise.resolve({}) });
  const everything = JSON.stringify(await db.query("SELECT * FROM action_logs"));
  check("no password, token or key appears anywhere in the action log", SECRETS.every((secret) => !everything.includes(secret)), SECRETS.filter((secret) => everything.includes(secret)));

  // Reads and transport controls: logged when they go wrong, not when they work.
  const quiet = withActionLog("music", async (request: Request) => {
    const body = (await request.json()) as { fail?: boolean };
    return body.fail ? Response.json({ error: "Player offline" }, { status: 500 }) : Response.json({ ok: true });
  }, { ...useDb, quiet: ["next"] });
  const beforeQuiet = await countActions();
  await quiet(post({ action: "next" }, { cookie: sessionCookie }), routeContext);
  check("a quiet action that works writes nothing", (await countActions()) === beforeQuiet);
  await quiet(post({ action: "next", fail: true }, { cookie: sessionCookie }), routeContext);
  check("the same action failing is recorded", (await countActions()) === beforeQuiet + 1 && (await newest()).action === "music.next");

  // Logging must never be the reason an action fails.
  const dbDown = withActionLog("orders", async () => Response.json({ ok: true }), { db: async () => { throw new Error("log database down"); } });
  const realConsoleError = console.error;
  const functionLog: string[] = [];
  console.error = (...args: unknown[]) => { functionLog.push(args.map(String).join(" ")); };
  let stillWorks: Response;
  try {
    stillWorks = await dbDown(post({ action: "confirm" }, { cookie: sessionCookie }), routeContext);
  } finally {
    console.error = realConsoleError;
  }
  check("an action succeeds even when its log line cannot be written", stillWorks.status === 200);
  check("…and the reason goes to the function log instead", functionLog.some((line) => /action log capture failed orders/.test(line) && /log database down/.test(line)), functionLog);

  // An upload is not copied into memory for the sake of a log line.
  const upload = withActionLog("media", async (request: Request) => {
    const form = await request.formData();
    return Response.json({ ok: true, name: (form.get("file") as File).name });
  }, { ...useDb, fallback: "upload" });
  const form = new FormData();
  form.set("file", new File([new Uint8Array(2048)], "karahi.jpg", { type: "image/jpeg" }));
  const uploaded = await upload(new Request("http://local.test/api/ops/upload", { method: "POST", body: form, headers: { cookie: sessionCookie } }), { params: Promise.resolve({}) });
  check("a multipart upload passes through and is logged by its fallback name", uploaded.status === 200 && (await newest()).action === "media.upload", (await newest()).action);

  check("a target is read from the body when the route has none", deriveTarget("menu", { action: "delete", id: 9 }, null, null) === "menu_item:9", deriveTarget("menu", { action: "delete", id: 9 }, null, null));
  check("a sign-in is never named from the text of the form", deriveTarget("auth", { email: "anything@example.com" }, null, null) === null);
  check(
    "the staff route names an account from the staff table, not from the form",
    /SELECT email FROM staff WHERE id = \$1/.test(read("app/api/ops/staff/route.ts")) && /SELECT email FROM staff WHERE lower\(email\) = \$1/.test(read("app/api/ops/staff/route.ts")),
  );
  check("a placed order is named by the code the customer was given", deriveTarget("orders", { items: [] }, null, { ok: true, code: "KB-1234AB" }) === "order:KB-1234AB");

  // --- every route that changes something is wrapped
  const routeFiles: string[] = [];
  const walkRoutes = (dir: string) => {
    for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) walkRoutes(full);
      else if (entry.name === "route.ts") routeFiles.push(full);
    }
  };
  for (const dir of ["app/api/ops", "app/api/staff", "app/api/broadcast"]) walkRoutes(nodePath.join(process.cwd(), dir));
  routeFiles.push(nodePath.join(process.cwd(), "app/api/orders/route.ts"));
  const mutating = routeFiles.filter((file) => /export\s+(async\s+function|const)\s+(POST|PUT|PATCH|DELETE)\b/.test(nodeFs.readFileSync(file, "utf8")));
  const unwrapped = mutating.filter((file) => !/export const (POST|PUT|PATCH|DELETE) = withActionLog\(/.test(nodeFs.readFileSync(file, "utf8")));
  check("there are staff routes to log", mutating.length >= 25, mutating.length);
  check(
    "every staff route that changes something writes to the action log",
    unwrapped.length === 0,
    unwrapped.map((file) => nodePath.relative(process.cwd(), file)),
  );

  // --- reading it back
  const problems = await listActions(db, { problems: true });
  check("the log can be filtered to problems", problems.total >= 8 && problems.rows.every((row) => row.outcome !== "ok"), problems.total);
  const byComponent = await listActions(db, { component: "auth" });
  check("…and by component", byComponent.total === 6 && byComponent.rows.every((row) => row.component === "auth"), byComponent.total);
  const byReference = await listActions(db, { q: okRow.reference.toLowerCase() });
  check("…and searched by reference, in any case", byReference.total === 1 && byReference.rows[0].id === okRow.id, byReference.total);
  const paged = await listActions(db, { limit: 2, offset: 1 });
  check("paging reports the full total", paged.rows.length === 2 && paged.total === (await countActions()), [paged.rows.length, paged.total]);
  check("a filter cannot be used to inject SQL", (await listActions(db, { component: "x'; DROP TABLE action_logs; --", q: "%' OR 1=1 --" })).total === 0 && (await countActions()) > 0);
  const actionStats = await actionSummary(db);
  check("the summary separates what worked from what did not", actionStats.total === (await countActions()) && actionStats.problems24h === problems.total && actionStats.ok24h + actionStats.problems24h === actionStats.last24h, actionStats);

  // --- one format, three exports
  const text = formatActionText(failedRow);
  check("the text record opens with timestamp, level and reference", new RegExp(`^\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z CRITICAL\\s+${failedRow.reference} orders\\.dispatch `).test(text), text.split("\n")[0]);
  check("…carries key=value pairs a search can match", /outcome=failed/.test(text) && /code=DB_UNREACHABLE/.test(text) && new RegExp(`actor=${adminStaff.email}`).test(text), text.split("\n")[0]);
  check("…and the numbered course of action with owners", /course_of_action: DB_UNREACHABLE/.test(text) && /\n\s+1\. \[developer\] /.test(text) && /\n\s+verify: /.test(text), text);
  const csv = actionsCsv([failedRow, okRow]);
  check("the CSV has a header and one line per row", csv.split("\r\n").filter(Boolean).length === 3 && csv.startsWith("occurred_at,level,reference,"), csv.split("\r\n")[0]);
  const hostile = await recordAction(db, { component: "menu", action: "save", outcome: "rejected", httpStatus: 400, actor: "=cmd|' /C calc'!A0", error: "=HYPERLINK(\"http://evil\")" });
  const hostileRow = await getAction(db, hostile as string);
  check("a value that would run as a spreadsheet formula is defused", /,'=cmd/.test(actionsCsv([hostileRow!])), actionsCsv([hostileRow!]).split("\r\n")[1]);
  const ndjson = actionsNdjson([failedRow, okRow]).trim().split("\n").map((line) => JSON.parse(line) as { ref: string; course_of_action: { steps: unknown[] } });
  check("the NDJSON is one object per line, course of action included", ndjson.length === 2 && ndjson[0].ref === failedRow.reference && ndjson[0].course_of_action.steps.length > 0);
  const anyFinding = (await openLogs(db))[0];
  const findingText = formatFindingText(anyFinding);
  check("a finding uses the same format", new RegExp(`${anyFinding.reference} ${anyFinding.code} status=open`).test(findingText) && /course_of_action:\n\s+1\. \[/.test(findingText), findingText.split("\n")[0]);
  check("findings export as CSV too", findingsCsv([anyFinding]).split("\r\n").filter(Boolean).length === 2);

  // --- the audit reads the action log
  for (let i = 0; i < 3; i += 1) {
    await recordAction(db, { component: "whatsapp", action: "publish", outcome: "failed", httpStatus: 502, actor: adminStaff.email, actorRole: "admin", error: "(#190) Error validating access token: Session has expired" });
  }
  const fromActions = await runAudit(db);
  const repeated = fromActions.findings.find((f) => f.code === "ACT_REPEATED_FAILURE");
  check("the same action failing three times becomes a standing finding", Boolean(repeated) && /whatsapp\.publish/.test(repeated?.title ?? ""), fromActions.findings.map((f) => f.code));
  check("…with the fix for the cause, not for the symptom", /Which token works/.test(repeated?.steps?.[0]?.do ?? ""), repeated?.steps?.[0]);
  check("a burst of failed sign-ins is reported", fromActions.findings.some((f) => f.code === "SEC_LOGIN_FAILURES"), fromActions.findings.map((f) => f.code));
  const related = await recordAction(db, { component: "auth", action: "login", outcome: "denied", httpStatus: 401, actor: "someone@khanbaba.com.au" });
  check("a recorded action always gets a reference back", /^ACT-AU-\d{6}-/.test(related ?? ""), related);

  // --- retention
  const old = async (level: string, days: number) =>
    db.query(
      "INSERT INTO action_logs (reference, occurred_at, level, component, action, outcome, message, course) VALUES ($1, now() - make_interval(days => $2), $3, 'menu', 'menu.save', $4, 'old row', '{}')",
      [`ACT-OLD-${level}-${days}`, days, level, level === "error" ? "failed" : "ok"],
    );
  await old("info", 40);
  await old("notice", 40);
  await old("error", 40);
  await old("error", 200);
  const pruned = await pruneActions(db);
  const survivors = (await db.query<{ reference: string }>("SELECT reference FROM action_logs WHERE reference LIKE 'ACT-OLD-%' ORDER BY reference")).map((row) => row.reference);
  check("pruning reports how many rows it removed", pruned === 2, pruned);
  check(
    "routine rows go after 30 days; sensitive changes and problems are kept 180",
    survivors.join() === "ACT-OLD-error-40,ACT-OLD-notice-40",
    survivors,
  );

  // --- the tables are closed to Supabase's public Data API
  const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
    "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('action_logs','operation_logs') ORDER BY relname",
  );
  check("both log tables have row level security on", rls.length === 2 && rls.every((row) => row.relrowsecurity === true), rls);
  check("…and the application, as owner, still reads and writes them", (await countActions()) > 0);

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
