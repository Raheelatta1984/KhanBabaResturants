import type { Metadata } from "next";
import Link from "next/link";
import { CheckoutFlow } from "@/components/CheckoutFlow";
import { getSettings } from "@/lib/settings";
import { stripeConfigured } from "@/lib/payments";
import { getDb } from "@/lib/db";
import { computePricing } from "@/lib/pricing";
import { getCurrentCustomer } from "@/lib/auth/customer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Checkout",
  description:
    "Review your Khan Baba order, choose delivery, pick-up or dine-in, and pay securely.",
};

export default async function CheckoutPage() {
  const settings = await getSettings();
  const db = await getDb();
  const account = await getCurrentCustomer(db);
  const preview = await computePricing(db, {
    subtotalCents: 0,
    channel: "delivery",
  });
  const paymentMode: "simulated" | "stripe" =
    (settings.payment_provider === "stripe" ||
      settings.payment_provider === "auto") &&
    (await stripeConfigured())
      ? "stripe"
      : "simulated";

  return (
    <section className="section-tight" style={{ paddingTop: 32 }}>
      <div className="container">
        <nav
          className="tiny muted"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <Link href="/">Home</Link> <span>/</span>
          <Link href="/menu">Menu</Link> <span>/</span>
          <span style={{ color: "var(--text)" }}>Checkout</span>
        </nav>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            flexWrap: "wrap",
            gap: 16,
            marginBottom: 26,
          }}
        >
          <div>
            <span className="eyebrow">Almost there</span>
            <h1
              style={{
                fontSize: "clamp(2rem, 4vw, 3rem)",
                margin: "12px 0 8px",
              }}
            >
              Checkout
            </h1>
            <p className="muted small">
              Delivery fees come from a live Uber Direct quote. Weekend and
              public holiday surcharges are applied automatically and shown
              before you pay.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="badge badge-green">Live courier quotes</span>
            <span className="badge">
              {preview.context.isWeekend
                ? "Weekend +5%"
                : preview.context.holidayName
                  ? `${preview.context.holidayName} +10%`
                  : "Standard rates"}
            </span>
            <span className="badge">
              {preview.context.isPeak
                ? "Peak hour — priority available"
                : "Priority available"}
            </span>
          </div>
        </div>

        <CheckoutFlow
          prefill={
            account
              ? {
                  name: account.name,
                  email: account.email,
                  phone: account.phone,
                  address: account.address,
                  suburb: account.suburb,
                  postcode: account.postcode,
                  signedIn: true,
                }
              : undefined
          }
          paymentMode={paymentMode}
          payAtCounterEnabled={settings.pay_at_counter_enabled === "1"}
          showDeliveryBreakdown={settings.show_delivery_breakdown === "1"}
          gstPercent={Number(settings.gst_percent || 10)}
        />
      </div>
    </section>
  );
}
