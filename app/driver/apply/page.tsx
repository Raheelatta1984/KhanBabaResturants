import type { Metadata } from "next";
import Link from "next/link";
import { DriverOnboardingForm } from "@/components/DriverOnboardingForm";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Become a delivery partner",
  description:
    "Join the Khan Baba verified driver network — onboarding, document verification, live delivery tracking, commission and ATO kilometre reports.",
};

export default function DriverApplyPage() {
  return (
    <section className="section-tight" style={{ paddingTop: 40, paddingBottom: 72 }}>
      <div className="container">
        <nav className="tiny muted" style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <Link href="/">Home</Link> <span>/</span>
          <span style={{ color: "var(--text)" }}>Delivery partners</span>
        </nav>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <span className="eyebrow">Driver partners</span>
          <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", margin: "12px 0 10px" }}>
            Deliver with Khan Baba.
          </h1>
          <p className="muted small" style={{ marginBottom: 24, maxWidth: 660 }}>
            A proper onboarding, not a sign-up sheet: identity, licence,
            insurance, right-to-work and police checks are verified one by one
            before you can be dispatched. Approved partners get a private portal
            with live maps, a commission ledger and an ATO-ready kilometre log.
          </p>

          <div className="grid grid-3" style={{ marginBottom: 22 }}>
            <div className="card" style={{ padding: 16 }}>
              <Icon name="shield" size={20} />
              <b className="small" style={{ display: "block", marginTop: 10 }}>Verified first</b>
              <p className="tiny muted">Seven compliance checks, audited per document.</p>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <Icon name="pin" size={20} />
              <b className="small" style={{ display: "block", marginTop: 10 }}>Live map</b>
              <p className="tiny muted">Share your location while on an active job.</p>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <Icon name="chart" size={20} />
              <b className="small" style={{ display: "block", marginTop: 10 }}>ATO km report</b>
              <p className="tiny muted">Every trip logged at the correct cents-per-km rate.</p>
            </div>
          </div>

          <DriverOnboardingForm />

          <p className="tiny muted" style={{ marginTop: 16, textAlign: "center" }}>
            Already approved? Use the private portal link sent to your email.
            Questions? Call the restaurant or email the delivery team.
          </p>
        </div>
      </div>
    </section>
  );
}
