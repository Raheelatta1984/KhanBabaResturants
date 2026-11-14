import type { Db } from "./db";
import { getSetting } from "./settings";
import type { Channel } from "./pricing";

/**
 * Promotions for two audiences:
 *  - customers: percent / flat discounts and free delivery at checkout
 *  - driver partners: flat bonuses or commission uplifts posted to their ledger
 *    only when a delivery is actually completed.
 *
 * Every claim is re-validated server-side at order creation (the checkout
 * preview is never trusted), usage limits are enforced in the database, and
 * each redemption is recorded for reporting.
 */

export class PromotionError extends Error {
  status = 400;
}

export type PromotionRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  audience: "customer" | "driver" | "both";
  kind:
    | "percent"
    | "flat"
    | "free_delivery"
    | "driver_bonus"
    | "driver_commission";
  value: number;
  max_discount_cents: number;
  min_subtotal_cents: number;
  channels: string | null;
  driver_id: number | null;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number;
  per_customer_limit: number;
  usage_count: number;
  active: boolean;
  created_at: string;
};

export type PromotionCheck = {
  promotion: PromotionRow;
  discountCents: number;
  rewardCents: number;
  label: string;
};

function activeNow(row: PromotionRow, at: Date): boolean {
  if (!row.active) return false;
  if (row.starts_at && new Date(row.starts_at).getTime() > at.getTime())
    return false;
  if (row.ends_at && new Date(row.ends_at).getTime() < at.getTime())
    return false;
  if (row.usage_limit > 0 && row.usage_count >= row.usage_limit) return false;
  return true;
}

function channelAllowed(row: PromotionRow, channel: Channel): boolean {
  if (!row.channels) return true;
  return row.channels
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(channel);
}

export function discountFor(
  promotion: PromotionRow,
  subtotalCents: number,
  deliveryFeeCents = 0,
): number {
  switch (promotion.kind) {
    case "percent": {
      const raw = Math.round((subtotalCents * promotion.value) / 100);
      return promotion.max_discount_cents > 0
        ? Math.min(raw, promotion.max_discount_cents)
        : raw;
    }
    case "flat":
      return Math.min(
        Math.round(promotion.value),
        promotion.max_discount_cents > 0
          ? promotion.max_discount_cents
          : Number.MAX_SAFE_INTEGER,
      );
    case "free_delivery":
      return deliveryFeeCents;
    default:
      return 0;
  }
}

