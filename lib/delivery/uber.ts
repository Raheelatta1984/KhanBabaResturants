import type {
  DeliveryProvider,
  DispatchRequest,
  DispatchResult,
  ProviderQuote,
  ProviderStatus,
  QuoteRequest,
} from "./types";
import { getSetting } from "../settings";
import { getSettingNumber } from "../settings";

const AUTH_URL = process.env.UBER_AUTH_URL || "https://login.uber.com/oauth/v2/token";
const API_URL = process.env.UBER_API_URL || "https://api.uber.com/v1";

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

function credentials() {
  return {
    clientId: process.env.UBER_DIRECT_CLIENT_ID || getSetting("uber_client_id"),
    clientSecret: process.env.UBER_DIRECT_CLIENT_SECRET || getSetting("uber_client_secret"),
    customerId: process.env.UBER_DIRECT_CUSTOMER_ID || getSetting("uber_customer_id"),
  };
}

export function uberConfigured(): boolean {
  const { clientId, clientSecret, customerId } = credentials();
  return Boolean(clientId && clientSecret && customerId);
}

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const { clientId, clientSecret } = credentials();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "direct.organizations",
  });
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Uber auth failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

function addressBlock(street: string, suburb?: string, postcode?: string) {
  return JSON.stringify({
    street_address: [street],
    city: suburb || getSetting("restaurant_suburb", "Sydney"),
    state: getSetting("restaurant_state", "NSW"),
    zip_code: postcode || getSetting("restaurant_postcode", "2000"),
    country: getSetting("restaurant_country", "AU"),
  });
}

async function api(path: string, init: RequestInit = {}) {
  const token = await accessToken();
  const { customerId } = credentials();
  const res = await fetch(`${API_URL}/customers/${customerId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
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
    const message = (json as { message?: string } | null)?.message ?? `Uber Direct error ${res.status}`;
    throw new Error(message);
  }
  return json as Record<string, unknown>;
}

/**
 * Uber Direct integration (quote → dispatch → track).
 * Docs: https://developer.uber.com/docs/deliveries/guides/direct
 * Credentials can come from env vars or from Admin → Delivery settings.
 */
export class UberDirectProvider implements DeliveryProvider {
  name = "uber_direct";
  live = true;

  async quote(request: QuoteRequest): Promise<ProviderQuote> {
    const lead = getSettingNumber("delivery_prep_lead_minutes", 15);
    const readyAt = new Date(Date.now() + lead * 60_000);
    const deadline = new Date(readyAt.getTime() + 45 * 60_000);
    const json = await api("/delivery_quotes", {
      method: "POST",
      body: JSON.stringify({
        pickup_address: addressBlock(
          getSetting("restaurant_address", "379 Pitt Street"),
          getSetting("restaurant_suburb", "Sydney"),
          getSetting("restaurant_postcode", "2000"),
        ),
        dropoff_address: addressBlock(
          request.dropoffAddress,
          request.dropoffSuburb,
          request.dropoffPostcode,
        ),
        pickup_ready_dt: readyAt.toISOString(),
        pickup_deadline_dt: deadline.toISOString(),
        dropoff_ready_dt: readyAt.toISOString(),
        dropoff_deadline_dt: deadline.toISOString(),
        external_store_id: process.env.UBER_STORE_ID || "khan-baba-sydney",
      }),
    });

    const feeCents = Number(json.fee ?? 0);
    if (!feeCents) throw new Error("Uber Direct returned a quote without a fee");
    const expiresAt =
      typeof json.expires === "string" ? json.expires : new Date(Date.now() + 5 * 60_000).toISOString();

    return {
      provider: this.name,
      quoteId: String(json.id ?? json.quote_id ?? ""),
      feeCents,
      etaMinutes: Number(json.dropoff_eta_seconds ? Math.round(Number(json.dropoff_eta_seconds) / 60) : 35),
      expiresAt,
      live: true,
      raw: json,
    };
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const json = await api("/deliveries", {
      method: "POST",
      body: JSON.stringify({
        quote_id: request.quoteId,
        external_id: request.orderCode,
        pickup_name: getSetting("restaurant_name", "Khan Baba Restaurant"),
        pickup_address: addressBlock(
          getSetting("restaurant_address", "379 Pitt Street"),
          getSetting("restaurant_suburb", "Sydney"),
          getSetting("restaurant_postcode", "2000"),
        ),
        pickup_phone_number: getSetting("restaurant_phone", "0290001234").replace(/\s/g, ""),
        pickup_notes: getSetting("uber_pickup_notes"),
        dropoff_name: request.customerName,
        dropoff_address: addressBlock(request.dropoffAddress, request.dropoffSuburb, request.dropoffPostcode),
        dropoff_phone_number: (request.phone || "").replace(/\s/g, ""),
        dropoff_notes: request.dropoffNotes,
        manifest_items: request.manifest.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          size: "medium",
        })),
        manifest_total_value: 0,
        deliverable_action: "deliverable_action_meet_at_door",
      }),
    });

    const courier = (json.courier ?? {}) as { name?: string; phone_number?: string };
    return {
      provider: this.name,
      deliveryId: String(json.id ?? ""),
      status: String(json.status ?? "accepted"),
      trackingUrl: typeof json.tracking_url === "string" ? json.tracking_url : undefined,
      courierName: courier.name,
      courierPhone: courier.phone_number,
      raw: json,
    };
  }

  async status(deliveryId: string): Promise<ProviderStatus> {
    const json = await api(`/deliveries/${deliveryId}`, { method: "GET" });
    const courier = (json.courier ?? {}) as { name?: string; phone_number?: string };
    return {
      status: String(json.status ?? "unknown"),
      trackingUrl: typeof json.tracking_url === "string" ? json.tracking_url : undefined,
      courierName: courier.name,
      courierPhone: courier.phone_number,
      raw: json,
    };
  }
}
