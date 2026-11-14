import type { Db } from "./db";
import { roundToCents, pct } from "./money";
import { getTimeParts, isTimeWithin, type TimeParts } from "./time";
import { DEFAULT_SETTINGS } from "./settings";

export type Channel = "delivery" | "pickup" | "dine_in" | "table";

export const CHANNEL_LABELS: Record<Channel, string> = {
  delivery: "Delivery",
  pickup: "Click & collect",
  dine_in: "Dine in",
  table: "Table order",
};

export type PricingRule = {
  id: number;
  code: string;
  label: string;
  kind: "weekend" | "public_holiday" | "priority" | "peak";
  calc: "percent" | "flat";
  value: number;
  applies_to: string;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  min_subtotal_cents: number;
  description: string | null;
  active: boolean;
  sort_order: number;
};

export type Holiday = {
  id: number;
  date: string;
  name: string;
  surcharge_percent: number | null;
  active: boolean;
};

export type Adjustment = {
  code: string;
  label: string;
  kind: "weekend" | "public_holiday" | "priority" | "peak" | "delivery" | "promotion";
  amountCents: number;
  percent?: number;
  note?: string;
};

export type DeliveryPricing = {
  provider: string;
  providerQuoteId: string;
  costCents: number;
  serviceFeeCents: number;
  customerFeeCents: number;
  etaMinutes: number;
  expiresAt: string;
  live: boolean;
  raw?: unknown;
};

export type PricingBreakdown = {
  subtotalCents: number;
  adjustments: Adjustment[];
  surchargeCents: number;
  priorityFeeCents: number;
  deliveryFeeCents: number;
  deliveryCostCents: number;
  deliveryServiceFeeCents: number;
  discountCents: number;
  totalCents: number;
  priorityAvailable: boolean;
  priorityFeeCentsIfSelected: number;
  context: {
    iso: string;
    hhmm: string;
    weekday: number;
    isWeekend: boolean;
    holidayName: string | null;
    isPeak: boolean;
  };
};

function appliesToChannel(rule: PricingRule, channel: Channel): boolean {
  if (rule.applies_to === "all") return true;
  return rule.applies_to
    .split(",")
    .map((s) => s.trim())
    .includes(channel);
}

function ruleInTimeWindow(rule: PricingRule, parts: TimeParts): boolean {
  if (rule.days) {
    const days = rule.days.split(",").map((d) => Number.parseInt(d.trim(), 10));
    if (!days.includes(parts.weekday)) return false;
  }
  return isTimeWithin(parts.hhmm, rule.start_time, rule.end_time);
}

export async function getActiveRules(db: Db): Promise<PricingRule[]> {
  return db.query<PricingRule>(
    "SELECT * FROM pricing_rules WHERE active ORDER BY sort_order ASC, id ASC",
  );
}

export async function getHoliday(db: Db, iso: string): Promise<Holiday | null> {
  // `date` is cast to text so callers keep receiving "YYYY-MM-DD".
  return db.maybeOne<Holiday>(
    "SELECT id, date::text AS date, name, surcharge_percent, active FROM holidays WHERE date = $1 AND active",
    [iso],
  );
}

export async function getUpcomingHolidays(
  db: Db,
  limit = 6,
): Promise<Holiday[]> {
  return db.query<Holiday>(
    `SELECT id, date::text AS date, name, surcharge_percent, active FROM holidays
     WHERE active AND date >= CURRENT_DATE ORDER BY date ASC LIMIT $1`,
    [limit],
  );
}

/**
 * Resolve the priority (jump-the-queue) fee for a channel at a moment in time.
 * Priority is never offered to dine-in / table guests — they are already seated.
 */
export async function resolvePriorityFee(
  db: Db,
  channel: Channel,
  parts: TimeParts = getTimeParts(),
): Promise<{
  available: boolean;
  feeCents: number;
  isPeak: boolean;
  label: string;
}> {
  const baseFee = Number.parseInt(DEFAULT_SETTINGS.priority_base_fee_cents, 10);
  const settingRow = await db.maybeOne<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'priority_base_fee_cents'",
  );
  const fallbackFee = settingRow
    ? Number.parseInt(settingRow.value, 10)
    : baseFee;

  if (channel === "table" || channel === "dine_in") {
    return {
      available: false,
      feeCents: 0,
      isPeak: false,
      label: "Not available for table guests",
    };
  }

  const rules = (await getActiveRules(db)).filter(
    (r) => r.kind === "priority" || r.kind === "peak",
  );
  const matching = rules.find(
    (r) => ruleInTimeWindow(r, parts) && (r.start_time || r.days),
  );
  const standard = rules.find((r) => !r.start_time && !r.days);
  const chosen = matching ?? standard;
  const fee = chosen ? Math.round(chosen.value * 100) : fallbackFee;

  return {
    available: true,
    feeCents: fee,
    isPeak: Boolean(matching),
    label: matching ? "Peak hour priority" : "Priority preparation",
  };
}

export type PricingInput = {
  subtotalCents: number;
  channel: Channel;
  priority?: boolean;
  delivery?: DeliveryPricing | null;
  /** Server-validated promotion discount (never trusted from the browser). */
  discountCents?: number;
  promotionLabel?: string;
  at?: Date;
};

