import { cache as reactCache } from "react";
import { getDb, type Db } from "./db";

/** The exact automatic Facebook comment requested for the first claim. */
export const DEFAULT_COMMUNITY_AUTO_REPLY = "thank you we have got it booked";

export const DEFAULT_SETTINGS: Record<string, string> = {
  restaurant_name: "Khan Baba Restaurant",
  restaurant_tagline: "Pakistani Cuisine — Same taste from Lahore to Sydney",
  // The kitchen is in Whalan, Western Sydney. It was previously seeded as
  // Pitt Street in the CBD, which put every delivery estimate 39 km east of
  // the actual fryer.
  restaurant_phone: "0461 382 923",
  restaurant_email: "hello@khanbabarestaurant.com.au",
  restaurant_address: "1/53 Bulolo Dr, Whalan NSW 2770",
  restaurant_suburb: "Whalan",
  restaurant_postcode: "2770",
  restaurant_state: "NSW",
  restaurant_country: "AU",
  restaurant_lat: "-33.757",
  restaurant_lng: "150.804",
  restaurant_hours:
    "Mon–Thu 11:00–22:00 · Fri–Sat 11:00–23:00 · Sun 11:00–22:00",
  timezone: "Australia/Sydney",

  // Delivery pricing (we quote the courier partners live, then apply a margin)
  // auto = cheapest live quote across every configured partner, plus our own
  // verified drivers. Individual providers can be forced for troubleshooting.
  delivery_provider: "auto", // auto | uber | doordash | own_fleet | simulated
  delivery_quote_strategy: "cheapest", // cheapest | fastest
  delivery_markup_percent: "15",
  delivery_markup_min_cents: "100",
  delivery_rounding_cents: "50",
  delivery_max_fee_cents: "2500",
  delivery_min_order_cents: "2500",
  delivery_free_over_cents: "0",
  delivery_radius_km: "12",
  // 0 = a postcode missing from the zone list is priced on the standard rate
  // (safe while zones are being filled in). 1 = only published zones are
  // served, and every other postcode is refused with a readable reason.
  delivery_zones_strict: "0",
  delivery_prep_lead_minutes: "15",
  show_delivery_breakdown: "1",
  uber_pickup_notes: "Pick up from the counter, ask for the Khan Baba order.",
  uber_webhook_secret: "",
  uber_client_id: "",
  uber_client_secret: "",
  uber_customer_id: "",

  // DoorDash Drive (second delivery partner; credentials are env-first)
  doordash_developer_id: "",
  doordash_key_id: "",
  doordash_signing_secret: "",
  doordash_store_id: "khan-baba-sydney",
  doordash_webhook_secret: "",

  // Our own verified driver fleet
  own_fleet_enabled: "1",
  own_fleet_base_fee_cents: "349",
  own_fleet_per_km_cents: "185",
  driver_commission_percent: "15",
  driver_base_fee_cents: "300",
  driver_tracking_interval_seconds: "15",
  ato_cents_per_km_current: "91", // ATO 2026-27 determination (91c; 88c for 2025-26)
  map_tile_provider: "osm", // osm | none — none keeps the map fully offline
  driver_onboarding_enabled: "1",

  // Payments — card brands, buy-now-pay-later and wallets are all opt-in.
  payment_provider: "simulated", // simulated | stripe | auto
  payment_methods: "card_visa,card_mastercard,card_amex,afterpay,paypal", // CSV, see PAYMENT_OPTIONS
  stripe_secret_key: "",
  stripe_webhook_secret: "",
  paypal_client_id: "",
  paypal_client_secret: "",
  paypal_mode: "sandbox", // sandbox | live
  paypal_webhook_id: "",
  gst_percent: "10",

  // Square POS bridge — detached synchronisation, never a dependency of orders.
  square_enabled: "1",
  square_environment: "sandbox", // sandbox | production
  square_access_token: "",
  square_location_id: "",
  square_webhook_signature_key: "",
  square_sync_catalog: "0",

  // Promotions
  promotions_enabled: "1",

  // Returns → community in need (Facebook post, first comment wins).
  community_enabled: "1",
  community_claim_keyword: "MINE",
  community_auto_reply: DEFAULT_COMMUNITY_AUTO_REPLY,
  community_facebook_page_id: "",
  community_facebook_access_token: "",
  community_facebook_app_secret: "",
  community_facebook_verify_token: "",
  community_pickup_hours: "Today, 5:00pm – 9:00pm",

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

  // ---------------------------------------------------------------------------
  // WhatsApp Business commerce
  // ---------------------------------------------------------------------------
  // Publish the menu to the WhatsApp catalogue and take orders in the chat.
  // With no credentials the whole channel runs in a clearly-labelled sandbox
  // that logs every message to whatsapp_messages instead of calling Meta.
  whatsapp_enabled: "1",
  // Which source wins for the credentials below. `auto` = a Vercel environment
  // variable beats the portal value (the historical behaviour); `settings` =
  // the portal value wins. A stale token in Vercel used to shadow a good one in
  // the database and present only as Meta error 190.
  whatsapp_credential_mode: "auto", // auto | env | settings
  // Which environment *alias* to read when the credential source resolves to a
  // Vercel variable. Two aliases exist because a token rotation used to mean
  // editing the one variable the app reads, mid-deploy, with no way to test the
  // new token without breaking the live one. `primary` = WHATSAPP_ACCESS_TOKEN,
  // `new` = WHATSAPP_ACCESS_TOKEN_NEW. Switching is a setting, not a deploy.
  whatsapp_env_alias: "primary", // primary | new
  // Set by the "Test credentials" button once a token has been proven to work:
  // the value is `<alias>:<last four>`. It lets the portal say "the token in
  // Vercel's WHATSAPP_ACCESS_TOKEN_NEW (••••ab12) has never been tested" instead
  // of making you guess which of two tokens Meta is currently rejecting.
  whatsapp_verified_token: "",
  whatsapp_verified_at: "",
  whatsapp_phone_number_id: "",
  whatsapp_business_account_id: "",
  whatsapp_access_token: "",
  whatsapp_catalog_id: "",
  whatsapp_verify_token: "",
  whatsapp_app_secret: "",
  whatsapp_counter_number: "0461 382 923", // staff number that receives new orders
  whatsapp_display_number: "+61410913853", // the public business number shown to customers
  whatsapp_currency: "AUD",
  whatsapp_publish_enabled: "1",
  whatsapp_notify_customer: "1",
  whatsapp_order_greeting:
    "Assalam-o-Alaikum from Khan Baba! Reply MENU to see today's dishes, or send your order like “2 chicken biryani and 1 garlic naan”.",
  whatsapp_payment_message:
    "Your Khan Baba order is ready for payment. Tap the button to pay securely — the counter will send it to the kitchen the moment payment clears.",
  whatsapp_auto_confirm_paid: "0", // 1 = send straight to the kitchen once paid
  // Marketing channels. Email magic links need an absolute URL, so the public
  // base is configuration, not a guess: it is resolved from PUBLIC_BASE_URL,
  // then Vercel's own production URL, then the request host.
  instagram_enabled: "1",
  social_daily_post_enabled: "1",
  broadcast_optin_required: "1",

  // Central inventory. Stock counts are optional per dish; a tracked dish goes
  // unavailable (and is unpublished from WhatsApp) at zero.
  inventory_track_enabled: "1",
  inventory_decrement_on: "confirm", // confirm | paid

  // ---------------------------------------------------------------------------
  // Dine-in / table settlement — payment is only taken at the counter, after
  // the meal. Counter staff park the ticket until the guest settles.
  // ---------------------------------------------------------------------------
  dine_in_pay_at_counter_only: "1",
  table_park_on_ready: "0", // 1 = park automatically when the kitchen bumps
  feedback_auto_on_table_settle: "1",

  // ---------------------------------------------------------------------------
  // Guest feedback → Google review drafts
  // ---------------------------------------------------------------------------
  feedback_enabled: "1",
  feedback_google_url: "https://search.google.com/local/writereview?placeid=",
  feedback_google_place_id: "",
  feedback_google_location_id: "", // Business Profile location, for reply API
  feedback_google_access_token: "",
  feedback_min_rating_to_publish: "4",
  feedback_bill_range_percent: "10",

  // ---------------------------------------------------------------------------
  // Lahore cultural theme + music system
  // ---------------------------------------------------------------------------
  theme_lahore: "1",            // warm Lahore truck-art palette and motifs
  music_enabled: "1",
  music_default_volume: "20",   // deliberately low — ambience, not a concert
  music_customer_default_muted: "0",
  music_encouragement_enabled: "1",
  music_encouragement_track_id: "",
  music_now_playing_note:
    "Lahore in the room — qawwali, ghazals and Punjabi folk, kept low so the table can talk.",
  music_request_enabled: "1",
  music_request_requires_approval: "1",
  music_request_base_charge_cents: "500",
  music_request_peak_charge_cents: "800",
  music_request_peak_start: "18:00",
  music_request_peak_end: "21:30",
  music_request_free_allowed: "1", // staff may waive the charge entirely
  music_request_max_minutes: "15", // how long an approved on-demand song may run
  music_pause_during_religious: "1", // never play music over a recitation
};

