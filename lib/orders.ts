import { randomBytes } from "node:crypto";
import type { Db } from "./db";
import {
  computePricing,
  type Channel,
  type PricingBreakdown,
  type DeliveryPricing,
} from "./pricing";
import { startPayment, paymentOptionLabel } from "./payments";
import { upsertGuestCustomer } from "./auth/customer";
import { getSetting, getSettingNumber } from "./settings";
import { addressHash, verifyQuote } from "./quotes";
import {
  quoteDelivery,
  dispatchWithProvider,
  providerStatus,
  providerLabel,
} from "./delivery";
import {
  validatePromotion,
  recordPromotionRedemption,
  PromotionError,
} from "./promotions";
import { trackingSnapshot, settleDriverJob } from "./drivers";
import { coordinate, estimateCoordinates, SYDNEY_CBD } from "./geo";

export class OrderError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type OrderStatus =
  | "pending_confirm"
  | "confirmed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "awaiting_collection"
  | "completed"
  | "cancelled";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_confirm: "Awaiting counter confirmation",
  confirmed: "Confirmed — sent to kitchen",
  preparing: "In the kitchen",
  ready: "Packed & ready",
  out_for_delivery: "Out for delivery",
  awaiting_collection: "Ready for collection",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type CartLineInput = {
  itemId: number;
  variantId: number;
  qty: number;
  spiceLevel?: string | null;
  notes?: string | null;
};

export type CreateOrderInput = {
  channel: Channel;
  customerName: string;
  phone?: string;
  email?: string;
  address?: string;
  suburb?: string;
  postcode?: string;
  notes?: string;
  tableCode?: string;
  priority?: boolean;
  paymentMethod: "online" | "counter";
  paymentLast4?: string;
  /** card_visa | card_mastercard | card_amex | afterpay | paypal */
  paymentOption?: string;
  quoteToken?: string;
  /** Geocoded drop-off. Resolved in the browser at checkout, corrected in admin. */
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  /** Customer promotion code — always re-validated server-side. */
  promoCode?: string;
  /** Set by the ordering route from the signed-in customer cookie, never by the browser. */
  customerId?: number | null;
  items: CartLineInput[];
};

export type OrderRow = {
  id: number;
  code: string;
  customer_id: number | null;
  tracking_token: string | null;
  channel: Channel;
  table_id: number | null;
  customer_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  suburb: string | null;
  postcode: string | null;
  notes: string | null;
  subtotal_cents: number;
  surcharge_cents: number;
  surcharge_detail: string | null;
  priority: boolean;
  priority_fee_cents: number;
  delivery_fee_cents: number;
  delivery_cost_cents: number;
  total_cents: number;
  payment_method: "online" | "counter";
  payment_status: "unpaid" | "pending" | "paid" | "refunded" | "failed";
  payment_ref: string | null;
  payment_option: string | null;
  discount_cents: number;
  promotion_code: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  status: OrderStatus;
  progress: number;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  kitchen_started_at: string | null;
  ready_at: string | null;
  dispatched_at: string | null;
  completed_at: string | null;
};

export type OrderItemRow = {
  id: number;
  order_id: number;
  item_id: number | null;
  variant_id: number | null;
  name: string;
  variant_label: string | null;
  size_ml: number | null;
  spice_level: string | null;
  qty: number;
  unit_price_cents: number;
  line_total_cents: number;
  notes: string | null;
  prep_state: "queued" | "preparing" | "ready";
};

export type DeliveryJobRow = {
  id: number;
  order_id: number;
  provider: string;
  provider_quote_id: string | null;
  provider_delivery_id: string | null;
  cost_cents: number;
  customer_fee_cents: number;
  markup_cents: number;
  status: string;
  courier_name: string | null;
  courier_phone: string | null;
  tracking_url: string | null;
  eta_minutes: number | null;
  driver_id: number | null;
  driver_fee_cents: number;
  driver_settled_at: string | null;
  distance_km: number | null;
  quote_json: string | null;
  external_status: string | null;
  triggered_by: string | null;
  created_at: string;
  dispatched_at: string | null;
  completed_at: string | null;
};

export function newOrderCode(): string {
  const stamp = Date.now().toString(36).slice(-5).toUpperCase();
  return `KB-${stamp}${randomBytes(2).toString("hex").toUpperCase()}`;
}

/**
 * The token behind `GET /t/<token>` — the link a customer can text to whoever is
 * collecting, or reopen on another phone without typing an order code. 16 bytes
 * of randomness makes it unguessable; the order code stays the human-facing
 * handle.
 */
export function newTrackingToken(): string {
  return randomBytes(16).toString("base64url");
}

export async function addEvent(
  db: Db,
  orderId: number,
  type: string,
  message: string,
  actor = "system",
  progress?: number,
): Promise<void> {
  await db.query(
    "INSERT INTO order_events (order_id, type, message, actor, progress) VALUES ($1, $2, $3, $4, $5)",
    [orderId, type, message, actor, progress ?? null],
  );
}

export async function getOrderByCode(
  db: Db,
  code: string,
): Promise<OrderRow | null> {
  return db.maybeOne<OrderRow>("SELECT * FROM orders WHERE code = $1", [
    code.trim().toUpperCase(),
  ]);
}

export async function getOrderById(
  db: Db,
  id: number,
): Promise<OrderRow | null> {
  return db.maybeOne<OrderRow>("SELECT * FROM orders WHERE id = $1", [id]);
}

