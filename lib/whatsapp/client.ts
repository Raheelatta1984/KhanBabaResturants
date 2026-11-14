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
  sources: Record<
    | "phoneNumberId"
    | "accessToken"
    | "businessAccountId"
    | "catalogId"
    | "verifyToken"
    | "appSecret"
    | "counterNumber"
    | "displayNumber",
    "env" | "settings" | "none"
  >;
};

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

type Resolved = { value: string; source: "env" | "settings" | "none" };

function resolve(envKey: string, setting: string): Resolved {
  const fromEnv = (process.env[envKey] ?? "").trim();
  if (fromEnv) return { value: fromEnv, source: "env" };
  const trimmed = (setting ?? "").trim();
  if (trimmed) return { value: trimmed, source: "settings" };
  return { value: "", source: "none" };
}

/** Resolve the channel configuration. Environment variables win over settings. */
export async function whatsappConfig(): Promise<WhatsAppConfig> {
  const settings = await getSettings();
  const value = (key: string) => settingValue(settings, key, "");
  const phoneNumberId = resolve("WHATSAPP_PHONE_NUMBER_ID", value("whatsapp_phone_number_id"));
  const accessToken = resolve("WHATSAPP_ACCESS_TOKEN", value("whatsapp_access_token"));
  const businessAccountId = resolve(
    "WHATSAPP_BUSINESS_ACCOUNT_ID",
    value("whatsapp_business_account_id"),
  );
  const catalogId = resolve("WHATSAPP_CATALOG_ID", value("whatsapp_catalog_id"));
  const verifyToken = resolve("WHATSAPP_VERIFY_TOKEN", value("whatsapp_verify_token"));
  const appSecret = resolve("WHATSAPP_APP_SECRET", value("whatsapp_app_secret"));
  const counterNumber = resolve("WHATSAPP_COUNTER_NUMBER", value("whatsapp_counter_number"));
  const displayNumber = resolve("WHATSAPP_DISPLAY_NUMBER", value("whatsapp_display_number"));
  const enabled = value("whatsapp_enabled") !== "0";
  const configured = Boolean(phoneNumberId.value && accessToken.value);
  return {
    enabled,
    configured,
    phoneNumberId: phoneNumberId.value,
    businessAccountId: businessAccountId.value,
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
      catalogId: catalogId.source,
      verifyToken: verifyToken.source,
      appSecret: appSecret.source,
      counterNumber: counterNumber.source,
      displayNumber: displayNumber.source,
    },
  };
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
