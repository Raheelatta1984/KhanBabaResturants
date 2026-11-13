import { getDb, type Db } from "../db";
import { getSetting, getSettingNumber } from "../settings";
import { priceDelivery, type DeliveryPricing } from "../pricing";
import { SimulatedProvider } from "./simulated";
import { UberDirectProvider, uberConfigured } from "./uber";
import type { DeliveryProvider, QuoteRequest } from "./types";

export type { DeliveryPricing } from "../pricing";

export async function getDeliveryProvider(db?: Db): Promise<DeliveryProvider> {
  const handle = db ?? (await getDb());
  const configured = await getSetting("delivery_provider", "auto");
  if (configured === "simulated") return new SimulatedProvider(handle);
  if (configured === "uber") return new UberDirectProvider(handle);
  return (await uberConfigured(handle))
    ? new UberDirectProvider(handle)
    : new SimulatedProvider(handle);
}

export async function deliveryMarginSettings(): Promise<{
  markupPercent: number;
  markupMinCents: number;
  roundingCents: number;
  maxFeeCents: number;
}> {
  return {
    markupPercent: await getSettingNumber("delivery_markup_percent", 15),
    markupMinCents: await getSettingNumber("delivery_markup_min_cents", 100),
    roundingCents: await getSettingNumber("delivery_rounding_cents", 50),
    maxFeeCents: await getSettingNumber("delivery_max_fee_cents", 2500),
  };
}

export async function applyDeliveryMargin(costCents: number) {
  return priceDelivery(costCents, await deliveryMarginSettings());
}

/**
 * Fetch a live courier quote and convert it into the customer-facing delivery fee.
 * If Uber Direct is configured but unavailable, we degrade to the local model and
 * flag the quote as non-live so the checkout can tell the customer.
 */
export async function quoteDelivery(
  request: QuoteRequest,
): Promise<DeliveryPricing> {
  const provider = await getDeliveryProvider();
  let fallbackReason: string | undefined;
  let quote;

  try {
    quote = await provider.quote(request);
  } catch (error) {
    fallbackReason =
      error instanceof Error ? error.message : "Courier quote unavailable";
    quote = await new SimulatedProvider().quote(request);
  }

  const { customerFeeCents, serviceFeeCents } = await applyDeliveryMargin(
    quote.feeCents,
  );

  return {
    provider: quote.provider,
    providerQuoteId: quote.quoteId,
    costCents: quote.feeCents,
    serviceFeeCents,
    customerFeeCents,
    etaMinutes: quote.etaMinutes,
    expiresAt: quote.expiresAt,
    live: quote.live,
    raw: {
      ...(typeof quote.raw === "object" && quote.raw ? quote.raw : {}),
      fallbackReason,
    },
  };
}

export async function dispatchWithProvider(
  providerName: string,
  request: Parameters<DeliveryProvider["dispatch"]>[0],
) {
  const db = await getDb();
  const provider =
    providerName === "uber_direct"
      ? new UberDirectProvider(db)
      : new SimulatedProvider(db);
  return provider.dispatch(request);
}

export async function providerStatus(providerName: string, deliveryId: string) {
  const db = await getDb();
  const provider =
    providerName === "uber_direct"
      ? new UberDirectProvider(db)
      : new SimulatedProvider(db);
  return provider.status(deliveryId);
}

export { uberConfigured };
