import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "../db";
import { getSettings, settingValue } from "../settings";

/**
 * WhatsApp Business Cloud API client.
 *
 * One module owns the boundary: configuration, the two send shapes we use
 * (plain text and a call-to-action link button), template sends, webhook
 * signature verification and the audit log. Every message — sent or received —
 * is written to `whatsapp_messages`, so the counter sees exactly what the
 * customer saw even in sandbox mode.
 *
 * With no credentials the channel is *sandbox*: nothing leaves the building,
 * each outbound message is logged with `status = 'logged'`, and the portal
 * labels it clearly. That keeps the ordering flow demonstrable without a Meta
 * app, exactly like the payment and courier sandboxes elsewhere in the app.
 */

export type WhatsAppConfig = {
  enabled: boolean;
  configured: boolean;
  phoneNumberId: string;
  businessAccountId: string;
  /**
   * The Meta business portfolio id (Business settings → Business info → ID).
   * Distinct from the WABA id: catalogues are owned by the portfolio, messages
   * belong to the WABA. Needed only to create a catalogue via the API.
   */
  businessId: string;
  accessToken: string;
  catalogId: string;
  verifyToken: string;
  appSecret: string;
  counterNumber: string;
  displayNumber: string;
  currency: string;
  mode: "live" | "sandbox";
  /**
   * Where each value came from: a host environment variable (Vercel → Settings
   * → Environment Variables), the settings table (Admin → WhatsApp Business),
   * or nowhere. The go-live checklist in the portal is built from this, so a
   * half-configured deployment says exactly what is missing instead of guessing.
   */
  sources: Record<ConfigField, "env" | "settings" | "none">;
  /**
   * True when one value comes from Vercel and the other from the settings
   * table — the exact split that produced a dead token nobody could see: the
   * portal showed a green "configured" and Meta answered error 190.
   */
  mixedSources: boolean;
  /** Settings-table values that are overridden by an environment variable. */
  shadowed: ConfigField[];
  /**
   * Which source wins. `auto` = Vercel env first (the historical behaviour),
   * `settings` = the value saved in Admin → WhatsApp Business first. The switch
   * exists because a stale variable in Vercel silently beat a good token saved
   * in the portal, and the only symptom was Meta's "Authentication Error".
   */
  credentialMode: "auto" | "env" | "settings";
  /**
   * Which Vercel variable the token is read from. Two aliases exist because
   * rotating a Meta token used to mean editing the single variable the app
   * reads — with no way to try the new one without breaking the live one, and
   * no way to fall back except another deploy. Switching is a setting now.
   */
  tokenAlias: "primary" | "new";
  /** The environment variable actually read for the token. */
  tokenEnvKey: string;
  /** Per-field overrides of the global mode, e.g. read the catalog id from Vercel. */
  fieldSources: Partial<Record<ConfigField, CredentialMode>>;
  /** True when the resolved token is the one "Test credentials" proved works. */
  tokenVerified: boolean;
  /** `<alias>:<last four>` of the token that was last proven good, if any. */
  verifiedToken: string | null;
  /** When that proof happened, ISO string. */
  verifiedAt: string | null;
};

export type CredentialMode = "auto" | "env" | "settings";

/** The two Vercel variables that can hold a token, in display order. */
export const TOKEN_ALIASES = { primary: "WHATSAPP_ACCESS_TOKEN", new: "WHATSAPP_ACCESS_TOKEN_NEW" } as const;
export type TokenAlias = keyof typeof TOKEN_ALIASES;

export const CONFIG_FIELDS = [
  "phoneNumberId",
  "accessToken",
  "businessAccountId",
  "businessId",
  "catalogId",
  "verifyToken",
  "appSecret",
  "counterNumber",
  "displayNumber",
] as const;

export type ConfigField = (typeof CONFIG_FIELDS)[number];

/** The variable each field is read from, for the go-live checklist. */
export const CONFIG_ENV_KEYS: Record<ConfigField, string> = {
  phoneNumberId: "WHATSAPP_PHONE_NUMBER_ID",
  accessToken: "WHATSAPP_ACCESS_TOKEN",
  businessAccountId: "WHATSAPP_BUSINESS_ACCOUNT_ID",
  businessId: "WHATSAPP_BUSINESS_ID",
  catalogId: "WHATSAPP_CATALOG_ID",
  verifyToken: "WHATSAPP_VERIFY_TOKEN",
  appSecret: "WHATSAPP_APP_SECRET",
  counterNumber: "WHATSAPP_COUNTER_NUMBER",
  displayNumber: "WHATSAPP_DISPLAY_NUMBER",
};

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

/** Normalise the stored credential mode. */
export function credentialMode(value: string): "auto" | "env" | "settings" {
  return value === "settings" || value === "env" ? value : "auto";
}

/** True when the resolved values come from more than one place. */
function hasBothSources(sources: ("env" | "settings" | "none")[]): boolean {
  const used = new Set(sources.filter((source) => source !== "none"));
  return used.size > 1;
}

type Resolved = { value: string; source: "env" | "settings" | "none" };

