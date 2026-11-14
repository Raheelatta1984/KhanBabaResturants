import type { Db } from "../db";
import { getSettings, settingNumber, settingValue } from "../settings";
import { KITCHEN_FALLBACK, estimateCoordinates, haversineKm, roadKm, type LatLng } from "../geo";

/**
 * Postcode delivery zones.
 *
 * Before this module the only delivery limit was `delivery_radius_km` — a
 * straight line from the kitchen. That is not a delivery area: it quotes 2770
 * (Mount Druitt) the same way as 2000 (the CBD) even though one is 40 km away.
 * A zone is now the commercial rule, read from Postgres:
 *
 *   postcodes            which addresses we serve
 *   base_fee_cents       flat fee for the zone
 *   per_km_cents         plus distance from the kitchen
 *   free_over_cents      free delivery above a subtotal (0 = never)
 *   min_order_cents      minimum order for the zone
 *   eta_minutes          the promise we make on the confirmation
 *
 * The rate card is a **fallback**, not a replacement. When a live courier quote
 * exists it still wins; the zone supplies the fee only when no partner could
 * quote, which is exactly the case the brief called "never guess randomly".
 */

export type DeliveryZone = {
  id: number;
  name: string;
  suburbs: string | null;
  postcodes: string;
  base_fee_cents: number;
  per_km_cents: number;
  min_order_cents: number;
  free_over_cents: number;
  eta_minutes: number;
  max_radius_km: number;
  active: boolean;
  sort_order: number;
};

export type ZoneQuote = {
  /** True when the postcode is inside a zone we deliver to. */
  serviceable: boolean;
  zone: DeliveryZone | null;
  zoneName: string;
  postcode: string;
  distanceKm: number | null;
  feeCents: number;
  freeDelivery: boolean;
  minOrderCents: number;
  etaMinutes: number;
  /** Why the answer looks the way it does — shown to staff, never invented. */
  note: string;
};

/** A postcode as it is used for lookup: digits, four characters, or "". */
export function normalisePostcode(input: string | null | undefined): string {
  const digits = (input ?? "").replace(/[^0-9]/g, "");
  return digits.slice(0, 4);
}

/** The postcodes of a zone, as a Set, tolerating spaces and "2000, 2001". */
function postcodeSet(zone: Pick<DeliveryZone, "postcodes">): Set<string> {
  return new Set(
    (zone.postcodes ?? "")
      .split(/[,\s]+/)
      .map((value) => normalisePostcode(value))
      .filter(Boolean),
  );
}

/** Every active zone, in display order. */
export async function listDeliveryZones(db: Db): Promise<DeliveryZone[]> {
  return db.query<DeliveryZone>(
    "SELECT * FROM delivery_zones WHERE active ORDER BY sort_order, id",
  );
}

/** The zone that owns a postcode, or null when we do not deliver there. */
export async function zoneForPostcode(
  db: Db,
  postcode: string,
): Promise<DeliveryZone | null> {
  const wanted = normalisePostcode(postcode);
  if (!wanted) return null;
  const zones = await listDeliveryZones(db);
  return zones.find((zone) => postcodeSet(zone).has(wanted)) ?? null;
}

/** The kitchen's own coordinates, from settings with a CBD fallback. */
export async function kitchenLocation(): Promise<LatLng> {
  const settings = await getSettings();
  const lat = Number.parseFloat(settingValue(settings, "restaurant_lat", ""));
  const lng = Number.parseFloat(settingValue(settings, "restaurant_lng", ""));
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0
    ? { lat, lng }
    : KITCHEN_FALLBACK;
}

/**
 * Road distance to an address. Real coordinates win; without them the address
 * is projected onto a deterministic point so the same address always prices the
 * same way (and staff can correct the pin in Admin → Orders).
 */
