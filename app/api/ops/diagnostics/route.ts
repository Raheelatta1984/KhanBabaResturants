import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import { deleteSetting, getSettings, setSetting, settingValue } from "@/lib/settings";
import {
  CONFIG_ENV_KEYS,
  CONFIG_FIELDS,
  TOKEN_ALIASES,
  checkWhatsAppConnection,
  createWhatsAppCatalog,
  credentialMode,
  discoverWhatsAppCatalog,
  maskSecret,
  probeWhatsAppCredentials,
  resolveTokenAlias,
  tokenFingerprint,
  whatsappConfig,
  type CredentialProbe,
} from "@/lib/whatsapp/client";
import { zoneSummary } from "@/lib/delivery/zones";
import { withActionLog } from "@/lib/ops/actions";

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
  const probeTokens = url.searchParams.get("tokens") === "1";
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
  // The probe carries each candidate's raw token so the POST handler can
  // fingerprint the winner. Strip it here: the browser gets the mask only.
  const tokens: CredentialProbe | null = probeTokens
    ? redactProbe(await probeWhatsAppCredentials())
    : null;

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
      businessId: config.businessId || null,
      tokenAlias: config.tokenAlias,
      tokenEnvKey: config.tokenEnvKey,
      fieldSources: config.fieldSources,
      tokenVerified: config.tokenVerified,
      verifiedToken: config.verifiedToken,
      verifiedAt: config.verifiedAt,
      counterNumber: config.counterNumber,
      displayNumber: config.displayNumber,
      mixedSources: config.mixedSources,
      shadowed: config.shadowed,
    },
    credentials,
    lastFailure,
    connection,
    catalog,
    tokens,
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
async function post(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  let body: {
    action?: string;
    mode?: string;
    catalogId?: string;
    alias?: string;
    field?: string;
    value?: string;
    name?: string;
  };
  try {
    body = (await request.json()) as typeof body;
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

  if (body.action === "set-token-alias") {
    const alias = resolveTokenAlias(body.alias ?? "");
    if (body.alias && !["primary", "new"].includes(body.alias)) {
      return NextResponse.json({ error: "Unknown token alias" }, { status: 400 });
    }
    await setSetting("whatsapp_env_alias", alias);
    const config = await whatsappConfig();
    return NextResponse.json({
      ok: true,
      tokenAlias: alias,
      tokenEnvKey: TOKEN_ALIASES[alias],
      configured: config.configured,
      message: `Tokens are now read from ${TOKEN_ALIASES[alias]}.${
        alias === "new" ? " Keep the old variable for one deploy so a bad rotation is a one-click rollback." : ""
      }`,
    });
  }

  // Per-field override of the global credential mode: "take the catalog id from
  // Vercel but the token from the portal" is a real and reasonable setup.
  if (body.action === "set-field-source") {
    const field = body.field ?? "";
    if (!(CONFIG_FIELDS as readonly string[]).includes(field)) {
      return NextResponse.json({ error: "Unknown credential field" }, { status: 400 });
    }
    const raw = body.value ?? "auto";
    if (!["auto", "env", "settings"].includes(raw)) {
      return NextResponse.json({ error: "Unknown credential source" }, { status: 400 });
    }
    if (raw === "auto") await deleteSetting(`whatsapp_source_${field}`);
    else await setSetting(`whatsapp_source_${field}`, raw);
    const config = await whatsappConfig();
    return NextResponse.json({
      ok: true,
      field,
      source: raw,
      resolved: config.sources[field as keyof typeof config.sources],
      message:
        raw === "auto"
          ? `${CONFIG_ENV_KEYS[field as keyof typeof CONFIG_ENV_KEYS]} follows the global credential source again.`
          : `${CONFIG_ENV_KEYS[field as keyof typeof CONFIG_ENV_KEYS]} is now read from ${raw === "env" ? "Vercel" : "the admin portal"}.`,
    });
  }

  // Prove which token Meta accepts, and record the winner so the portal can show
  // a tick instead of leaving the owner to guess between two variables.
  if (body.action === "probe-tokens") {
    const probe = await probeWhatsAppCredentials();
    if (probe.winner) {
      const config = await whatsappConfig();
      // Use the token the candidate was built from, never `config.accessToken`:
      // if the winner came from the portal then config.accessToken is already
      // that value, but if it came from Vercel it is a *different* token, and
      // fingerprinting the wrong one would record proof for a token we are not
      // sending with — the exact tick-on-a-broken-token the portal must not show.
      const fingerprint = tokenFingerprint(
        probe.winner.alias ?? "primary",
        probe.winner.token,
      );
      // Only record the proof for the token that is actually in use — a tick
      // against a token we are not sending with would be a lie.
      const inUse =
        config.sources.accessToken === probe.winner.origin &&
        (probe.winner.origin === "settings" || config.tokenAlias === probe.winner.alias);
      if (inUse && fingerprint) {
        await setSetting("whatsapp_verified_token", fingerprint);
        await setSetting("whatsapp_verified_at", new Date().toISOString());
      }
    }
    return NextResponse.json({ ok: true, probe: redactProbe(probe) });
  }

  // Create the catalogue instead of sending the owner hunting for a Content ID.
  if (body.action === "create-catalog") {
    const result = await createWhatsAppCatalog(body.name);
    if (!result.ok || !result.catalogId) {
      return NextResponse.json({ ok: false, error: result.error, hint: result.hint, steps: result.steps }, { status: 400 });
    }
    await setSetting("whatsapp_catalog_id", result.catalogId);
    return NextResponse.json({
      ok: true,
      catalogId: result.catalogId,
      connected: result.connected,
      steps: result.steps,
      message: `Catalogue ${result.catalogId} is saved and ready for publishing.`,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/**
 * Drop the raw token from every attempt. The mask is all the portal needs, and
 * a secret that never leaves the server cannot leak through a screenshot, a
 * browser devtools panel or a support ticket.
 */
function redactProbe(probe: CredentialProbe): CredentialProbe {
  return {
    ...probe,
    attempts: probe.attempts.map(({ token: _token, ...rest }) => rest) as CredentialProbe["attempts"],
    winner: probe.winner
      ? (() => {
          const { token: _token, ...rest } = probe.winner;
          return rest as CredentialProbe["attempts"][number];
        })()
      : null,
  };
}

/** Every call is written to the action log: who, what, the outcome, what to do next. */
export const POST = withActionLog("diagnostics", post);