/**
 * Resolve one credential from the environment or the settings table.
 *
 * `mode` decides the winner. The loser is never thrown away: a settings value
 * that an environment variable overrides is reported as `shadowed` so the
 * portal can say "Vercel is sending a different token than the one saved here"
 * instead of the owner debugging a green tick and a Meta 190.
 */
function resolve(
  envKey: string,
  setting: string,
  mode: "auto" | "env" | "settings" = "auto",
): Resolved & { shadowed: boolean } {
  const fromEnv = (process.env[envKey] ?? "").trim();
  const trimmed = (setting ?? "").trim();
  const preferSettings = mode === "settings";
  const envAllowed = mode !== "settings";

  if (preferSettings && trimmed) {
    return {
      value: trimmed,
      source: "settings",
      shadowed: Boolean(fromEnv) && fromEnv !== trimmed,
    };
  }
  if (envAllowed && fromEnv) {
    return {
      value: fromEnv,
      source: "env",
      shadowed: Boolean(trimmed) && trimmed !== fromEnv,
    };
  }
  if (trimmed) return { value: trimmed, source: "settings", shadowed: false };
  return { value: "", source: "none", shadowed: false };
}

/** Mask a credential for display: never more than the last four characters. */
export function maskSecret(value: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

/**
 * Resolve the channel configuration.
 *
 * Precedence is deliberate and per-field, because one global switch cannot
 * express what actually goes wrong in production. The real incident was a
 * stale `sensitive` Vercel variable silently beating a good token saved in the
 * portal, so the portal said "configured" and Meta answered 190. Now:
 *
 *   - the credential *mode* picks the winner: `env`, `settings`, or `auto`
 *     (auto = Vercel first, the historical behaviour)
 *   - the token has two aliases (`WHATSAPP_ACCESS_TOKEN` / `..._NEW`) chosen by
 *     a setting, so a rotation is a switch rather than a deploy
 *   - any single field may override the global mode, so "read the catalog id
 *     from Vercel but the token from the portal" is expressible
 *   - the loser is never discarded: a portal value beaten by a variable is
 *     reported as `shadowed`, and the portal can say so instead of you
 *     debugging a green tick and a Meta 190.
 */
export async function whatsappConfig(): Promise<WhatsAppConfig> {
  const settings = await getSettings();
  const value = (key: string) => settingValue(settings, key, "");
  const mode = credentialMode(value("whatsapp_credential_mode"));
  const tokenAlias = resolveTokenAlias(value("whatsapp_env_alias"));
  const tokenEnvKey = TOKEN_ALIASES[tokenAlias];

  const fieldSources: Partial<Record<ConfigField, CredentialMode>> = {};
  for (const field of CONFIG_FIELDS) {
    const raw = credentialMode(value(`whatsapp_source_${field}`));
    // A stored "auto" is the default, so only keep a real override.
    if (value(`whatsapp_source_${field}`) && raw !== "auto") fieldSources[field] = raw;
  }

  const pick = (field: ConfigField, envKey: string, setting: string) =>
    resolve(envKey, setting, fieldSources[field] ?? mode);

  const phoneNumberId = pick("phoneNumberId", "WHATSAPP_PHONE_NUMBER_ID", value("whatsapp_phone_number_id"));
  const accessToken = pick("accessToken", tokenEnvKey, value("whatsapp_access_token"));
  const businessAccountId = pick(
    "businessAccountId",
    "WHATSAPP_BUSINESS_ACCOUNT_ID",
    value("whatsapp_business_account_id"),
  );
  const businessId = pick("businessId", "WHATSAPP_BUSINESS_ID", value("whatsapp_business_id"));
  const catalogId = pick("catalogId", "WHATSAPP_CATALOG_ID", value("whatsapp_catalog_id"));
  const verifyToken = pick("verifyToken", "WHATSAPP_VERIFY_TOKEN", value("whatsapp_verify_token"));
  const appSecret = pick("appSecret", "WHATSAPP_APP_SECRET", value("whatsapp_app_secret"));
  const counterNumber = pick("counterNumber", "WHATSAPP_COUNTER_NUMBER", value("whatsapp_counter_number"));
  const displayNumber = pick("displayNumber", "WHATSAPP_DISPLAY_NUMBER", value("whatsapp_display_number"));

  const enabled = value("whatsapp_enabled") !== "0";
  const configured = Boolean(phoneNumberId.value && accessToken.value);
  const verifiedToken = value("whatsapp_verified_token") || null;
  const verifiedAt = value("whatsapp_verified_at") || null;

  return {
    enabled,
    configured,
    phoneNumberId: phoneNumberId.value,
    businessAccountId: businessAccountId.value,
    businessId: businessId.value,
    accessToken: accessToken.value,
    catalogId: catalogId.value,
    verifyToken: verifyToken.value,
    appSecret: appSecret.value,
    counterNumber: counterNumber.value,
    displayNumber: displayNumber.value,
    currency: value("whatsapp_currency") || "AUD",
    mode: configured && enabled ? "live" : "sandbox",
    sources: {
      phoneNumberId: phoneNumberId.source,
      accessToken: accessToken.source,
      businessAccountId: businessAccountId.source,
      businessId: businessId.source,
      catalogId: catalogId.source,
      verifyToken: verifyToken.source,
      appSecret: appSecret.source,
      counterNumber: counterNumber.source,
      displayNumber: displayNumber.source,
    },
    credentialMode: mode,
    tokenAlias,
    tokenEnvKey,
    fieldSources,
    tokenVerified: Boolean(verifiedToken) && verifiedToken === tokenFingerprint(tokenAlias, accessToken.value),
    verifiedToken,
    verifiedAt,
    mixedSources: hasBothSources([
      phoneNumberId.source,
      accessToken.source,
      businessAccountId.source,
      catalogId.source,
    ]),
    shadowed: (
      [
        ["phoneNumberId", phoneNumberId],
        ["accessToken", accessToken],
        ["businessAccountId", businessAccountId],
        ["businessId", businessId],
        ["catalogId", catalogId],
        ["verifyToken", verifyToken],
        ["appSecret", appSecret],
        ["counterNumber", counterNumber],
        ["displayNumber", displayNumber],
      ] as [ConfigField, { shadowed: boolean }][]
    )
      .filter(([, resolved]) => resolved.shadowed)
      .map(([field]) => field),
  };
}

/** Normalise the stored alias. Anything unknown falls back to the primary. */
export function resolveTokenAlias(value: string): TokenAlias {
  return value === "new" ? "new" : "primary";
}

/**
 * `<alias>:<last four>` — identifies a token for the "has this been proven
 * good?" check without storing anything that could be used to send a message.
 * The last four characters are not secret; the rest never leaves Meta.
 */
export function tokenFingerprint(alias: TokenAlias, token: string): string {
  const trimmed = (token ?? "").trim();
  if (!trimmed) return "";
  return `${alias}:${trimmed.slice(-4)}`;
}

/** Digits only, E.164 without the plus — what the Cloud API expects. */
export function normalisePhone(input: string | null | undefined): string {
  return (input ?? "").replace(/[^0-9]/g, "");
}

/** A readable +61 form for the UI. */
export function prettyPhone(waId: string | null | undefined): string {
  const digits = normalisePhone(waId);
  if (!digits) return "";
  if (digits.startsWith("61") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("0")) return `+61${digits.slice(1)}`;
  return `+${digits}`;
}

type LogInput = {
  waId: string;
  direction: "inbound" | "outbound";
  kind?: string;
  body: string;
  status?: string;
  externalId?: string | null;
  orderId?: number | null;
  payload?: unknown;
  error?: string | null;
  conversationId?: number | null;
};

/** Append to the WhatsApp audit trail. Never throws — logging must not break a send. */
export async function logWhatsAppMessage(db: Db, input: LogInput): Promise<void> {
  try {
    await db.query(
      `INSERT INTO whatsapp_messages (direction, wa_id, kind, body, status, external_id,
        order_id, conversation_id, payload, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.direction,
        normalisePhone(input.waId) || input.waId,
        input.kind ?? "text",
        input.body,
        input.status ?? (input.direction === "inbound" ? "received" : "logged"),
        input.externalId ?? null,
        input.orderId ?? null,
        input.conversationId ?? null,
        input.payload === undefined ? null : JSON.stringify(input.payload),
        input.error ?? null,
      ],
    );
  } catch (error) {
    console.error("whatsapp log failed", error);
  }
}

/**
 * Upsert the conversation for a number and return it. Called for every inbound
 * message and before an outbound send, so the portal always has a thread.
 */
export async function touchConversation(
  db: Db,
  waId: string,
  options: { name?: string | null; inbound?: boolean } = {},
): Promise<{ id: number; state: string }> {
  const id = normalisePhone(waId);
  const row = await db.one<{ id: number; state: string }>(
    `INSERT INTO whatsapp_conversations (wa_id, display_name, phone, last_message_at,
        last_inbound_at, created_at)
     VALUES ($1,$2,$3,now(), CASE WHEN $4 THEN now() ELSE NULL END, now())
     ON CONFLICT (wa_id) DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, whatsapp_conversations.display_name),
       last_message_at = now(),
       last_inbound_at = CASE WHEN $4 THEN now() ELSE whatsapp_conversations.last_inbound_at END
     RETURNING id, state`,
    [id, options.name ?? null, prettyPhone(id), Boolean(options.inbound)],
  );
  return row;
}

export type GraphResult = {
  ok: boolean;
  data: Record<string, unknown>;
  error?: string;
  /** Meta's numeric error code — the only reliable way to tell the failures apart. */
  code?: number;
  subcode?: number;
};

type GraphErrorBody = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_user_msg?: string;
  };
};

function graphFailure(data: Record<string, unknown>, status: number): GraphResult {
  const error = (data as GraphErrorBody).error;
  return {
    ok: false,
    data,
    error: error?.error_user_msg || error?.message || `WhatsApp API returned ${status}`,
    code: error?.code,
    subcode: error?.error_subcode,
  };
}

/** The Graph API POST, or null in sandbox mode. */
async function postGraph(
  config: WhatsAppConfig,
  path: string,
  body: unknown,
): Promise<GraphResult> {
  if (!config.configured) return { ok: false, data: {}, error: "not configured" };
  try {
    const response = await fetch(`${GRAPH_BASE}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) return graphFailure(data, response.status);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      data: {},
      error: error instanceof Error ? error.message : "WhatsApp API request failed",
    };
  }
}

