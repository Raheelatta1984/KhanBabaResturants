"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { money } from "@/lib/money";
import { useCart } from "./CartProvider";
import { Icon } from "./Icon";
import { StatusBadge } from "./ui";
import { DeliveryMap, type DeliveryMapData } from "./DeliveryMap";

export type TrackPayload = {
  order: {
    code: string;
    channel: "delivery" | "pickup" | "dine_in" | "table";
    status: string;
    progress: number;
    paymentStatus: string;
    paymentMethod: string;
    totalCents: number;
    subtotalCents: number;
    surchargeCents: number;
    priorityFeeCents: number;
    deliveryFeeCents: number;
    discountCents?: number;
    promotionCode?: string | null;
    paymentOption?: string | null;
    paymentOptionLabel?: string;
    priority: boolean;
    customerName: string;
    address: string | null;
    suburb: string | null;
    postcode: string | null;
    notes: string | null;
    createdAt: string;
    confirmedAt: string | null;
    readyAt: string | null;
    dispatchedAt: string | null;
    completedAt: string | null;
  };
  items: {
    id: number;
    itemId: number | null;
    variantId: number | null;
    name: string;
    variantLabel: string | null;
    spice: string | null;
    qty: number;
    unitPriceCents: number;
    lineTotalCents: number;
    prepState: string;
  }[];
  events: { id: number; message: string; actor: string | null; progress: number | null; createdAt: string }[];
  delivery: {
    provider: string;
    providerLabel?: string;
    status: string;
    courierName: string | null;
    courierPhone: string | null;
    trackingUrl: string | null;
    etaMinutes: number | null;
  } | null;
  table: { code: string; name: string } | null;
  tracking?: DeliveryMapData | null;
};

const CHANNEL_LABEL: Record<string, string> = {
  delivery: "Delivery",
  pickup: "Click & collect",
  dine_in: "Dine in",
  table: "Table order",
};

