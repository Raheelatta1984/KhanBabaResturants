"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DeliveryMap, type DeliveryMapData } from "./DeliveryMap";
import { Icon } from "./Icon";
import { money } from "@/lib/money";
import { formatDate } from "@/lib/time";

export type DriverPortalData = {
  token: string;
  driver: { code: string; name: string; commissionPercent: number; baseFeeCents: number };
  intervalSeconds: number;
  fy: string;
  rate: number;
  report: { totalKm: number; claimableKm: number; claimCents: number; capKm: number };
  job: {
    id: number;
    orderCode: string;
    address: string | null;
    suburb: string | null;
    postcode: string | null;
    status: string;
    tracking: DeliveryMapData;
  } | null;
  ledger: {
    id: number;
    kind: string;
    amount_cents: number;
    description: string | null;
    settled_at: string | null;
    created_at: string;
  }[];
  trips: {
    id: number;
    order_code: string | null;
    distance_km: number;
    claim_cents: number;
    source: string;
    financial_year: string;
    ended_at: string | null;
  }[];
};

export function DriverPortal({ initial }: { initial: DriverPortalData }) {
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState("Location sharing is off");
  const [delivering, setDelivering] = useState(false);
  const [completed, setCompleted] = useState(
    initial.job?.status === "delivered",
  );
  const [fee, setFee] = useState<number | null>(null);
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);

  async function ping(position: GeolocationPosition) {
    const now = Date.now();
    if (now - lastSent.current < initial.intervalSeconds * 1000) return;
    lastSent.current = now;
    try {
      const res = await fetch("/api/driver/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: initial.token,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy,
          heading: position.coords.heading,
          speedKmh: position.coords.speed
            ? Math.round(position.coords.speed * 3.6)
            : null,
        }),
      });
      if (!res.ok) throw new Error("ping rejected");
      setStatus(`Location shared at ${new Date().toLocaleTimeString("en-AU")}`);
    } catch {
      setStatus("Could not share location — check your connection");
    }
  }

  useEffect(() => {
    if (!sharing) {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      return;
    }
    if (!navigator.geolocation) {
      setStatus("This browser does not support location sharing");
      setSharing(false);
      return;
    }
    setStatus("Waiting for a GPS fix…");
    watchId.current = navigator.geolocation.watchPosition(
      ping,
      () => setStatus("Location permission is off — enable it in your browser"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharing]);

  async function markDelivered() {
    if (!initial.job) return;
    setDelivering(true);
    try {
      const res = await fetch("/api/driver/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: initial.token, jobId: initial.job.id }),
      });
      const data = (await res.json()) as { error?: string; driverFeeCents?: number };
      if (!res.ok) throw new Error(data.error ?? "Could not mark delivered");
      setCompleted(true);
      setFee(data.driverFeeCents ?? null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not complete job");
    } finally {
      setDelivering(false);
    }
  }

  return (
    <div className="driver-portal">
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <div className="stat-card">
          <span>Commission rate</span>
          <b>{initial.driver.commissionPercent}%</b>
          <small>+ {money(initial.driver.baseFeeCents)} per delivery</small>
        </div>
        <div className="stat-card">
          <span>{initial.fy} business km</span>
          <b>{initial.report.totalKm.toFixed(1)} km</b>
          <small>{initial.rate}c/km · capped at {initial.report.capKm} km</small>
        </div>
        <div className="stat-card">
          <span>ATO claim estimate</span>
          <b style={{ color: "var(--green)" }}>{money(initial.report.claimCents)}</b>
          <small>{initial.report.claimableKm.toFixed(1)} claimable km</small>
        </div>
      </div>

      {initial.job ? (
        <section className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-head">
            <h3>Active delivery · {initial.job.orderCode}</h3>
            <span className={`badge ${completed ? "badge-green" : "badge-blue"}`}>
              {completed ? "Delivered" : initial.job.status.replace(/_/g, " ")}
            </span>
          </div>
          <p className="small muted" style={{ marginBottom: 12 }}>
            {[initial.job.address, initial.job.suburb, initial.job.postcode]
              .filter(Boolean)
              .join(", ")}
          </p>
          <DeliveryMap
            data={initial.job.tracking}
            title="Your route"
            refreshUrl={`/api/driver/location?token=${encodeURIComponent(initial.token)}`}
          />
          <div className="row" style={{ marginTop: 14, gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className={`btn ${sharing ? "btn-outline" : "btn-primary"}`}
              onClick={() => setSharing((value) => !value)}
            >
              <Icon name="pin" size={14} />{" "}
              {sharing ? "Stop sharing location" : "Share my live location"}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={markDelivered}
              disabled={delivering || completed}
            >
              <Icon name="check" size={14} />{" "}
              {completed ? "Delivered — commission posted" : "Mark delivered"}
            </button>
            <span className="tiny muted">{status}</span>
          </div>
          {fee != null ? (
            <div className="notice notice-green" style={{ marginTop: 12 }}>
              {money(fee)} credited to your ledger and the trip logged for your
              ATO report.
            </div>
          ) : null}
        </section>
      ) : (
        <div className="notice" style={{ marginBottom: 18 }}>
          No active delivery. Approved jobs appear here as soon as the dispatch
          desk assigns one to you.
        </div>
      )}

      <div className="grid grid-2">
        <section className="panel">
          <div className="panel-head">
            <h3>Commission ledger</h3>
            <span className="tiny muted">{initial.ledger.length} entries</span>
          </div>
          {initial.ledger.length === 0 ? (
            <p className="small muted">No earnings posted yet.</p>
          ) : (
            initial.ledger.map((entry) => (
              <div className="summary-row" key={entry.id}>
                <span>
                  {entry.description ?? entry.kind}
                  <div className="tiny muted">{formatDate(entry.created_at)}</div>
                </span>
                <b style={{ color: entry.amount_cents >= 0 ? "var(--green)" : "var(--muted)" }}>
                  {money(entry.amount_cents)}
                </b>
              </div>
            ))
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>ATO kilometre history</h3>
            <a
              className="btn btn-outline btn-sm"
              href={`/api/driver/ato-report?token=${encodeURIComponent(initial.token)}&fy=${initial.fy}`}
            >
              Download CSV
            </a>
          </div>
          {initial.trips.length === 0 ? (
            <p className="small muted">Trips are recorded when a delivery completes.</p>
          ) : (
            initial.trips.map((trip) => (
              <div className="summary-row" key={trip.id}>
                <span>
                  {trip.order_code ?? "Trip"} · {trip.financial_year}
                  <div className="tiny muted">
                    {trip.ended_at ? formatDate(trip.ended_at) : "In progress"} · {trip.source}
                  </div>
                </span>
                <b>{Number(trip.distance_km).toFixed(2)} km</b>
              </div>
            ))
          )}
          <p className="tiny muted" style={{ marginTop: 12 }}>
            Cents-per-km method, capped at 5,000 business km per year. Keep this
            CSV with your tax records.{" "}
            <Link href="/driver/apply" className="tiny">Partner terms</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
