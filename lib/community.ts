import { randomBytes } from "node:crypto";
import type { Db } from "./db";
import {
  DEFAULT_COMMUNITY_AUTO_REPLY,
  getSettings,
  settingValue,
} from "./settings";
import {
  closePostComments,
  facebookConfigured,
  hideComment,
  listPostComments,
  postMessage,
  publishOfferPost,
  replyToComment,
  type PostComment,
} from "./integrations/facebook";

/**
 * Returns → community in need.
 *
 * A returned order can be redirected as a Facebook Page post. The FIRST person
 * to comment the claim keyword gets a free click & collect booking; the platform
 * immediately replies with "thank you we have got it booked", closes (or
 * moderates) the comments so nobody else can claim, and issues a zero-cost
 * pickup ticket that the counter hands over like any other collection.
 *
 * Everything is recorded in `community_offer_events`, and a conditional UPDATE
 * makes the claim first-wins even if two comments arrive in the same second.
 */

export class CommunityError extends Error {
  status = 400;
}

export type OfferRow = {
  id: number;
  return_id: number | null;
  order_id: number | null;
  token: string;
  pickup_code: string;
  title: string;
  description: string | null;
  contents: string | null;
  channel: string;
  status: "draft" | "posted" | "claimed" | "expired" | "cancelled";
  claim_keyword: string;
  auto_reply_text: string | null;
  facebook_post_id: string | null;
  facebook_post_url: string | null;
  facebook_mode: string;
  posted_at: string | null;
  posted_by: string | null;
  comments_closed: boolean;
  comments_moderated: boolean;
  auto_reply_posted_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  claim_comment_id: string | null;
  claim_source: string | null;
  claim_order_code: string | null;
  pickup_deadline: string | null;
  created_at: string;
};

