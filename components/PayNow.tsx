"use client";

import Link from "next/link";
import { useState } from "react";

const OPTIONS = [
  { id: "card_visa", label: "Visa / Mastercard", blurb: "Secure hosted checkout" },
  { id: "card_amex", label: "American Express", blurb: "Amex accepted" },
  { id: "afterpay", label: "Afterpay", blurb: "Pay in 4" },
  { id: "paypal", label: "PayPal", blurb: "Use your PayPal wallet" },
];

/**
 * The payment screen behind the WhatsApp link. It shows exactly what is being
 * paid for before anything happens, and names the sandbox plainly when no
 * provider credentials are configured — a demo must never look like a charge.
 */
export function PayNow({
  token,
  code,
  totalLabel,
  sandbox,
}: {
  token: string;
  code: string;
  totalLabel: string;
  sandbox: boolean;
}) {
  const [option, setOption] = useState("card_visa");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paid, setPaid] = useState(false);
  const [redirect, setRedirect] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/pay/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ option }),
      });
      const data = (await response.json()) as {
        error?: string;
        paid?: boolean;
        redirectUrl?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not start the payment");
      if (data.redirectUrl) {
        setRedirect(data.redirectUrl);
        window.location.href = data.redirectUrl;
        return;
      }
      setPaid(true);
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  if (paid) {
    return (
      <div className="panel" style={{ padding: 28, textAlign: "center" }}>
        <div className="pay-tick" aria-hidden="true">✓</div>
        <h2 style={{ fontSize: "1.9rem", margin: "14px 0" }}>Payment received</h2>
        <p className="small muted">
          Thank you — {code} is paid. The counter has been told and will accept the ticket and send
          it to the kitchen.
        </p>
        <div className="row" style={{ gap: 10, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
          <Link href={`/order/${code}`} className="btn btn-primary">
            Track my order
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ padding: 26 }}>
      <span className="eyebrow">Secure payment · {code}</span>
      <h2 style={{ fontSize: "2rem", margin: "12px 0 6px" }}>{totalLabel}</h2>
      <p className="small muted" style={{ marginBottom: 18 }}>
        Choose how you would like to pay. Card details are entered on the provider’s hosted page and
        never touch Khan Baba.
      </p>

      <div className="pay-options">
        {OPTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`pay-option ${option === entry.id ? "is-on" : ""}`}
            onClick={() => setOption(entry.id)}
          >
            <b>{entry.label}</b>
            <span className="tiny muted">{entry.blurb}</span>
          </button>
        ))}
      </div>

      {sandbox ? (
        <div className="notice" style={{ marginTop: 16 }}>
          <span>
            <strong>Sandbox gateway.</strong> No Stripe or PayPal credentials are configured, so this
            button records a clearly-labelled test payment. Nothing is charged.
          </span>
        </div>
      ) : null}
      {redirect ? <div className="notice" style={{ marginTop: 16 }}>Redirecting to the payment provider…</div> : null}
      {error ? <div className="notice notice-red" style={{ marginTop: 16 }}>{error}</div> : null}

      <button type="button" className="btn btn-primary" style={{ marginTop: 18 }} onClick={pay} disabled={busy}>
        {busy ? "Starting…" : `Pay ${totalLabel}`}
      </button>
      <p className="tiny muted" style={{ marginTop: 12 }}>
        Sitting at a table? You can also settle at the counter after your meal — the waiter will take
        it there.
      </p>
    </div>
  );
}