/**
 * Number of database round trips matters on a serverless platform, so the whole
 * settings table is read once and reused — but only briefly.
 *
 * It used to be reused for as long as the process lived, and dropped only by a
 * write made in the same process. On a serverless host that is not one
 * process: the function that saves a setting and the function that renders the
 * page showing it are separate, each with its own copy. The save cleared one
 * copy; the page kept serving the other until its instance was recycled. A
 * change made in the portal could appear not to have been made.
 *
 * Now:
 *   - a page render reads the table once per request, always from the
 *     database, so the screen you return to after saving shows what you saved;
 *   - everything else (API handlers, webhooks, scripts) may reuse a copy for
 *     at most SETTINGS_TTL_MS, and a write in the same process drops it at once.
 */
export const SETTINGS_TTL_MS = 2000;

type CacheEntry = { at: number; values: Promise<Record<string, string>> };
const cache = new WeakMap<Db, CacheEntry>();

/**
 * One object per React server render; a new throwaway object on every call
 * anywhere else. That difference is how a render is recognised.
 */
const requestScope = reactCache((): { settings?: Promise<Record<string, string>> } => ({}));

async function loadSettings(db: Db): Promise<Record<string, string>> {
  const rows = await db.query<{ key: string; value: string }>(
    "SELECT key, value FROM settings",
  );
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

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

/**
 * Settings that never touch the database.
 *
 * The root layout only needs the restaurant's name/address/phone for the header
 * and footer. Asking the database for them meant that a missing or unreachable
 * `DATABASE_URL` took the entire site down with an opaque "server-side
 * exception" — including the pages that would have explained the problem. The
 * layout now renders from these defaults and the pages themselves report the
 * database state.
 */
export const BRAND_SETTINGS: Record<string, string> = {
  restaurant_name: DEFAULT_SETTINGS.restaurant_name,
  restaurant_address: DEFAULT_SETTINGS.restaurant_address,
  restaurant_phone: DEFAULT_SETTINGS.restaurant_phone,
  restaurant_email: DEFAULT_SETTINGS.restaurant_email,
  restaurant_hours: DEFAULT_SETTINGS.restaurant_hours,
};

export async function getSettings(): Promise<Record<string, string>> {
  const db = await getDb();

  // Rendering a page: once per request, never from an earlier request.
  const scope = requestScope();
  if (scope === requestScope()) {
    scope.settings ??= loadSettings(db);
    return scope.settings;
  }

  const entry = cache.get(db);
  if (entry && Date.now() - entry.at < SETTINGS_TTL_MS) return entry.values;

  const values = loadSettings(db);
  cache.set(db, { at: Date.now(), values });
  // A failed read must not be served again as if it were the settings.
  values.catch(() => {
    if (cache.get(db)?.values === values) cache.delete(db);
  });
  return values;
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

/** Remove a key, so the default in DEFAULT_SETTINGS applies again. */
export async function deleteSetting(key: string, db?: Db): Promise<void> {
  const handle = db ?? (await getDb());
  await handle.query("DELETE FROM settings WHERE key = $1", [key]);
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
