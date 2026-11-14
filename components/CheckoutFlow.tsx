"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { money } from "@/lib/money";
import { useCart } from "./CartProvider";
import { Icon } from "./Icon";
import { EmptyState } from "./ui";

type Adjustment = {
  code: string;
  label: string;
  kind: string;
  amountCents: number;
  percent?: number;
  note?: string;
};

type Pricing = {
  subtotalCents: number;
  adjustments: Adjustment[];
  surchargeCents: number;
  priorityFeeCents: number;
  deliveryFeeCents: number;
  discountCents?: number;
  totalCents: number;
  priorityAvailable: boolean;
  priorityFeeCentsIfSelected: number;
  context: { iso: string; hhmm: string; weekday: number; isWeekend: boolean; holidayName: string | null; isPeak: boolean };
};

type DeliveryQuote = {
  provider: string;
  feeCents: number;
  costCents: number;
  serviceFeeCents: number;
  etaMinutes: number;
  live: boolean;
  expiresAt: string;
  fallbackReason: string | null;
};

type QuoteResponse = {
  pricing?: Pricing;
  quoteToken?: string;
  delivery?: DeliveryQuote | null;
  promotion?: { code: string; label: string; discountCents: number } | null;
  promotionError?: string | null;
  error?: string;
  addressRequired?: boolean;
};

export type CheckoutPaymentOption = {
  id: string;
  label: string;
  blurb: string;
  group: "card" | "bnpl" | "wallet";
};

type Channel = "delivery" | "pickup" | "dine_in";

const CHANNELS: { id: Channel; title: string; blurb: string; icon: string }[] = [
  { id: "delivery", title: "Delivery", blurb: "Live courier quote · 30–45 min", icon: "bike" },
  { id: "pickup", title: "Click & collect", blurb: "Ready in ~20 min · Pitt St", icon: "bag" },
  { id: "dine_in", title: "Dine in", blurb: "Eat in · pay at counter", icon: "table" },
];

function luhnValid(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function expiryValid(value: string): boolean {
  const match = value.match(/^(\d{2})\s*\/\s*(\d{2})$/);
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return false;
  const end = new Date(year, month, 1).getTime();
  return end > Date.now();
}

type Prefill = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  suburb?: string | null;
  postcode?: string | null;
  signedIn?: boolean;
};