export async function getOrderByTrackingToken(
  db: Db,
  token: string,
): Promise<OrderRow | null> {
  const clean = (token ?? "").trim();
  if (!clean) return null;
  return db.maybeOne<OrderRow>(
    "SELECT * FROM orders WHERE tracking_token = $1",
    [clean],
  );
}

/** Every order belonging to an account, newest first, with its items. */
export async function listCustomerOrders(
  db: Db,
  customerId: number,
  limit = 50,
) {
  const orders = await db.query<OrderRow>(
    `SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [customerId, limit],
  );
  const withItems = [];
  for (const order of orders) {
    withItems.push({
      order,
      items: await getOrderItems(db, order.id),
    });
  }
  return withItems;
}

/**
 * Resolve an order from whatever the customer has: the code they were given,
 * or the token in their tracking link. Used by the shared tracking view so one
 * URL shape (`/t/<token>`) and one search box both work.
 */
export async function resolveOrderRef(
  db: Db,
  ref: string,
): Promise<OrderRow | null> {
  const clean = (ref ?? "").trim();
  if (!clean) return null;
  if (/^KB-/i.test(clean)) return getOrderByCode(db, clean);
  return (await getOrderByTrackingToken(db, clean)) ?? getOrderByCode(db, clean);
}

export async function getOrderItems(
  db: Db,
  orderId: number,
): Promise<OrderItemRow[]> {
  return db.query<OrderItemRow>(
    "SELECT * FROM order_items WHERE order_id = $1 ORDER BY id",
    [orderId],
  );
}

export async function getOrderEvents(
  db: Db,
  orderId: number,
): Promise<
  {
    id: number;
    type: string;
    message: string;
    actor: string | null;
    progress: number | null;
    created_at: string;
  }[]
> {
  return db.query(
    "SELECT * FROM order_events WHERE order_id = $1 ORDER BY id ASC",
    [orderId],
  );
}

export async function getLatestJob(
  db: Db,
  orderId: number,
): Promise<DeliveryJobRow | null> {
  return db.maybeOne<DeliveryJobRow>(
    "SELECT * FROM delivery_jobs WHERE order_id = $1 ORDER BY id DESC LIMIT 1",
    [orderId],
  );
}

export async function getFullOrder(db: Db, code: string) {
  const order = await getOrderByCode(db, code);
  if (!order) return null;
  return fullOrderFromRow(db, order);
}

/** The same shape as getFullOrder, for a row already in hand. */
export async function fullOrderFromRow(db: Db, order: OrderRow) {
  const table = order.table_id
    ? await db.maybeOne<{ code: string; name: string; zone: string | null }>(
        "SELECT code, name, zone FROM dining_tables WHERE id = $1",
        [order.table_id],
      )
    : null;
  const [items, events, job] = await Promise.all([
    getOrderItems(db, order.id),
    getOrderEvents(db, order.id),
    getLatestJob(db, order.id),
  ]);
  return { order, items, events, job, table: table ?? null };
}

type ResolvedLine = {
  item_id: number;
  variant_id: number;
  name: string;
  image: string | null;
  variant_label: string;
  size_ml: number | null;
  spice_level: string | null;
  qty: number;
  unit_price_cents: number;
  line_total_cents: number;
  notes: string | null;
  prep_minutes: number;
};

async function resolveLines(
  db: Db,
  items: CartLineInput[],
): Promise<ResolvedLine[]> {
  if (!Array.isArray(items) || items.length === 0)
    throw new OrderError("Your cart is empty");
  if (items.length > 40) throw new OrderError("Too many items in one order");

  const resolved: ResolvedLine[] = [];
  for (const line of items) {
    const qty = Math.floor(Number(line.qty));
    if (!Number.isFinite(qty) || qty <= 0 || qty > 30)
      throw new OrderError("Invalid quantity");
    const row = await db.maybeOne<{
      id: number;
      name: string;
      image: string | null;
      spice_levels: string;
      is_available: boolean;
      published: boolean;
      prep_minutes: number;
      variant_id: number;
      item_id: number;
      label: string;
      size_ml: number | null;
      price_cents: number;
      active: boolean;
    }>(
      `SELECT mi.id, mi.name, mi.image, mi.spice_levels, mi.is_available, mi.published, mi.prep_minutes,
              iv.id AS variant_id, iv.item_id, iv.label, iv.size_ml, iv.price_cents, iv.active
       FROM item_variants iv JOIN menu_items mi ON mi.id = iv.item_id
       WHERE iv.id = $1`,
      [line.variantId],
    );
    if (!row)
      throw new OrderError("An item in your cart is no longer available");
    if (!row.published || !row.is_available || !row.active) {
      throw new OrderError(`${row.name} is currently unavailable`);
    }
    if (row.item_id !== Number(line.itemId))
      throw new OrderError("Menu item mismatch");

    const allowedSpice = (row.spice_levels || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    let spice: string | null = null;
    if (allowedSpice.length > 0) {
      spice =
        line.spiceLevel && allowedSpice.includes(line.spiceLevel)
          ? line.spiceLevel
          : allowedSpice[0];
    }

    resolved.push({
      item_id: row.item_id,
      variant_id: row.variant_id,
      name: row.name,
      image: row.image,
      variant_label: row.label,
      size_ml: row.size_ml,
      spice_level: spice,
      qty,
      unit_price_cents: row.price_cents,
      line_total_cents: row.price_cents * qty,
      notes: line.notes?.slice(0, 200) ?? null,
      prep_minutes: row.prep_minutes,
    });
  }
  return resolved;
}

export type CreateOrderResult = {
  order: OrderRow;
  items: OrderItemRow[];
  pricing: PricingBreakdown;
  redirectUrl?: string;
  /** The unguessable token behind the shareable /t/<token> tracking link. */
  trackingToken: string | null;
};

export async function createOrder(
  db: Db,
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const channel = input.channel;
  if (!["delivery", "pickup", "dine_in", "table"].includes(channel))
    throw new OrderError("Unknown service type");

  const name = (input.customerName || "").trim().slice(0, 80);
  if (name.length < 2) throw new OrderError("Please tell us your name");

  // Table orders must reference a real, active table.
  let tableId: number | null = null;
  if (channel === "table") {
    if ((await getSetting("table_ordering_enabled", "1")) !== "1") {
      throw new OrderError("Table ordering is currently paused");
    }
    const table = await db.maybeOne<{ id: number }>(
      "SELECT id FROM dining_tables WHERE code = $1 AND active",
      [(input.tableCode || "").toUpperCase()],
    );
    if (!table) throw new OrderError("That table QR code is not recognised");
    tableId = table.id;
  }

  if (channel === "delivery") {
    if (!input.address || input.address.trim().length < 5)
      throw new OrderError("A delivery address is required");
  }

  const lines = await resolveLines(db, input.items);
  const subtotal = lines.reduce((sum, line) => sum + line.line_total_cents, 0);

  const minOrder =
    channel === "delivery"
      ? await getSettingNumber("delivery_min_order_cents", 2500)
      : await getSettingNumber("min_order_cents", 0);
  if (subtotal < minOrder) {
    throw new OrderError(
      `Minimum order for ${channel === "delivery" ? "delivery" : "ordering"} is $${(minOrder / 100).toFixed(2)}`,
    );
  }

  // Delivery coordinates: trusted from the browser geocoder when present,
  // otherwise a deterministic estimate so distance fees, maps and ATO trip logs
  // always have a usable point. Staff can correct them in Admin → Orders.
  const deliveryLat =
    channel === "delivery"
      ? (coordinate(input.deliveryLat) ??
        estimateCoordinates(
          input.address ?? "",
          input.suburb ?? "",
          input.postcode ?? "",
          SYDNEY_CBD,
        ).lat)
      : null;
  const deliveryLng =
    channel === "delivery"
      ? (coordinate(input.deliveryLng) ??
        estimateCoordinates(
          input.address ?? "",
          input.suburb ?? "",
          input.postcode ?? "",
          SYDNEY_CBD,
        ).lng)
      : null;

  // Delivery fee: trust only a signed quote for this address, otherwise re-quote live.
  let delivery: DeliveryPricing | null = null;
  if (channel === "delivery") {
    const verified = verifyQuote(input.quoteToken);
    const hash = addressHash(
      `${input.address ?? ""}|${input.suburb ?? ""}|${input.postcode ?? ""}`,
    );
    if (verified && verified.addressHash === hash) {
      delivery = {
        provider: verified.provider,
        providerQuoteId: verified.quoteId,
        costCents: verified.costCents,
        serviceFeeCents: verified.customerFeeCents - verified.costCents,
        customerFeeCents: verified.customerFeeCents,
        etaMinutes: verified.etaMinutes,
        expiresAt: verified.expiresAt,
        live: verified.live,
      };
    } else {
      delivery = await quoteDelivery({
        orderCode: "PENDING",
        customerName: name,
        phone: input.phone,
        dropoffAddress: input.address ?? "",
        dropoffSuburb: input.suburb,
        dropoffPostcode: input.postcode,
        dropoffNotes: input.notes,
        dropoffLat: deliveryLat,
        dropoffLng: deliveryLng,
        orderValueCents: subtotal,
      });
    }
  }

  // Promotions are validated again on the server — the checkout preview is
  // only ever an estimate, and a forged discount must never reach the total.
  let promotionCheck: Awaited<ReturnType<typeof validatePromotion>> | null = null;
  if (input.promoCode?.trim()) {
    try {
      promotionCheck = await validatePromotion(db, input.promoCode, {
        subtotalCents: subtotal,
        channel,
        deliveryFeeCents: delivery?.customerFeeCents ?? 0,
        customerId: input.customerId ?? null,
      });
    } catch (error) {
      if (error instanceof PromotionError) throw new OrderError(error.message);
      throw error;
    }
  }

  const pricing = await computePricing(db, {
    subtotalCents: subtotal,
    channel,
    priority: Boolean(input.priority),
    delivery,
    discountCents: promotionCheck?.discountCents ?? 0,
    promotionLabel: promotionCheck?.label,
  });

  if (channel === "delivery" && input.paymentMethod === "counter") {
    throw new OrderError("Delivery orders must be paid online before dispatch");
  }
  if (
    input.paymentMethod === "counter" &&
    (await getSetting("pay_at_counter_enabled", "1")) !== "1"
  ) {
    throw new OrderError("Pay at counter is currently unavailable");
  }
  if (
    input.paymentMethod === "online" &&
    (await getSetting("online_payment_enabled", "1")) !== "1"
  ) {
    throw new OrderError(
      "Online payment is currently unavailable — please pay at the counter",
    );
  }

  const code = newOrderCode();
  const trackingToken = newTrackingToken();

  // Attach the order to an account when we can identify one: the signed-in
  // customer first, otherwise the guest row for this email (created on the
  // spot). Counter walk-ins without an email simply have no account — the
  // tracking token still gives them a live link.
  let customerId: number | null = input.customerId ?? null;
  if (!customerId && input.email) {
    const guest = await upsertGuestCustomer(db, {
      name,
      email: input.email,
      phone: input.phone,
      address: input.address,
      suburb: input.suburb,
      postcode: input.postcode,
    });
    customerId = guest?.id ?? null;
  }

  const prepMinutes = Math.max(...lines.map((l) => l.prep_minutes));
  const promisedAt = new Date(
    Date.now() + (prepMinutes + (channel === "delivery" ? 25 : 5)) * 60_000,
  ).toISOString();

  const orderId = await db.transaction(async (tx) => {
    const id = await tx.insert(
      `INSERT INTO orders (code, customer_id, tracking_token, channel, table_id, customer_name, phone, email,
        address, suburb, postcode, notes,
        subtotal_cents, surcharge_cents, surcharge_detail, priority, priority_fee_cents, delivery_fee_cents,
        delivery_cost_cents, total_cents, payment_method, payment_status, status, progress, promised_at,
        delivery_lat, delivery_lng, discount_cents, promotion_code, payment_option)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
        'pending_confirm', 5, $23, $24, $25, $26, $27, $28)
       RETURNING id`,
      [
        code,
        customerId,
        trackingToken,
        channel,
        tableId,
        name,
        input.phone?.slice(0, 30) ?? null,
        input.email?.slice(0, 120) ?? null,
        channel === "delivery" ? (input.address ?? "").slice(0, 250) : null,
        input.suburb?.slice(0, 80) ?? null,
        input.postcode?.slice(0, 12) ?? null,
        input.notes?.slice(0, 500) ?? null,
        subtotal,
        pricing.surchargeCents,
        JSON.stringify(pricing.adjustments),
        pricing.priorityFeeCents > 0,
        pricing.priorityFeeCents,
        pricing.deliveryFeeCents,
        pricing.deliveryCostCents,
        pricing.totalCents,
        input.paymentMethod,
        input.paymentMethod === "counter" ? "unpaid" : "pending",
        promisedAt,
        deliveryLat,
        deliveryLng,
        pricing.discountCents,
        promotionCheck?.promotion.code ?? null,
        input.paymentMethod === "online"
          ? (input.paymentOption ?? "card_visa")
          : null,
      ],
    );

    for (const line of lines) {
      await tx.query(
        `INSERT INTO order_items (order_id, item_id, variant_id, name, variant_label, size_ml, spice_level, qty,
          unit_price_cents, line_total_cents, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          line.item_id,
          line.variant_id,
          line.name,
          line.variant_label,
          line.size_ml,
          line.spice_level,
          line.qty,
          line.unit_price_cents,
          line.line_total_cents,
          line.notes,
        ],
      );
    }

    await addEvent(
      tx,
      id,
      "created",
      `Order placed — ${channel === "delivery" ? "delivery" : channel === "pickup" ? "click & collect" : channel === "table" ? "table order" : "dine in"}`,
      "customer",
      5,
    );
    return id;
  });

  if (customerId) {
    await db.query(
      `INSERT INTO customer_activity (customer_id, kind, detail) VALUES ($1, 'order', $2)`,
      [customerId, `Placed order ${code}`],
    );
    await db.query("UPDATE customers SET last_order_at = now() WHERE id = $1", [
      customerId,
    ]);
    if (channel === "delivery" && deliveryLat && deliveryLng) {
      await db.query(
        "UPDATE customers SET address_lat = $1, address_lng = $2 WHERE id = $3 AND address_lat IS NULL",
        [deliveryLat, deliveryLng, customerId],
      );
    }
  }

  if (promotionCheck) {
    await recordPromotionRedemption(
      db,
      promotionCheck,
      orderId,
      customerId,
    );
    await addEvent(
      db,
      orderId,
      "promotion",
      `${promotionCheck.label} applied — ${(promotionCheck.discountCents / 100).toFixed(2)} off`,
      "customer",
    );
  }

  // Delivery job placeholder — the coordinator confirms the live quote at dispatch time.
  if (channel === "delivery" && delivery) {
    await db.query(
      `INSERT INTO delivery_jobs (order_id, provider, provider_quote_id, cost_cents, customer_fee_cents, markup_cents,
        status, eta_minutes, quote_json, distance_km)
       VALUES ($1, $2, $3, $4, $5, $6, 'quoted', $7, $8, $9)`,
      [
        orderId,
        delivery.provider,
        delivery.providerQuoteId,
        delivery.costCents,
        delivery.customerFeeCents,
        delivery.customerFeeCents - delivery.costCents,
        delivery.etaMinutes,
        JSON.stringify(delivery.raw ?? {}),
        Number(
          (delivery.raw as { distanceKm?: number } | undefined)?.distanceKm ?? 0,
        ) || null,
      ],
    );
  }

  let redirectUrl: string | undefined;
  if (input.paymentMethod === "online") {
    const payment = await startPayment({
      orderCode: code,
      amountCents: pricing.totalCents,
      description: `Khan Baba order ${code}`,
      last4: input.paymentLast4,
      customerEmail: input.email,
      option: (input.paymentOption ?? "card_visa") as Parameters<
        typeof startPayment
      >[0]["option"],
    });
    await db.query(
      `INSERT INTO payments (order_id, provider, intent_id, amount_cents, status, method, last4, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        orderId,
        payment.provider,
        payment.intentId,
        pricing.totalCents,
        payment.status,
        payment.method ?? "card",
        payment.last4 ?? null,
        JSON.stringify(payment.raw ?? {}),
      ],
    );

    if (payment.status === "paid") {
      await db.query(
        "UPDATE orders SET payment_status = 'paid', payment_ref = $1, updated_at = now() WHERE id = $2",
        [payment.intentId, orderId],
      );
      await addEvent(
        db,
        orderId,
        "payment",
        "Payment received online",
        "customer",
        8,
      );
    } else {
      await db.query(
        "UPDATE orders SET payment_ref = $1, updated_at = now() WHERE id = $2",
        [payment.intentId, orderId],
      );
      redirectUrl = payment.redirectUrl;
    }
  } else {
    await addEvent(
      db,
      orderId,
      "payment",
      "Payment to be taken at the counter",
      "customer",
      8,
    );
  }

  const order = (await getOrderById(db, orderId))!;
  return {
    order,
    items: await getOrderItems(db, orderId),
    pricing,
    redirectUrl,
    trackingToken: order.tracking_token,
  };
}

async function recomputeProgress(db: Db, order: OrderRow): Promise<void> {
  const items = await getOrderItems(db, order.id);
  if (items.length === 0) return;
  const ready = items.filter((i) => i.prep_state === "ready").length;
  const preparing = items.filter((i) => i.prep_state === "preparing").length;
  if (order.status === "preparing" || order.status === "confirmed") {
    const progress = Math.min(
      78,
      Math.round(20 + (ready / items.length) * 55 + (preparing > 0 ? 3 : 0)),
    );
    await db.query(
      "UPDATE orders SET progress = $1, updated_at = now() WHERE id = $2",
      [progress, order.id],
    );
  }
}

/** Counter accepts the order → it is routed straight to the kitchen display. */
export async function confirmOrder(
  db: Db,
  orderId: number,
  actor: string,
): Promise<OrderRow> {
  const order = await getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (order.status !== "pending_confirm")
    throw new OrderError("This order has already been actioned");
  await db.query(
    `UPDATE orders SET status = 'confirmed', progress = 20, confirmed_at = now(), updated_at = now()
     WHERE id = $1`,
    [orderId],
  );
  await addEvent(
    db,
    orderId,
    "confirmed",
    "Order accepted by the counter — sent to the kitchen display",
    actor,
    20,
  );
  return (await getOrderById(db, orderId))!;
}

export async function setItemPrepState(
  db: Db,
  orderId: number,
  itemId: number,
  state: "queued" | "preparing" | "ready",
  actor: string,
): Promise<OrderRow> {
  const order = await getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (!["confirmed", "preparing"].includes(order.status)) {
    throw new OrderError("This order is no longer in the kitchen queue");
  }
  const item = await db.maybeOne<OrderItemRow>(
    "SELECT * FROM order_items WHERE id = $1 AND order_id = $2",
    [itemId, orderId],
  );
  if (!item) throw new OrderError("Item not found", 404);

  await db.query("UPDATE order_items SET prep_state = $1 WHERE id = $2", [
    state,
    itemId,
  ]);

  if (order.status === "confirmed") {
    await db.query(
      "UPDATE orders SET status = 'preparing', kitchen_started_at = COALESCE(kitchen_started_at, now()), updated_at = now() WHERE id = $1",
      [orderId],
    );
    await addEvent(
      db,
      orderId,
      "kitchen_started",
      "Kitchen started preparation",
      actor,
      22,
    );
  }

  const refreshed = (await getOrderById(db, orderId))!;
  await recomputeProgress(db, refreshed);

  const items = await getOrderItems(db, orderId);
  const readyCount = items.filter((i) => i.prep_state === "ready").length;
  if (state === "ready") {
    await addEvent(
      db,
      orderId,
      "item_ready",
      `${item.name} (${item.variant_label}) is ready — ${readyCount}/${items.length} items complete`,
      actor,
    );
  } else if (state === "preparing") {
    await addEvent(
      db,
      orderId,
      "item_preparing",
      `Preparing ${item.name} (${item.variant_label})`,
      actor,
    );
  }
  return (await getOrderById(db, orderId))!;
}

export async function markOrderReady(
  db: Db,
  orderId: number,
  actor: string,
): Promise<OrderRow> {
  const order = await getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (!["confirmed", "preparing"].includes(order.status))
    throw new OrderError("Order is not in preparation");

  // Anything the kitchen has not explicitly closed off is finished when they bump the ticket.
  await db.query(
    "UPDATE order_items SET prep_state = 'ready' WHERE order_id = $1",
    [orderId],
  );

  const nextStatus: OrderStatus =
    order.channel === "pickup" ? "awaiting_collection" : "ready";
  const progress = order.channel === "pickup" ? 88 : 85;
  await db.query(
    `UPDATE orders SET status = $1, progress = $2, ready_at = now(), updated_at = now() WHERE id = $3`,
    [nextStatus, progress, orderId],
  );
  await addEvent(
    db,
    orderId,
    "ready",
    order.channel === "delivery"
      ? "Packed and ready — waiting for the delivery coordinator"
      : order.channel === "pickup"
        ? "Ready for collection at the counter"
        : "Ready to serve",
    actor,
    progress,
  );
  return (await getOrderById(db, orderId))!;
}

export async function markOrderPaid(
  db: Db,
  orderId: number,
  actor: string,
  method = "counter",
  last4?: string,
): Promise<OrderRow> {
  const order = await getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (order.payment_status === "paid") return order;
  await db.query(
    "UPDATE orders SET payment_status = 'paid', payment_ref = $1, updated_at = now() WHERE id = $2",
    [`counter-${method}`, orderId],
  );
  await db.query(
    `INSERT INTO payments (order_id, provider, intent_id, amount_cents, status, method, last4, paid_at)
     VALUES ($1, 'counter', $2, $3, 'paid', $4, $5, now())`,
    [orderId, `counter_${orderId}`, order.total_cents, method, last4 ?? null],
  );
  await addEvent(
    db,
    orderId,
    "payment",
    `Payment taken at counter (${method})`,
    actor,
  );
  return (await getOrderById(db, orderId))!;
}

export async function completeOrder(
  db: Db,
  orderId: number,
  actor: string,
  message?: string,
): Promise<OrderRow> {
  const order = await getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (order.status === "cancelled") throw new OrderError("Order is cancelled");
  await db.query(
    "UPDATE orders SET status = 'completed', progress = 100, completed_at = now(), updated_at = now() WHERE id = $1",
    [orderId],
  );
  await addEvent(
    db,
    orderId,
    "completed",
    message ?? "Order completed",
    actor,
    100,
  );

  // Post the driver's commission + ATO kilometre trip only on a successful
  // delivery. Idempotent, so webhooks and status re-syncs cannot double-pay.
  const job = await getLatestJob(db, orderId);
  if (job?.status === "delivered" && job.driver_id) {
    const settled = await settleDriverJob(db, job.id, actor);
    if (settled)
      await addEvent(
        db,
        orderId,
        "driver_settled",
        `Driver commission $${(settled.feeCents / 100).toFixed(2)} posted · ${settled.distanceKm} km logged for the ATO report`,
        actor,
      );
  }

  // NOTE: no Square calls here by design. The detached POS bridge discovers
  // completed orders from its own sync tables (manual run, cron or webhook),
  // so the ordering core has zero dependency on Square being available.
  return (await getOrderById(db, orderId))!;
}

export async function cancelOrder(
  db: Db,
  orderId: number,
  actor: string,
  reason: string,
): Promise<OrderRow> {
  const order = await getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (["completed", "cancelled"].includes(order.status))
    throw new OrderError("Order cannot be cancelled");
  await db.query(
    "UPDATE orders SET status = 'cancelled', cancelled_reason = $1, updated_at = now() WHERE id = $2",
    [reason.slice(0, 200), orderId],
  );
  await addEvent(
    db,
    orderId,
    "cancelled",
    `Order cancelled — ${reason}`,
    actor,
  );
  if (order.payment_status === "paid") {
    await db.query(
      "UPDATE orders SET payment_status = 'refunded' WHERE id = $1",
      [orderId],
    );
    await addEvent(
      db,
      orderId,
      "refund",
      "Refund queued for the original payment method",
      actor,
    );
  }
  return (await getOrderById(db, orderId))!;
}

/** Re-quote the courier at dispatch time and record the real cost against the order. */
export async function refreshDeliveryQuote(
  db: Db,
  orderId: number,
  actor: string,
): Promise<DeliveryJobRow> {
  const order = await getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (order.channel !== "delivery")
    throw new OrderError("Only delivery orders need a courier");

  const quote = await quoteDelivery({
    orderCode: order.code,
    customerName: order.customer_name,
    phone: order.phone ?? undefined,
    dropoffAddress: order.address ?? "",
    dropoffSuburb: order.suburb ?? undefined,
    dropoffPostcode: order.postcode ?? undefined,
    dropoffLat: order.delivery_lat,
    dropoffLng: order.delivery_lng,
    orderValueCents: order.subtotal_cents,
  });

  const existing = await getLatestJob(db, orderId);
  const charged = existing?.customer_fee_cents ?? order.delivery_fee_cents;

  if (existing && existing.status === "quoted") {
    await db.query(
      `UPDATE delivery_jobs SET provider = $1, provider_quote_id = $2, cost_cents = $3, customer_fee_cents = $4,
        markup_cents = $5, eta_minutes = $6, quote_json = $7 WHERE id = $8`,
      [
        quote.provider,
        quote.providerQuoteId,
        quote.costCents,
        charged,
        charged - quote.costCents,
        quote.etaMinutes,
        JSON.stringify(quote.raw ?? {}),
        existing.id,
      ],
    );
    await db.query("UPDATE orders SET delivery_cost_cents = $1 WHERE id = $2", [
      quote.costCents,
      orderId,
    ]);
    await addEvent(
      db,
      orderId,
      "delivery_quote",
      `Live courier quote refreshed: $${(quote.costCents / 100).toFixed(2)} courier cost (customer paid $${(charged / 100).toFixed(2)})`,
      actor,
    );
    return (await getLatestJob(db, orderId))!;
  }

  const jobId = await db.insert(
    `INSERT INTO delivery_jobs (order_id, provider, provider_quote_id, cost_cents, customer_fee_cents, markup_cents,
      status, eta_minutes, quote_json, triggered_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'quoted', $7, $8, $9)
     RETURNING id`,
    [
      orderId,
      quote.provider,
      quote.providerQuoteId,
      quote.costCents,
      charged,
      charged - quote.costCents,
      quote.etaMinutes,
      JSON.stringify(quote.raw ?? {}),
      actor,
    ],
  );
  return (await db.maybeOne<DeliveryJobRow>(
    "SELECT * FROM delivery_jobs WHERE id = $1",
    [jobId],
  ))!;
}

export const STATUS_MAP: Record<string, string> = {
  // Uber Direct
  accepted: "accepted",
  pickup: "pickup",
  pickup_complete: "pickup",
  dropoff: "dropoff",
  dropoff_complete: "dropoff",
  delivered: "delivered",
  canceled: "cancelled",
  cancelled: "cancelled",
  returned: "failed",
  // DoorDash Drive
  created: "requested",
  confirmed: "accepted",
  en_route_to_pickup: "accepted",
  arrived_at_pickup: "pickup",
  picked_up: "pickup",
  en_route_to_dropoff: "dropoff",
  arrived_at_dropoff: "dropoff",
  completed: "delivered",
  delivery: "delivered",
  canceled_by_restaurant: "cancelled",
  // Own fleet
  assigned: "accepted",
};

export function mapProviderStatus(status: string): string {
  return STATUS_MAP[String(status ?? "").toLowerCase()] ?? "requested";
}

/** Trigger the courier request — this is the action the delivery coordinator signs off. */
export async function dispatchOrder(
  db: Db,
  orderId: number,
  actor: string,
): Promise<DeliveryJobRow> {
  const order = await getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (order.channel !== "delivery")
    throw new OrderError("This order is not a delivery");
  if (!["ready", "confirmed", "preparing"].includes(order.status)) {
    throw new OrderError("Order must be packed before dispatch");
  }
  if (order.payment_status !== "paid")
    throw new OrderError(
      "Delivery cannot be dispatched until payment is captured",
    );

  let job = await getLatestJob(db, orderId);
  const quoteExpired =
    !job ||
    !job.provider_quote_id ||
    (job.status === "quoted" && job.eta_minutes == null);
  if (quoteExpired) job = await refreshDeliveryQuote(db, orderId, actor);
  if (!job) throw new OrderError("Could not obtain a courier quote");

  const items = await getOrderItems(db, orderId);
  const result = await dispatchWithProvider(job.provider, {
    quoteId: job.provider_quote_id ?? "",
    orderCode: order.code,
    customerName: order.customer_name,
    phone: order.phone ?? undefined,
    dropoffAddress: order.address ?? "",
    dropoffSuburb: order.suburb ?? undefined,
    dropoffPostcode: order.postcode ?? undefined,
    dropoffNotes: order.notes ?? undefined,
    dropoffLat: order.delivery_lat,
    dropoffLng: order.delivery_lng,
    manifest: items.map((item) => ({
      name: `${item.name} — ${item.variant_label}`,
      quantity: item.qty,
    })),
  });

  await db.query(
    `UPDATE delivery_jobs SET provider_delivery_id = $1, status = $2, courier_name = $3, courier_phone = $4,
      tracking_url = $5, eta_minutes = $6, triggered_by = $7, dispatched_at = now(),
      driver_id = COALESCE($9, driver_id), distance_km = COALESCE($10, distance_km) WHERE id = $8`,
    [
      result.deliveryId,
      mapProviderStatus(result.status),
      result.courierName ?? null,
      result.courierPhone ?? null,
      result.trackingUrl ?? null,
      result.etaMinutes ?? job.eta_minutes,
      actor,
      job.id,
      result.driverId ?? null,
      (result.raw as { distance_km?: number } | undefined)?.distance_km ?? job.distance_km ?? null,
    ],
  );

  await db.query(
    "UPDATE orders SET status = 'out_for_delivery', progress = 92, dispatched_at = now(), updated_at = now() WHERE id = $1",
    [orderId],
  );
  await addEvent(
    db,
    orderId,
    "dispatched",
    `Delivery requested with ${providerLabel(job.provider)}${result.courierName ? ` — ${result.courierName}` : ""}${result.driverId ? " (own verified driver)" : ""}`,
    actor,
    92,
  );
  return (await getLatestJob(db, orderId))!;
}

export async function syncDelivery(
  db: Db,
  orderId: number,
  actor = "system",
): Promise<DeliveryJobRow | null> {
  const job = await getLatestJob(db, orderId);
  if (!job || !job.provider_delivery_id) return job;
  try {
    const status = await providerStatus(job.provider, job.provider_delivery_id);
    const mapped = STATUS_MAP[status.status] ?? job.status;
    await db.query(
      `UPDATE delivery_jobs SET status = $1, external_status = $2, courier_name = COALESCE($3, courier_name),
        courier_phone = COALESCE($4, courier_phone), tracking_url = COALESCE($5, tracking_url),
        eta_minutes = COALESCE($6, eta_minutes) WHERE id = $7`,
      [
        mapped,
        status.status,
        status.courierName ?? null,
        status.courierPhone ?? null,
        status.trackingUrl ?? null,
        status.etaMinutes ?? null,
        job.id,
      ],
    );

    if (mapped === "delivered") {
      await db.query(
        "UPDATE delivery_jobs SET completed_at = now() WHERE id = $1",
        [job.id],
      );
      const order = await getOrderById(db, orderId);
      if (order && order.status !== "completed") {
        await completeOrder(db, orderId, actor, "Delivered — enjoy your meal");
      }
    } else if (mapped === "pickup") {
      await db.query("UPDATE orders SET progress = 95 WHERE id = $1", [
        orderId,
      ]);
    }
    return await getLatestJob(db, orderId);
  } catch {
    return await getLatestJob(db, orderId);
  }
}

export async function listOrders(
  db: Db,
  opts: { status?: string[]; channel?: string; limit?: number } = {},
): Promise<OrderRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.status?.length) {
    clauses.push(`status = ANY($${params.length + 1}::text[])`);
    params.push(opts.status);
  }
  if (opts.channel) {
    clauses.push(`channel = $${params.length + 1}`);
    params.push(opts.channel);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(opts.limit ?? 50);
  return db.query<OrderRow>(
    `SELECT * FROM orders ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params,
  );
}