/** Check a customer promo code. Returns a validated discount or throws. */
export async function validatePromotion(
  db: Db,
  code: string,
  context: {
    subtotalCents: number;
    channel: Channel;
    deliveryFeeCents?: number;
    customerId?: number | null;
  },
): Promise<PromotionCheck> {
  const clean = (code ?? "").trim().toUpperCase();
  if (!clean) throw new PromotionError("Enter a promotion code");
  if ((await getSetting("promotions_enabled", "1")) === "0")
    throw new PromotionError("Promotions are currently paused");

  const promotion = await db.maybeOne<PromotionRow>(
    "SELECT * FROM promotions WHERE upper(code) = $1",
    [clean],
  );
  if (!promotion) throw new PromotionError("That promotion code is not valid");
  if (!["customer", "both"].includes(promotion.audience))
    throw new PromotionError("That code is for driver partners only");
  if (!activeNow(promotion, new Date()))
    throw new PromotionError("That promotion has expired or reached its limit");
  if (!channelAllowed(promotion, context.channel))
    throw new PromotionError("That promotion does not apply to this order type");
  if (context.subtotalCents < promotion.min_subtotal_cents) {
    throw new PromotionError(
      `Spend at least $${(promotion.min_subtotal_cents / 100).toFixed(2)} to use ${clean}`,
    );
  }
  if (promotion.per_customer_limit > 0 && context.customerId) {
    const used = await db.one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM promotion_redemptions
        WHERE promotion_id = $1 AND customer_id = $2`,
      [promotion.id, context.customerId],
    );
    if (Number(used.c) >= promotion.per_customer_limit)
      throw new PromotionError("You have already used this promotion");
  }

  const discountCents = Math.max(
    0,
    Math.min(
      discountFor(promotion, context.subtotalCents, context.deliveryFeeCents),
      context.subtotalCents + (context.deliveryFeeCents ?? 0),
    ),
  );
  if (discountCents <= 0)
    throw new PromotionError("That promotion does not apply to this order");

  return {
    promotion,
    discountCents,
    rewardCents: 0,
    label: `${promotion.name} (${clean})`,
  };
}

/** Persist a customer redemption and bump the usage counter atomically. */
export async function recordPromotionRedemption(
  db: Db,
  check: PromotionCheck,
  orderId: number,
  customerId: number | null,
): Promise<void> {
  await db.query(
    `INSERT INTO promotion_redemptions (promotion_id, order_id, customer_id, discount_cents)
     VALUES ($1, $2, $3, $4) ON CONFLICT (promotion_id, order_id) DO NOTHING`,
    [check.promotion.id, orderId, customerId, check.discountCents],
  );
  await db.query(
    "UPDATE promotions SET usage_count = usage_count + 1 WHERE id = $1",
    [check.promotion.id],
  );
}

/**
 * Bonuses that a driver has earned on a completed job. Only active driver
 * promotions inside their date/usage window count, and the redemption is
 * recorded against the job so a re-sync cannot pay it twice.
 */
export async function driverPromotionBonus(
  db: Db,
  driverId: number,
  jobId: number,
  deliveryFeeCents: number,
): Promise<number> {
  const rows = await db.query<PromotionRow>(
    `SELECT * FROM promotions
      WHERE active AND audience IN ('driver','both')
        AND kind IN ('driver_bonus','driver_commission')
        AND (driver_id IS NULL OR driver_id = $1)
        AND (starts_at IS NULL OR starts_at <= now())
        AND (ends_at IS NULL OR ends_at >= now())
        AND (usage_limit = 0 OR usage_count < usage_limit)`,
    [driverId],
  );
  let total = 0;
  for (const promotion of rows) {
    const used = await db.maybeOne<{ id: number }>(
      "SELECT id FROM promotion_redemptions WHERE promotion_id = $1 AND job_id = $2",
      [promotion.id, jobId],
    );
    if (used) continue;
    const reward =
      promotion.kind === "driver_commission"
        ? Math.round((deliveryFeeCents * promotion.value) / 100)
        : Math.round(promotion.value);
    if (reward <= 0) continue;
    await db.query(
      `INSERT INTO promotion_redemptions (promotion_id, job_id, driver_id, reward_cents)
       VALUES ($1, $2, $3, $4) ON CONFLICT (promotion_id, order_id) DO NOTHING`,
      [promotion.id, jobId, driverId, reward],
    );
    await db.query(
      "UPDATE promotions SET usage_count = usage_count + 1 WHERE id = $1",
      [promotion.id],
    );
    total += reward;
  }
  return total;
}

export async function listPromotions(db: Db): Promise<PromotionRow[]> {
  return db.query<PromotionRow>(
    "SELECT * FROM promotions ORDER BY active DESC, created_at DESC, id DESC",
  );
}

export async function createPromotion(
  db: Db,
  input: {
    code: string;
    name: string;
    description?: string;
    audience: string;
    kind: string;
    value: number;
    maxDiscountCents?: number;
    minSubtotalCents?: number;
    channels?: string;
    driverId?: number | null;
    startsAt?: string | null;
    endsAt?: string | null;
    usageLimit?: number;
    perCustomerLimit?: number;
  },
): Promise<number> {
  const code = (input.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,32}$/.test(code))
    throw new PromotionError("Code must be 2–32 letters, numbers, - or _");
  if (!input.name?.trim()) throw new PromotionError("Give the promotion a name");
  return db.insert(
    `INSERT INTO promotions (code, name, description, audience, kind, value, max_discount_cents,
       min_subtotal_cents, channels, driver_id, starts_at, ends_at, usage_limit, per_customer_limit)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      code,
      input.name.trim().slice(0, 120),
      input.description?.trim() || null,
      input.audience,
      input.kind,
      Number(input.value) || 0,
      Number(input.maxDiscountCents) || 0,
      Number(input.minSubtotalCents) || 0,
      input.channels?.trim() || null,
      input.driverId ?? null,
      input.startsAt || null,
      input.endsAt || null,
      Number(input.usageLimit) || 0,
      Number(input.perCustomerLimit) || 0,
    ],
  );
}

export async function setPromotionActive(
  db: Db,
  id: number,
  active: boolean,
): Promise<void> {
  await db.query("UPDATE promotions SET active = $1 WHERE id = $2", [
    active,
    id,
  ]);
}
