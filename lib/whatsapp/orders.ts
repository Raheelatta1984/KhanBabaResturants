import { randomBytes } from "node:crypto";
import type { Db } from "../db";
import {
  createOrder,
  getOrderByCode,
  getOrderItems,
  OrderError,
  type OrderItemRow,
  type OrderRow,
} from "../orders";
import { getSettings, settingValue } from "../settings";
import { money } from "../money";
import { getTimeParts } from "../time";
import {
  logWhatsAppMessage,
  sendWhatsAppCta,
  sendWhatsAppText,
  touchConversation,
} from "./client";

/**
 * The WhatsApp ordering desk.
 *
 * A customer writes to the business number; this module matches their words
 * against the live menu, creates a normal order (channel pickup / dine-in /
 * table), texts the counter, and — once the counter approves it — sends the
 * guest a secure payment link. Nothing here bypasses the order state machine:
 * a WhatsApp order is an order with `source = 'whatsapp'`, so the kitchen,
 * inventory, reviews and reporting all see it like any other.
 */

export type InboundMessage = {
  from: string;
  name?: string | null;
  text: string;
  externalId?: string | null;
  type?: string;
};

type MenuOption = {
  item_id: number;
  variant_id: number;
  name: string;
  label: string;
  price_cents: number;
  is_veg: boolean;
  image: string | null;
};

export type ParsedLine = { itemId: number; variantId: number; qty: number; name: string };

/** Normalise a message for matching: lowercase, punctuation collapsed. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return matrix[a.length][b.length];
}

/** Loose match so “chiken biryani” still finds the dish, without a language model. */
function fuzzyIncludes(haystack: string, needle: string): boolean {
  const target = normalise(needle);
  if (!target) return false;
  if (haystack.includes(target)) return true;
  const words = target.split(" ").filter((word) => word.length > 3);
  if (words.length === 0) return false;
  const matched = words.filter((word) =>
    haystack.split(" ").some((token) => token.length > 2 && levenshtein(token, word) <= 1),
  );
  return matched.length === words.length;
}

/**
 * Turn “2 chicken biryani, 1 garlic naan and a mango lassi” into cart lines.
 * Quantities are read before or after the dish name; the default variant is
 * used (the customer can change it at the table or with the counter).
 */
export async function parseOrderText(db: Db, text: string): Promise<ParsedLine[]> {
  const options = await db.query<MenuOption>(
    `SELECT mi.id AS item_id, v.id AS variant_id, mi.name, v.label, v.price_cents, mi.is_veg, mi.image
       FROM menu_items mi
       JOIN item_variants v ON v.item_id = mi.id AND v.active
      WHERE mi.published AND mi.is_available
        AND NOT (mi.track_stock AND mi.stock_qty IS NOT NULL AND mi.stock_qty <= 0)
        AND v.id = (SELECT v2.id FROM item_variants v2 WHERE v2.item_id = mi.id AND v2.active
                    ORDER BY v2.is_default DESC, v2.sort_order, v2.id LIMIT 1)
      ORDER BY mi.sort_order, mi.id`,
  );
  const haystack = normalise(text);
  const lines: ParsedLine[] = [];
  const consumed: { start: number; end: number }[] = [];

  for (const option of options) {
    const name = normalise(option.name);
    const index = haystack.indexOf(name);
    let matched = index >= 0;
    let start = index;
    let end = index + name.length;

    if (!matched) {
      const words = name.split(" ").filter((word) => word.length > 3);
      const candidate = words.map((word) => {
        const at = haystack.split(" ").findIndex((token) => levenshtein(token, word) <= 1);
        return at >= 0 ? haystack.split(" ").slice(0, at + 1).join(" ").length - word.length : -1;
      });
      if (words.length > 0 && candidate.every((at) => at >= 0)) {
        matched = true;
        start = Math.min(...candidate);
        end = start + name.length;
      }
    }
    if (!matched) continue;
    if (consumed.some((range) => start < range.end && end > range.start)) continue;

    const before = haystack.slice(Math.max(0, start - 12), start);
    const after = haystack.slice(end, end + 12);
    const beforeMatch = before.match(/(\d{1,2})\s*(?:x|×)?\s*$/);
    const afterMatch = after.match(/^\s*(?:x|×)\s*(\d{1,2})|^\s*(\d{1,2})\s*(?:off|plates?|portions?)?/);
    const qty = Math.max(
      1,
      Math.min(20, Number(beforeMatch?.[1] ?? afterMatch?.[1] ?? afterMatch?.[2] ?? 1)),
    );
    lines.push({ itemId: option.item_id, variantId: option.variant_id, qty, name: option.name });
    consumed.push({ start, end });
    if (lines.length >= 12) break;
  }
  return lines;
}

