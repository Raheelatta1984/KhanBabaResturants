import { randomUUID } from "node:crypto";
import { getSetting } from "./settings";

export type PaymentResult = {
  provider: "simulated" | "stripe";
  intentId: string;
  status: "paid" | "pending" | "redirect";
  redirectUrl?: string;
  last4?: string;
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

function baseUrl(): string {
  return process.env.PUBLIC_BASE_URL || "http://localhost:3000";
}

/**
 * Take payment for an order.
 * - Stripe (when configured): a hosted Checkout Session, so no card data is ever
 *   handled by this application. The order is marked paid on the Stripe webhook.
 * - Simulated (default): authorises locally with a validated demo card so the whole
 *   order → kitchen → delivery lifecycle can be exercised end to end.
 */
export async function startCardPayment(input: {
  orderCode: string;
  amountCents: number;
  description: string;
  last4?: string;
  customerEmail?: string;
}): Promise<PaymentResult> {
  const providerSetting = await getSetting("payment_provider", "simulated");
  if (
    (providerSetting === "stripe" || providerSetting === "auto") &&
    (await stripeConfigured())
  ) {
    const params = new URLSearchParams({
      mode: "payment",
      success_url: `${baseUrl()}/order/${input.orderCode}?paid=1`,
      cancel_url: `${baseUrl()}/order/${input.orderCode}?cancelled=1`,
      client_reference_id: input.orderCode,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "aud",
      "line_items[0][price_data][unit_amount]": String(input.amountCents),
      "line_items[0][price_data][product_data][name]": input.description,
      "metadata[order_code]": input.orderCode,
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
      raw: json,
    };
  }

  const intentId = `sim_pi_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  return {
    provider: "simulated",
    intentId,
    status: "paid",
    last4: input.last4 || "4242",
    raw: { mode: "simulated", amount: input.amountCents, currency: "AUD" },
  };
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
  const { createHmac, timingSafeEqual } =
    require("node:crypto") as typeof import("node:crypto");
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}
