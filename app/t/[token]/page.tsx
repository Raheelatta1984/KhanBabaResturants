import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import {
  fullOrderFromRow,
  getOrderByTrackingToken,
  publicOrderPayload,
} from "@/lib/orders";
import { TrackingView } from "@/components/TrackingView";
import { TrackingLinkBar } from "@/components/TrackingLinkBar";
import { getCustomerSession } from "@/lib/auth/customer";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Track your order",
  description:
    "Follow your Khan Baba order from the counter to the kitchen to your door.",
  robots: { index: false },
};

/**
 * `/t/<token>` — the shareable tracking link every order gets.
 *
 * The code-based `/order/<code>` page stays (it is what a customer reads out at
 * the counter), but the token is what goes in a text message: it cannot be
 * guessed from another customer's code, and it is the same URL at every stage.
 */
export default async function TokenTrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;

  const db = await getDb();
  const row = await getOrderByTrackingToken(db, decodeURIComponent(token));
  if (!row) notFound();

  const full = await fullOrderFromRow(db, row);
  const payload = await publicOrderPayload(db, full.order.code);
  if (!payload) notFound();

  // Guests are nudged (never forced) to keep the order in an account. A customer
  // who already has one — or owns this order — just gets the link bar.
  const session = await getCustomerSession();
  const offersAccount = !session && Boolean(row.email);

  return (
    <section className="section-tight" style={{ paddingTop: 32 }}>
      <div className="container">
        <nav
          className="tiny muted"
          style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}
        >
          <Link href="/">Home</Link> <span>/</span>
          <Link href="/menu">Menu</Link> <span>/</span>
          <span style={{ color: "var(--text)" }}>Order {payload.order.code}</span>
        </nav>

        <TrackingView initial={payload} justPlaced={query.new === "1"} />

        <TrackingLinkBar token={token} orderCode={payload.order.code} />

        {offersAccount ? (
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <h3 style={{ fontSize: "1.05rem" }}>
                <span className="step-number">★</span>Keep this order
              </h3>
              <span className="badge badge-amber">Optional</span>
            </div>
            <p className="small muted" style={{ marginBottom: 14 }}>
              Sign in with <b style={{ color: "var(--text)" }}>{row.email}</b> and
              this order joins your history — reorder it in one tap, and no more
              hunting for codes.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link
                href={`/login?mode=signup&next=/account`}
                className="btn btn-primary btn-sm"
              >
                Create an account
              </Link>
              <Link href="/login?reason=signin" className="btn btn-outline btn-sm">
                I already have one
              </Link>
            </div>
          </div>
        ) : null}

        <div className="notice" style={{ marginTop: 18 }}>
          <Icon name="shield" size={15} />
          <span>
            This link is the private key to this order — anyone who has it can see
            the status, so share it only with whoever is collecting. Sign in to
            keep every order in one place.
          </span>
        </div>
      </div>
    </section>
  );
}