export function channelFromText(text: string): {
  channel: "pickup" | "dine_in" | "table" | "delivery";
  tableCode?: string;
  address?: string;
} {
  const table = /table\s*([a-z]?\d{1,3})/i.exec(text);
  if (table) return { channel: "table", tableCode: `T${table[1].replace(/^t/i, "").padStart(2, "0")}` };
  if (/\b(dine\s*in|eat\s*in|sitting\s*in)\b/i.test(text)) return { channel: "dine_in" };
  const delivery = /\bdeliver(?:y)?\s+to\s+(.+)$/i.exec(text) ?? /\bdeliver(?:y)?\s*[:\-]\s*(.+)$/i.exec(text);
  if (delivery) return { channel: "delivery", address: delivery[1].trim() };
  if (/\bdeliver(?:y)?\b/i.test(text)) return { channel: "delivery" };
  return { channel: "pickup" };
}

function orderSummary(order: OrderRow, items: OrderItemRow[]): string {
  const lines = items
    .map((item) => `• ${item.qty}× ${item.name}${item.variant_label ? ` (${item.variant_label})` : ""}`)
    .join("\n");
  const channelLabel =
    order.channel === "table"
      ? "Table order (pay at the counter after the meal)"
      : order.channel === "dine_in"
        ? "Dine-in (pay at the counter after the meal)"
        : "Click & collect";
  return `${lines}\n\n${channelLabel}\nTotal ${money(order.total_cents)} · ${order.code}`;
}

/** Text the staff number with the new ticket and a link straight into the counter. */
export async function notifyCounterNewOrder(
  db: Db,
  order: OrderRow,
  items: OrderItemRow[],
  baseUrl: string,
): Promise<{ sent: boolean; sandbox: boolean }> {
  const settings = await getSettings();
  if (settingValue(settings, "whatsapp_enabled", "1") === "0") return { sent: false, sandbox: true };
  const counterNumber = settingValue(settings, "whatsapp_counter_number", "");
  if (!counterNumber) return { sent: false, sandbox: true };
  const result = await sendWhatsAppCta({
    db,
    to: counterNumber,
    orderId: order.id,
    header: "New Khan Baba order",
    body: `${order.customer_name} ordered via WhatsApp.\n\n${orderSummary(order, items)}\n\nReview and accept it in the counter portal.`,
    buttonLabel: "Open counter",
    url: `${baseUrl}/counter?focus=${order.code}`,
  });
  return { sent: result.ok, sandbox: result.sandbox };
}

/** Acknowledge the guest and set expectations: the counter reviews first. */
export async function acknowledgeNewOrder(
  db: Db,
  order: OrderRow,
  baseUrl: string,
): Promise<void> {
  await sendWhatsAppText({
    db,
    to: order.phone ?? order.whatsapp_wa_id ?? "",
    orderId: order.id,
    body: `Shukriya ${order.customer_name.split(" ")[0]}! Your order ${order.code} is with the counter.\n\nThey will check it and send you a secure payment link. ${order.channel === "table" || order.channel === "dine_in" ? "You can settle at the counter after your meal — no need to pay now." : "Your food starts cooking once the counter accepts it."}\n\nTrack it any time: ${baseUrl}/order/${order.code}`,
  });
}

export type PaymentLinkResult = {
  url: string | null;
  sent: boolean;
  sandbox: boolean;
  token: string | null;
  error?: string;
};

/**
 * Create (or re-use) the secure payment link for an order and send it to the
 * guest over WhatsApp. The token is random and single-purpose, so the URL can be
 * texted, reopened or forwarded without exposing the order list.
 */
