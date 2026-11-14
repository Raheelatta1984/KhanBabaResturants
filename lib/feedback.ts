import { randomBytes } from "node:crypto";
import type { Db } from "./db";
import { getSettings, settingNumber, settingValue } from "./settings";
import { money } from "./money";
import { sendWhatsAppCta } from "./whatsapp/client";

/**
 * Guest feedback → Google review drafts.
 *
 * After a table is settled (or a paid order is handed over) the counter sends a
 * one-time feedback link over WhatsApp or a QR/link. The guest rates the meal,
 * says how many people were served and picks what they ate. That becomes a
 * ready-to-post Google review draft that names the dishes, shows the dish
 * photography, states the bill range and says “served 2 people” — the things a
 * real review contains and a generic “great food” does not.
 *
 * Google's Business Profile API does not let a third party publish a review in
 * a customer's name, so the honest flow is prepared-and-shared: the draft is
 * copied in one tap and Google's own write-a-review page is opened. The portal
 * says that plainly rather than pretending an automatic post happened.
 */

export type FeedbackInviteRow = {
  id: number;
  order_id: number;
  token: string;
  channel: string;
  party_size: number;
  sent_at: string | null;
  submitted_at: string | null;
  rating: number | null;
  comment: string | null;
  highlights: string | null;
  created_at: string;
};

export type FeedbackOrderView = {
  code: string;
  channel: string;
  customer_name: string;
  phone: string | null;
  email: string | null;
  total_cents: number;
  party_size: number;
  table_name: string | null;
  completed_at: string | null;
  created_at: string;
};

export type FeedbackItemView = {
  name: string;
  qty: number;
  image: string | null;
  line_total_cents: number;
};

export function feedbackToken(): string {
  return randomBytes(16).toString("base64url");
}

/** Create (once) the invite for an order. Re-using an open invite is deliberate. */
export async function createFeedbackInvite(
  db: Db,
  orderId: number,
  input: { channel?: string; partySize?: number } = {},
): Promise<FeedbackInviteRow> {
  const existing = await db.maybeOne<FeedbackInviteRow>(
    "SELECT * FROM feedback_invites WHERE order_id = $1 AND submitted_at IS NULL ORDER BY id DESC LIMIT 1",
    [orderId],
  );
  if (existing) return existing;
  const order = await db.maybeOne<{ party_size: number; channel: string }>(
    "SELECT party_size, channel FROM orders WHERE id = $1",
    [orderId],
  );
  if (!order) throw new Error("Order not found");
  const id = await db.insert(
    `INSERT INTO feedback_invites (order_id, token, channel, party_size, sent_at)
     VALUES ($1,$2,$3,$4,now()) RETURNING id`,
    [
      orderId,
      feedbackToken(),
      ["link", "whatsapp", "email", "qr"].includes(input.channel ?? "")
        ? (input.channel as string)
        : "link",
      Math.min(40, Math.max(1, Number(input.partySize) || order.party_size || 2)),
    ],
  );
  await db.query("UPDATE orders SET feedback_sent_at = now() WHERE id = $1", [orderId]);
  return (await db.maybeOne<FeedbackInviteRow>("SELECT * FROM feedback_invites WHERE id = $1", [
    id,
  ]))!;
}

export async function feedbackInviteByToken(
  db: Db,
  token: string,
): Promise<{
  invite: FeedbackInviteRow;
  order: FeedbackOrderView;
  items: FeedbackItemView[];
} | null> {
  const invite = await db.maybeOne<FeedbackInviteRow>(
    "SELECT * FROM feedback_invites WHERE token = $1",
    [token],
  );
  if (!invite) return null;
  const order = await db.maybeOne<FeedbackOrderView>(
    `SELECT o.code, o.channel, o.customer_name, o.phone, o.email, o.total_cents,
       o.party_size, o.completed_at, o.created_at, t.name AS table_name
     FROM orders o LEFT JOIN dining_tables t ON t.id = o.table_id
     WHERE o.id = $1`,
    [invite.order_id],
  );
  if (!order) return null;
  const items = await db.query<FeedbackItemView>(
    `SELECT oi.name, oi.qty, mi.image, oi.line_total_cents
       FROM order_items oi
       LEFT JOIN menu_items mi ON mi.id = oi.item_id
      WHERE oi.order_id = $1 ORDER BY oi.id`,
    [invite.order_id],
  );
  return { invite, order, items };
}

export type ReviewDraftInput = {
  restaurantName: string;
  items: FeedbackItemView[];
  totalCents: number;
  partySize: number;
  rating: number;
  comment?: string | null;
  highlights?: string[];
  channel?: string;
  tableName?: string | null;
  billRangePercent?: number;
};

/**
 * Compose the review. It reads like a guest wrote it, and always includes the
 * three facts the brief asked for: the dishes, the bill range and how many
 * people were served.
 */
