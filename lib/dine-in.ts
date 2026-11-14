import type { Db } from "./db";
import {
  addEvent,
  completeOrder,
  getOrderById,
  markOrderPaid,
  OrderError,
  type OrderRow,
} from "./orders";
import { getSettings, settingValue } from "./settings";
import { createFeedbackInvite, sendFeedbackInvite } from "./feedback";
import { notifyCustomerAccepted, notifyCounterPaymentReceived } from "./whatsapp/orders";

/**
 * Dine-in and table settlement.
 *
 * The house rule is absolute: a guest sitting at a table never pays online. The
 * ticket is cooked, served and eaten first; the counter then settles it and
 * parks the bill until the payment actually clears. `orders.parked` is that
 * parking brake — a boolean, not a new status, so the kitchen can still work the
 * ticket while the counter holds it open for payment.
 */

async function order(db: Db, orderId: number): Promise<OrderRow> {
  const row = await getOrderById(db, orderId);
  if (!row) throw new OrderError("Order not found", 404);
  return row;
}

function isTableOrder(row: OrderRow): boolean {
  return row.channel === "table" || row.channel === "dine_in";
}

/** Hold the ticket open at the counter until the guest settles. */
export async function parkOrder(
  db: Db,
  orderId: number,
  actor: string,
  reason?: string,
): Promise<OrderRow> {
  const row = await order(db, orderId);
  if (!isTableOrder(row))
    throw new OrderError("Only dine-in and table tickets can be parked for counter payment");
  if (row.parked) return row;
  await db.query(
    "UPDATE orders SET parked = TRUE, parked_at = now(), parked_by = $1, updated_at = now() WHERE id = $2",
    [actor, orderId],
  );
  await addEvent(
    db,
    orderId,
    "parked",
    reason?.trim()
      ? `Parked at the counter — ${reason.trim().slice(0, 120)}`
      : "Parked at the counter until the guest settles the bill",
    actor,
  );
  return (await order(db, orderId))!;
}

export async function unparkOrder(
  db: Db,
  orderId: number,
  actor: string,
  reason?: string,
): Promise<OrderRow> {
  const row = await order(db, orderId);
  if (!row.parked) return row;
  await db.query(
    "UPDATE orders SET parked = FALSE, parked_at = NULL, parked_by = NULL, updated_at = now() WHERE id = $1",
    [orderId],
  );
  await addEvent(
    db,
    orderId,
    "unparked",
    reason?.trim() ? `Released — ${reason.trim().slice(0, 120)}` : "Released from the counter parking bay",
    actor,
  );
  return (await order(db, orderId))!;
}

/**
 * The end of a table meal: take the payment, release the parking brake, complete
 * the ticket and hand the guest a feedback link. Idempotent — a second press
 * does not double-charge or double-complete.
 */
export async function settleTableOrder(
  db: Db,
  orderId: number,
  actor: string,
  method = "counter",
  baseUrl?: string,
): Promise<{
  order: OrderRow;
  alreadyPaid: boolean;
  feedbackUrl?: string;
  whatsappSent?: boolean;
  sandbox?: boolean;
}> {
  const row = await order(db, orderId);
  if (!isTableOrder(row))
    throw new OrderError("Only dine-in and table tickets settle at the counter");
  const alreadyPaid = row.payment_status === "paid";
  if (!alreadyPaid) {
    await markOrderPaid(db, orderId, actor, method === "card" ? "card" : "cash");
  }
  if (row.parked) {
    await db.query(
      "UPDATE orders SET parked = FALSE, parked_at = NULL, parked_by = NULL, updated_at = now() WHERE id = $1",
      [orderId],
    );
  }
  if (row.status !== "completed" && row.status !== "cancelled") {
    await completeOrder(
      db,
      orderId,
      actor,
      `Served, eaten and settled at the counter (${method === "card" ? "card" : "cash"})`,
    );
  }

  const settings = await getSettings();
  let feedback:
    | { token: string; url: string; sent: boolean; sandbox?: boolean }
    | undefined;
  if (
    baseUrl &&
    settingValue(settings, "feedback_enabled", "1") !== "0" &&
    settingValue(settings, "feedback_auto_on_table_settle", "1") !== "0"
  ) {
    try {
      const invite = await createFeedbackInvite(db, orderId, { channel: "whatsapp" });
      feedback = await sendFeedbackInvite(db, orderId, baseUrl, { channel: "whatsapp" });
      await addEvent(
        db,
        orderId,
        "feedback_invite",
        `Feedback link prepared (${invite.token.slice(0, 6)}…)`,
        actor,
      );
    } catch (error) {
      console.error("feedback invite failed", error);
    }
  }

  return {
    order: (await order(db, orderId))!,
    alreadyPaid,
    feedbackUrl: feedback?.url,
    whatsappSent: feedback?.sent,
    sandbox: feedback?.sandbox,
  };
}