export async function orderStats(db: Db) {
  const today = await db.one<{
    orders: number;
    revenue: number;
    collected: number;
    avg_order: number;
  }>(
    `SELECT
      COUNT(*) AS orders,
      COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_cents ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_cents ELSE 0 END), 0) AS collected,
      COALESCE(AVG(CASE WHEN status != 'cancelled' THEN total_cents END), 0) AS avg_order
     FROM orders WHERE created_at::date = CURRENT_DATE`,
  );

  const [pending, kitchen, delivery, unpaid] = await Promise.all([
    db.one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM orders WHERE status = 'pending_confirm'",
    ),
    db.one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM orders WHERE status IN ('confirmed','preparing')",
    ),
    db.one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM orders WHERE status = 'ready' AND channel = 'delivery'",
    ),
    db.one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM orders WHERE payment_status = 'unpaid' AND status != 'cancelled'",
    ),
  ]);

  return {
    today: {
      orders: Number(today.orders),
      revenue: Number(today.revenue),
      collected: Number(today.collected),
      avg_order: Number(today.avg_order),
    },
    pending: Number(pending.c),
    kitchen: Number(kitchen.c),
    awaitingDispatch: Number(delivery.c),
    unpaid: Number(unpaid.c),
  };
}

/** Shape shared by the tracking page and the public status API. */
export async function publicOrderPayload(db: Db, code: string) {
  const full = await getFullOrder(db, code);
  if (!full) return null;
  const { order, items, events, job, table } = full;
  return {
    order: {
      code: order.code,
      channel: order.channel,
      status: order.status,
      progress: order.progress,
      paymentStatus: order.payment_status,
      paymentMethod: order.payment_method,
      totalCents: order.total_cents,
      subtotalCents: order.subtotal_cents,
      surchargeCents: order.surcharge_cents,
      priorityFeeCents: order.priority_fee_cents,
      deliveryFeeCents: order.delivery_fee_cents,
      discountCents: order.discount_cents ?? 0,
      promotionCode: order.promotion_code ?? null,
      paymentOption: order.payment_option ?? null,
      paymentOptionLabel: paymentOptionLabel(order.payment_option),
      priority: Boolean(order.priority),
      customerName: order.customer_name,
      address: order.address,
      suburb: order.suburb,
      postcode: order.postcode,
      deliveryLat: order.delivery_lat ?? null,
      deliveryLng: order.delivery_lng ?? null,
      notes: order.notes,
      createdAt: order.created_at,
      confirmedAt: order.confirmed_at,
      readyAt: order.ready_at,
      dispatchedAt: order.dispatched_at,
      completedAt: order.completed_at,
    },
    items: items.map((item) => ({
      id: item.id,
      itemId: item.item_id,
      variantId: item.variant_id,
      name: item.name,
      variantLabel: item.variant_label,
      spice: item.spice_level,
      qty: item.qty,
      unitPriceCents: item.unit_price_cents,
      lineTotalCents: item.line_total_cents,
      prepState: item.prep_state,
    })),
    events: events.map((event) => ({
      id: event.id,
      message: event.message,
      actor: event.actor,
      progress: event.progress,
      createdAt: event.created_at,
    })),
    delivery: job
      ? {
          provider: job.provider,
          providerLabel: providerLabel(job.provider),
          status: job.status,
          courierName: job.courier_name,
          courierPhone: job.courier_phone,
          trackingUrl: job.tracking_url,
          etaMinutes: job.eta_minutes,
          driverCode: null,
        }
      : null,
    /** Live map data for customers and staff: restaurant, driver, drop-off. */
    tracking:
      order.channel === "delivery"
        ? await trackingSnapshot(db, {
            id: order.id,
            code: order.code,
            address: order.address,
            suburb: order.suburb,
            postcode: order.postcode,
            delivery_lat: order.delivery_lat,
            delivery_lng: order.delivery_lng,
            dispatched_at: order.dispatched_at,
            status: order.status,
          })
        : null,
    table: table ? { code: table.code, name: table.name } : null,
    /** Present once the order row has one; the shareable link is derived from it. */
    trackingToken: order.tracking_token,
  };
}