/** The Graph API GET — used to prove a token and phone number id actually work. */
async function getGraph(config: WhatsAppConfig, path: string): Promise<GraphResult> {
  if (!config.configured) return { ok: false, data: {}, error: "not configured" };
  try {
    const response = await fetch(`${GRAPH_BASE}/${path}`, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) return graphFailure(data, response.status);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      data: {},
      error: error instanceof Error ? error.message : "WhatsApp API request failed",
    };
  }
}

/**
 * Meta's error codes, translated into the next action a restaurant owner can
 * actually take. Without this a failed test just says "WhatsApp API returned
 * 400" and the cause — usually the 24-hour window or the test-recipient list —
 * stays invisible.
 */
export function whatsappErrorHint(code?: number, subcode?: number): string | undefined {
  switch (code) {
    case 190:
      return "The access token is invalid or expired. Generate a permanent System-user token in Meta → Business settings and update WHATSAPP_ACCESS_TOKEN.";
    case 100:
      return subcode === 33
        ? "The phone number id does not belong to this token. Check WHATSAPP_PHONE_NUMBER_ID against Meta → WhatsApp → API setup."
        : "Meta rejected the request. Check the phone number id and the recipient format (digits only, with the country code).";
    case 131030:
      return "That number is not allowed to receive messages yet. While the Meta app is in Development mode only the test recipients added in WhatsApp Manager can be messaged — add the customer's number there (up to 5).";
    case 131047:
      return "The 24-hour customer-service window is closed: the customer has not messaged the business in the last 24 hours, so only an approved template can start the conversation.";
    case 131026:
      return "The recipient cannot receive this message — usually an incorrect or non-WhatsApp number.";
    case 131031:
      return "The WhatsApp Business account is restricted or its payment method is not set up.";
    case 132000:
    case 132001:
      return "That message template does not exist for this account, or the language code is wrong. The default hello_world template is en_US.";
    case 132005:
      return "The template needs more parameters than were supplied.";
    case 131056:
      return "Too many messages to the same number in a short time. Wait a few minutes and try again.";
    case 4:
      return "Meta's rate limit for the account was hit. Wait a few minutes and retry.";
    default:
      return undefined;
  }
}

