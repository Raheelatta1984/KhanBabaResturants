import { getDb, type Db } from "./db";

export const DEFAULT_SETTINGS: Record<string, string> = {
  restaurant_name: "Khan Baba Restaurant",
  restaurant_tagline: "Pakistani Cuisine — Same taste from Lahore to Sydney",
  restaurant_phone: "02 9000 1234",
  restaurant_email: "hello@khanbabarestaurant.com.au",
  restaurant_address: "Shop 4, 379 Pitt Street, Sydney NSW 2000",
  restaurant_suburb: "Sydney",
  restaurant_postcode: "2000",
  restaurant_state: "NSW",
  restaurant_country: "AU",
  restaurant_lat: "-33.8688",
  restaurant_lng: "151.2093",
  restaurant_hours:
    "Mon–Thu 11:00–22:00 · Fri–Sat 11:00–23:00 · Sun 11:00–22:00",
  timezone: "Australia/Sydney",

  // Delivery pricing (we quote Uber Direct live, then apply a service margin)
  delivery_provider: "auto", // auto | uber | simulated
  delivery_markup_percent: "15",
  delivery_markup_min_cents: "100",
  delivery_rounding_cents: "50",
  delivery_max_fee_cents: "2500",
  delivery_min_order_cents: "2500",
  delivery_free_over_cents: "0",
  delivery_radius_km: "12",
  delivery_prep_lead_minutes: "15",
  show_delivery_breakdown: "1",
  uber_pickup_notes: "Pick up from the counter, ask for the Khan Baba order.",
  uber_webhook_secret: "",
  uber_client_id: "",
  uber_client_secret: "",
  uber_customer_id: "",

  // Payments
  payment_provider: "simulated", // simulated | stripe
  stripe_secret_key: "",
  stripe_webhook_secret: "",
  gst_percent: "10",

  // Ordering
  min_order_cents: "0",
  pickup_lead_minutes: "20",
  table_ordering_enabled: "1",
  online_payment_enabled: "1",
  pay_at_counter_enabled: "1",
  reviews_require_approval: "1",
  priority_base_fee_cents: "250",

  // Media
  media_driver: "auto", // auto | blob | gdrive | local
  gdrive_folder_id: "",
};

/**
 * Number of database round trips matters on a serverless platform, so a request
 * caches the whole settings table once and reads from memory after that.
 *
 * `getSettingsCached()` is the request-scoped accessor used by the UI; the
 * `getSetting(key)` helpers fall back to a query whenever nothing was loaded.
 */
const cache = new WeakMap<Db, Record<string, string>>();

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const db = await getDb();
  const row = await db.maybeOne<{ value: string }>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return row?.value ?? DEFAULT_SETTINGS[key] ?? fallback;
}

export async function getSettingNumber(
  key: string,
  fallback = 0,
): Promise<number> {
  const value = Number.parseFloat(await getSetting(key, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

export async function getSettings(): Promise<Record<string, string>> {
  const db = await getDb();
  const cached = cache.get(db);
  if (cached) return cached;
  const rows = await db.query<{ key: string; value: string }>(
    "SELECT key, value FROM settings",
  );
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  cache.set(db, out);
  return out;
}

/** Read a setting from an already-loaded settings object (no query). */
export function settingValue(
  settings: Record<string, string>,
  key: string,
  fallback = "",
): string {
  return settings[key] ?? DEFAULT_SETTINGS[key] ?? fallback;
}

export function settingNumber(
  settings: Record<string, string>,
  key: string,
  fallback = 0,
): number {
  const value = Number.parseFloat(
    settingValue(settings, key, String(fallback)),
  );
  return Number.isFinite(value) ? value : fallback;
}

export async function setSetting(
  key: string,
  value: string,
  db?: Db,
): Promise<void> {
  const handle = db ?? (await getDb());
  await handle.query(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
  cache.delete(handle);
}

export async function setSettings(
  entries: Record<string, string>,
  db?: Db,
): Promise<void> {
  const handle = db ?? (await getDb());
  const rows = Object.entries(entries);
  if (rows.length === 0) return;
  await handle.transaction(async (tx) => {
    for (const [key, value] of rows) {
      await tx.query(
        "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [key, value],
      );
    }
  });
  cache.delete(handle);
}