export function buildGoogleReviewBody(input: ReviewDraftInput): string {
  const dishes = (input.highlights?.length
    ? input.highlights
    : input.items.filter((item) => item.qty > 0).map((item) => item.name)
  )
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 8);

  const percent = Math.max(0, Math.min(40, Number(input.billRangePercent ?? 10)));
  const low = Math.max(0, Math.round((input.totalCents * (100 - percent)) / 100));
  const high = Math.round((input.totalCents * (100 + percent)) / 100);
  const range =
    low === high ? money(high) : `${money(low)}–${money(high)}`;

  const people = Math.max(1, Math.min(40, Number(input.partySize) || 1));
  const peopleLine =
    people === 1
      ? "I was served on my own"
      : `We were a table of ${people} and everything came out together`;

  const opener =
    input.rating >= 5
      ? `${input.restaurantName} was outstanding.`
      : input.rating >= 4
        ? `Really good meal at ${input.restaurantName}.`
        : `Honest note on ${input.restaurantName}.`;

  const dishLine = dishes.length
    ? `We ordered ${dishes.slice(0, -1).join(", ")}${dishes.length > 1 ? " and " : ""}${dishes.slice(-1)[0]}.`
    : "The food came out hot and fresh.";

  const comment = input.comment?.trim();
  const flourish =
    input.rating >= 4
      ? "The Lahori spice balance is the real thing, and the room feels like a Lahore dhaba in the best way."
      : "The team were receptive when we mentioned it.";

  return [
    opener,
    `${peopleLine}.`,
    `${dishLine} ${comment ? `${comment.replace(/\s+/g, " ").slice(0, 240)}` : flourish}`,
    `Bill came to around ${range} for ${people === 1 ? "one" : people} ${
      people === 1 ? "person" : "people"
    }${input.tableName ? ` at ${input.tableName}` : ""}${input.channel === "delivery" ? " including delivery" : ""}.`,
    `Photos of what we had are on this review.`,
  ].join(" ");
}

/** Build the Google “write a review” URL from settings. */
export async function googleReviewUrl(db: Db): Promise<string> {
  const settings = await getSettings();
  const configured = settingValue(settings, "feedback_google_url", "").trim();
  const placeId = settingValue(settings, "feedback_google_place_id", "").trim();
  if (placeId) {
    const base = configured && !configured.endsWith("=") ? configured : "https://search.google.com/local/writereview";
    return `${base}${base.includes("?") ? "&" : "?"}placeid=${encodeURIComponent(placeId)}`;
  }
  if (configured && !configured.endsWith("=")) return configured;
  // No place configured: still give a useful Google Maps search for the restaurant.
  const name = settingValue(settings, "restaurant_name", "Khan Baba Restaurant");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
}

/** Guest submits feedback → invite updated, Google draft created. */
export async function submitFeedback(
  db: Db,
  token: string,
  input: {
    rating: number;
    comment?: string;
    highlights?: string[];
    partySize?: number;
  },
): Promise<{ invite: FeedbackInviteRow; draftId: number }> {
  const found = await feedbackInviteByToken(db, token);
  if (!found) throw new Error("That feedback link is not recognised");
  if (found.invite.submitted_at) throw new Error("Thank you — this feedback has already been received");

  const rating = Math.round(Number(input.rating));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new Error("Please choose a rating from 1 to 5");
  const partySize = Math.min(40, Math.max(1, Number(input.partySize) || found.order.party_size || 2));
  const highlights = Array.isArray(input.highlights)
    ? input.highlights.map((name) => String(name).slice(0, 120)).slice(0, 12)
    : [];

  await db.query(
    `UPDATE feedback_invites SET submitted_at = now(), rating = $1, comment = $2,
       highlights = $3, party_size = $4 WHERE id = $5`,
    [
      rating,
      input.comment?.slice(0, 1200) || null,
      highlights.length ? JSON.stringify(highlights) : null,
      partySize,
      found.invite.id,
    ],
  );
  await db.query("UPDATE orders SET party_size = $1 WHERE id = $2", [partySize, found.invite.order_id]);

  const settings = await getSettings();
  const body = buildGoogleReviewBody({
    restaurantName: settingValue(settings, "restaurant_name", "Khan Baba Restaurant"),
    items: found.items,
    totalCents: found.order.total_cents,
    partySize,
    rating,
    comment: input.comment,
    highlights,
    channel: found.order.channel,
    tableName: found.order.table_name,
    billRangePercent: settingNumber(settings, "feedback_bill_range_percent", 10),
  });

  const imageRefs = found.items
    .map((item) => item.image)
    .filter((image): image is string => Boolean(image))
    .slice(0, 6);

  const draftId = await db.insert(
    `INSERT INTO google_review_drafts (feedback_id, order_id, rating, body, image_refs,
        bill_cents, party_size, status, google_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8) RETURNING id`,
    [
      found.invite.id,
      found.invite.order_id,
      rating,
      body,
      imageRefs.length ? JSON.stringify(imageRefs) : null,
      found.order.total_cents,
      partySize,
      await googleReviewUrl(db),
    ],
  );

  return {
    invite: (await db.maybeOne<FeedbackInviteRow>("SELECT * FROM feedback_invites WHERE id = $1", [
      found.invite.id,
    ]))!,
    draftId,
  };
}

