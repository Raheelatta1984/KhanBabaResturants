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
};

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

function envOr(envKey: string, fallback: string): string {
  return (process.env[envKey] ?? "").trim() || fallback;
}

/** Resolve the channel configuration. Environment variables win over settings. */
export async function whatsappConfig(): Promise<WhatsAppConfig> {
  const settings = await getSettings();
  const value = (key: string) => settingValue(settings, key, "");
  const phoneNumberId = envOr("WHATSAPP_PHONE_NUMBER_ID", value("whatsapp_phone_number_id"));
  const accessToken = envOr("WHATSAPP_ACCESS_TOKEN", value("whatsapp_access_token"));
  const enabled = value("whatsapp_enabled") !== "0";
  const configured = Boolean(phoneNumberId && accessToken);
  return {
    enabled,
    configured,
    phoneNumberId,
    businessAccountId: envOr("WHATSAPP_BUSINESS_ACCOUNT_ID", value("whatsapp_business_account_id")),
    accessToken,
    catalogId: envOr("WHATSAPP_CATALOG_ID", value("whatsapp_catalog_id")),
    verifyToken: envOr("WHATSAPP_VERIFY_TOKEN", value("whatsapp_verify_token")),
    appSecret: envOr("WHATSAPP_APP_SECRET", value("whatsapp_app_secret")),
    counterNumber: envOr("WHATSAPP_COUNTER_NUMBER", value("whatsapp_counter_number")),
    displayNumber: envOr("WHATSAPP_DISPLAY_NUMBER", value("whatsapp_display_number")),
    currency: value("whatsapp_currency") || "AUD",
    mode: configured && enabled ? "live" : "sandbox",
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

/** The Graph API POST, or null in sandbox mode. */
async function postGraph(
  config: WhatsAppConfig,
  path: string,
  body: unknown,
): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }> {
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
    if (!response.ok) {
      const message =
        (data.error as { message?: string } | undefined)?.message ??
        `WhatsApp API returned ${response.status}`;
      return { ok: false, data, error: message };
    }
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      data: {},
      error: error instanceof Error ? error.message : "WhatsApp API request failed",
    };
  }
}

export type SendResult = {
  ok: boolean;
  sandbox: boolean;
  messageId: string | null;
  error?: string;
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
  result: { ok: boolean; data: Record<string, unknown>; error?: string },
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