export type WhatsAppConnection = {
  ok: boolean;
  mode: "live" | "sandbox";
  verifiedName?: string;
  displayPhoneNumber?: string;
  qualityRating?: string;
  error?: string;
  hint?: string;
};

/**
 * Confirm the configured credentials work before blaming the message: reads the
 * phone number object itself. This is the difference between "the token is
 * wrong" and "the customer is not a test recipient".
 */
export async function checkWhatsAppConnection(): Promise<WhatsAppConnection> {
  const config = await whatsappConfig();
  if (!config.configured) {
    return {
      ok: false,
      mode: "sandbox",
      error: "No phone number id or access token configured",
      hint: "Add WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN, or fill them in the settings below.",
    };
  }
  const result = await getGraph(
    config,
    `${config.phoneNumberId}?fields=verified_name,display_phone_number,quality_rating`,
  );
  if (!result.ok) {
    return {
      ok: false,
      mode: "live",
      error: result.error,
      hint: whatsappErrorHint(result.code, result.subcode),
    };
  }
  return {
    ok: true,
    mode: "live",
    verifiedName: String(result.data.verified_name ?? ""),
    displayPhoneNumber: String(result.data.display_phone_number ?? ""),
    qualityRating: String(result.data.quality_rating ?? ""),
  };
}

export type SendResult = {
  ok: boolean;
  sandbox: boolean;
  messageId: string | null;
  error?: string;
  /** Meta's error code, so the caller can explain the failure precisely. */
  errorCode?: number;
  hint?: string;
};

type SendOptions = {
  db: Db;
  orderId?: number | null;
  conversationId?: number | null;
  /** Log even when the customer has opted out (counter/system messages). */
  system?: boolean;
};

async function finishSend(
  options: SendOptions,
  config: WhatsAppConfig,
  waId: string,
  kind: string,
  body: string,
  result: GraphResult,
): Promise<SendResult> {
  const messageId =
    (result.data.messages as { id?: string }[] | undefined)?.[0]?.id ?? null;
  await logWhatsAppMessage(options.db, {
    waId,
    direction: "outbound",
    kind,
    body,
    status: result.ok ? "sent" : config.configured ? "failed" : "logged",
    externalId: messageId,
    orderId: options.orderId ?? null,
    conversationId: options.conversationId ?? null,
    payload: { mode: config.mode, ...result.data },
    error: result.error ?? null,
  });
  return {
    ok: result.ok || !config.configured,
    sandbox: !config.configured,
    messageId,
    error: result.error,
    errorCode: result.code,
    hint: result.ok ? undefined : whatsappErrorHint(result.code, result.subcode),
  };
}

