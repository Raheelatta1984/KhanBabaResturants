import type { Metadata } from "next";
import { ClaimOrder } from "@/components/ClaimOrder";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Claim your order",
  robots: { index: false },
};

/**
 * Landing page for the one-time link texted/emailed with an order. The token is
 * redeemed by a button press (see ClaimOrder) so a prefetching mail client does
 * not consume it.
 */
export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <section className="section-tight" style={{ paddingTop: 48, paddingBottom: 64 }}>
      <div className="container">
        <ClaimOrder token={decodeURIComponent(token)} />
      </div>
    </section>
  );
}