export function CheckoutFlow({
  paymentMode,
  payAtCounterEnabled,
  showDeliveryBreakdown,
  gstPercent,
  prefill,
  paymentOptions = [],
  liveGateways = [],
}: {
  paymentMode: "simulated" | "stripe";
  payAtCounterEnabled: boolean;
  showDeliveryBreakdown: boolean;
  gstPercent: number;
  /** Enabled card brands / Afterpay / PayPal from Admin → Delivery & payments. */
  paymentOptions?: CheckoutPaymentOption[];
  /** Gateways with real credentials configured, for the secure-checkout notice. */
  liveGateways?: string[];
  /** Saved account details — checkout should feel like a confirmation, not a form. */
  prefill?: Prefill;
}) {
  const router = useRouter();
  const { items, subtotalCents, setQty, remove, clear, hydrated } = useCart();

  const [channel, setChannel] = useState<Channel>("delivery");
  const [name, setName] = useState(prefill?.name ?? "");
  const [phone, setPhone] = useState(prefill?.phone ?? "");
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [address, setAddress] = useState(prefill?.address ?? "");
  const [suburb, setSuburb] = useState(prefill?.suburb ?? "");
  const [postcode, setPostcode] = useState(prefill?.postcode ?? "");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"online" | "counter">("online");
  const [paymentOption, setPaymentOption] = useState(
    paymentOptions[0]?.id ?? "card_visa",
  );
  const [promoCode, setPromoCode] = useState("");
  const [promotion, setPromotion] = useState<QuoteResponse["promotion"]>(null);
  const [promotionError, setPromotionError] = useState<string | null>(null);
  const [deliveryLat, setDeliveryLat] = useState<number | null>(null);
  const [deliveryLng, setDeliveryLng] = useState<number | null>(null);
  const [geoNote, setGeoNote] = useState("");
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [cardExpiry, setCardExpiry] = useState("12/34");
  const [cardCvc, setCardCvc] = useState("123");
  const [cardName, setCardName] = useState("");

  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [delivery, setDelivery] = useState<DeliveryQuote | null>(null);
  const [quoteToken, setQuoteToken] = useState<string | undefined>();
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const cartSignature = useMemo(
    () => JSON.stringify(items.map((item) => ({ v: item.variantId, q: item.qty })).sort((a, b) => a.v - b.v)),
    [items],
  );

  const fetchQuote = useCallback(async () => {
    if (items.length === 0) return;
    const current = ++requestId.current;
    setLoadingQuote(true);
    setQuoteError("");
    try {
      const hasAddress = channel === "delivery" && address.trim().length >= 5 && postcode.trim().length >= 3;
      const response = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          items: items.map((item) => ({ variantId: item.variantId, qty: item.qty })),
          address: hasAddress ? address : undefined,
          suburb,
          postcode,
          priority: priority && channel !== "dine_in",
          customerName: name,
          phone,
          notes,
          promoCode: promoCode.trim() || undefined,
          deliveryLat,
          deliveryLng,
        }),
      });
      const data = (await response.json()) as QuoteResponse;
      if (current !== requestId.current) return;
      if (!response.ok) {
        setQuoteError(data.error ?? "Could not calculate delivery");
        if (data.error?.includes("minimum")) setPricing(null);
        return;
      }
      if (data.pricing) setPricing(data.pricing);
      setDelivery(data.delivery ?? null);
      setQuoteToken(data.quoteToken);
      setPromotion(data.promotion ?? null);
      setPromotionError(data.promotionError ?? null);
    } catch {
      if (current === requestId.current) setQuoteError("Network problem — check your connection and try again.");
    } finally {
      if (current === requestId.current) setLoadingQuote(false);
    }
  }, [items, channel, address, suburb, postcode, priority, name, phone, notes, promoCode, deliveryLat, deliveryLng]);

  useEffect(() => {
    if (!hydrated || items.length === 0) return;
    const timer = window.setTimeout(fetchQuote, 450);
    return () => window.clearTimeout(timer);
  }, [cartSignature, channel, address, suburb, postcode, priority, hydrated, fetchQuote, items.length]);

  useEffect(() => {
    if (channel === "delivery" && paymentMethod === "counter") setPaymentMethod("online");
  }, [channel, paymentMethod]);

  /**
   * Best-effort browser geocoding. The coordinates travel with the order so
   * courier quotes, driver assignment, the live map and the ATO kilometre log
   * all use the same point. If OpenStreetMap is unreachable the server falls
   * back to a deterministic estimate and staff can correct it in admin.
   */
  useEffect(() => {
    if (channel !== "delivery" || address.trim().length < 5) return;
    let alive = true;
    const timer = window.setTimeout(async () => {
      const query = [address, suburb, postcode, "Australia"].filter(Boolean).join(", ");
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`,
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok) throw new Error("geocoder unavailable");
        const rows = (await res.json()) as { lat: string; lon: string }[];
        const lat = Number(rows[0]?.lat);
        const lng = Number(rows[0]?.lon);
        if (alive && Number.isFinite(lat) && Number.isFinite(lng)) {
          setDeliveryLat(lat);
          setDeliveryLng(lng);
          setGeoNote("Address pin confirmed");
        } else if (alive) setGeoNote("Using an approximate pin — we'll confirm at dispatch");
      } catch {
        if (alive) setGeoNote("Using an approximate pin — we'll confirm at dispatch");
      }
    }, 700);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [channel, address, suburb, postcode]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setGeoNote("Location is not available in this browser");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDeliveryLat(position.coords.latitude);
        setDeliveryLng(position.coords.longitude);
        setGeoNote("Using your device's location for the delivery pin");
      },
      () => setGeoNote("Location permission declined — address pin retained"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  const effectiveTotal = pricing?.totalCents ?? subtotalCents;
  const surchargeLines = pricing?.adjustments.filter((entry) => entry.kind === "weekend" || entry.kind === "public_holiday" || entry.kind === "priority" || entry.kind === "peak") ?? [];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (items.length === 0) return;
    if (name.trim().length < 2) return setError("Please enter the name for the order.");
    if (channel === "delivery") {
      if (address.trim().length < 5) return setError("Please enter a delivery street address.");
      if (postcode.trim().length < 3) return setError("Please enter the delivery postcode.");
      if (!delivery) return setError("We need a delivery quote before you can pay. Add your address above.");
      if (phone.replace(/\D/g, "").length < 8) return setError("A mobile number is required so the courier can reach you.");
    }
    const isCardOption = paymentOption.startsWith("card_");
    if (paymentMethod === "online" && paymentMode === "simulated" && isCardOption) {
      if (!luhnValid(cardNumber)) return setError("That card number does not look right (try 4242 4242 4242 4242).");
      if (!expiryValid(cardExpiry)) return setError("Enter the expiry as MM/YY, in the future.");
      if (!/^\d{3,4}$/.test(cardCvc)) return setError("Enter the 3 or 4 digit CVC.");
      if (cardName.trim().length < 2) return setError("Enter the name on the card.");
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          customerName: name,
          phone,
          email,
          address: channel === "delivery" ? address : undefined,
          suburb,
          postcode,
          notes,
          priority: priority && channel !== "dine_in",
          paymentMethod,
          paymentOption: paymentMethod === "online" ? paymentOption : undefined,
          paymentLast4: paymentMethod === "online" ? cardNumber.replace(/\D/g, "").slice(-4) : undefined,
          quoteToken,
          promoCode: promoCode.trim() || undefined,
          deliveryLat,
          deliveryLng,
          items: items.map((item) => ({
            itemId: item.itemId,
            variantId: item.variantId,
            qty: item.qty,
            spiceLevel: item.spice,
            notes: item.notes,
          })),
        }),
      });
      const data = (await response.json()) as { error?: string; redirectTo?: string };
      if (!response.ok) throw new Error(data.error || "Could not place the order");
      clear();
      router.push(data.redirectTo ?? "/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  if (!hydrated) {
    return <div className="empty">Loading your order…</div>;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon="bag"
        title="Your order is empty"
        body="Pick something from the tandoor and come back — we will hold your spot."
        action={
          <Link href="/menu" className="btn btn-primary">
            Browse the menu <Icon name="arrow" size={16} />
          </Link>
        }
      />
    );
  }

  return (
    <form onSubmit={submit} className="checkout-grid">
      <div>
        <section className="panel">
          <div className="panel-head">
            <h3>
              <span className="step-number">1</span>How would you like it?
            </h3>
            {pricing?.context ? (
              <span className="tiny muted">
                {pricing.context.holidayName ? pricing.context.holidayName : pricing.context.isWeekend ? "Weekend pricing" : "Standard pricing"}
              </span>
            ) : null}
          </div>
          <div className="service-tabs">
            {CHANNELS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="service-tab"
                data-active={channel === entry.id ? "true" : "false"}
                onClick={() => setChannel(entry.id)}
              >
                <b>
                  <Icon name={entry.icon} size={15} /> {entry.title}
                </b>
                <span>{entry.blurb}</span>
              </button>
            ))}
          </div>

          {channel === "dine_in" ? (
            <div className="notice" style={{ marginTop: 14 }}>
              <Icon name="table" size={15} />
              <span>
                Eating in? Settle at the counter when you leave. Ordering from your table?{" "}
                <Link href="/table/T04" style={{ color: "var(--accent)", textDecoration: "underline" }}>
                  Open the table menu
                </Link>{" "}
                to have it delivered to your seat.
              </span>
            </div>
          ) : null}

          {channel === "delivery" ? (
            <div className="quote-box">
              {loadingQuote ? (
                <div className="row">
                  <span className="muted">Requesting a live courier quote…</span>
                  <span className="badge badge-amber">Courier partners</span>
                </div>
              ) : delivery ? (
                <>
                  <div className="row">
                    <span className="strong">Courier delivery</span>
                    <span className="eta-pill">
                      <Icon name="clock" size={12} /> {delivery.etaMinutes} min
                    </span>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <span className="muted">Courier quote</span>
                    <span>{money(delivery.costCents)}</span>
                  </div>
                  {showDeliveryBreakdown ? (
                    <div className="row" style={{ marginTop: 4 }}>
                      <span className="muted">Service &amp; handling</span>
                      <span>{money(delivery.serviceFeeCents)}</span>
                    </div>
                  ) : null}
                  <div className="row" style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                    <span className="strong">Delivery fee</span>
                    <span className="strong">{money(delivery.feeCents)}</span>
                  </div>
                  <p className="tiny" style={{ color: "var(--muted-2)", marginTop: 8 }}>
                    {delivery.live
                      ? "Best live quote across our configured courier partners."
                      : "Estimated courier fee — confirmed at dispatch."}{" "}
                    Held for 15 minutes. {delivery.fallbackReason ? "Live quote unavailable, using our rate card." : ""}
                  </p>
                </>
              ) : quoteError ? (
                <div className="row">
                  <span style={{ color: "var(--red)" }}>{quoteError}</span>
                </div>
              ) : (
                <div className="row">
                  <span className="muted">Add your address below to see the live delivery fee.</span>
                </div>
              )}
            </div>
          ) : null}

          {channel !== "dine_in" ? (
            <label
              className="card"
              style={{
                marginTop: 14,
                padding: 14,
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                cursor: "pointer",
                borderColor: priority ? "rgba(243,171,63,0.5)" : undefined,
              }}
            >
              <input type="checkbox" checked={priority} onChange={(event) => setPriority(event.target.checked)} style={{ marginTop: 3, accentColor: "var(--accent)" }} />
              <div>
                <div className="small strong">
                  Priority preparation · {money(pricing?.priorityFeeCentsIfSelected ?? 250)}
                  {pricing?.context.isPeak ? <span className="badge badge-amber" style={{ marginLeft: 8 }}>Peak hour</span> : null}
                </div>
                <p className="tiny muted">
                  Jumps the kitchen queue and is dispatched first. Peak-hour pricing applies between 12–2pm and 6–9:30pm.
                  Not available for dine-in or table guests.
                </p>
              </div>
            </label>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>
              <span className="step-number">2</span>Your details
            </h3>
            {prefill?.signedIn ? (
              <span className="badge badge-green">
                <Icon name="check" size={11} /> From your account
              </span>
            ) : (
              <Link href="/login?reason=signin" className="tiny" style={{ color: "var(--accent)" }}>
                Sign in to fill this in
              </Link>
            )}
          </div>
          <div className="form-grid">
            <div className="field">
              <span className="label">Name on order</span>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Ayesha Khan" required />
            </div>
            <div className="field">
              <span className="label">Mobile{channel === "delivery" ? " (for the courier)" : ""}</span>
              <input className="input" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="04xx xxx xxx" inputMode="tel" />
            </div>
            {channel === "delivery" ? (
              <>
                <div className="field full">
                  <span className="label">Delivery address</span>
                  <input className="input" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street address, unit / level" required />
                </div>
                <div className="field">
                  <span className="label">Suburb</span>
                  <input className="input" value={suburb} onChange={(event) => setSuburb(event.target.value)} placeholder="Pyrmont" />
                </div>
                <div className="field">
                  <span className="label">Postcode</span>
                  <input className="input" value={postcode} onChange={(event) => setPostcode(event.target.value)} placeholder="2009" inputMode="numeric" maxLength={6} />
                </div>
                <div className="field full">
                  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                    <span className="tiny muted">
                      <Icon name="pin" size={13} />{" "}
                      {deliveryLat && deliveryLng
                        ? `Delivery pin ${deliveryLat.toFixed(5)}, ${deliveryLng.toFixed(5)}`
                        : "Resolving a map pin for the courier…"}
                      {geoNote ? ` · ${geoNote}` : ""}
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={useMyLocation}>
                      Use my location
                    </button>
                  </div>
                </div>
              </>
            ) : null}
            <div className="field">
              <span className="label">Email for receipt (optional)</span>
              <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            </div>
            <div className="field">
              <span className="label">Kitchen / courier notes</span>
              <input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Leave at reception, allergy info…" maxLength={300} />
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>
              <span className="step-number">3</span>Payment
            </h3>
            <span className="badge badge-green">
              <Icon name="shield" size={11} /> {paymentMode === "stripe" ? "Stripe secure" : "Sandbox"}
            </span>
          </div>

          <div className="pay-tabs">
            <button type="button" className="pay-tab" data-active={paymentMethod === "online" ? "true" : "false"} onClick={() => setPaymentMethod("online")}>
              <b>Pay now</b>
              <span>Card, Afterpay or PayPal</span>
            </button>
            <button
              type="button"
              className="pay-tab"
              data-active={paymentMethod === "counter" ? "true" : "false"}
              onClick={() => setPaymentMethod("counter")}
              disabled={!payAtCounterEnabled || channel === "delivery"}
              style={!payAtCounterEnabled || channel === "delivery" ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
            >
              <b>Pay at the counter</b>
              <span>Pick-up and dine-in only</span>
            </button>
          </div>

          {paymentMethod === "counter" ? (
            <div className="notice" style={{ marginTop: 14 }}>
              <Icon name="clock" size={15} />
              <span>
                Your order is sent to the counter for confirmation. Pay when you collect or when you finish your meal.
              </span>
            </div>
          ) : (
            <>
              <div className="pay-options">
                {paymentOptions.map((option) => {
                  const hosted =
                    (option.group === "card" || option.id === "afterpay")
                      ? paymentMode === "stripe"
                      : liveGateways.includes("paypal");
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className="pay-option"
                      data-active={paymentOption === option.id ? "true" : "false"}
                      onClick={() => setPaymentOption(option.id)}
                    >
                      <b>{option.label}</b>
                      <span>{option.blurb}</span>
                      <small>{hosted ? "Secure hosted checkout" : "Sandbox — no real charge"}</small>
                    </button>
                  );
                })}
              </div>

              {((paymentOption.startsWith("card_") && paymentMode === "stripe") ||
                (paymentOption === "afterpay" && paymentMode === "stripe") ||
                (paymentOption === "paypal" && liveGateways.includes("paypal"))) ? (
                <div className="notice notice-green" style={{ marginTop: 14 }}>
                  <Icon name="shield" size={15} />
                  <span>
                    You will be redirected to a secure hosted checkout. No card
                    details touch our servers.
                  </span>
                </div>
              ) : paymentOption.startsWith("card_") ? (
                <>
                  <div className="notice" style={{ marginTop: 14 }}>
                    <Icon name="shield" size={15} />
                    <span>
                      Payments are running in sandbox mode. Use the test card
                      below — no money moves, no card data is stored.
                    </span>
                  </div>
                  <div className="card-fields">
                    <div className="field">
                      <span className="label">Card number</span>
                      <input className="input" value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} inputMode="numeric" autoComplete="off" />
                    </div>
                    <div className="row">
                      <div className="field">
                        <span className="label">Expiry (MM/YY)</span>
                        <input className="input" value={cardExpiry} onChange={(event) => setCardExpiry(event.target.value)} placeholder="12/34" autoComplete="off" />
                      </div>
                      <div className="field">
                        <span className="label">CVC</span>
                        <input className="input" value={cardCvc} onChange={(event) => setCardCvc(event.target.value)} inputMode="numeric" maxLength={4} autoComplete="off" />
                      </div>
                    </div>
                    <div className="field">
                      <span className="label">Name on card</span>
                      <input className="input" value={cardName} onChange={(event) => setCardName(event.target.value)} placeholder="As printed" autoComplete="off" />
                    </div>
                  </div>
                </>
              ) : (
                <div className="notice" style={{ marginTop: 14 }}>
                  <Icon name="shield" size={15} />
                  <span>
                    {paymentOption === "paypal" ? "PayPal" : "Afterpay"} is in
                    sandbox mode — your order will be marked paid locally with no
                    real charge.
                  </span>
                </div>
              )}
            </>
          )}

          {error ? (
            <div className="notice notice-red" style={{ marginTop: 14 }}>
              {error}
            </div>
          ) : null}

          <button type="submit" className="btn btn-primary btn-block" style={{ marginTop: 18 }} disabled={submitting}>
            {submitting ? "Placing your order…" : `Place order · ${money(effectiveTotal)}`}
          </button>
          <p className="tiny" style={{ color: "var(--muted-2)", marginTop: 10, textAlign: "center" }}>
            {channel === "delivery" ? "Delivery orders are paid online before dispatch." : "You can cancel before the counter confirms."}{" "}
            All prices include {gstPercent}% GST.
          </p>
        </section>
      </div>

      <aside className="summary">
        <div className="panel">
          <div className="panel-head">
            <h3>Order summary</h3>
            <Link href="/menu" className="tiny" style={{ color: "var(--accent)" }}>
              + Add more
            </Link>
          </div>

          <div>
            {items.map((item) => (
              <div key={item.key} className="cart-line">
                <img src={item.image} alt="" />
                <div>
                  <div className="name">{item.name}</div>
                  <div className="opts">
                    {item.variantLabel}
                    {item.spice ? ` · ${item.spice.replace("_", " ")}` : ""}
                    {item.notes ? ` · ${item.notes}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                    <div className="qty" style={{ height: 28 }}>
                      <button type="button" style={{ height: 28, width: 28 }} onClick={() => setQty(item.key, item.qty - 1)} aria-label="Decrease">
                        <Icon name="minus" size={12} />
                      </button>
                      <span style={{ minWidth: 22, fontSize: "0.8rem" }}>{item.qty}</span>
                      <button type="button" style={{ height: 28, width: 28 }} onClick={() => setQty(item.key, item.qty + 1)} aria-label="Increase">
                        <Icon name="plus" size={12} />
                      </button>
                    </div>
                    <button type="button" className="cart-remove" onClick={() => remove(item.key)}>
                      Remove
                    </button>
                  </div>
                </div>
                <div className="mono small">{money(item.unitPriceCents * item.qty)}</div>
              </div>
            ))}
          </div>

          <div className="promo-box">
            <span className="label">Promotion code</span>
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <input
                className="input"
                value={promoCode}
                onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
                placeholder="e.g. WELCOME10"
                maxLength={32}
              />
            </div>
            {promotion ? (
              <p className="tiny" style={{ color: "var(--green)", marginTop: 6 }}>
                <Icon name="check" size={12} /> {promotion.label} — {money(promotion.discountCents)} off
              </p>
            ) : promotionError ? (
              <p className="tiny" style={{ color: "var(--red)", marginTop: 6 }}>
                {promotionError}
              </p>
            ) : promoCode ? (
              <p className="tiny muted" style={{ marginTop: 6 }}>Checking code…</p>
            ) : null}
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="summary-row">
              <span>Subtotal</span>
              <b>{money(pricing?.subtotalCents ?? subtotalCents)}</b>
            </div>
            {surchargeLines.map((line) => (
              <div className="summary-row" key={line.code}>
                <span>
                  {line.label}
                  {line.percent ? ` (${line.percent}%)` : ""}
                </span>
                <b>{money(line.amountCents)}</b>
              </div>
            ))}
            {pricing && pricing.deliveryFeeCents > 0 ? (
              <div className="summary-row">
                <span>Delivery</span>
                <b>{money(pricing.deliveryFeeCents)}</b>
              </div>
            ) : null}
            {channel === "delivery" && !delivery && !loadingQuote ? (
              <div className="summary-row">
                <span>Delivery</span>
                <b className="muted">Add address</b>
              </div>
            ) : null}
            {pricing && pricing.discountCents && pricing.discountCents > 0 ? (
              <div className="summary-row">
                <span style={{ color: "var(--green)" }}>
                  {promotion?.label ?? "Promotion"}
                </span>
                <b style={{ color: "var(--green)" }}>
                  −{money(pricing.discountCents)}
                </b>
              </div>
            ) : null}
            <div className="summary-total">
              <span>Total</span>
              <b>{money(effectiveTotal)}</b>
            </div>
            <p className="tiny" style={{ color: "var(--muted-2)", marginTop: 8 }}>
              Includes {gstPercent}% GST. Surcharges are set by the restaurant and shown line-by-line.
            </p>
          </div>

          <div className="notice" style={{ marginTop: 16 }}>
            <Icon name="clock" size={14} />
            <span>
              {channel === "delivery"
                ? `Estimated ${delivery?.etaMinutes ?? 30}–${(delivery?.etaMinutes ?? 30) + 10} min once dispatched.`
                : channel === "pickup"
                  ? "Ready for collection in about 20 minutes."
                  : "Fresh from the kitchen in about 15–20 minutes."}{" "}
              Track every step after you order.
            </span>
          </div>
        </div>
      </aside>
    </form>
  );
}
