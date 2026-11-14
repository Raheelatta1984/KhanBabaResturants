import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  DeliveryProvider,
  DispatchRequest,
  DispatchResult,
  ProviderQuote,
  ProviderStatus,
  QuoteRequest,
} from "./types";
import { getDb, type Db as Database } from "../db";
import { getSetting, getSettings, settingValue } from "../settings";
import type { LatLng } from "../geo";

/**
 * DoorDash Drive — the second courier partner alongside Uber Direct.
 *
 * Quotes and deliveries are idempotent on `external_delivery_id` (our own
 * order-scoped id), so a retry after a network blip never creates a duplicate
 * job. Authentication is a short-lived HS256 JWT signed with the Developer
 * Portal signing secret; credentials come from env vars first, then the admin
 * settings table, and never reach the browser.
 *
 * Docs: https://developer.doordash.com/en-US/api/drive/
 */
const API_URL =
  process.env.DOORDASH_API_URL || "https://openapi.doordash.com/drive/v2";

type Credentials = {
  developerId: string;
  keyId: string;
  signingSecret: string;
  storeId: string;
};

async function credentials(db: Database): Promise<Credentials> {
  return {
    developerId:
      process.env.DOORDASH_DEVELOPER_ID ||
      (await getSetting("doordash_developer_id")),
    keyId:
      process.env.DOORDASH_KEY_ID || (await getSetting("doordash_key_id")),
    signingSecret:
      process.env.DOORDASH_SIGNING_SECRET ||
      (await getSetting("doordash_signing_secret")),
    storeId:
      process.env.DOORDASH_STORE_ID ||
      (await getSetting("doordash_store_id", "khan-baba-sydney")),
  };
}

export async function doordashConfigured(db?: Database): Promise<boolean> {
  const handle = db ?? (await getDb());
  const { developerId, keyId, signingSecret } = await credentials(handle);
  return Boolean(developerId && keyId && signingSecret);
}

function b64url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** DoorDash expects the signing secret to be base64-decoded before HMAC. */
function signingKey(secret: string): Buffer {
  try {
    const decoded = Buffer.from(secret, "base64");
    if (decoded.length >= 16) return decoded;
  } catch {
    /* fall through to the raw secret */
  }
  return Buffer.from(secret, "utf8");
}

export function doordashJwt(creds: Credentials, ttlSeconds = 300): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(
    JSON.stringify({ alg: "HS256", typ: "JWT", kid: creds.keyId }),
  );
  const payload = b64url(
    JSON.stringify({
      aud: "doordash",
      iss: creds.developerId,
      kid: creds.keyId,
      iat: now,
      exp: now + ttlSeconds,
    }),
  );
  const signature = createHmac("sha256", signingKey(creds.signingSecret))
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${payload}.${signature}`;
}

/** Verify a DoorDash webhook JWT (same HS256 key, `kid` from the header). */
export async function verifyDoordashWebhook(
  authorization: string | null,
  db?: Database,
): Promise<boolean> {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  const handle = db ?? (await getDb());
  const creds = await credentials(handle);
  if (!creds.signingSecret) return false; // sandbox: no secret configured
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const expected = createHmac("sha256", signingKey(creds.signingSecret))
    .update(`${parts[0]}.${parts[1]}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (expected.length !== parts[2].length) return false;
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2])))
      return false;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { exp?: number };
    return !payload.exp || payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

function fullAddress(request: {
  dropoffAddress: string;
  dropoffSuburb?: string;
  dropoffPostcode?: string;
}): string {
  return [
    request.dropoffAddress,
    request.dropoffSuburb,
    request.dropoffPostcode,
    "Australia",
  ]
    .filter(Boolean)
    .join(", ");
}

function latLng(request: {
  dropoffLat?: number | null;
  dropoffLng?: number | null;
}): LatLng | null {
  return request.dropoffLat != null && request.dropoffLng != null
    ? { lat: Number(request.dropoffLat), lng: Number(request.dropoffLng) }
    : null;
}

async function api(
  db: Database,
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const creds = await credentials(db);
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${doordashJwt(creds)}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const message =
      (json as { message?: string; error?: string } | null)?.message ??
      (json as { error?: string } | null)?.error ??
      `DoorDash Drive error ${res.status}`;
    throw new Error(String(message));
  }
  return (json ?? {}) as Record<string, unknown>;
}

export class DoorDashDriveProvider implements DeliveryProvider {
  name = "doordash_drive";
  live = true;
  private db?: Database;
  private settingsCache?: Record<string, string>;

  constructor(db?: Database) {
    this.db = db;
  }

  private async settingsFor(): Promise<Record<string, string>> {
    if (!this.settingsCache) this.settingsCache = await getSettings();
    return this.settingsCache;
  }

