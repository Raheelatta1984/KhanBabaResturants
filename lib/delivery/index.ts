import { getDb, type Db } from "../db";
import { getSetting, getSettingNumber } from "../settings";
import { priceDelivery, type DeliveryPricing } from "../pricing";
import { SimulatedProvider } from "./simulated";
import { UberDirectProvider, uberConfigured } from "./uber";
import {
  DoorDashDriveProvider,
  doordashConfigured,
} from "./doordash";
import { OwnFleetProvider } from "./fleet";
import { quoteFromZones } from "./zones";
import type {
  DeliveryProvider,
  ProviderQuote,
  QuoteRequest,
} from "./types";

export type { DeliveryPricing } from "../pricing";

export const PROVIDER_LABELS: Record<string, string> = {
  uber_direct: "Uber Direct",
  doordash_drive: "DoorDash Drive",
  own_fleet: "Khan Baba drivers",
  simulated: "Sandbox courier",
};

export function providerLabel(name: string): string {
  return PROVIDER_LABELS[name] ?? name.replace(/_/g, " ");
}

/** One provider by its internal name. */
export async function providerFor(
  name: string,
  db?: Db,
): Promise<DeliveryProvider> {
  const handle = db ?? (await getDb());
  switch (name) {
    case "uber_direct":
    case "uber":
      return new UberDirectProvider(handle);
    case "doordash_drive":
    case "doordash":
      return new DoorDashDriveProvider(handle);
    case "own_fleet":
    case "fleet":
      return new OwnFleetProvider(handle);
    default:
      return new SimulatedProvider(handle);
  }
}

export async function ownFleetConfigured(db?: Db): Promise<boolean> {
  const handle = db ?? (await getDb());
  const enabled = await getSetting("own_fleet_enabled", "1");
  if (enabled === "0") return false;
  const row = await handle.maybeOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM drivers WHERE status = 'approved'",
  );
  return Number(row?.c ?? 0) > 0;
}

/** Every live partner that is ready to quote right now. */
export async function configuredProviders(db?: Db): Promise<string[]> {
  const handle = db ?? (await getDb());
  const [uber, doordash, fleet] = await Promise.all([
    uberConfigured(handle),
    doordashConfigured(handle),
    ownFleetConfigured(handle),
  ]);
  const names: string[] = [];
  if (uber) names.push("uber_direct");
  if (doordash) names.push("doordash_drive");
  if (fleet) names.push("own_fleet");
  return names;
}

