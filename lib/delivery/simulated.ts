import type {
  DeliveryProvider,
  DispatchRequest,
  DispatchResult,
  ProviderQuote,
  ProviderStatus,
  QuoteRequest,
} from "./types";
import { getSetting } from "../settings";

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function restaurantAddress(): string {
  return getSetting(
    "restaurant_address",
    "Shop 4, 379 Pitt Street, Sydney NSW 2000",
  );
}

const STATUS_SEQUENCE = ["accepted", "pickup", "dropoff", "delivered"] as const;

/**
 * Deterministic local courier model used for development, demos and as a
 * resilient fallback when Uber Direct credentials are not configured.
 * Fee model mirrors Uber Direct's structure: base + distance + small-order levy.
 */
export class SimulatedProvider implements DeliveryProvider {
  name = "simulated";
  live = false;

  private quotes = new Map<string, { expiresAt: number; feeCents: number; eta: number }>();

  private feeFor(address: string, orderValueCents: number) {
    const seed = hash(address.trim().toLowerCase());
    const distanceKm = 1.2 + (seed % 900) / 100; // 1.2 – 10.2 km
    const base = 349;
    const perKm = 215;
    const smallOrderLevy = orderValueCents < 3500 ? 150 : 0;
    const surge = (seed % 7 === 0 ? 1.12 : 1) * 1.0;
    const feeCents = Math.round((base + perKm * distanceKm + smallOrderLevy) * surge);
    return { feeCents, distanceKm, eta: 24 + (seed % 17) };
  }

  async quote(request: QuoteRequest): Promise<ProviderQuote> {
    const { feeCents, eta } = this.feeFor(
      `${request.dropoffAddress}|${request.dropoffPostcode ?? ""}`,
      request.orderValueCents,
    );
    const quoteId = `sim_q_${hash(request.dropoffAddress + request.orderCode).toString(36)}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    this.quotes.set(quoteId, { expiresAt: Date.now() + 15 * 60 * 1000, feeCents, eta });
    return {
      provider: this.name,
      quoteId,
      feeCents,
      etaMinutes: eta,
      expiresAt,
      live: false,
      raw: {
        pickup_address: restaurantAddress(),
        dropoff_address: request.dropoffAddress,
        fee: feeCents,
        currency: "AUD",
      },
    };
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const quote = this.quotes.get(request.quoteId);
    const deliveryId = `sim_d_${hash(request.quoteId + request.orderCode).toString(36)}`;
    const courierFirst = ["Adeel", "Sana", "Bilal", "Farhan", "Hamza", "Zara"][hash(deliveryId) % 6];
    const courierLast = ["K.", "R.", "M.", "S.", "A."][hash(deliveryId + "x") % 5];
    return {
      provider: this.name,
      deliveryId,
      status: "accepted",
      trackingUrl: `/order/${request.orderCode}?track=1`,
      courierName: `${courierFirst} ${courierLast}`,
      courierPhone: "04•• ••• •••",
      etaMinutes: quote?.eta ?? 32,
      raw: { simulated: true },
    };
  }

  async status(deliveryId: string): Promise<ProviderStatus> {
    // Local simulation advances through milestones on a 90-second cadence.
    const seed = hash(deliveryId);
    const minutes = Math.floor((Date.now() / 60000) % 6);
    const status = STATUS_SEQUENCE[Math.min(3, Math.floor((minutes + (seed % 3)) / 2))];
    return { status, etaMinutes: Math.max(4, 32 - minutes * 5) };
  }
}

export function simulatedQuoteFee(address: string, orderValueCents: number): number {
  const provider = new SimulatedProvider();
  const seed = hash(address.trim().toLowerCase());
  const distanceKm = 1.2 + (seed % 900) / 100;
  return Math.round(349 + 215 * distanceKm + (orderValueCents < 3500 ? 150 : 0));
}

export { STATUS_SEQUENCE };