  private async deliveryBody(request: QuoteRequest | DispatchRequest) {
    const db = this.db ?? (await getDb());
    const settings = await this.settingsFor();
    const creds = await credentials(db);
    const lead = Number.parseInt(
      settingValue(settings, "delivery_prep_lead_minutes", "15"),
      10,
    );
    const readyAt = new Date(Date.now() + lead * 60_000).toISOString();
    const point = latLng(request);
    return {
      external_delivery_id: String(request.orderCode).replace(/[^A-Za-z0-9_-]/g, "-"),
      external_store_id: creds.storeId,
      pickup_business_name: settingValue(
        settings,
        "restaurant_name",
        "Khan Baba Restaurant",
      ),
      pickup_address: settingValue(
        settings,
        "restaurant_address",
        "Shop 4, 379 Pitt Street, Sydney NSW 2000",
      ),
      pickup_phone_number: settingValue(
        settings,
        "restaurant_phone",
        "0290001234",
      ).replace(/\s/g, ""),
      pickup_instructions: settingValue(settings, "uber_pickup_notes"),
      dropoff_business_name: "",
      dropoff_address: fullAddress(request),
      dropoff_phone_number: (request.phone ?? "").replace(/\s/g, ""),
      dropoff_instructions: request.dropoffNotes ?? "",
      dropoff_contact_given_name: request.customerName.split(" ")[0],
      dropoff_contact_family_name:
        request.customerName.split(" ").slice(1).join(" ") || "-",
      ...(point
        ? {
            dropoff_latitude: point.lat,
            dropoff_longitude: point.lng,
          }
        : {}),
      pickup_time: readyAt,
      dropoff_time: new Date(Date.now() + (lead + 45) * 60_000).toISOString(),
      order_value:
        "orderValueCents" in request
          ? Number(request.orderValueCents) || 0
          : 0,
      currency: "AUD",
      ...(point ? { distance_unit: "km" } : {}),
      manifest_items:
        "manifest" in request
          ? request.manifest.map((item) => ({
              name: item.name,
              quantity: item.quantity,
            }))
          : undefined,
      tip: 0,
      allow_unattended_delivery: false,
    };
  }

  async quote(request: QuoteRequest): Promise<ProviderQuote> {
    const db = this.db ?? (await getDb());
    const body = await this.deliveryBody(request);
    const json = await api(db, "/quotes", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const feeCents = Math.round(
      Number(json.fee ?? json.delivery_fee ?? json.total_fee ?? 0),
    );
    if (!feeCents) throw new Error("DoorDash Drive returned a quote without a fee");
    const expiresAt =
      typeof json.expires_at === "string"
        ? json.expires_at
        : new Date(Date.now() + 10 * 60_000).toISOString();
    let etaMinutes = 35;
    if (typeof json.estimated_delivery_time === "string") {
      const delta =
        new Date(json.estimated_delivery_time).getTime() - Date.now();
      if (Number.isFinite(delta) && delta > 0)
        etaMinutes = Math.max(10, Math.round(delta / 60_000));
    }
    return {
      provider: this.name,
      // DoorDash uses external_delivery_id for both quote and delivery creation.
      quoteId: String(body.external_delivery_id),
      feeCents,
      etaMinutes,
      expiresAt,
      live: true,
      raw: json,
    };
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const db = this.db ?? (await getDb());
    const body = await this.deliveryBody(request);
    body.external_delivery_id = request.quoteId;
    const json = await api(db, "/deliveries", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const courier = (json.courier ?? {}) as {
      name?: string;
      first_name?: string;
      phone_number?: string;
    };
    return {
      provider: this.name,
      deliveryId: String(
        json.external_delivery_id ?? request.quoteId ?? json.id ?? "",
      ),
      status: String(json.delivery_status ?? json.status ?? "accepted"),
      trackingUrl:
        typeof json.tracking_url === "string" ? json.tracking_url : undefined,
      courierName: courier.name ?? courier.first_name,
      courierPhone: courier.phone_number,
      etaMinutes:
        typeof json.estimated_delivery_time === "string"
          ? Math.max(
              5,
              Math.round(
                (new Date(json.estimated_delivery_time).getTime() - Date.now()) /
                  60_000,
              ),
            )
          : undefined,
      raw: json,
    };
  }

  async status(deliveryId: string): Promise<ProviderStatus> {
    const db = this.db ?? (await getDb());
    const json = await api(db, `/deliveries/${encodeURIComponent(deliveryId)}`, {
      method: "GET",
    });
    return {
      status: String(json.delivery_status ?? json.status ?? "unknown"),
      trackingUrl:
        typeof json.tracking_url === "string" ? json.tracking_url : undefined,
      raw: json,
    };
  }
}