export async function requestOrderPayment(
  db: Db,
  orderId: number,
  actor: string,
  baseUrl: string,
): Promise<PaymentLinkResult> {
  const order = await db.maybeOne<OrderRow>("SELECT * FROM orders WHERE id = $1", [orderId]);
  if (!order) throw new OrderError("Order not found", 404);
  if (order.payment_status === "paid") {
    return { url: null, sent: false, sandbox: false, token: order.payment_link_token, error: "Already paid" };
  }
  const token = order.payment_link_token ?? randomBytes(18).toString("base64url");
  await db.query(
    `UPDATE orders SET payment_link_token = $1, payment_requested_at = now(),
       payment_status = CASE WHEN payment_status = 'unpaid' THEN 'pending' ELSE payment_status END,
       updated_at = now() WHERE id = $2`,
    [token, orderId],
  );
  const url = `${baseUrl}/pay/${token}`;
  const settings = await getSettings();
  const message = settingValue(settings, "whatsapp_payment_message", "Please pay for your Khan Baba order:");
  let sent = false;
  let sandbox = false;
  if (order.phone) {
    const result = await sendWhatsAppCta({
      db,
      to: order.phone,
      orderId,
      header: "Payment for your order",
      body: `${message}\n\n${orderSummary(order, await getOrderItems(db, orderId))}`,
      buttonLabel: "Pay securely",
      url,
    });
    sent = result.ok;
    sandbox = result.sandbox;
  }
  await db.query(
    "INSERT INTO order_events (order_id, type, message, actor) VALUES ($1,'payment_link',$2,$3)",
    [orderId, `Payment link sent to the customer · ${url}`, actor],
  );
  return { url, sent, sandbox, token };
}

/** Tell the counter that money has landed and the ticket is ready to accept. */
export async function notifyCounterPaymentReceived(
  db: Db,
  orderId: number,
  baseUrl: string,
): Promise<void> {
  const settings = await getSettings();
  const counterNumber = settingValue(settings, "whatsapp_counter_number", "");
  const order = await db.maybeOne<OrderRow>("SELECT * FROM orders WHERE id = $1", [orderId]);
  if (!counterNumber || !order) return;
  await sendWhatsAppCta({
    db,
    to: counterNumber,
    orderId,
    header: "Payment received",
    body: `${order.customer_name} paid ${money(order.total_cents)} for ${order.code}. Accept the ticket to send it to the kitchen.`,
    buttonLabel: "Accept order",
    url: `${baseUrl}/counter?focus=${order.code}`,
  });
}

/** Tell the guest their order was accepted and is in the kitchen. */
export async function notifyCustomerAccepted(
  db: Db,
  orderId: number,
  baseUrl: string,
): Promise<void> {
  const order = await db.maybeOne<OrderRow>("SELECT * FROM orders WHERE id = $1", [orderId]);
  if (!order?.phone) return;
  await sendWhatsAppText({
    db,
    to: order.phone,
    orderId,
    body: `Good news — the counter accepted ${order.code}. The kitchen is on it. Follow every step live: ${baseUrl}/order/${order.code}`,
  });
}

function helpText(displayNumber: string): string {
  return [
    "Khan Baba — order right here in WhatsApp.",
    "",
    "• Send your order: “2 chicken biryani, 1 garlic naan”",
    "• Add a table: “2 chicken biryani table 4”",
    "• MENU — see today's dishes",
    "• STATUS KB-XXXX — check an order",
    "• SONG — request a song for the room (link required)",
    "",
    displayNumber ? `Call us on ${displayNumber}.` : "Reply here and the counter will help.",
  ].join("\n");
}

async function menuText(db: Db): Promise<string> {
  const rows = await db.query<{ name: string; price_cents: number; is_veg: boolean }>(
    `SELECT mi.name, MIN(v.price_cents) AS price_cents, mi.is_veg
       FROM menu_items mi JOIN item_variants v ON v.item_id = mi.id AND v.active
      WHERE mi.published AND mi.is_available
        AND NOT (mi.track_stock AND mi.stock_qty IS NOT NULL AND mi.stock_qty <= 0)
      GROUP BY mi.id, mi.name, mi.is_veg
      ORDER BY MIN(mi.sort_order), mi.id LIMIT 18`,
  );
  if (rows.length === 0) return "The menu is being updated — the counter will help you in a moment.";
  const lines = rows.map(
    (row) => `• ${row.name}${row.is_veg ? " (v)" : ""} — ${money(row.price_cents)}`,
  );
  return `Today at Khan Baba:\n\n${lines.join("\n")}\n\nReply with your order, for example “2 chicken biryani”.`;
}

/**
 * The webhook entry point. Returns the replies that were sent, which the route
 * logs; errors are contained per message so one bad message cannot break the
 * batch Meta delivered.
 */