/** Send a plain text message. */
export async function sendWhatsAppText(
  options: SendOptions & { to: string; body: string },
): Promise<SendResult> {
  const config = await whatsappConfig();
  if (!config.enabled) {
    return { ok: false, sandbox: true, messageId: null, error: "WhatsApp channel disabled" };
  }
  const to = normalisePhone(options.to);
  if (!to) return { ok: false, sandbox: true, messageId: null, error: "No recipient number" };
  const conversation = await touchConversation(options.db, to);
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: options.body.slice(0, 4096) },
  };
  const result = await postGraph(config, `${config.phoneNumberId}/messages`, payload);
  return finishSend(
    { ...options, conversationId: options.conversationId ?? conversation.id },
    config,
    to,
    "text",
    options.body,
    result,
  );
}

/**
 * Send an interactive call-to-action message with a link button — the shape
 * used for “Review & pay” and “Leave feedback”. Falls back to a text message
 * with the URL inline when the channel is not configured, so the sandbox log
 * still shows what the customer would have received.
 */
export async function sendWhatsAppCta(
  options: SendOptions & {
    to: string;
    body: string;
    buttonLabel: string;
    url: string;
    header?: string;
    footer?: string;
  },
): Promise<SendResult> {
  const config = await whatsappConfig();
  if (!config.enabled) {
    return { ok: false, sandbox: true, messageId: null, error: "WhatsApp channel disabled" };
  }
  const to = normalisePhone(options.to);
  if (!to) return { ok: false, sandbox: true, messageId: null, error: "No recipient number" };
  const conversation = await touchConversation(options.db, to);
  if (!config.configured) {
    // Sandbox: log the exact CTA the customer would receive.
    return finishSend(
      { ...options, conversationId: conversation.id },
      config,
      to,
      "cta",
      `${options.body}\n\n[${options.buttonLabel}] ${options.url}`,
      { ok: false, data: {}, error: "sandbox" },
    );
  }
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "cta_url",
      header: options.header ? { type: "text", text: options.header.slice(0, 60) } : undefined,
      body: { text: options.body.slice(0, 1024) },
      footer: options.footer ? { text: options.footer.slice(0, 60) } : undefined,
      action: {
        name: "cta_url",
        parameters: {
          display_text: options.buttonLabel.slice(0, 20),
          url: options.url,
        },
      },
    },
  };
  const result = await postGraph(config, `${config.phoneNumberId}/messages`, payload);
  return finishSend(
    { ...options, conversationId: conversation.id },
    config,
    to,
    "cta",
    `${options.body}\n\n[${options.buttonLabel}] ${options.url}`,
    result,
  );
}

/** Send an approved template (used when a 24-hour customer-service window is closed). */
export async function sendWhatsAppTemplate(
  options: SendOptions & {
    to: string;
    name: string;
    language?: string;
    variables?: string[];
  },
): Promise<SendResult> {
  const config = await whatsappConfig();
  const to = normalisePhone(options.to);
  if (!config.enabled || !to) {
    return { ok: false, sandbox: true, messageId: null, error: "WhatsApp channel unavailable" };
  }
  const conversation = await touchConversation(options.db, to);
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: options.name,
      language: { code: options.language ?? "en" },
      components: options.variables?.length
        ? [
            {
              type: "body",
              parameters: options.variables.map((text) => ({ type: "text", text })),
            },
          ]
        : undefined,
    },
  };
  const result = await postGraph(config, `${config.phoneNumberId}/messages`, payload);
  return finishSend(
    { ...options, conversationId: conversation.id },
    config,
    to,
    "template",
    `template:${options.name}`,
    result,
  );
}

/**
 * Verify `X-Hub-Signature-256` against the raw request body. Returns true when
 * no app secret is configured (sandbox), so local webhook testing works.
 */
