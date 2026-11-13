import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCustomerSession } from "@/lib/auth/customer";
import { CustomerAuthForm } from "@/components/CustomerAuthForm";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to Khan Baba to reorder your favourites, see past orders and track a delivery in one place.",
};

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string; reason?: string }>;
}) {
  const query = await searchParams;
  const session = await getCustomerSession();
  if (session) redirect(query.next || "/account");

  const mode = query.mode === "signup" ? "signup" : "signin";

  return (
    <section className="section-tight" style={{ paddingTop: 40, paddingBottom: 64 }}>
      <div className="container">
        <div className="auth-grid">
          <div>
            <span className="eyebrow">
              {mode === "signup" ? "Join the table" : "Welcome back"}
            </span>
            <h1 style={{ fontSize: "clamp(2rem, 4.6vw, 3.1rem)", margin: "14px 0 12px" }}>
              {mode === "signup"
                ? "One account, every order."
                : "Sign in and order in a tap."}
            </h1>
            <p className="muted" style={{ maxWidth: "46ch" }}>
              An account keeps your delivery address, your usual heat level and
              every past order in one place — whether you ordered at the counter,
              for pick-up or for delivery.
            </p>

            <div className="auth-points">
              <div>
                <Icon name="clock" size={16} />
                <div>
                  <b>Track from anywhere</b>
                  <span>
                    A private link for every order — reopen it on any device.
                  </span>
                </div>
              </div>
              <div>
                <Icon name="bag" size={16} />
                <div>
                  <b>Reorder in one tap</b>
                  <span>Send a past order straight back to the cart.</span>
                </div>
              </div>
              <div>
                <Icon name="pin" size={16} />
                <div>
                  <b>Checkout that remembers</b>
                  <span>Address, mobile and allergies filled in for you.</span>
                </div>
              </div>
              <div>
                <Icon name="shield" size={16} />
                <div>
                  <b>No password theatre</b>
                  <span>
                    Card payments still go through Stripe — we never store a card.
                  </span>
                </div>
              </div>
            </div>

            <Link href="/menu" className="btn btn-outline" style={{ marginTop: 22 }}>
              Just show me the menu <Icon name="arrow" size={15} />
            </Link>
          </div>

          <div className="auth-card">
            <h2 style={{ fontSize: "1.3rem", marginBottom: 4 }}>
              {mode === "signup" ? "Create your account" : "Sign in"}
            </h2>
            <p className="tiny muted" style={{ marginBottom: 18 }}>
              Takes about fifteen seconds.
            </p>
            <CustomerAuthForm
              mode={mode}
              nextPath={query.next}
              reason={query.reason}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
