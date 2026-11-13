import type { Db } from "../db";
import { getSetting, getSettingNumber } from "../settings";
import { priceDelivery, type DeliveryPricing } from "../pricing";
import { SimulatedProvider } from "./simulated";
import { UberDirectProvider, uberConfigured } from "./uber";
import type { DeliveryProvider, QuoteRequest } from "./types";

export type { DeliveryPricing } from "../pricing";

export function getDeliveryProvider(db?: Db): DeliveryProvider {
  const configured = getSetting("delivery_provider", "auto");
  if (configured === "simulated") return new SimulatedProvider();
  if (configured === "uber") return new UberDirectProvider();
  return uberConfigured() ? new UberDirectProvider() : new SimulatedProvider();
}

export function deliveryMarginSettings() {
  return {
    markupPercent: getSettingNumber("delivery_markup_percent", 15),
    markupMinCents: getSettingNumber("delivery_markup_min_cents", 100),
    roundingCents: getSettingNumber("delivery_rounding_cents", 50),
    maxFeeCents: getSettingNumber("delivery_max_fee_cents", 2500),
  };
}

export function applyDeliveryMargin(costCents: number) {
  return priceDelivery(costCents, deliveryMarginSettings());
}

/**
 * Fetch a live courier quote and convert it into the customer-facing delivery fee.
 * If Uber Direct is configured but unavailable, we degrade to the local model and
 * flag the quote as non-live so the checkout can tell the customer.
 */
export async function quoteDelivery(request: QuoteRequest): Promise<DeliveryPricing> {
  const provider = getDeliveryProvider();
  let fallbackReason: string | undefined;
  let quote;

  try {
    quote = await provider.quote(request);
  } catch (error) {
    fallbackReason = error instanceof Error ? error.message : "Courier quote unavailable";
    quote = await new SimulatedProvider().quote(request);
  }

  const { customerFeeCents, serviceFeeCents } = applyDeliveryMargin(quote.feeCents);

  return {
    provider: quote.provider,
    providerQuoteId: quote.quoteId,
    costCents: quote.feeCents,
    serviceFeeCents,
    customerFeeCents,
    etaMinutes: quote.etaMinutes,
    expiresAt: quote.expiresAt,
    live: quote.live,
    raw: { ...(typeof quote.raw === "object" && quote.raw ? quote.raw : {}), fallbackReason },
  };
}

export async function dispatchWithProvider(
  providerName: string,
  request: Parameters<DeliveryProvider["dispatch"]>[0],
) {
  const provider = providerName === "uber_direct" ? new UberDirectProvider() : new SimulatedProvider();
  return provider.dispatch(request);
}

export async function providerStatus(providerName: string, deliveryId: string) {
  const provider = providerName === "uber_direct" ? new UberDirectProvider() : new SimulatedProvider();
  return provider.status(deliveryId);
}

export { uberConfigured };