export async function verifyWhatsAppSignature(
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  const config = await whatsappConfig();
  if (!config.appSecret) return true;
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", config.appSecret).update(rawBody).digest("hex");
  const provided = signature.slice("sha256=".length);
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

/** A tappable wa.me link for the website, QR posters and receipts. */
export function whatsappChatLink(number: string, message?: string): string {
  const digits = normalisePhone(number);
  if (!digits) return "";
  const query = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${digits}${query}`;
}

/**
 * Try every place a token can come from and report which one Meta accepts.
 *
 * This exists because "Authentication Error" names a symptom, not a token. With
 * a portal value and two Vercel aliases in play there are up to four candidate
 * tokens, and the only honest answer to "which one do I fix?" is to try them
 * all and say. Nothing here is destructive: each candidate is a read-only
 * `GET /{phone_number_id}`. The first that works is recorded as the proven
 * token so the portal can show a tick rather than a guess.
 *
 * The winning combination is returned as a concrete instruction — set the
 * source to X and the alias to Y — so the fix is one click, not a hunt.
 */
export type TokenCandidate = {
  /** Where this token came from. */
  origin: "settings" | "env";
  /** The Vercel variable name, when origin is env. */
  envKey?: string;
  alias?: TokenAlias;
  /** Masked to the last four characters, never the whole token. */
  masked: string;
  ok: boolean;
  /** Meta's message when it refused. */
  error?: string;
  errorCode?: number;
  hint?: string;
  /** The verified business name when it worked. */
  verifiedName?: string;
  displayPhoneNumber?: string;
};

export type CredentialProbe = {
  attempts: TokenCandidate[];
  /** The candidate that worked, or null when none did. */
  winner: TokenCandidate | null;
  /** What to change so the app uses the working token. */
  recommendation: {
    credentialMode: CredentialMode;
    tokenAlias: TokenAlias | null;
    message: string;
  } | null;
  /** Present when nothing worked — the next thing to check, in plain English. */
  nextStep: string | null;
};

export async function probeWhatsAppCredentials(): Promise<CredentialProbe> {
  const settings = await getSettings();
  const value = (key: string) => settingValue(settings, key, "");
  const phoneNumberId =
    (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim() || value("whatsapp_phone_number_id");

  const candidates: { origin: "settings" | "env"; envKey?: string; alias?: TokenAlias; token: string }[] = [];
  const portalToken = value("whatsapp_access_token").trim();
  if (portalToken) candidates.push({ origin: "settings", token: portalToken });
  for (const alias of Object.keys(TOKEN_ALIASES) as TokenAlias[]) {
    const envKey = TOKEN_ALIASES[alias];
    const token = (process.env[envKey] ?? "").trim();
    // Both aliases can legitimately hold the same value; trying it twice would
    // just print the same failure twice and make the list look worse than it is.
    if (token && !candidates.some((entry) => entry.token === token)) {
      candidates.push({ origin: "env", envKey, alias, token });
    }
  }

  if (!phoneNumberId) {
    return {
      attempts: [],
      winner: null,
      recommendation: null,
      nextStep:
        "No phone number id is set, so a token cannot be tested. Add WHATSAPP_PHONE_NUMBER_ID in Vercel, or WhatsApp Phone Number ID in Admin → WhatsApp Business.",
    };
  }
  if (candidates.length === 0) {
    return {
      attempts: [],
      winner: null,
      recommendation: null,
      nextStep:
        "No token found anywhere. Save your System User token in Admin → WhatsApp Business, or add WHATSAPP_ACCESS_TOKEN in Vercel.",
    };
  }

  const attempts: TokenCandidate[] = [];
  for (const candidate of candidates) {
    const base: TokenCandidate = {
      origin: candidate.origin,
      envKey: candidate.envKey,
      alias: candidate.alias,
      masked: maskSecret(candidate.token),
      ok: false,
    };
    try {
      const response = await fetch(
        `${GRAPH_BASE}/${phoneNumberId}?fields=verified_name,display_phone_number`,
        { headers: { Authorization: `Bearer ${candidate.token}` }, cache: "no-store" },
      );
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.ok) {
        attempts.push({
          ...base,
          ok: true,
          verifiedName: String(data.verified_name ?? ""),
          displayPhoneNumber: String(data.display_phone_number ?? ""),
        });
      } else {
        const failure = graphFailure(data, response.status);
        attempts.push({
          ...base,
          error: failure.error,
          errorCode: failure.code,
          hint: whatsappErrorHint(failure.code, failure.subcode),
        });
      }
    } catch (error) {
      attempts.push({
        ...base,
        error: error instanceof Error ? error.message : "Request failed",
      });
    }
  }

  const winner = attempts.find((attempt) => attempt.ok) ?? null;
  if (!winner) {
    const codes = attempts.map((attempt) => attempt.errorCode).filter(Boolean);
    const allAuth = codes.length > 0 && codes.every((code) => code === 190);
    return {
      attempts,
      winner: null,
      recommendation: null,
      nextStep: allAuth
        ? "Every token was rejected with Meta error 190, so the problem is not which token you pick — all of them are invalid. Generate a fresh System User token at business.facebook.com/settings/system-users (expiry: Never) and save it in Admin → WhatsApp Business, then test again."
        : "No candidate token was accepted. Check that the phone number id belongs to the same WhatsApp Business Account as the token, and that the token has the whatsapp_business_messaging scope.",
    };
  }

  const current = await whatsappConfig();
  const alreadyActive =
    current.sources.accessToken === winner.origin &&
    (winner.origin === "settings" || current.tokenAlias === winner.alias);
  const credentialMode: CredentialMode = winner.origin === "settings" ? "settings" : "env";
  const tokenAlias: TokenAlias | null = winner.alias ?? null;
  const where = winner.origin === "settings" ? "Admin → WhatsApp Business" : `Vercel's ${winner.envKey}`;
  return {
    attempts,
    winner,
    recommendation: {
      credentialMode,
      tokenAlias,
      message: alreadyActive
        ? `The token currently in use (${where}, ••••${winner.masked.slice(-4)}) is accepted by Meta. Nothing to change.`
        : `The token in ${where} (••••${winner.masked.slice(-4)}) is accepted by Meta. Switch the source to “${credentialMode === "settings" ? "Use admin portal" : "Use Vercel env"}”${tokenAlias ? ` and the token alias to “${tokenAlias === "new" ? "WHATSAPP_ACCESS_TOKEN_NEW" : "WHATSAPP_ACCESS_TOKEN"}”` : ""} to start using it.`,
    },
    nextStep: null,
  };
}

/**
 * Discover the WhatsApp catalog id from Meta instead of hunting the UI.
 *
 * The catalog id is the one value in the whole setup that an owner cannot find
 * by looking at the obvious screens: it is not on the API setup page, it is not
 * the WABA id, and in Commerce Manager it appears only in the URL of a page you
 * have to already be on. It *is* however an attribute of the business account,
 * so the Graph API can simply answer the question once the token is valid:
 *
 *   GET /{WABA_ID}?fields=id,name,owner_business_info,product_catalogs
 *
 * This returns every catalog the token can see, which one is already connected
 * to the business account, and a plain-English next step when there isn't one.
 */
export type CatalogDiscovery = {
  ok: boolean;
  configuredCatalogId: string | null;
  businessAccountId: string | null;
  businessAccountName: string | null;
  catalogs: {
    id: string;
    name: string;
    /** True when this is the catalog the business account already uses. */
    connected: boolean;
    source: "waba" | "business" | "owned";
  }[];
  suggestedCatalogId: string | null;
  error?: string;
  hint?: string;
  setupSteps: string[];
  /**
   * True when the token has the `catalog_management` scope, so the portal can
   * offer to create the catalogue instead of sending the owner hunting through
   * Commerce Manager. Detected by trying, not by asking Meta for a scope list.
   */
  canCreate: boolean;
  /** Why creation is unavailable, when it is. */
  createBlocked?: string;
};

type CatalogNode = { id?: string; name?: string; product_catalog?: { id?: string; name?: string }[] };

function catalogsFrom(value: unknown): CatalogNode[] {
  if (!value || typeof value !== "object") return [];
  const node = value as { data?: unknown; product_catalogs?: unknown };
  const list = Array.isArray(node.data)
    ? node.data
    : Array.isArray(node.product_catalogs)
      ? (node.product_catalogs as { data?: unknown }).data
      : node.product_catalogs;
  if (!Array.isArray(list)) return [];
  return list as CatalogNode[];
}

export async function discoverWhatsAppCatalog(): Promise<CatalogDiscovery> {
  const config = await whatsappConfig();
  const setupSteps = [
    "Open business.facebook.com → All tools → Commerce Manager → Add catalog → name it “Khan Baba Menu”, choose Online products, currency AUD.",
    "Still in Commerce Manager: Settings → Catalog ID is shown as Content ID. Or read the digits in the URL (/catalog/1234567890/products).",
    "Go to WhatsApp Manager → Account tools → Catalog → Choose catalog → Connect catalog, and select the Khan Baba catalog.",
    "Turn on “Show catalog icon in chat header” so customers can browse the menu in the chat.",
    "Paste the Content ID into Admin → WhatsApp Business → WhatsApp Catalogue ID and save.",
  ];

  if (!config.configured) {
    return {
      ok: false,
      configuredCatalogId: config.catalogId || null,
      businessAccountId: config.businessAccountId || null,
      businessAccountName: null,
      catalogs: [],
      suggestedCatalogId: null,
      error: "WhatsApp is not configured yet.",
      hint: "Add the phone number id and a valid access token first — the catalog lookup uses the same token.",
      setupSteps,
      canCreate: false,
      createBlocked: "WhatsApp is not configured yet.",
    };
  }
  if (!config.businessAccountId) {
    return {
      ok: false,
      configuredCatalogId: config.catalogId || null,
      businessAccountId: null,
      businessAccountName: null,
      catalogs: [],
      suggestedCatalogId: null,
      error: "No business account id (WABA id) is set.",
      hint: "It is the “WhatsApp Business Account ID” on Meta → WhatsApp → API setup, next to the phone number id.",
      setupSteps,
      canCreate: false,
      createBlocked: "A business account id (WABA id) is required to create a catalogue.",
    };
  }

  const found = new Map<string, CatalogDiscovery["catalogs"][number]>();
  const add = (id: string | undefined, name: string | undefined, source: "waba" | "business" | "owned") => {
    if (!id) return;
    if (found.has(id)) return;
    found.set(id, { id, name: name ?? "Untitled catalog", connected: false, source });
  };

  const waba = await getGraph(
    config,
    `${config.businessAccountId}?fields=id,name,product_catalogs`,
  );
  let businessAccountName: string | null = null;
  if (waba.ok) {
    businessAccountName = String(waba.data.name ?? "") || null;
    for (const node of catalogsFrom(waba.data.product_catalogs)) {
      add(node.id, node.name, "waba");
    }
  }

  // A catalog already connected to the business account is the right answer,
  // so prefer it over anything else the token can see.
  const connected = await getGraph(config, `${config.businessAccountId}/product_catalogs?limit=25`);
  if (connected.ok) {
    for (const node of catalogsFrom(connected.data)) add(node.id, node.name, "waba");
  }

  if (waba.ok || connected.ok) {
    if (config.catalogId) {
      const existing = found.get(config.catalogId);
      if (existing) existing.connected = true;
    }
  }

  // Anything the configured catalog id points at is by definition the one in use.
  if (config.catalogId && !found.has(config.catalogId)) {
    add(config.catalogId, "Configured catalog", "owned");
    const own = found.get(config.catalogId);
    if (own) own.connected = true;
  }

  const catalogs = [...found.values()].sort(
    (a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name),
  );
  const suggested =
    config.catalogId && catalogs.some((row) => row.id === config.catalogId)
      ? config.catalogId
      : (catalogs.find((row) => row.connected)?.id ?? catalogs[0]?.id ?? null);

  if (!waba.ok && !connected.ok) {
    return {
      ok: false,
      configuredCatalogId: config.catalogId || null,
      businessAccountId: config.businessAccountId,
      businessAccountName,
      catalogs,
      suggestedCatalogId: suggested,
      error: waba.error ?? connected.error ?? "Meta rejected the lookup",
      hint: whatsappErrorHint(waba.code, waba.subcode),
      setupSteps,
      canCreate: false,
      createBlocked: "The catalog lookup failed, so creating one is not attempted.",
    };
  }

  return {
    ok: true,
    configuredCatalogId: config.catalogId || null,
    businessAccountId: config.businessAccountId,
    businessAccountName,
    catalogs,
    suggestedCatalogId: suggested,
    setupSteps,
    canCreate: catalogs.length === 0,
    createBlocked:
      catalogs.length === 0
        ? undefined
        : "A catalogue already exists — pick it below instead of making another.",
  };
}

/**
 * Create the WhatsApp catalogue and connect it to the business account.
 *
 * Asking the owner to go to Commerce Manager, add a catalogue, copy a Content
 * ID out of a URL and come back is exactly the step that stalls the setup. The
 * catalogue is just a Graph object owned by the business, so if the token has
 * `catalog_management` we can make it, connect it, and return the id that the
 * rest of the app needs. When the scope is missing we say so precisely instead
 * of failing with a cryptic 200.
 */
export type CreateCatalogResult = {
  ok: boolean;
  catalogId?: string;
  name?: string;
  connected?: boolean;
  error?: string;
  hint?: string;
  steps: string[];
};

export async function createWhatsAppCatalog(name?: string): Promise<CreateCatalogResult> {
  const config = await whatsappConfig();
  const steps: string[] = [];
  const catalogName = (name ?? "").trim() || "Khan Baba Menu";

  if (!config.configured) {
    return {
      ok: false,
      error: "WhatsApp is not configured yet",
      hint: "Add the phone number id and access token first — creating a catalogue uses the same token.",
      steps,
    };
  }
  const businessId = config.businessId;
  if (!businessId) {
    return {
      ok: false,
      error: "No Meta business id is available",
      hint:
        "Creating a catalogue needs the business portfolio id (Business settings → Business info → ID). Add WHATSAPP_BUSINESS_ID in Vercel, or create the catalogue by hand in Commerce Manager and paste its Content ID.",
      steps: [
        "Business settings → Business info → copy the business portfolio id (15–16 digits).",
        "Add it in Vercel as WHATSAPP_BUSINESS_ID, then redeploy.",
        "Come back here and press “Create catalogue”.",
      ],
    };
  }

  const created = await postGraph(config, `${businessId}/owned_product_catalogs`, {
    name: catalogName,
    // The catalogue is a menu: vertical=commerce is the generic retail type and
    // is what "Online products" maps to in Commerce Manager.
    vertical: "commerce",
  });
  if (!created.ok) {
    const scopeMissing = created.code === 200 || created.code === 100 || /permission|scope/i.test(created.error ?? "");
    return {
      ok: false,
      error: created.error,
      hint: scopeMissing
        ? "The token cannot create catalogues. Add the catalog_management scope to the System User token (business.facebook.com/settings/system-users), or create the catalogue in Commerce Manager and paste its Content ID."
        : whatsappErrorHint(created.code, created.subcode),
      steps,
    };
  }

  const catalogId = String(created.data.id ?? "");
  if (!catalogId) {
    return {
      ok: false,
      error: "Meta created the catalogue but did not return an id",
      hint: "Open Commerce Manager and copy the Content ID from the catalogue.",
      steps,
    };
  }
  steps.push(`Catalogue “${catalogName}” created with id ${catalogId}.`);

  // Connect it to the WhatsApp business account so it appears in the chat.
  const connected = await postGraph(config, `${config.businessAccountId}/product_catalogs`, {
    catalog_id: catalogId,
  });
  steps.push(
    connected.ok
      ? "Connected to the WhatsApp business account — customers can now browse it in chat."
      : `Could not connect it automatically (${connected.error ?? "unknown error"}). Connect it in WhatsApp Manager → Account tools → Catalog.`,
  );

  return {
    ok: true,
    catalogId,
    name: catalogName,
    connected: connected.ok,
    steps,
  };
}
