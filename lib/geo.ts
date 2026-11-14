/**
 * Small, dependency-free geodesy helpers shared by courier quoting, driver
 * assignment, live tracking maps and the ATO kilometre log.
 *
 * All distances are great-circle (haversine) kilometres. Road distance is
 * approximated with a 1.28 detour factor — enough for quoting and tax-trip
 * estimates, and it is recorded as `estimated` rather than pretending to be a
 * routing engine. GPS breadcrumbs, when a driver shares location, are summed
 * directly and recorded as `gps`.
 */

export type LatLng = { lat: number; lng: number };

export const SYDNEY_CBD: LatLng = { lat: -33.8688, lng: 151.2093 };

const RAD = Math.PI / 180;
const EARTH_KM = 6371.0088;
/** Straight-line → realistic road distance multiplier. */
export const ROAD_FACTOR = 1.28;

export function isLatLng(value: unknown): value is LatLng {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<LatLng>;
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(Number(point.lat)) <= 90 &&
    Math.abs(Number(point.lng)) <= 180
  );
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const lat1 = a.lat * RAD;
  const lat2 = b.lat * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function roadKm(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * ROAD_FACTOR;
}

/** Sum a sequence of GPS breadcrumbs (already in chronological order). */
export function pathKm(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineKm(points[i - 1], points[i]);
  }
  return total;
}

/** A point `t` (0..1) of the way along a straight-line route, for demo maps. */
export function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    lat: a.lat + (b.lat - a.lat) * clamped,
    lng: a.lng + (b.lng - a.lng) * clamped,
  };
}

/**
 * Deterministic fallback coordinates for an address that has not been geocoded.
 * Checkout resolves real coordinates in the browser (OpenStreetMap Nominatim)
 * and staff can correct them in Admin → Orders; this only guarantees that every
 * delivery has *some* usable point so maps and distance fees never break.
 *
 * The hash spreads addresses across a ~12 km box around the restaurant, which
 * is the configured delivery radius.
 */
export function estimateCoordinates(
  address: string,
  suburb = "",
  postcode = "",
  origin: LatLng = SYDNEY_CBD,
): LatLng {
  const input = `${address}|${suburb}|${postcode}`.trim().toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = Math.abs(h);
  const angle = ((a % 3600) / 3600) * 2 * Math.PI;
  const km = 1.1 + ((a >> 7) % 900) / 100; // 1.1 – 10.1 km
  return {
    lat: origin.lat + (km * Math.cos(angle)) / 111.32,
    lng:
      origin.lng +
      (km * Math.sin(angle)) / (111.32 * Math.cos(origin.lat * RAD)),
  };
}

/** Parse a numeric coordinate from a form field, or null when blank/invalid. */
export function coordinate(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** ETA in minutes from a road distance and an average urban speed. */
export function etaMinutes(distanceKm: number, prepMinutes = 15): number {
  return Math.round(prepMinutes + Math.max(6, (distanceKm / 24) * 60));
}

/** Web-mercator tile numbers, used by the optional OpenStreetMap background. */
export function tileXY(lat: number, lng: number, zoom: number) {
  const scale = 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const latRad = lat * RAD;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    scale;
  return { x, y };
}

export function formatCoordinate(point: LatLng | null): string {
  return point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : "—";
}
