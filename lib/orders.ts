import { randomBytes } from "node:crypto";
import type { Db } from "./db";
import { computePricing, type Channel, type PricingBreakdown, type DeliveryPricing } from "./pricing";
import { startCardPayment } from "./payments";
import { getSetting, getSettingNumber } from "./settings";
import { addressHash, verifyQuote } from "./quotes";
import { quoteDelivery, dispatchWithProvider, providerStatus } from "./delivery";

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
  quoteToken?: string;
  items: CartLineInput[];
};

export type OrderRow = {
  id: number;
  code: string;
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
  priority: number;
  priority_fee_cents: number;
  delivery_fee_cents: number;
  delivery_cost_cents: number;
  total_cents: number;
  payment_method: "online" | "counter";
  payment_status: "unpaid" | "pending" | "paid" | "refunded" | "failed";
  payment_ref: string | null;
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

export function addEvent(
  db: Db,
  orderId: number,
  type: string,
  message: string,
  actor = "system",
  progress?: number,
): void {
  db.prepare(
    "INSERT INTO order_events (order_id, type, message, actor, progress) VALUES (?, ?, ?, ?, ?)",
  ).run(orderId, type, message, actor, progress ?? null);
}

export function getOrderByCode(db: Db, code: string): OrderRow | null {
  const row = db.prepare("SELECT * FROM orders WHERE code = ?").get(code.trim().toUpperCase()) as
    | OrderRow
    | undefined;
  return row ?? null;
}

export function getOrderById(db: Db, id: number): OrderRow | null {
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined;
  return row ?? null;
}

export function getOrderItems(db: Db, orderId: number): OrderItemRow[] {
  return db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").all(orderId) as OrderItemRow[];
}

export function getOrderEvents(db: Db, orderId: number) {
  return db
    .prepare("SELECT * FROM order_events WHERE order_id = ? ORDER BY id ASC")
    .all(orderId) as {
    id: number;
    type: string;
    message: string;
    actor: string | null;
    progress: number | null;
    created_at: string;
  }[];
}

export function getLatestJob(db: Db, orderId: number): DeliveryJobRow | null {
  const row = db
    .prepare("SELECT * FROM delivery_jobs WHERE order_id = ? ORDER BY id DESC LIMIT 1")
    .get(orderId) as DeliveryJobRow | undefined;
  return row ?? null;
}

export function getFullOrder(db: Db, code: string) {
  const order = getOrderByCode(db, code);
  if (!order) return null;
  const table = order.table_id
    ? (db.prepare("SELECT * FROM dining_tables WHERE id = ?").get(order.table_id) as
        | { code: string; name: string; zone: string | null }
        | undefined)
    : undefined;
  return {
    order,
    items: getOrderItems(db, order.id),
    events: getOrderEvents(db, order.id),
    job: getLatestJob(db, order.id),
    table: table ?? null,
  };
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

function resolveLines(db: Db, items: CartLineInput[]): ResolvedLine[] {
  if (!Array.isArray(items) || items.length === 0) throw new OrderError("Your cart is empty");
  if (items.length > 40) throw new OrderError("Too many items in one order");

  const stmt = db.prepare(
    `SELECT mi.id, mi.name, mi.image, mi.spice_levels, mi.is_available, mi.published, mi.prep_minutes,
            iv.id AS variant_id, iv.item_id, iv.label, iv.size_ml, iv.price_cents, iv.active
     FROM item_variants iv JOIN menu_items mi ON mi.id = iv.item_id
     WHERE iv.id = ?`,
  );

  return items.map((line) => {
    const qty = Math.floor(Number(line.qty));
    if (!Number.isFinite(qty) || qty <= 0 || qty > 30) throw new OrderError("Invalid quantity");
    const row = stmt.get(line.variantId) as
      | {
          id: number;
          name: string;
          image: string | null;
          spice_levels: string;
          is_available: number;
          published: number;
          prep_minutes: number;
          variant_id: number;
          item_id: number;
          label: string;
          size_ml: number | null;
          price_cents: number;
          active: number;
        }
      | undefined;
    if (!row) throw new OrderError("An item in your cart is no longer available");
    if (!row.published || !row.is_available || !row.active) {
      throw new OrderError(`${row.name} is currently unavailable`);
    }
    if (row.item_id !== Number(line.itemId)) throw new OrderError("Menu item mismatch");

    const allowedSpice = (row.spice_levels || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let spice: string | null = null;
    if (allowedSpice.length > 0) {
      spice = line.spiceLevel && allowedSpice.includes(line.spiceLevel) ? line.spiceLevel : allowedSpice[0];
    }

    return {
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
    };
  });
}

export type CreateOrderResult = {
  order: OrderRow;
  items: OrderItemRow[];
  pricing: PricingBreakdown;
  redirectUrl?: string;
};

export async function createOrder(db: Db, input: CreateOrderInput): Promise<CreateOrderResult> {
  const channel = input.channel;
  if (!["delivery", "pickup", "dine_in", "table"].includes(channel)) throw new OrderError("Unknown service type");

  const name = (input.customerName || "").trim().slice(0, 80);
  if (name.length < 2) throw new OrderError("Please tell us your name");

  // Table orders must reference a real, active table.
  let tableId: number | null = null;
  if (channel === "table") {
    if (getSetting("table_ordering_enabled", "1") !== "1") throw new OrderError("Table ordering is currently paused");
    const table = db
      .prepare("SELECT id FROM dining_tables WHERE code = ? AND active = 1")
      .get((input.tableCode || "").toUpperCase()) as { id: number } | undefined;
    if (!table) throw new OrderError("That table QR code is not recognised");
    tableId = table.id;
  }

  if (channel === "delivery") {
    if (!input.address || input.address.trim().length < 5) throw new OrderError("A delivery address is required");
  }

  const lines = resolveLines(db, input.items);
  const subtotal = lines.reduce((sum, line) => sum + line.line_total_cents, 0);

  const minOrder = channel === "delivery" ? getSettingNumber("delivery_min_order_cents", 2500) : getSettingNumber("min_order_cents", 0);
  if (subtotal < minOrder) {
    throw new OrderError(`Minimum order for ${channel === "delivery" ? "delivery" : "ordering"} is $${(minOrder / 100).toFixed(2)}`);
  }

  // Delivery fee: trust only a signed quote for this address, otherwise re-quote live.
  let delivery: DeliveryPricing | null = null;
  if (channel === "delivery") {
    const verified = verifyQuote(input.quoteToken);
    const hash = addressHash(`${input.address ?? ""}|${input.suburb ?? ""}|${input.postcode ?? ""}`);
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
        orderValueCents: subtotal,
      });
    }
  }

  const pricing = computePricing(db, {
    subtotalCents: subtotal,
    channel,
    priority: Boolean(input.priority),
    delivery,
  });

  if (channel === "delivery" && input.paymentMethod === "counter") {
    throw new OrderError("Delivery orders must be paid online before dispatch");
  }
  if (input.paymentMethod === "counter" && getSetting("pay_at_counter_enabled", "1") !== "1") {
    throw new OrderError("Pay at counter is currently unavailable");
  }
  if (input.paymentMethod === "online" && getSetting("online_payment_enabled", "1") !== "1") {
    throw new OrderError("Online payment is currently unavailable — please pay at the counter");
  }

  const code = newOrderCode();
  const prepMinutes = Math.max(...lines.map((l) => l.prep_minutes));
  const promisedAt = new Date(
    Date.now() + (prepMinutes + (channel === "delivery" ? 25 : 5)) * 60_000,
  ).toISOString();

  const insertOrder = db.prepare(
    `INSERT INTO orders (code, channel, table_id, customer_name, phone, email, address, suburb, postcode, notes,
      subtotal_cents, surcharge_cents, surcharge_detail, priority, priority_fee_cents, delivery_fee_cents,
      delivery_cost_cents, total_cents, payment_method, payment_status, status, progress, promised_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_confirm', 5, ?)`,
  );

  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, item_id, variant_id, name, variant_label, size_ml, spice_level, qty,
      unit_price_cents, line_total_cents, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let orderId = 0;
  const tx = db.transaction(() => {
    const info = insertOrder.run(
      code,
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
      pricing.priorityFeeCents > 0 ? 1 : 0,
      pricing.priorityFeeCents,
      pricing.deliveryFeeCents,
      pricing.deliveryCostCents,
      pricing.totalCents,
      input.paymentMethod,
      input.paymentMethod === "counter" ? "unpaid" : "pending",
      promisedAt,
    );
    orderId = Number(info.lastInsertRowid);
    for (const line of lines) {
      insertItem.run(
        orderId,
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
      );
    }
    addEvent(
      db,
      orderId,
      "created",
      `Order placed — ${channel === "delivery" ? "delivery" : channel === "pickup" ? "click & collect" : channel === "table" ? "table order" : "dine in"}`,
      "customer",
      5,
    );
  });
  tx();

  // Delivery job placeholder — the coordinator confirms the live quote at dispatch time.
  if (channel === "delivery" && delivery) {
    db.prepare(
      `INSERT INTO delivery_jobs (order_id, provider, provider_quote_id, cost_cents, customer_fee_cents, markup_cents,
        status, eta_minutes, quote_json)
       VALUES (?, ?, ?, ?, ?, ?, 'quoted', ?, ?)`,
    ).run(
      orderId,
      delivery.provider,
      delivery.providerQuoteId,
      delivery.costCents,
      delivery.customerFeeCents,
      delivery.customerFeeCents - delivery.costCents,
      delivery.etaMinutes,
      JSON.stringify(delivery.raw ?? {}),
    );
  }

  let redirectUrl: string | undefined;
  if (input.paymentMethod === "online") {
    const payment = await startCardPayment({
      orderCode: code,
      amountCents: pricing.totalCents,
      description: `Khan Baba order ${code}`,
      last4: input.paymentLast4,
      customerEmail: input.email,
    });
    db.prepare(
      `INSERT INTO payments (order_id, provider, intent_id, amount_cents, status, method, last4, raw)
       VALUES (?, ?, ?, ?, ?, 'card', ?, ?)`,
    ).run(
      orderId,
      payment.provider,
      payment.intentId,
      pricing.totalCents,
      payment.status,
      payment.last4 ?? null,
      JSON.stringify(payment.raw ?? {}),
    );

    if (payment.status === "paid") {
      db.prepare(
        "UPDATE orders SET payment_status = 'paid', payment_ref = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(payment.intentId, orderId);
      addEvent(db, orderId, "payment", "Payment received online", "customer", 8);
    } else {
      db.prepare("UPDATE orders SET payment_ref = ?, updated_at = datetime('now') WHERE id = ?").run(
        payment.intentId,
        orderId,
      );
      redirectUrl = payment.redirectUrl;
    }
  } else {
    addEvent(db, orderId, "payment", "Payment to be taken at the counter", "customer", 8);
  }

  const order = getOrderById(db, orderId)!;
  return { order, items: getOrderItems(db, orderId), pricing, redirectUrl };
}

function recomputeProgress(db: Db, order: OrderRow): void {
  const items = getOrderItems(db, order.id);
  if (items.length === 0) return;
  const ready = items.filter((i) => i.prep_state === "ready").length;
  const preparing = items.filter((i) => i.prep_state === "preparing").length;
  if (order.status === "preparing" || order.status === "confirmed") {
    const progress = Math.min(78, Math.round(20 + (ready / items.length) * 55 + (preparing > 0 ? 3 : 0)));
    db.prepare("UPDATE orders SET progress = ?, updated_at = datetime('now') WHERE id = ?").run(progress, order.id);
  }
}

/** Counter accepts the order → it is routed straight to the kitchen display. */
export function confirmOrder(db: Db, orderId: number, actor: string): OrderRow {
  const order = getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (order.status !== "pending_confirm") throw new OrderError("This order has already been actioned");
  db.prepare(
    `UPDATE orders SET status = 'confirmed', progress = 20, confirmed_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
  ).run(orderId);
  addEvent(
    db,
    orderId,
    "confirmed",
    "Order accepted by the counter — sent to the kitchen display",
    actor,
    20,
  );
  return getOrderById(db, orderId)!;
}

export function setItemPrepState(
  db: Db,
  orderId: number,
  itemId: number,
  state: "queued" | "preparing" | "ready",
  actor: string,
): OrderRow {
  const order = getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (!["confirmed", "preparing"].includes(order.status)) {
    throw new OrderError("This order is no longer in the kitchen queue");
  }
  const item = db
    .prepare("SELECT * FROM order_items WHERE id = ? AND order_id = ?")
    .get(itemId, orderId) as OrderItemRow | undefined;
  if (!item) throw new OrderError("Item not found", 404);

  db.prepare("UPDATE order_items SET prep_state = ? WHERE id = ?").run(state, itemId);

  if (order.status === "confirmed") {
    db.prepare(
      "UPDATE orders SET status = 'preparing', kitchen_started_at = COALESCE(kitchen_started_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
    ).run(orderId);
    addEvent(db, orderId, "kitchen_started", "Kitchen started preparation", actor, 22);
  }

  const refreshed = getOrderById(db, orderId)!;
  recomputeProgress(db, refreshed);

  const items = getOrderItems(db, orderId);
  const readyCount = items.filter((i) => i.prep_state === "ready").length;
  if (state === "ready") {
    addEvent(db, orderId, "item_ready", `${item.name} (${item.variant_label}) is ready — ${readyCount}/${items.length} items complete`, actor);
  } else if (state === "preparing") {
    addEvent(db, orderId, "item_preparing", `Preparing ${item.name} (${item.variant_label})`, actor);
  }
  return getOrderById(db, orderId)!;
}

export function markOrderReady(db: Db, orderId: number, actor: string): OrderRow {
  const order = getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (!["confirmed", "preparing"].includes(order.status)) throw new OrderError("Order is not in preparation");

  // Anything the kitchen has not explicitly closed off is finished when they bump the ticket.
  db.prepare("UPDATE order_items SET prep_state = 'ready' WHERE order_id = ?").run(orderId);

  const nextStatus: OrderStatus = order.channel === "pickup" ? "awaiting_collection" : "ready";
  const progress = order.channel === "pickup" ? 88 : 85;
  db.prepare(
    `UPDATE orders SET status = ?, progress = ?, ready_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
  ).run(nextStatus, progress, orderId);
  addEvent(
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
  return getOrderById(db, orderId)!;
}

export function markOrderPaid(db: Db, orderId: number, actor: string, method = "counter", last4?: string): OrderRow {
  const order = getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (order.payment_status === "paid") return order;
  db.prepare(
    "UPDATE orders SET payment_status = 'paid', payment_ref = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(`counter-${method}`, orderId);
  db.prepare(
    "INSERT INTO payments (order_id, provider, intent_id, amount_cents, status, method, last4, paid_at) VALUES (?, 'counter', ?, ?, 'paid', ?, ?, datetime('now'))",
  ).run(orderId, `counter_${orderId}`, order.total_cents, method, last4 ?? null);
  addEvent(db, orderId, "payment", `Payment taken at counter (${method})`, actor);
  return getOrderById(db, orderId)!;
}

export function completeOrder(db: Db, orderId: number, actor: string, message?: string): OrderRow {
  const order = getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (order.status === "cancelled") throw new OrderError("Order is cancelled");
  db.prepare(
    "UPDATE orders SET status = 'completed', progress = 100, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
  ).run(orderId);
  addEvent(db, orderId, "completed", message ?? "Order completed", actor, 100);
  return getOrderById(db, orderId)!;
}

export function cancelOrder(db: Db, orderId: number, actor: string, reason: string): OrderRow {
  const order = getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (["completed", "cancelled"].includes(order.status)) throw new OrderError("Order cannot be cancelled");
  db.prepare(
    "UPDATE orders SET status = 'cancelled', cancelled_reason = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(reason.slice(0, 200), orderId);
  addEvent(db, orderId, "cancelled", `Order cancelled — ${reason}`, actor);
  if (order.payment_status === "paid") {
    db.prepare("UPDATE orders SET payment_status = 'refunded' WHERE id = ?").run(orderId);
    addEvent(db, orderId, "refund", "Refund queued for the original payment method", actor);
  }
  return getOrderById(db, orderId)!;
}

/** Re-quote the courier at dispatch time and record the real cost against the order. */
export async function refreshDeliveryQuote(db: Db, orderId: number, actor: string): Promise<DeliveryJobRow> {
  const order = getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (order.channel !== "delivery") throw new OrderError("Only delivery orders need a courier");

  const quote = await quoteDelivery({
    orderCode: order.code,
    customerName: order.customer_name,
    phone: order.phone ?? undefined,
    dropoffAddress: order.address ?? "",
    dropoffSuburb: order.suburb ?? undefined,
    dropoffPostcode: order.postcode ?? undefined,
    orderValueCents: order.subtotal_cents,
  });

  const existing = getLatestJob(db, orderId);
  const charged = existing?.customer_fee_cents ?? order.delivery_fee_cents;

  if (existing && existing.status === "quoted") {
    db.prepare(
      `UPDATE delivery_jobs SET provider = ?, provider_quote_id = ?, cost_cents = ?, customer_fee_cents = ?,
        markup_cents = ?, eta_minutes = ?, quote_json = ? WHERE id = ?`,
    ).run(
      quote.provider,
      quote.providerQuoteId,
      quote.costCents,
      charged,
      charged - quote.costCents,
      quote.etaMinutes,
      JSON.stringify(quote.raw ?? {}),
      existing.id,
    );
    db.prepare("UPDATE orders SET delivery_cost_cents = ? WHERE id = ?").run(quote.costCents, orderId);
    addEvent(
      db,
      orderId,
      "delivery_quote",
      `Live courier quote refreshed: $${(quote.costCents / 100).toFixed(2)} courier cost (customer paid $${(charged / 100).toFixed(2)})`,
      actor,
    );
    return getLatestJob(db, orderId)!;
  }

  const info = db
    .prepare(
      `INSERT INTO delivery_jobs (order_id, provider, provider_quote_id, cost_cents, customer_fee_cents, markup_cents,
        status, eta_minutes, quote_json, triggered_by)
       VALUES (?, ?, ?, ?, ?, ?, 'quoted', ?, ?, ?)`,
    )
    .run(
      orderId,
      quote.provider,
      quote.providerQuoteId,
      quote.costCents,
      charged,
      charged - quote.costCents,
      quote.etaMinutes,
      JSON.stringify(quote.raw ?? {}),
      actor,
    );
  return db.prepare("SELECT * FROM delivery_jobs WHERE id = ?").get(Number(info.lastInsertRowid)) as DeliveryJobRow;
}

const STATUS_MAP: Record<string, string> = {
  accepted: "accepted",
  pickup: "pickup",
  pickup_complete: "pickup",
  dropoff: "dropoff",
  dropoff_complete: "dropoff",
  delivered: "delivered",
  canceled: "cancelled",
  cancelled: "cancelled",
  returned: "failed",
};

/** Trigger the courier request — this is the action the delivery coordinator signs off. */
export async function dispatchOrder(db: Db, orderId: number, actor: string): Promise<DeliveryJobRow> {
  const order = getOrderById(db, orderId);
  if (!order) throw new OrderError("Order not found", 404);
  if (order.channel !== "delivery") throw new OrderError("This order is not a delivery");
  if (!["ready", "confirmed", "preparing"].includes(order.status)) {
    throw new OrderError("Order must be packed before dispatch");
  }
  if (order.payment_status !== "paid") throw new OrderError("Delivery cannot be dispatched until payment is captured");

  let job = getLatestJob(db, orderId);
  const quoteExpired =
    !job || !job.provider_quote_id || (job.status === "quoted" && job.eta_minutes == null);
  if (quoteExpired) job = await refreshDeliveryQuote(db, orderId, actor);
  if (!job) throw new OrderError("Could not obtain a courier quote");

  const items = getOrderItems(db, orderId);
  const result = await dispatchWithProvider(job.provider, {
    quoteId: job.provider_quote_id ?? "",
    orderCode: order.code,
    customerName: order.customer_name,
    phone: order.phone ?? undefined,
    dropoffAddress: order.address ?? "",
    dropoffSuburb: order.suburb ?? undefined,
    dropoffPostcode: order.postcode ?? undefined,
    dropoffNotes: order.notes ?? undefined,
    manifest: items.map((item) => ({ name: `${item.name} — ${item.variant_label}`, quantity: item.qty })),
  });

  db.prepare(
    `UPDATE delivery_jobs SET provider_delivery_id = ?, status = ?, courier_name = ?, courier_phone = ?,
      tracking_url = ?, eta_minutes = ?, triggered_by = ?, dispatched_at = datetime('now') WHERE id = ?`,
  ).run(
    result.deliveryId,
    STATUS_MAP[result.status] ?? "requested",
    result.courierName ?? null,
    result.courierPhone ?? null,
    result.trackingUrl ?? null,
    result.etaMinutes ?? job.eta_minutes,
    actor,
    job.id,
  );

  db.prepare(
    "UPDATE orders SET status = 'out_for_delivery', progress = 92, dispatched_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
  ).run(orderId);
  addEvent(
    db,
    orderId,
    "dispatched",
    `Delivery requested with ${job.provider === "uber_direct" ? "Uber Direct" : "our courier partner"}${result.courierName ? ` — ${result.courierName}` : ""}`,
    actor,
    92,
  );
  return getLatestJob(db, orderId)!;
}

export async function syncDelivery(db: Db, orderId: number, actor = "system"): Promise<DeliveryJobRow | null> {
  const job = getLatestJob(db, orderId);
  if (!job || !job.provider_delivery_id) return job;
  try {
    const status = await providerStatus(job.provider, job.provider_delivery_id);
    const mapped = STATUS_MAP[status.status] ?? job.status;
    db.prepare(
      `UPDATE delivery_jobs SET status = ?, external_status = ?, courier_name = COALESCE(?, courier_name),
        courier_phone = COALESCE(?, courier_phone), tracking_url = COALESCE(?, tracking_url),
        eta_minutes = COALESCE(?, eta_minutes) WHERE id = ?`,
    ).run(
      mapped,
      status.status,
      status.courierName ?? null,
      status.courierPhone ?? null,
      status.trackingUrl ?? null,
      status.etaMinutes ?? null,
      job.id,
    );

    if (mapped === "delivered") {
      db.prepare(
        "UPDATE delivery_jobs SET completed_at = datetime('now') WHERE id = ?",
      ).run(job.id);
      const order = getOrderById(db, orderId);
      if (order && order.status !== "completed") {
        completeOrder(db, orderId, actor, "Delivered — enjoy your meal");
      }
    } else if (mapped === "pickup") {
      db.prepare("UPDATE orders SET progress = 95 WHERE id = ?").run(orderId);
    }
    return getLatestJob(db, orderId);
  } catch {
    return getLatestJob(db, orderId);
  }
}

export function listOrders(db: Db, opts: { status?: string[]; channel?: string; limit?: number } = {}) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.status?.length) {
    clauses.push(`status IN (${opts.status.map(() => "?").join(",")})`);
    params.push(...opts.status);
  }
  if (opts.channel) {
    clauses.push("channel = ?");
    params.push(opts.channel);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM orders ${where} ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`)
    .all(...params, opts.limit ?? 50) as OrderRow[];
}

export function orderStats(db: Db) {
  const today = db
    .prepare(
      `SELECT
        COUNT(*) AS orders,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_cents ELSE 0 END), 0) AS revenue,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_cents ELSE 0 END), 0) AS collected,
        COALESCE(AVG(CASE WHEN status != 'cancelled' THEN total_cents END), 0) AS avg_order
       FROM orders WHERE date(created_at) = date('now')`,
    )
    .get() as { orders: number; revenue: number; collected: number; avg_order: number };

  const pending = db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'pending_confirm'")
    .get() as { c: number };
  const kitchen = db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE status IN ('confirmed','preparing')")
    .get() as { c: number };
  const delivery = db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'ready' AND channel = 'delivery'")
    .get() as { c: number };
  const unpaid = db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE payment_status = 'unpaid' AND status != 'cancelled'")
    .get() as { c: number };

  return {
    today,
    pending: pending.c,
    kitchen: kitchen.c,
    awaitingDispatch: delivery.c,
    unpaid: unpaid.c,
  };
}

/** Shape shared by the tracking page and the public status API. */
export function publicOrderPayload(db: Db, code: string) {
  const full = getFullOrder(db, code);
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
      priority: Boolean(order.priority),
      customerName: order.customer_name,
      address: order.address,
      suburb: order.suburb,
      postcode: order.postcode,
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
          status: job.status,
          courierName: job.courier_name,
          courierPhone: job.courier_phone,
          trackingUrl: job.tracking_url,
          etaMinutes: job.eta_minutes,
        }
      : null,
    table: table ? { code: table.code, name: table.name } : null,
  };
}
