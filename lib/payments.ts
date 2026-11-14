import { randomUUID } from "node:crypto";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSetting } from "./settings";

/**
 * Payment options. Card brands (Visa, Mastercard, Amex) and Afterpay/Clearpay
 * are served through Stripe's hosted Checkout — no card data ever touches this
 * application. PayPal uses the native Orders v2 API. With no credentials every
 * option runs through the sandbox gateway, which is labelled in the UI so
 * nobody mistakes a demo charge for a real one.
 */
export type PaymentOption =
  | "card_visa"
  | "card_mastercard"
  | "card_amex"
  | "afterpay"
  | "paypal";

export const PAYMENT_OPTIONS: {
  id: PaymentOption;
  label: string;
  blurb: string;
  group: "card" | "bnpl" | "wallet";
  stripeMethod?: string;
}[] = [
  { id: "card_visa", label: "Visa", blurb: "Debit or credit card", group: "card", stripeMethod: "card" },
  { id: "card_mastercard", label: "Mastercard", blurb: "Debit or credit card", group: "card", stripeMethod: "card" },
  { id: "card_amex", label: "American Express", blurb: "Debit or credit card", group: "card", stripeMethod: "card" },
  { id: "afterpay", label: "Afterpay", blurb: "Pay in 4 instalments", group: "bnpl", stripeMethod: "afterpay_clearpay" },
  { id: "paypal", label: "PayPal", blurb: "Pay with your PayPal wallet", group: "wallet" },
];

export function isPaymentOption(value: unknown): value is PaymentOption {
  return PAYMENT_OPTIONS.some((option) => option.id === value);
}

export function paymentOptionLabel(id: string | null | undefined): string {
  return PAYMENT_OPTIONS.find((option) => option.id === id)?.label ?? "Card";
}

/** Enabled options from the `payment_methods` CSV setting. */
export function enabledPaymentOptions(
  settings: Record<string, string>,
): PaymentOption[] {
  const configured = (settings.payment_methods ?? "card_visa,card_mastercard,afterpay,paypal")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const enabled = PAYMENT_OPTIONS.filter((option) =>
    configured.includes(option.id),
  );
  return enabled.length
    ? enabled.map((option) => option.id)
    : ["card_visa", "card_mastercard"];
}

export type PaymentResult = {
  provider: "simulated" | "stripe" | "paypal";
  intentId: string;
  status: "paid" | "pending" | "redirect";
  redirectUrl?: string;
  last4?: string;
  method?: string;
  raw?: unknown;
};

async function stripeKey(): Promise<string> {
  return (
    process.env.STRIPE_SECRET_KEY || (await getSetting("stripe_secret_key"))
  );
}

export async function stripeConfigured(): Promise<boolean> {
  if (process.env.STRIPE_SECRET_KEY)
    return process.env.STRIPE_SECRET_KEY.startsWith("sk_");
  return (await getSetting("stripe_secret_key")).startsWith("sk_");
}

type PaypalConfig = { clientId: string; clientSecret: string; mode: string; webhookId: string };

async function paypalConfig(): Promise<PaypalConfig> {
  return {
    clientId:
      process.env.PAYPAL_CLIENT_ID || (await getSetting("paypal_client_id")),
    clientSecret:
      process.env.PAYPAL_CLIENT_SECRET ||
      (await getSetting("paypal_client_secret")),
    mode:
      process.env.PAYPAL_MODE || (await getSetting("paypal_mode", "sandbox")),
    webhookId:
      process.env.PAYPAL_WEBHOOK_ID ||
      (await getSetting("paypal_webhook_id")),
  };
}

export async function paypalConfigured(): Promise<boolean> {
  const config = await paypalConfig();
  return Boolean(config.clientId && config.clientSecret);
}