/**
 * The single source of truth for order pricing. Client-side estimates are only
 * ever a preview — order creation always calls this again on the server.
 */
export async function computePricing(
  db: Db,
  input: PricingInput,
): Promise<PricingBreakdown> {
  const at = input.at ?? new Date();
  const parts = getTimeParts(at);
  const rules = (await getActiveRules(db)).filter((r) =>
    appliesToChannel(r, input.channel),
  );
  const adjustments: Adjustment[] = [];

  const holiday = await getHoliday(db, parts.iso);
  const weekendRule = rules.find((r) => r.kind === "weekend");
  const holidayRule = rules.find((r) => r.kind === "public_holiday");

  // A public holiday replaces the weekend surcharge instead of stacking on top of it.
  if (holidayRule && holiday) {
    const percent = holiday.surcharge_percent ?? holidayRule.value;
    const amount = pct(input.subtotalCents, percent);
    if (amount > 0) {
      adjustments.push({
        code: "public_holiday",
        label: `Public holiday surcharge — ${holiday.name}`,
        kind: "public_holiday",
        amountCents: amount,
        percent,
        note: `${percent}% applies on ${holiday.date}`,
      });
    }
  } else if (weekendRule && (parts.weekday === 0 || parts.weekday === 6)) {
    const days = weekendRule.days
      ? weekendRule.days.split(",").map(Number)
      : [0, 6];
    if (days.includes(parts.weekday)) {
      const amount = pct(input.subtotalCents, weekendRule.value);
      if (amount > 0) {
        adjustments.push({
          code: weekendRule.code,
          label: weekendRule.label,
          kind: "weekend",
          amountCents: amount,
          percent: weekendRule.value,
          note: weekendRule.description ?? undefined,
        });
      }
    }
  }

  const priority = await resolvePriorityFee(db, input.channel, parts);
  let priorityFeeCents = 0;
  if (input.priority && priority.available) {
    priorityFeeCents = priority.feeCents;
    adjustments.push({
      code: priority.isPeak ? "priority_peak" : "priority_standard",
      label: priority.label,
      kind: priority.isPeak ? "peak" : "priority",
      amountCents: priorityFeeCents,
      note: "Jumps the kitchen queue and is dispatched first",
    });
  }

  const surchargeCents = adjustments
    .filter((a) => a.kind === "weekend" || a.kind === "public_holiday")
    .reduce((sum, a) => sum + a.amountCents, 0);

  const delivery = input.delivery ?? null;
  const deliveryFeeCents =
    input.channel === "delivery" && delivery ? delivery.customerFeeCents : 0;
  const deliveryCostCents =
    input.channel === "delivery" && delivery ? delivery.costCents : 0;
  const deliveryServiceFeeCents =
    input.channel === "delivery" && delivery
      ? delivery.customerFeeCents - delivery.costCents
      : 0;

  if (deliveryFeeCents > 0) {
    adjustments.push({
      code: "delivery",
      label: "Delivery (live courier quote)",
      kind: "delivery",
      amountCents: deliveryFeeCents,
      note: delivery?.live
        ? "Quoted live from Uber Direct"
        : "Estimated courier fee",
    });
  }

  const discountCents = Math.max(
    0,
    Math.min(
      Math.round(input.discountCents ?? 0),
      input.subtotalCents + surchargeCents + priorityFeeCents + deliveryFeeCents,
    ),
  );
  if (discountCents > 0) {
    adjustments.push({
      code: "promotion",
      label: input.promotionLabel ?? "Promotion",
      kind: "promotion",
      amountCents: -discountCents,
      note: "Applied at checkout",
    });
  }

  const totalCents =
    input.subtotalCents +
    surchargeCents +
    priorityFeeCents +
    deliveryFeeCents -
    discountCents;

  return {
    discountCents,
    subtotalCents: input.subtotalCents,
    adjustments,
    surchargeCents,
    priorityFeeCents,
    deliveryFeeCents,
    deliveryCostCents,
    deliveryServiceFeeCents,
    totalCents,
    priorityAvailable: priority.available,
    priorityFeeCentsIfSelected: priority.feeCents,
    context: {
      iso: parts.iso,
      hhmm: parts.hhmm,
      weekday: parts.weekday,
      isWeekend: parts.weekday === 0 || parts.weekday === 6,
      holidayName: holiday?.name ?? null,
      isPeak: priority.isPeak,
    },
  };
}

/** Apply the restaurant's delivery margin to a raw courier quote. */
export function priceDelivery(
  costCents: number,
  settings: {
    markupPercent: number;
    markupMinCents: number;
    roundingCents: number;
    maxFeeCents: number;
  },
): { customerFeeCents: number; serviceFeeCents: number } {
  const serviceFee = Math.max(
    Math.round((costCents * settings.markupPercent) / 100),
    settings.markupMinCents,
  );
  let customerFee = roundToCents(
    costCents + serviceFee,
    settings.roundingCents,
  );
  if (settings.maxFeeCents > 0)
    customerFee = Math.min(
      customerFee,
      Math.max(settings.maxFeeCents, costCents),
    );
  return {
    customerFeeCents: Math.max(customerFee, costCents),
    serviceFeeCents: customerFee - costCents,
  };
}