/** Tickets parked for payment, oldest first — the counter's end-of-meal queue. */
export async function parkedOrders(db: Db): Promise<OrderRow[]> {
  return db.query<OrderRow>(
    "SELECT * FROM orders WHERE parked AND status != 'cancelled' ORDER BY parked_at NULLS LAST, created_at",
  );
}

/** Paid, still awaiting counter acceptance — the WhatsApp payment follow-up queue. */
export async function paidAwaitingAcceptance(db: Db): Promise<OrderRow[]> {
  return db.query<OrderRow>(
    `SELECT * FROM orders
      WHERE payment_status = 'paid' AND status = 'pending_confirm'
      ORDER BY created_at`,
  );
}

/** Unpaid table tickets that are ready or served, for the counter to chase. */
export async function tableBillsDue(db: Db): Promise<OrderRow[]> {
  return db.query<OrderRow>(
    `SELECT * FROM orders
      WHERE channel IN ('table','dine_in') AND payment_status != 'paid'
        AND status NOT IN ('cancelled')
      ORDER BY created_at`,
  );
}

export async function dineInStats(db: Db) {
  const row = await db.one<{
    parked: number;
    due_cents: number;
    paid_today: number;
    awaiting_accept: number;
    table_orders: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE parked AND status != 'cancelled') AS parked,
       COALESCE(SUM(CASE WHEN channel IN ('table','dine_in') AND payment_status != 'paid'
                          AND status != 'cancelled' THEN total_cents ELSE 0 END), 0) AS due_cents,
       COALESCE(SUM(CASE WHEN payment_status = 'paid' AND paid_at::date = CURRENT_DATE
                          AND channel IN ('table','dine_in') THEN total_cents ELSE 0 END), 0) AS paid_today,
       COUNT(*) FILTER (WHERE payment_status = 'paid' AND status = 'pending_confirm') AS awaiting_accept,
       COUNT(*) FILTER (WHERE channel IN ('table','dine_in') AND created_at::date = CURRENT_DATE) AS table_orders
     FROM orders`,
  );
  return {
    parked: Number(row.parked),
    dueCents: Number(row.due_cents),
    paidToday: Number(row.paid_today),
    awaitingAccept: Number(row.awaiting_accept),
    tableOrders: Number(row.table_orders),
  };
}

/** After an online payment clears, WhatsApp the counter so they can accept it. */
export async function afterPaymentCleared(
  db: Db,
  orderId: number,
  baseUrl: string,
): Promise<void> {
  const row = await order(db, orderId);
  if (row.phone) {
    await notifyCounterPaymentReceived(db, orderId, baseUrl);
  }
  if (
    row.channel === "pickup" &&
    (await getSettings()).whatsapp_auto_confirm_paid === "1" &&
    row.status === "pending_confirm"
  ) {
    // Staff can opt into auto-accepting paid pickup orders; the kitchen still
    // gets the ticket through the normal transition.
    const { confirmOrder } = await import("./orders");
    await confirmOrder(db, orderId, "whatsapp-auto-confirm");
    await notifyCustomerAccepted(db, orderId, baseUrl);
  }
}

/**
 * Mark a payment link paid. Kept separate from `markOrderPaid` so the payment
 * row records the real provider (hosted checkout vs the clearly-labelled
 * sandbox) instead of pretending the counter took cash.
 */
export async function markOrderPaidViaLink(
  db: Db,
  orderId: number,
  input: { provider: string; intentId: string; option?: string | null; sandbox?: boolean },
): Promise<OrderRow> {
  const row = await order(db, orderId);
  if (row.payment_status === "paid") return row;
  await db.query(
    "UPDATE orders SET payment_status = 'paid', payment_ref = $1, paid_at = now(), updated_at = now() WHERE id = $2",
    [input.intentId, orderId],
  );
  await db.query(
    `INSERT INTO payments (order_id, provider, intent_id, amount_cents, status, method, paid_at)
     VALUES ($1,$2,$3,$4,'paid',$5,now())`,
    [orderId, input.provider, input.intentId, row.total_cents, input.option ?? "card"],
  );
  await addEvent(
    db,
    orderId,
    "payment",
    input.sandbox
      ? "Payment completed through the sandbox gateway (no money moved)"
      : "Payment received through the secure payment link",
    "customer",
  );
  return (await order(db, orderId))!;
}