export async function handleInboundWhatsApp(
  db: Db,
  message: InboundMessage,
  baseUrl: string,
): Promise<{ replies: string[]; orderCode?: string }> {
  const text = (message.text ?? "").trim();
  const from = message.from.replace(/[^0-9]/g, "");
  if (!from) return { replies: [] };
  const conversation = await touchConversation(db, from, {
    name: message.name ?? null,
    inbound: true,
  });
  await logWhatsAppMessage(db, {
    waId: from,
    direction: "inbound",
    kind: message.type ?? "text",
    body: text || `[${message.type ?? "message"}]`,
    status: "received",
    externalId: message.externalId ?? null,
    conversationId: conversation.id,
  });

  const settings = await getSettings();
  const displayNumber = settingValue(settings, "whatsapp_display_number", "");
  const lower = normalise(text);
  const replies: string[] = [];
  const reply = async (body: string) => {
    replies.push(body);
    await sendWhatsAppText({
      db,
      to: from,
      conversationId: conversation.id,
      body,
    });
  };

  // Opt-out / opt-in -------------------------------------------------------
  if (/^(stop|unsubscribe|opt out)$/.test(lower)) {
    await db.query("UPDATE whatsapp_conversations SET opt_in = FALSE WHERE id = $1", [conversation.id]);
    await reply("You are unsubscribed from Khan Baba WhatsApp messages. Reply START any time to turn them back on.");
    return { replies };
  }
  if (/^(start|subscribe|opt in)$/.test(lower)) {
    await db.query("UPDATE whatsapp_conversations SET opt_in = TRUE WHERE id = $1", [conversation.id]);
    await reply("Welcome back! Reply MENU to see today's dishes.");
    return { replies };
  }
  const optIn = await db.maybeOne<{ opt_in: boolean }>(
    "SELECT opt_in FROM whatsapp_conversations WHERE id = $1",
    [conversation.id],
  );
  if (optIn && optIn.opt_in === false) {
    return { replies }; // respect the opt-out: no marketing, no order chatter
  }

  // Status -----------------------------------------------------------------
  const statusMatch = /\b(KB-[A-Z0-9]+)\b/i.exec(text);
  if (/\b(status|track)\b/i.test(text) || (statusMatch && text.length < 30)) {
    const code = statusMatch?.[1]?.toUpperCase();
    if (!code) {
      await reply("Send the order code, for example: STATUS KB-4F2A91");
      return { replies };
    }
    const order = await getOrderByCode(db, code);
    if (!order) {
      await reply(`I could not find ${code}. Check the code on your receipt, or send MENU to start again.`);
      return { replies };
    }
    await reply(
      `${order.code} · ${order.status.replace(/_/g, " ")}\n${order.progress}% complete · ${order.payment_status === "paid" ? "paid" : "payment due"}\nTotal ${money(order.total_cents)}\n\nLive view: ${baseUrl}/order/${order.code}`,
    );
    return { replies };
  }

  // Song request -----------------------------------------------------------
  if (/\bsong\b|\bmusic\b|\brequest\b/i.test(text) && !/\bbiryani|naan|karahi|order\b/i.test(lower)) {
    await reply(
      `You can ask the room for a song with a link to it. Open ${baseUrl}/music and send it there — the counter approves it and can tell you if there is a small charge.`,
    );
    return { replies };
  }

  if (/^(menu|food|dishes|what do you have|help|hi|hello|salam|assalam)/.test(lower) && !/\d/.test(lower)) {
    await reply(lower.startsWith("menu") ? await menuText(db) : helpText(displayNumber));
    return { replies };
  }

  // A pending delivery address --------------------------------------------
  const context = await db.maybeOne<{ state: string; context: string | null }>(
    "SELECT state, context FROM whatsapp_conversations WHERE id = $1",
    [conversation.id],
  );
  type PendingOrder = { lines: ParsedLine[]; channel: string; tableCode?: string };
  let pending: PendingOrder | null = null;
  if (context?.state === "awaiting_address" && context.context) {
    try {
      pending = JSON.parse(context.context) as PendingOrder;
    } catch {
      pending = null;
    }
    if (pending && text.length >= 8) {
      return createWhatsAppOrder(db, {
        from,
        name: message.name ?? null,
        lines: pending.lines,
        channel: "delivery",
        address: text,
        baseUrl,
        conversationId: conversation.id,
        reply,
      });
    }
    await reply("Please send the full delivery address (street, suburb and postcode).");
    return { replies };
  }

  // An order ---------------------------------------------------------------
  const lines = await parseOrderText(db, text);
  if (lines.length === 0) {
    await reply(helpText(displayNumber));
    return { replies };
  }

  const intent = channelFromText(text);
  if (intent.channel === "delivery") {
    if (!intent.address) {
      await db.query(
        "UPDATE whatsapp_conversations SET state = 'awaiting_address', context = $1 WHERE id = $2",
        [JSON.stringify({ lines, channel: "delivery" }), conversation.id],
      );
      await reply(
        `Delivery needs an address. Reply with the street, suburb and postcode and I will place the order for you.\n\nOr skip delivery and reply “pickup” to collect at the counter.`,
      );
      return { replies };
    }
    return createWhatsAppOrder(db, {
      from,
      name: message.name ?? null,
      lines,
      channel: "delivery",
      address: intent.address,
      baseUrl,
      conversationId: conversation.id,
      reply,
    });
  }

  return createWhatsAppOrder(db, {
    from,
    name: message.name ?? null,
    lines,
    channel: intent.channel === "table" ? "table" : intent.channel,
    tableCode: intent.tableCode,
    baseUrl,
    conversationId: conversation.id,
    reply,
  });
}