function formatTime(value: string | null | undefined) {
  if (!value) return "";
  const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function TrackingView({ initial, justPlaced }: { initial: TrackPayload; justPlaced?: boolean }) {
  const [data, setData] = useState<TrackPayload>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [addedAgain, setAddedAgain] = useState(false);
  const { add } = useCart();
  const order = data.order;
  const isDelivery = order.channel === "delivery";
  const finished = ["completed", "cancelled"].includes(order.status);

  useEffect(() => {
    if (finished) return;
    let alive = true;
    const tick = async () => {
      try {
        const response = await fetch(`/api/orders/${order.code}`, { cache: "no-store" });
        if (!response.ok) return;
        const next = (await response.json()) as TrackPayload;
        if (alive) setData(next);
      } catch {
        /* keep last known state */
      } finally {
        if (alive) setRefreshing(false);
      }
    };
    setRefreshing(true);
    tick();
    const timer = window.setInterval(tick, 6000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [order.code, finished]);

  const steps = [
    { key: "placed", label: "Order received", detail: "We have your ticket", pct: 5 },
    { key: "confirmed", label: "Counter confirmed", detail: "Sent to the kitchen display", pct: 20 },
    { key: "kitchen", label: "In the kitchen", detail: "Cooked to order, item by item", pct: 45 },
    {
      key: "ready",
      label: order.channel === "pickup" ? "Ready for collection" : "Packed & ready",
      detail: order.channel === "pickup" ? "Collect from the counter" : "Sealed for travel",
      pct: 85,
    },
    ...(isDelivery
      ? [{ key: "dispatched", label: "Out for delivery", detail: data.delivery?.courierName ? `Courier ${data.delivery.courierName}` : "Courier requested", pct: 92 }]
      : []),
    {
      key: "done",
      label: isDelivery ? "Delivered" : order.channel === "pickup" ? "Collected" : "Served",
      detail: "Enjoy your meal",
      pct: 100,
    },
  ];

  function reorder() {
    let added = 0;
    for (const item of data.items) {
      if (!item.itemId || !item.variantId) continue;
      add({
        itemId: item.itemId,
        variantId: item.variantId,
        slug: "",
        name: item.name,
        image: "/images/biryani-chicken.jpg",
        variantLabel: item.variantLabel ?? "",
        sizeMl: null,
        unitPriceCents: item.unitPriceCents,
        spice: item.spice,
      });
      added += 1;
    }
    if (added > 0) {
      setAddedAgain(true);
      window.setTimeout(() => setAddedAgain(false), 2200);
    }
  }

  return (
    <div className="track-shell">
      <div>
        <div className="panel">
          <div className="track-head">
            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="badge badge-amber">{CHANNEL_LABEL[order.channel]}</span>
                <StatusBadge status={order.status} />
                {order.priority ? <span className="badge badge-blue">Priority</span> : null}
                <span className={`badge ${order.paymentStatus === "paid" ? "badge-green" : "badge-red"}`}>
                  {order.paymentStatus === "paid" ? "Paid" : order.paymentStatus === "refunded" ? "Refunded" : "Payment due"}
                </span>
              </div>
              <h1 style={{ fontSize: "clamp(1.7rem, 3.4vw, 2.4rem)", margin: "14px 0 4px" }}>
                Order {order.code}
              </h1>
              <p className="small muted">
                {data.table ? `${data.table.name} · ` : ""}
                {order.customerName} · placed {formatTime(order.createdAt)}
                {data.delivery?.etaMinutes && isDelivery ? ` · courier ETA ${data.delivery.etaMinutes} min` : ""}
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="track-percent">{order.progress}%</div>
              <div className="tiny muted">{refreshing ? "Syncing…" : "Live · updates every 6s"}</div>
            </div>
          </div>

          <div className="progress" aria-hidden="true">
            <i style={{ width: `${Math.max(4, order.progress)}%` }} />
          </div>

          {justPlaced && order.status === "pending_confirm" ? (
            <div className="notice" style={{ marginTop: 14 }}>
              <span className="live-dot" />
              <span>
                Thanks {order.customerName.split(" ")[0]}! Your order is with our counter team. Once accepted it goes
                straight to the kitchen and this screen updates automatically.
              </span>
            </div>
          ) : null}

          <div className="track-steps">
            {steps.map((step) => {
              const done = order.progress >= step.pct && step.pct !== 100;
              const current = order.progress < step.pct
                ? false
                : order.progress >= step.pct && order.progress < (steps.find((s) => s.pct > step.pct)?.pct ?? 101);
              return (
                <div key={step.key} className="track-step" data-done={done ? "true" : "false"} data-current={current && !done ? "true" : "false"}>
                  <span className="dot">{done ? <Icon name="check" size={13} /> : step.pct === 100 && order.status === "completed" ? <Icon name="check" size={13} /> : ""}</span>
                  <div>
                    <b>{step.label}</b>
                    <span>{step.detail}</span>
                  </div>
                  <span className="tiny" style={{ marginLeft: "auto", color: "var(--muted-2)" }}>
                    {step.pct}%
                  </span>
                </div>
              );
            })}
          </div>

          <div className="notice" style={{ marginTop: 18 }}>
            <Icon name="clock" size={15} />
            <span>
              {order.status === "pending_confirm"
                ? "Waiting for the counter to confirm — usually under two minutes at peak times."
                : order.status === "confirmed"
                  ? "Confirmed. The kitchen is picking up your ticket now."
                  : order.status === "preparing"
                    ? "The kitchen is preparing your dishes. Each item updates as it is finished."
                    : order.status === "ready"
                      ? isDelivery
                        ? "Packed and waiting for the delivery coordinator to request the courier."
                        : "Ready to serve."
                      : order.status === "awaiting_collection"
                        ? "Ready at the counter — just quote your order number."
                        : order.status === "out_for_delivery"
                          ? "Your courier is on the way. Keep your phone handy."
                          : order.status === "completed"
                            ? "Order complete. We would love a review of your meal."
                            : "This order was cancelled. Any payment will be refunded."}
            </span>
          </div>
        </div>

        {isDelivery && data.tracking && !["cancelled", "completed"].includes(order.status) ? (
          <DeliveryMap
            data={data.tracking}
            title="Follow your delivery"
            refreshUrl={`/api/orders/${encodeURIComponent(order.code)}`}
          />
        ) : null}

        <div className="panel">
          <div className="panel-head">
            <h3>Items in this order</h3>
            <span className="tiny muted">
              {data.items.filter((item) => item.prepState === "ready").length}/{data.items.length} ready
            </span>
          </div>
          {data.items.map((item) => (
            <div key={item.id} className="item-status">
              <div>
                <div className="small">
                  <span className="mono" style={{ color: "var(--accent)" }}>
                    {item.qty}×
                  </span>{" "}
                  {item.name}
                </div>
                <div className="tiny" style={{ color: "var(--muted-2)" }}>
                  {item.variantLabel}
                  {item.spice ? ` · ${item.spice.replace("_", " ")}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className={`badge ${item.prepState === "ready" ? "badge-green" : item.prepState === "preparing" ? "badge-amber" : "badge-muted"}`}>
                  {item.prepState === "ready" ? "Ready" : item.prepState === "preparing" ? "On the fire" : "Queued"}
                </span>
                <span className="small mono">{money(item.lineTotalCents)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Progress log</h3>
            <span className="tiny muted">{data.events.length} updates</span>
          </div>
          <div className="timeline">
            {[...data.events].reverse().map((event) => (
              <div key={event.id} className="timeline-item">
                <span className="bar" />
                <div>
                  <b>{event.message}</b>
                  <span>
                    {formatTime(event.createdAt)} · {event.actor ?? "system"}
                    {event.progress != null ? ` · ${event.progress}%` : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside>
        <div className="panel">
          <h3 style={{ fontSize: "1.05rem", marginBottom: 14 }}>Bill</h3>
          <div className="summary-row">
            <span>Subtotal</span>
            <b>{money(order.subtotalCents)}</b>
          </div>
          {order.surchargeCents > 0 ? (
            <div className="summary-row">
              <span>Surcharges</span>
              <b>{money(order.surchargeCents)}</b>
            </div>
          ) : null}
          {order.priorityFeeCents > 0 ? (
            <div className="summary-row">
              <span>Priority preparation</span>
              <b>{money(order.priorityFeeCents)}</b>
            </div>
          ) : null}
          {order.deliveryFeeCents > 0 ? (
            <div className="summary-row">
              <span>Delivery</span>
              <b>{money(order.deliveryFeeCents)}</b>
            </div>
          ) : null}
          {order.discountCents && order.discountCents > 0 ? (
            <div className="summary-row">
              <span style={{ color: "var(--green)" }}>
                Promotion {order.promotionCode ? `(${order.promotionCode})` : ""}
              </span>
              <b style={{ color: "var(--green)" }}>−{money(order.discountCents)}</b>
            </div>
          ) : null}
          <div className="summary-total">
            <span>Total</span>
            <b>{money(order.totalCents)}</b>
          </div>
          <p className="tiny" style={{ color: "var(--muted-2)", marginTop: 10 }}>
            {order.paymentStatus === "paid"
              ? order.paymentMethod === "counter"
                ? "Paid at the counter."
                : "Paid online. GST included."
              : "Payment due at the counter. Show your order number."}
          </p>
        </div>

        {isDelivery ? (
          <div className="panel">
            <h3 style={{ fontSize: "1.05rem", marginBottom: 12 }}>Delivery</h3>
            <div className="small strong">
              {data.delivery?.courierName ? `Courier: ${data.delivery.courierName}` : "Courier not assigned yet"}
            </div>
            <p className="tiny muted" style={{ marginTop: 6 }}>
              {order.address}
              {order.suburb ? `, ${order.suburb}` : ""} {order.postcode ?? ""}
            </p>
            {data.delivery?.trackingUrl ? (
              <a href={data.delivery.trackingUrl} className="btn btn-outline btn-sm btn-block" style={{ marginTop: 12 }} target="_blank" rel="noreferrer">
                Open courier tracking
              </a>
            ) : null}
            {data.delivery?.etaMinutes ? (
              <div className="eta-pill" style={{ marginTop: 12 }}>
                <Icon name="clock" size={12} /> ETA {data.delivery.etaMinutes} min
              </div>
            ) : null}
            <p className="tiny" style={{ color: "var(--muted-2)", marginTop: 12 }}>
              Delivered by {data.delivery?.providerLabel ?? "our delivery partner"}.
              {order.paymentOptionLabel && order.paymentMethod === "online"
                ? ` Paid with ${order.paymentOptionLabel}.`
                : ""}
            </p>
          </div>
        ) : null}

        <div className="panel">
          <h3 style={{ fontSize: "1.05rem", marginBottom: 12 }}>Need a hand?</h3>
          <p className="small muted">
            Call the restaurant and quote <b style={{ color: "var(--text)" }}>{order.code}</b>.
          </p>
          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            <a href="tel:0290001234" className="btn btn-outline btn-sm btn-block">
              <Icon name="phone" size={14} /> Call the counter
            </a>
            <button type="button" className="btn btn-ghost btn-sm btn-block" onClick={reorder}>
              <Icon name={addedAgain ? "check" : "cart"} size={14} /> {addedAgain ? "Added to cart" : "Order these again"}
            </button>
            <Link href="/menu" className="btn btn-ghost btn-sm btn-block">
              Back to the menu
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