export async function getDeliveryProvider(db?: Db): Promise<DeliveryProvider> {
  const handle = db ?? (await getDb());
  const configured = await getSetting("delivery_provider", "auto");
  if (configured === "simulated") return new SimulatedProvider(handle);
  if (configured === "uber") return new UberDirectProvider(handle);
  if (configured === "doordash") return new DoorDashDriveProvider(handle);
  if (configured === "own_fleet") return new OwnFleetProvider(handle);
  const names = await configuredProviders(handle);
  return providerFor(names[0] ?? "simulated", handle);
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
 * Quote every configured delivery partner and return the best one.
 *
 * `auto` compares Uber Direct, DoorDash Drive and our own verified drivers on
 * price (or ETA when `delivery_quote_strategy = fastest`); a forced provider
 * quotes only that partner. Any partner that is down is simply skipped — the
 * customer never sees an error because one integration is having a bad day, and
 * the sandbox rate card is the last resort. Which partners were compared is
 * kept on the quote so the delivery desk can show why a job went where it did.
 */
export async function quoteDelivery(
  request: QuoteRequest,
): Promise<DeliveryPricing> {
  const db = await getDb();
  const [mode, strategy] = await Promise.all([
    getSetting("delivery_provider", "auto"),
    getSetting("delivery_quote_strategy", "cheapest"),
  ]);

  const forced: Record<string, string> = {
    uber: "uber_direct",
    doordash: "doordash_drive",
    own_fleet: "own_fleet",
    simulated: "simulated",
  };
  const names =
    mode === "auto"
      ? await configuredProviders(db)
      : [forced[mode] ?? "simulated"];

  // Who is allowed to answer "we can deliver there".
  //
  // A forced provider used to bypass the zone check entirely: with
  // `delivery_provider = simulated` any postcode was priced by the sandbox
  // hash, including addresses the kitchen does not serve. The zone rate card
  // now answers serviceability first, whatever provider is forced, so the
  // question "do you deliver to me?" has one answer in every mode.
  const forcedZone = await quoteFromZones(db, {
    address: request.dropoffAddress,
    suburb: request.dropoffSuburb,
    postcode: request.dropoffPostcode,
    lat: request.dropoffLat,
    lng: request.dropoffLng,
    orderValueCents: request.orderValueCents,
  });
  if (!forcedZone.serviceable) {
    throw new Error(forcedZone.note);
  }

  const attempts = await Promise.all(
    names.map(async (name) => {
      try {
        const quote = await (
          await providerFor(name, db)
        ).quote(request);
        return { name, quote, error: null as string | null };
      } catch (error) {
        return {
          name,
          quote: null,
          error: error instanceof Error ? error.message : "Quote unavailable",
        };
      }
    }),
  );
  const successful = attempts.filter(
    (entry): entry is { name: string; quote: ProviderQuote; error: null } =>
      entry.quote !== null,
  );

  // No partner could quote. The zone rate card — read from Postgres — is the
  // answer, not a hash of the address. It also knows which postcodes we serve,
  // so an address outside the area is refused honestly instead of being priced.
  const zone = successful.length
    ? null
    : await quoteFromZones(db, {
        address: request.dropoffAddress,
        suburb: request.dropoffSuburb,
        postcode: request.dropoffPostcode,
        lat: request.dropoffLat,
        lng: request.dropoffLng,
        orderValueCents: request.orderValueCents,
      });

  if (zone && !zone.serviceable) {
    throw new Error(zone.note);
  }

  const quote: ProviderQuote = successful.length
    ? successful.sort((a, b) =>
        strategy === "fastest"
          ? a.quote.etaMinutes - b.quote.etaMinutes
          : a.quote.feeCents - b.quote.feeCents,
      )[0].quote
    : {
        provider: "zone_rate_card",
        quoteId: `zone_q_${Date.now().toString(36)}`,
        feeCents: zone?.feeCents ?? 0,
        etaMinutes: zone?.etaMinutes ?? 30,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        live: false,
        distanceKm: zone?.distanceKm ?? undefined,
        raw: { zone: zone?.zoneName ?? null, postcode: zone?.postcode ?? null },
      };

  let fallbackReason: string | undefined;
  if (!successful.length) {
    fallbackReason =
      attempts.map((a) => a.error).filter(Boolean).join("; ") ||
      (zone
        ? `No courier partner is configured — priced from the ${zone.zoneName} delivery zone`
        : "No courier partner is configured — using the sandbox rate card");
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
      distanceKm: quote.distanceKm ?? zone?.distanceKm ?? undefined,
      fallbackReason,
      deliveryZone: zone
        ? {
            name: zone.zoneName,
            postcode: zone.postcode,
            serviceable: zone.serviceable,
            freeDelivery: zone.freeDelivery,
            minOrderCents: zone.minOrderCents,
            note: zone.note,
          }
        : undefined,
      compared: attempts.map((entry) => ({
        provider: entry.name,
        feeCents: entry.quote?.feeCents ?? null,
        etaMinutes: entry.quote?.etaMinutes ?? null,
        error: entry.error,
      })),
    },
  };
}

export async function dispatchWithProvider(
  providerName: string,
  request: Parameters<DeliveryProvider["dispatch"]>[0],
) {
  const db = await getDb();
  return (await providerFor(providerName, db)).dispatch(request);
}

export async function providerStatus(providerName: string, deliveryId: string) {
  const db = await getDb();
  return (await providerFor(providerName, db)).status(deliveryId);
}

export { uberConfigured, doordashConfigured };