function shortCode(prefix: string): string {
  return `${prefix}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

async function logOffer(
  db: Db,
  offerId: number,
  kind: string,
  detail: string,
  actor: string,
): Promise<void> {
  await db.query(
    "INSERT INTO community_offer_events (offer_id, kind, detail, actor) VALUES ($1,$2,$3,$4)",
    [offerId, kind, detail.slice(0, 500), actor],
  );
}

export async function createReturnRequest(
  db: Db,
  input: {
    orderCode: string;
    reason: string;
    resolution: "refund" | "replacement" | "community" | "waste";
    notes?: string;
    actor: string;
  },
): Promise<{ returnId: number; offerId: number | null; code: string }> {
  const order = await db.maybeOne<{
    id: number;
    code: string;
    status: string;
    customer_name: string;
  }>("SELECT * FROM orders WHERE code = $1", [
    input.orderCode.trim().toUpperCase(),
  ]);
  if (!order) throw new CommunityError("Order not found");
  if (!input.reason?.trim()) throw new CommunityError("Give a reason for the return");
  const settings = await getSettings();
  const code = shortCode("RET");
  const returnId = await db.insert(
    `INSERT INTO return_requests (order_id, code, reason, resolution, status, notes, requested_by)
     VALUES ($1,$2,$3,$4,'open',$5,$6) RETURNING id`,
    [
      order.id,
      code,
      input.reason.trim().slice(0, 300),
      input.resolution,
      input.notes?.slice(0, 500) ?? null,
      input.actor,
    ],
  );
  await db.query(
    `INSERT INTO order_events (order_id, type, message, actor, progress)
     VALUES ($1,'return',$2,$3,NULL)`,
    [order.id, `Return ${code} logged — ${input.resolution}`, input.actor],
  );

  let offerId: number | null = null;
  if (input.resolution === "community") {
    const items = await db.query<{ name: string; qty: number }>(
      "SELECT name, qty FROM order_items WHERE order_id = $1 ORDER BY id",
      [order.id],
    );
    const contents = items.map((item) => ({
      name: `${item.name}`,
      qty: item.qty,
    }));
    const title = `Community meal from order ${order.code}`;
    const id = await db.insert(
      `INSERT INTO community_offers (return_id, order_id, token, pickup_code, title, description,
        contents, channel, status, claim_keyword, auto_reply_text, pickup_deadline)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'click_and_collect','draft',$8,$9, now() + interval '1 day')
       RETURNING id`,
      [
        returnId,
        order.id,
        randomBytes(12).toString("base64url"),
        shortCode("KB-GIVE"),
        title,
        `Untouched order ${order.code} is available free to a neighbour in need. Click & collect only.`,
        JSON.stringify(contents),
        settingValue(settings, "community_claim_keyword", "MINE").toUpperCase(),
        settingValue(settings, "community_auto_reply"),
      ],
    );
    offerId = id;
    await logOffer(db, id, "created", `Drafted from return ${code}`, input.actor);
  }
  return { returnId, offerId, code };
}

/** Publish the offer to the Facebook Page (or sandbox mode). */
export async function publishOffer(
  db: Db,
  offerId: number,
  actor: string,
  baseUrl = "",
): Promise<OfferRow> {
  const offer = await db.maybeOne<OfferRow>(
    "SELECT * FROM community_offers WHERE id = $1",
    [offerId],
  );
  if (!offer) throw new CommunityError("Offer not found");
  if (offer.status !== "draft")
    throw new CommunityError("Only draft offers can be published");
  const settings = await getSettings();
  const post = {
    title: offer.title,
    description: offer.description,
    contents: offer.contents,
    claimKeyword: offer.claim_keyword,
    pickupHours: settingValue(settings, "community_pickup_hours", "Today"),
    restaurantName: settingValue(settings, "restaurant_name", "Khan Baba Restaurant"),
    pickupUrl: baseUrl ? `${baseUrl}/community/${offer.token}` : undefined,
  };

  if (await facebookConfigured()) {
    try {
      const result = await publishOfferPost(post);
      await db.query(
        `UPDATE community_offers SET status = 'posted', facebook_mode = 'live',
          facebook_post_id = $1, facebook_post_url = $2, posted_at = now(), posted_by = $3
         WHERE id = $4`,
        [result.postId, result.url, actor, offerId],
      );
      await logOffer(
        db,
        offerId,
        "posted",
        `Published to the Facebook Page — post ${result.postId}`,
        actor,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Facebook publish failed";
      await logOffer(db, offerId, "post_failed", message, actor);
      throw new CommunityError(message);
    }
  } else {
    await db.query(
      `UPDATE community_offers SET status = 'posted', facebook_mode = 'sandbox',
        facebook_post_id = $1, facebook_post_url = $2, posted_at = now(), posted_by = $3
       WHERE id = $4`,
      [
        `sandbox-${offer.id}`,
        baseUrl ? `${baseUrl}/community/${offer.token}` : `/community/${offer.token}`,
        actor,
        offerId,
      ],
    );
    await logOffer(
      db,
      offerId,
      "posted_sandbox",
      "Published in sandbox mode — add Facebook Page credentials for a live post",
      actor,
    );
    await logOffer(db, offerId, "post_preview", postMessage(post), actor);
  }
  return (await db.maybeOne<OfferRow>(
    "SELECT * FROM community_offers WHERE id = $1",
    [offerId],
  ))!;
}

/** Create the zero-cost click & collect ticket the counter hands over. */
async function createClaimOrder(
  db: Db,
  offer: OfferRow,
  claimedBy: string,
): Promise<string> {
  const code = `KB-GIVE-${randomBytes(3).toString("hex").toUpperCase()}`;
  const token = randomBytes(16).toString("base64url");
  const id = await db.insert(
    `INSERT INTO orders (code, tracking_token, channel, customer_name, notes,
      subtotal_cents, surcharge_cents, total_cents, payment_method, payment_status,
      status, progress, promised_at)
     VALUES ($1,$2,'pickup',$3,$4,0,0,0,'counter','paid','awaiting_collection',88,
      now() + interval '2 hours') RETURNING id`,
    [
      code,
      token,
      claimedBy.slice(0, 80),
      `Community in need — click & collect ONLY. Pickup code ${offer.pickup_code}. No charge.`,
    ],
  );
  await db.query(
    `INSERT INTO order_items (order_id, name, qty, unit_price_cents, line_total_cents, prep_state)
     VALUES ($1,$2,1,0,0,'ready')`,
    [id, `Community meal — ${offer.title}`.slice(0, 180)],
  );
  await db.query(
    `INSERT INTO order_events (order_id, type, message, actor, progress)
     VALUES ($1,'created',$2,'community',88)`,
    [id, "Click & collect booking created — present the pickup code at the counter"],
  );
  return code;
}

/** First-wins claim, shared by the Facebook sync and the local claim button. */
export async function claimOffer(
  db: Db,
  offerId: number,
  input: {
    claimedBy: string;
    commentId?: string | null;
    source?: string;
    actor?: string;
  },
): Promise<OfferRow | null> {
  const claimed = await db.maybeOne<OfferRow>(
    `UPDATE community_offers SET status = 'claimed', claimed_by = $1, claimed_at = now(),
      claim_comment_id = COALESCE($2, claim_comment_id), claim_source = $3,
      comments_closed = TRUE
     WHERE id = $4 AND status = 'posted' AND claimed_at IS NULL
     RETURNING *`,
    [
      input.claimedBy.slice(0, 120),
      input.commentId ?? null,
      input.source ?? "portal",
      offerId,
    ],
  );
  if (!claimed) return null;

  const actor = input.actor ?? "system";
  await logOffer(
    db,
    offerId,
    "claimed",
    `${input.claimedBy} claimed the meal (${input.source ?? "portal"}) — click & collect only`,
    actor,
  );

  // Auto-comment the thank-you and stop further comments from claiming it.
  let replyPosted = false;
  let closed = false;
  if (claimed.facebook_mode === "live" && claimed.facebook_post_id) {
    const reply = claimed.auto_reply_text || DEFAULT_COMMUNITY_AUTO_REPLY;
    if (input.commentId) replyPosted = await replyToComment(input.commentId, reply);
    closed = await closePostComments(claimed.facebook_post_id);
    if (!closed) {
      await db.query(
        "UPDATE community_offers SET comments_moderated = TRUE WHERE id = $1",
        [offerId],
      );
      await logOffer(
        db,
        offerId,
        "moderation_fallback",
        "This Page API does not support closing comments — later comments will be hidden",
        actor,
      );
    }
    await logOffer(
      db,
      offerId,
      "auto_reply",
      replyPosted ? reply : "Auto-reply queued (comment API unavailable)",
      actor,
    );
  } else {
    replyPosted = true;
    closed = true;
    await logOffer(
      db,
      offerId,
      "auto_reply",
      claimed.auto_reply_text || DEFAULT_COMMUNITY_AUTO_REPLY,
      actor,
    );
  }
  if (replyPosted)
    await db.query(
      "UPDATE community_offers SET auto_reply_posted_at = now() WHERE id = $1",
      [offerId],
    );
  await logOffer(
    db,
    offerId,
    "comments_blocked",
    closed ? "Post closed to further comments" : "Later comments are being hidden",
    actor,
  );

  const orderCode = await createClaimOrder(db, claimed, input.claimedBy);
  await db.query(
    "UPDATE community_offers SET claim_order_code = $1 WHERE id = $2",
    [orderCode, offerId],
  );
  return db.maybeOne<OfferRow>(
    "SELECT * FROM community_offers WHERE id = $1",
    [offerId],
  );
}

/** Local claim (sandbox mode, or the "claim here" button on the offer page). */
export async function claimOfferByToken(
  db: Db,
  token: string,
  input: { name: string; keyword: string },
): Promise<OfferRow> {
  const offer = await db.maybeOne<OfferRow>(
    "SELECT * FROM community_offers WHERE token = $1",
    [token],
  );
  if (!offer) throw new CommunityError("Offer not found");
  if (offer.status === "claimed")
    throw new CommunityError("This meal has already been claimed — thank you!");
  if (offer.status !== "posted")
    throw new CommunityError("This offer is not open for claims");
  if (!input.name?.trim()) throw new CommunityError("Tell us your name for the booking");
  if (input.keyword.trim().toUpperCase() !== offer.claim_keyword.toUpperCase())
    throw new CommunityError(
      `Comment or enter "${offer.claim_keyword}" to claim this meal`,
    );
  const claimed = await claimOffer(db, offer.id, {
    claimedBy: input.name.trim(),
    source: "portal",
    actor: "community",
  });
  if (!claimed)
    throw new CommunityError("Someone else just claimed it — first comment wins!");
  return claimed;
}

/**
 * Poll the Facebook post for comments. The first qualifying comment wins; all
 * later comments are hidden when the Page API cannot close the post.
 */
export async function syncOfferComments(
  db: Db,
  offerId: number,
  actor = "facebook-sync",
): Promise<{ comments: number; claimed: boolean; hidden: number }> {
  const offer = await db.maybeOne<OfferRow>(
    "SELECT * FROM community_offers WHERE id = $1",
    [offerId],
  );
  if (!offer || offer.facebook_mode !== "live" || !offer.facebook_post_id)
    return { comments: 0, claimed: false, hidden: 0 };
  let comments: PostComment[] = [];
  try {
    comments = await listPostComments(offer.facebook_post_id);
  } catch (error) {
    await logOffer(
      db,
      offerId,
      "sync_failed",
      error instanceof Error ? error.message : "Comment poll failed",
      actor,
    );
    return { comments: 0, claimed: false, hidden: 0 };
  }
  const keyword = offer.claim_keyword.toUpperCase();
  if (offer.status === "posted") {
    const winner = comments.find((comment) =>
      comment.message.toUpperCase().includes(keyword),
    );
    if (winner) {
      await claimOffer(db, offerId, {
        claimedBy: winner.fromName,
        commentId: winner.id,
        source: "facebook",
        actor,
      });
      return { comments: comments.length, claimed: true, hidden: 0 };
    }
  } else if (offer.comments_moderated) {
    let hidden = 0;
    for (const comment of comments.slice(1)) {
      // Reply on the winning comment is ours; hide anything that could confuse
      // other people into thinking the meal is still available.
      if (await hideComment(comment.id)) hidden += 1;
    }
    if (hidden)
      await logOffer(
        db,
        offerId,
        "comments_hidden",
        `${hidden} later comment(s) hidden after the meal was booked`,
        actor,
      );
    return { comments: comments.length, claimed: true, hidden };
  }
  return { comments: comments.length, claimed: false, hidden: 0 };
}

export async function syncAllPostedOffers(db: Db, actor = "facebook-sync") {
  const offers = await db.query<{ id: number }>(
    "SELECT id FROM community_offers WHERE status IN ('posted','claimed') AND facebook_mode = 'live'",
  );
  const results = [];
  for (const offer of offers)
    results.push(await syncOfferComments(db, offer.id, actor));
  return results;
}

export async function expireOffer(
  db: Db,
  offerId: number,
  actor: string,
): Promise<void> {
  await db.query(
    "UPDATE community_offers SET status = 'expired' WHERE id = $1 AND status = 'posted'",
    [offerId],
  );
  await logOffer(db, offerId, "expired", "Offer closed without a claim", actor);
}

export async function listReturns(db: Db) {
  return db.query<{
    id: number;
    code: string;
    order_code: string;
    reason: string;
    resolution: string;
    status: string;
    notes: string | null;
    requested_by: string | null;
    created_at: string;
  }>(
    `SELECT r.*, o.code AS order_code FROM return_requests r
      JOIN orders o ON o.id = r.order_id ORDER BY r.id DESC LIMIT 100`,
  );
}

export async function listOffers(db: Db) {
  return db.query<OfferRow>(
    "SELECT * FROM community_offers ORDER BY id DESC LIMIT 100",
  );
}

export async function publicOffers(db: Db) {
  return db.query<{
    token: string;
    title: string;
    description: string | null;
    contents: string | null;
    status: string;
    claim_keyword: string;
    facebook_post_url: string | null;
    claimed_by: string | null;
    posted_at: string | null;
  }>(
    `SELECT token, title, description, contents, status, claim_keyword,
      facebook_post_url, claimed_by, posted_at
     FROM community_offers WHERE status IN ('posted','claimed')
      ORDER BY posted_at DESC NULLS LAST LIMIT 50`,
  );
}

export async function offerByToken(
  db: Db,
  token: string,
): Promise<OfferRow | null> {
  return db.maybeOne<OfferRow>(
    "SELECT * FROM community_offers WHERE token = $1",
    [token],
  );
}

export async function offerEvents(db: Db, offerId: number) {
  return db.query<{
    id: number;
    kind: string;
    detail: string | null;
    actor: string;
    created_at: string;
  }>(
    "SELECT * FROM community_offer_events WHERE offer_id = $1 ORDER BY id ASC",
    [offerId],
  );
}