async function createWhatsAppOrder(
  db: Db,
  input: {
    from: string;
    name: string | null;
    lines: ParsedLine[];
    channel: "pickup" | "dine_in" | "table" | "delivery";
    tableCode?: string;
    address?: string;
    baseUrl: string;
    conversationId: number;
    reply: (body: string) => Promise<void>;
  },
): Promise<{ replies: string[]; orderCode?: string }> {
  const replies: string[] = [];
  const reply = async (body: string) => {
    replies.push(body);
    await input.reply(body);
  };
  try {
    const result = await createOrder(db, {
      channel: input.channel,
      customerName: input.name?.trim() || "WhatsApp guest",
      phone: `+${input.from}`,
      address: input.address,
      tableCode: input.tableCode,
      paymentMethod: "counter",
      source: "whatsapp",
      whatsappWaId: input.from,
      notes: "Ordered in WhatsApp. Confirm with the customer if anything is unclear.",
      items: input.lines.map((line) => ({
        itemId: line.itemId,
        variantId: line.variantId,
        qty: line.qty,
      })),
    });

    await db.query(
      `UPDATE whatsapp_conversations SET state = 'idle', context = NULL,
         order_count = order_count + 1 WHERE id = $1`,
      [input.conversationId],
    );
    await db.query(
      "UPDATE orders SET whatsapp_wa_id = $1 WHERE id = $2",
      [input.from, result.order.id],
    );
    await logWhatsAppMessage(db, {
      waId: input.from,
      direction: "inbound",
      kind: "order",
      body: `Order ${result.order.code} created from WhatsApp`,
      orderId: result.order.id,
      conversationId: input.conversationId,
      status: "received",
    });

    await acknowledgeNewOrder(db, result.order, input.baseUrl);
    await notifyCounterNewOrder(db, result.order, result.items, input.baseUrl);
    await reply(
      `Order ${result.order.code} received — ${money(result.order.total_cents)}.\n\n${input.channel === "table" || input.channel === "dine_in" ? "Pay at the counter after your meal." : "The counter will send a payment link shortly."}\n\nTrack it: ${input.baseUrl}/order/${result.order.code}`,
    );
    return { replies, orderCode: result.order.code };
  } catch (error) {
    if (error instanceof OrderError) {
      await reply(`${error.message}. Reply MENU to see what is available.`);
      return { replies };
    }
    console.error("whatsapp order failed", error);
    await reply("Sorry — I could not place that order. The counter will pick it up from here.");
    return { replies };
  }
}

/** Timestamp of the last inbound message, used to label the console. */
export async function lastInboundAt(db: Db): Promise<string | null> {
  const row = await db.maybeOne<{ at: string | null }>(
    "SELECT MAX(created_at) AS at FROM whatsapp_messages WHERE direction = 'inbound'",
  );
  return row?.at ?? null;
}

export function serviceGreetingNow(): string {
  const parts = getTimeParts();
  return parts.hour < 12 ? "Good morning" : parts.hour < 17 ? "Good afternoon" : "Good evening";
}
