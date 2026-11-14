import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { getSettings, setSetting, settingValue } from "@/lib/settings";
import {
  CONFIG_ENV_KEYS,
  CONFIG_FIELDS,
  checkWhatsAppConnection,
  credentialMode,
  discoverWhatsAppCatalog,
  maskSecret,
  whatsappConfig,
} from "@/lib/whatsapp/client";
import { zoneSummary } from "@/lib/delivery/zones";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Server-side integration diagnostics.
 *
 * The failure this exists for: every WhatsApp send returned Meta error 190
 * ("Authentication Error") while the portal showed a green "configured" tick.
 * Two things caused it — a token that had expired, and a hidden `sensitive`
 * variable in Vercel that took precedence over the token saved in the settings
 * table, so "update the token in the portal" changed nothing.
 *
 * Rules this endpoint keeps:
 *   - server-side only, staff session required (admin/manager)
 *   - secrets are masked to their last four characters, never returned whole
 *   - nothing is written unless `action = "set-credential-mode"`
 *   - it reads Supabase as the source of truth for business config
 */
export async function GET(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  const url = new URL(request.url);
  const probe = url.searchParams.get("probe") === "1";
  const findCatalog = url.searchParams.get("catalog") === "1";
  const config = await whatsappConfig();
  const settings = await getSettings();
  const db = await getDb();

  const credentials = CONFIG_FIELDS.map((field) => {
    const value = config[field];
    return {
      field,
      envKey: CONFIG_ENV_KEYS[field],
      source: config.sources[field],
      // Everything except the token is safe to show; numbers and ids are not
      // secrets in this app (they are printed on Meta's own dashboard).
      value:
        field === "accessToken" || field === "appSecret"
          ? maskSecret(value)
          : value,
      shadowed: config.shadowed.includes(field),
    };
  });

  const zones = await zoneSummary(db);
  const lastFailure = await db.maybeOne<{
    created_at: string;
    body: string | null;
    error: string | null;
    kind: string;
    status: string;
  }>(
    `SELECT created_at::text, body, error, kind, status
       FROM whatsapp_messages
      WHERE direction = 'outbound' AND status = 'failed'
      ORDER BY id DESC LIMIT 1`,
  );

  // Only probe Meta when asked: a live check costs a Graph call and should not
  // run every time somebody opens a page.
  const connection = probe ? await checkWhatsAppConnection() : null;
  const catalog = findCatalog ? await discoverWhatsAppCatalog() : null;

  const problems: string[] = [];
  if (!config.configured) {
    problems.push(
      "No phone number id or access token resolved — the channel is in sandbox mode.",
    );
  }
  if (config.mixedSources) {
    problems.push(
      "Credentials are split between Vercel environment variables and the settings table. A stale variable in Vercel wins, so updating the portal token appears to do nothing. Set the credential source to “Admin portal” below, or delete the WHATSAPP_* variables in Vercel.",
    );
  }
  if (config.shadowed.length > 0) {
    problems.push(
      `These portal values are currently overridden by a Vercel variable: ${config.shadowed
        .map((field) => CONFIG_ENV_KEYS[field])
        .join(", ")}.`,
    );
  }
  if (!config.catalogId) {
    problems.push(
      "No WhatsApp catalogue id — dishes cannot be published to the catalogue yet (menu ordering in chat still works). Use “Find my catalog” to read it from Meta.",
    );
  }
  if (connection && !connection.ok) {
    problems.push(
      `Meta rejected the credentials: ${connection.error}${connection.hint ? ` — ${connection.hint}` : ""}`,
    );
  }
  if (lastFailure && /authentication/i.test(lastFailure.error ?? "")) {
    problems.push(
      `The last outbound message failed with "${lastFailure.error}". Meta error 190 means the access token itself is rejected: it has expired, been rotated, or belongs to a different app. A permanent System User token is the fix.`,
    );
  }

  return NextResponse.json({
    ok: problems.length === 0,
    checkedAt: new Date().toISOString(),
    whatsapp: {
      enabled: config.enabled,
      configured: config.configured,
      mode: config.mode,
      credentialMode: config.credentialMode,
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      catalogId: config.catalogId || null,
      counterNumber: config.counterNumber,
      displayNumber: config.displayNumber,
      mixedSources: config.mixedSources,
      shadowed: config.shadowed,
    },
    credentials,
    lastFailure,
    connection,
    catalog,
    deliveryZones: {
      count: zones.zones.length,
      postcodes: zones.postcodes,
      names: zones.zones.map((zone) => zone.name),
      rates: zones.zones.map((zone) => ({
        name: zone.name,
        postcodes: zone.area,
        baseFee: zone.base_fee_cents / 100,
        perKm: zone.per_km_cents / 100,
        minOrder: zone.min_order_cents / 100,
        freeOver: zone.free_over_cents / 100 || null,
      })),
    },
    social: {
      facebookPageId: settingValue(settings, "community_facebook_page_id", "") || null,
      facebookToken: maskSecret(
        process.env.FACEBOOK_PAGE_ACCESS_TOKEN ||
          settingValue(settings, "community_facebook_access_token", ""),
      ),
      instagramAccountId:
        process.env.INSTAGRAM_ACCOUNT_ID ||
        settingValue(settings, "instagram_account_id", "") ||
        null,
      instagramToken: maskSecret(
        process.env.INSTAGRAM_ACCESS_TOKEN ||
          settingValue(settings, "instagram_access_token", ""),
      ),
    },
    problems,
  });
}

/**
 * Flip which source wins for the WhatsApp credentials. One setting, no secret
 * in the request: the values themselves stay in Vercel or in Supabase.
 */
export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  let body: { action?: string; mode?: string; catalogId?: string };
  try {
    body = (await request.json()) as { action?: string; mode?: string; catalogId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (body.action === "set-credential-mode") {
    const mode = credentialMode(body.mode ?? "");
    if (body.mode && !["auto", "env", "settings"].includes(body.mode)) {
      return NextResponse.json({ error: "Unknown credential mode" }, { status: 400 });
    }
    await setSetting("whatsapp_credential_mode", mode);
    const config = await whatsappConfig();
    return NextResponse.json({
      ok: true,
      credentialMode: mode,
      configured: config.configured,
      mode: config.mode,
      message:
        mode === "settings"
          ? "The token saved in Admin → WhatsApp Business now wins over Vercel's variables."
          : mode === "env"
            ? "Vercel's environment variables now win over the values saved in the portal."
            : "Automatic: a Vercel variable wins when one is set, otherwise the portal value is used.",
    });
  }

  if (body.action === "set-catalog-id") {
    const catalogId = (body.catalogId ?? "").replace(/[^0-9]/g, "");
    if (!catalogId) {
      return NextResponse.json({ error: "A numeric catalog id is required" }, { status: 400 });
    }
    await setSetting("whatsapp_catalog_id", catalogId);
    const config = await whatsappConfig();
    return NextResponse.json({
      ok: true,
      catalogId,
      message: `Catalogue id ${catalogId} saved. Dishes can now be published to the WhatsApp catalogue.`,
      configured: config.configured,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