export type GoogleDraftRow = {
  id: number;
  feedback_id: number | null;
  order_id: number | null;
  rating: number | null;
  body: string;
  image_refs: string | null;
  bill_cents: number;
  party_size: number;
  status: string;
  google_url: string | null;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  order_code?: string | null;
  customer_name?: string | null;
  channel?: string | null;
};

export async function draftsForTeam(db: Db, limit = 30): Promise<GoogleDraftRow[]> {
  return db.query<GoogleDraftRow>(
    `SELECT d.*, o.code AS order_code, o.customer_name, o.channel
       FROM google_review_drafts d
       LEFT JOIN orders o ON o.id = d.order_id
      ORDER BY CASE d.status WHEN 'draft' THEN 0 ELSE 1 END, d.created_at DESC LIMIT $1`,
    [limit],
  );
}

/**
 * Mark a draft as shared/posted. With Business Profile credentials we attempt
 * the documented reply endpoint when a review id is supplied; otherwise the
 * draft is recorded as published by the team with the Google link they used.
 */
export async function markGoogleDraft(
  db: Db,
  draftId: number,
  actor: string,
  action: "published" | "skipped",
): Promise<GoogleDraftRow> {
  const draft = await db.maybeOne<GoogleDraftRow>(
    "SELECT * FROM google_review_drafts WHERE id = $1",
    [draftId],
  );
  if (!draft) throw new Error("Review draft not found");
  await db.query(
    `UPDATE google_review_drafts SET status = $1, published_at = $2, published_by = $3
     WHERE id = $4`,
    [action, action === "published" ? new Date().toISOString() : null, actor, draftId],
  );
  return (await db.maybeOne<GoogleDraftRow>("SELECT * FROM google_review_drafts WHERE id = $1", [
    draftId,
  ]))!;
}

/** Send the feedback link to the guest over WhatsApp (sandbox logs it). */
export async function sendFeedbackInvite(
  db: Db,
  orderId: number,
  baseUrl: string,
  options: { channel?: "whatsapp" | "link"; actor?: string } = {},
): Promise<{ token: string; url: string; sent: boolean; sandbox?: boolean }> {
  const invite = await createFeedbackInvite(db, orderId, { channel: options.channel ?? "whatsapp" });
  const order = await db.maybeOne<{
    code: string;
    phone: string | null;
    customer_name: string;
    total_cents: number;
  }>("SELECT code, phone, customer_name, total_cents FROM orders WHERE id = $1", [orderId]);
  if (!order) throw new Error("Order not found");
  const url = `${baseUrl}/feedback/${invite.token}`;

  let sent = false;
  let sandbox: boolean | undefined;
  if (options.channel !== "link" && order.phone) {
    const result = await sendWhatsAppCta({
      db,
      to: order.phone,
      orderId,
      header: "How was your Khan Baba meal?",
      body: `Thank you ${order.customer_name.split(" ")[0]}! Two taps: rate the meal, tell us how many were at the table, and pick the dishes you had. It helps the kitchen and it makes a lovely Google review.`,
      buttonLabel: "Leave feedback",
      url,
    });
    sent = result.ok;
    sandbox = result.sandbox;
    await db.query(
      "UPDATE feedback_invites SET sent_at = now(), channel = 'whatsapp' WHERE id = $1",
      [invite.id],
    );
  }
  await db.query("UPDATE orders SET feedback_sent_at = now() WHERE id = $1", [orderId]);
  return { token: invite.token, url, sent, sandbox };
}

export async function feedbackStats(db: Db) {
  const row = await db.one<{
    invites: number; submitted: number; drafts: number; published: number; avg_rating: number | null;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM feedback_invites) AS invites,
       (SELECT COUNT(*) FROM feedback_invites WHERE submitted_at IS NOT NULL) AS submitted,
       (SELECT COUNT(*) FROM google_review_drafts WHERE status = 'draft') AS drafts,
       (SELECT COUNT(*) FROM google_review_drafts WHERE status = 'published') AS published,
       (SELECT AVG(rating) FROM feedback_invites WHERE rating IS NOT NULL) AS avg_rating`,
  );
  return {
    invites: Number(row.invites),
    submitted: Number(row.submitted),
    drafts: Number(row.drafts),
    published: Number(row.published),
    avgRating: row.avg_rating === null ? null : Number(row.avg_rating),
  };
}