function paypalBase(mode: string): string {
  return mode === "live" || mode === "production"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

let paypalTokenCache: { token: string; expiresAt: number; mode: string } | null = null;

export async function paypalAccessToken(): Promise<string> {
  const config = await paypalConfig();
  if (
    paypalTokenCache &&
    paypalTokenCache.mode === config.mode &&
    paypalTokenCache.expiresAt > Date.now() + 60_000
  )
    return paypalTokenCache.token;
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await fetch(`${paypalBase(config.mode)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PayPal authentication failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  paypalTokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    mode: config.mode,
  };
  return json.access_token;
}

export async function paypalFetch(
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const config = await paypalConfig();
  const token = await paypalAccessToken();
  const res = await fetch(`${paypalBase(config.mode)}${path}`, {
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
    const message = (json as { message?: string } | null)?.message;
    throw new Error(message ?? `PayPal API error ${res.status}`);
  }
  return (json ?? {}) as Record<string, unknown>;
}

function baseUrl(): string {
  return process.env.PUBLIC_BASE_URL || "http://localhost:3000";
}

/** Start a payment for an order using the customer's chosen option. */
export async function startPayment(input: {
  orderCode: string;
  amountCents: number;
  description: string;
  last4?: string;
  customerEmail?: string;
  option?: PaymentOption | null;
}): Promise<PaymentResult> {
  const option = input.option ?? "card_visa";
  const providerSetting = await getSetting("payment_provider", "simulated");
  const stripeLive =
    (providerSetting === "stripe" || providerSetting === "auto") &&
    (await stripeConfigured());
  const method = PAYMENT_OPTIONS.find((entry) => entry.id === option);

  // PayPal has its own hosted approval flow.
  if (option === "paypal" && (await paypalConfigured())) {
    const json = await paypalFetch("/v2/checkout/orders", {
      method: "POST",
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.orderCode,
            description: input.description.slice(0, 127),
            amount: {
              currency_code: "AUD",
              value: (input.amountCents / 100).toFixed(2),
            },
          },
        ],
        application_context: {
          brand_name: "Khan Baba Restaurant",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          return_url: `${baseUrl()}/api/payments/paypal/return?order=${encodeURIComponent(input.orderCode)}`,
          cancel_url: `${baseUrl()}/order/${input.orderCode}?cancelled=1`,
        },
      }),
    });
    const links = (json.links ?? []) as { rel?: string; href?: string }[];
    const approve = links.find((link) => link.rel === "approve")?.href;
    const id = String(json.id ?? "");
    if (!approve || !id) throw new Error("PayPal could not start checkout");
    return {
      provider: "paypal",
      intentId: id,
      status: "redirect",
      redirectUrl: approve,
      method: "paypal",
      raw: json,
    };
  }

  // Card brands + Afterpay/Clearpay through Stripe's hosted Checkout.
  if (stripeLive && method?.stripeMethod) {
    const params = new URLSearchParams({
      mode: "payment",
      success_url: `${baseUrl()}/order/${input.orderCode}?paid=1`,
      cancel_url: `${baseUrl()}/order/${input.orderCode}?cancelled=1`,
      client_reference_id: input.orderCode,
      "payment_method_types[0]": method.stripeMethod,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "aud",
      "line_items[0][price_data][unit_amount]": String(input.amountCents),
      "line_items[0][price_data][product_data][name]": input.description,
      "metadata[order_code]": input.orderCode,
      "metadata[payment_option]": option,
    });
    if (input.customerEmail) params.set("customer_email", input.customerEmail);

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await stripeKey()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      cache: "no-store",
    });
    const json = (await res.json()) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };
    if (!res.ok || !json.url || !json.id) {
      throw new Error(
        json.error?.message || "Stripe Checkout could not be started",
      );
    }
    return {
      provider: "stripe",
      intentId: json.id,
      status: "redirect",
      redirectUrl: json.url,
      method: option,
      raw: json,
    };
  }

  // Sandbox: authorise locally, never transmit or store card numbers.
  const intentId = `sim_pi_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  return {
    provider: "simulated",
    intentId,
    status: "paid",
    last4: input.last4 || "4242",
    method: option,
    raw: { mode: "simulated", option, amount: input.amountCents, currency: "AUD" },
  };
}

/** Backwards-compatible alias for the original single-gateway call site. */
export async function startCardPayment(
  input: Parameters<typeof startPayment>[0],
): Promise<PaymentResult> {
  return startPayment(input);
}

/** Capture a PayPal order after the customer approves it. */
export async function capturePaypalOrder(orderToken: string): Promise<{
  captureId: string;
  status: string;
  referenceId: string | null;
  amountCents: number;
  raw: Record<string, unknown>;
}> {
  const json = await paypalFetch(
    `/v2/checkout/orders/${encodeURIComponent(orderToken)}/capture`,
    { method: "POST", body: "{}" },
  );
  const unit = ((json.purchase_units ?? []) as {
    reference_id?: string;
    payments?: {
      captures?: {
        id?: string;
        status?: string;
        amount?: { value?: string };
      }[];
    };
  }[])[0];
  const capture = unit?.payments?.captures?.[0];
  return {
    captureId: String(capture?.id ?? json.id ?? orderToken),
    status: String(json.status ?? capture?.status ?? "COMPLETED"),
    referenceId: unit?.reference_id ?? null,
    amountCents: Math.round(Number(capture?.amount?.value ?? 0) * 100),
    raw: json,
  };
}

/** Verify a PayPal webhook through PayPal's own signature-verification API. */
export async function verifyPaypalWebhook(
  headers: Headers,
  raw: string,
): Promise<boolean> {
  const config = await paypalConfig();
  if (!config.webhookId) return false;
  const get = (name: string) => headers.get(name) ?? "";
  try {
    const json = await paypalFetch("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: JSON.stringify({
        auth_algo: get("paypal-auth-algo"),
        cert_url: get("paypal-cert-url"),
        transmission_id: get("paypal-transmission-id"),
        transmission_sig: get("paypal-transmission-sig"),
        transmission_time: get("paypal-transmission-time"),
        webhook_id: config.webhookId,
        webhook_event: JSON.parse(raw),
      }),
    });
    return json.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

export function verifyStripeSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const parts = signatureHeader
    .split(",")
    .reduce<Record<string, string>>((acc, part) => {
      const [k, v] = part.split("=");
      if (k && v) acc[k] = v;
      return acc;
    }, {});
  const timestamp = parts.t;
  const provided = parts.v1;
  if (!timestamp || !provided) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}