export async function distanceFromKitchen(input: {
  address: string;
  suburb?: string;
  postcode?: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<{ distanceKm: number; precise: boolean }> {
  const origin = await kitchenLocation();
  if (
    typeof input.lat === "number" &&
    typeof input.lng === "number" &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng) &&
    input.lat !== 0 &&
    input.lng !== 0
  ) {
    return {
      distanceKm: roadKm(origin, { lat: input.lat, lng: input.lng }),
      precise: true,
    };
  }
  const estimate = estimateCoordinates(
    input.address,
    input.suburb ?? "",
    input.postcode ?? "",
    origin,
  );
  return { distanceKm: haversineKm(origin, estimate), precise: false };
}

/**
 * Price a delivery from the zone rate card. This never throws: an unserviceable
 * postcode returns `serviceable: false` with a readable reason, and an unknown
 * postcode falls back to the kitchen's global delivery settings so the checkout
 * still works while zones are being set up.
 */
export async function quoteFromZones(
  db: Db,
  input: {
    address: string;
    suburb?: string;
    postcode?: string;
    lat?: number | null;
    lng?: number | null;
    orderValueCents: number;
  },
): Promise<ZoneQuote> {
  const postcode = normalisePostcode(input.postcode);
  const { distanceKm, precise } = await distanceFromKitchen(input);
  const zone = await zoneForPostcode(db, postcode);
  const settings = await getSettings();

  // No zone configured at all (fresh install): use the global rate card so the
  // site keeps selling instead of refusing every delivery.
  if (!zone) {
    const configured = await db.maybeOne<{ c: number }>(
      "SELECT COUNT(*) AS c FROM delivery_zones WHERE active",
    );
    if (Number(configured?.c ?? 0) === 0) {
      const fee = settingNumber(settings, "own_fleet_base_fee_cents", 349);
      const perKm = settingNumber(settings, "own_fleet_per_km_cents", 185);
      const radius = settingNumber(settings, "delivery_radius_km", 12);
      const tooFar = distanceKm > radius;
      return {
        serviceable: !tooFar,
        zone: null,
        zoneName: tooFar ? "Outside our delivery area" : "Standard delivery",
        postcode,
        distanceKm,
        feeCents: tooFar ? 0 : Math.round(fee + perKm * distanceKm),
        freeDelivery: false,
        minOrderCents: settingNumber(settings, "delivery_min_order_cents", 2500),
        etaMinutes: Math.round(30 + distanceKm * 2),
        note: tooFar
          ? `That address is ${distanceKm.toFixed(1)} km away; the kitchen delivers within ${radius} km.`
          : `No delivery zones are configured yet, so this uses the kitchen's standard rate${precise ? "" : " (address not geocoded)"}.`,
      };
    }
    // Zones exist but this postcode is not on any list. That could be a real
    // "we do not deliver there", or a zone list that has not been filled in
    // yet. `delivery_zones_strict` decides which: the default keeps selling
    // with the kitchen radius (and the note says the rate is an estimate),
    // while a finished zone list can refuse out-of-area addresses outright.
    const strict = settingValue(settings, "delivery_zones_strict", "0") === "1";
    if (!strict) {
      const fee = settingNumber(settings, "own_fleet_base_fee_cents", 349);
      const perKm = settingNumber(settings, "own_fleet_per_km_cents", 185);
      const radius = settingNumber(settings, "delivery_radius_km", 12);
      const tooFar = distanceKm > radius;
      return {
        serviceable: !tooFar,
        zone: null,
        zoneName: tooFar ? "Outside our delivery area" : "Standard delivery",
        postcode,
        distanceKm,
        feeCents: tooFar ? 0 : Math.round(fee + perKm * distanceKm),
        freeDelivery: false,
        minOrderCents: settingNumber(settings, "delivery_min_order_cents", 2500),
        etaMinutes: tooFar ? 0 : Math.round(30 + distanceKm * 2),
        note: tooFar
          ? `That address is ${distanceKm.toFixed(1)} km away; the kitchen delivers within ${radius} km.`
          : `${postcode || "This address"} is not in a published delivery zone yet, so it is priced on the standard rate from ${distanceKm.toFixed(1)} km${precise ? "" : " (estimated pin)"}.`,
      };
    }
    return {
      serviceable: false,
      zone: null,
      zoneName: "Outside our delivery area",
      postcode,
      distanceKm,
      feeCents: 0,
      freeDelivery: false,
      minOrderCents: settingNumber(settings, "delivery_min_order_cents", 2500),
      etaMinutes: 0,
      note: postcode
        ? `We do not deliver to ${postcode}. Reply PICKUP to collect at the counter instead.`
        : "A postcode is needed to check the delivery area.",
    };
  }

  // Serviceability is decided by the postcode list, which is the commercial
  // promise: if 2770 is on the zone, 2770 is served. The radius is a second
  // guard that only means something when the distance is real — an estimated
  // pin is spread across ~1–10 km by construction, so testing a radius against
  // it would refuse valid addresses (a Pyrmont order 2 km away "measuring"
  // 11 km) while passing invalid ones. Real coordinates are checked always.
  if (precise && distanceKm > zone.max_radius_km) {
    return {
      serviceable: false,
      zone,
      zoneName: zone.name,
      postcode,
      distanceKm,
      feeCents: 0,
      freeDelivery: false,
      minOrderCents: zone.min_order_cents,
      etaMinutes: 0,
      note: `${zone.name} covers up to ${zone.max_radius_km} km; this address is ${distanceKm.toFixed(1)} km away.`,
    };
  }

  const freeDelivery =
    zone.free_over_cents > 0 && input.orderValueCents >= zone.free_over_cents;
  // An estimated pin would add a random distance charge to the zone fee, so
  // the per-km component only applies to a real geocoded address. Without
  // coordinates the customer sees the zone's flat fee — a number staff can
  // quote at the counter — instead of a fee that changes with the spelling of
  // their street.
  const feeCents = freeDelivery
    ? 0
    : Math.round(
        zone.base_fee_cents + (precise ? zone.per_km_cents * distanceKm : 0),
      );

  return {
    serviceable: true,
    zone,
    zoneName: zone.name,
    postcode,
    distanceKm,
    feeCents,
    freeDelivery,
    minOrderCents: zone.min_order_cents,
    etaMinutes: Math.round(
      zone.eta_minutes + Math.max(0, distanceKm - 3) * 1.5,
    ),
    note: freeDelivery
      ? `Free delivery on this order — ${zone.name} is free over $${(zone.free_over_cents / 100).toFixed(0)}.`
      : precise
        ? `${zone.name} · $${(zone.base_fee_cents / 100).toFixed(2)} base + $${(zone.per_km_cents / 100).toFixed(2)}/km over ${distanceKm.toFixed(1)} km.`
        : `${zone.name} · flat $${(zone.base_fee_cents / 100).toFixed(2)} — the pin is estimated until the address is geocoded.`,
  };
}

/** Everything the admin zone table and the WhatsApp agent need in one read. */
export async function zoneSummary(db: Db): Promise<{
  zones: (DeliveryZone & { area: string })[];
  postcodes: number;
}> {
  const zones = await listDeliveryZones(db);
  const postcodes = zones.reduce((sum, zone) => sum + postcodeSet(zone).size, 0);
  return {
    zones: zones.map((zone) => ({
      ...zone,
      area: (zone.postcodes ?? "").split(",").map((value) => value.trim()).filter(Boolean).join(" · "),
    })),
    postcodes,
  };
}
