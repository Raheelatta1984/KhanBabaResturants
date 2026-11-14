import Link from "next/link";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getBaseUrl } from "@/lib/url";
import {
  DOCUMENT_LABELS,
  driverAtoReport,
  driverDocuments,
  driverEvents,
  driverStats,
  financialYear,
  getDriver,
  issueDriverToken,
  listDrivers,
  REQUIRED_DOCUMENTS,
} from "@/lib/drivers";
import { money } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { ActionForm } from "@/components/portal/ActionForm";
import { OpsButton } from "@/components/portal/OpsButton";
import { CopyField } from "@/components/portal/CopyField";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { SettingsForm } from "@/components/portal/AdminForms";

export const dynamic = "force-dynamic";

const FYS = ["2026-27", "2025-26", "2024-25"];

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<{ driver?: string; fy?: string }>;
}) {
  const query = await searchParams;
  const db = await getDb();
  const [drivers, stats, settings, baseUrl, jobs] = await Promise.all([
    listDrivers(db),
    driverStats(db),
    getSettings(),
    getBaseUrl(),
    db.query<{
      id: number;
      order_code: string;
      provider: string;
      status: string;
      driver_id: number | null;
      customer_fee_cents: number;
    }>(
      `SELECT j.id, o.code AS order_code, j.provider, j.status, j.driver_id, j.customer_fee_cents
        FROM delivery_jobs j JOIN orders o ON o.id = j.order_id
        WHERE j.status IN ('quoted','requested','accepted','pickup','dropoff')
        ORDER BY j.id DESC LIMIT 20`,
    ),
  ]);
  const selectedId = Number(query.driver) || drivers[0]?.id || 0;
  const selected = drivers.find((driver) => driver.id === selectedId) ?? null;
  const fy = query.fy && FYS.includes(query.fy) ? query.fy : financialYear();
  const [documents, events, ledger, trips, report, driverRow] =
    await Promise.all([
      selected ? driverDocuments(db, selected.id) : Promise.resolve([]),
      selected ? driverEvents(db, selected.id) : Promise.resolve([]),
      selected
        ? db.query<{
            id: number; kind: string; amount_cents: number; description: string | null;
            settled_at: string | null; created_at: string;
          }>(
            "SELECT * FROM driver_ledger WHERE driver_id = $1 ORDER BY id DESC LIMIT 25",
            [selected.id],
          )
        : Promise.resolve([]),
      selected
        ? db.query<{
            id: number; order_code: string | null; distance_km: number;
            claim_cents: number; source: string; rate_cents_per_km: number;
            financial_year: string; ended_at: string | null; notes: string | null;
          }>(
            "SELECT * FROM driver_trips WHERE driver_id = $1 ORDER BY id DESC LIMIT 25",
            [selected.id],
          )
        : Promise.resolve([]),
      selected ? driverAtoReport(db, selected.id, fy) : Promise.resolve(null),
      selected ? getDriver(db, selected.id) : Promise.resolve(null),
    ]);
  const portalLink =
    selected && driverRow && driverRow.status === "approved"
      ? `${baseUrl}/driver/${await issueDriverToken(driverRow)}`
      : "";

  return (
    <>
      <AutoRefresh intervalMs={15000} />
      <div className="page-head">
        <div>
          <h1>Driver management</h1>
          <p>
            Onboarding, seven-point verification, commission, live GPS tracking
            and an ATO-ready kilometre history — all in one place.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/driver/apply" target="_blank" className="btn btn-outline btn-sm">
            Onboarding form
          </Link>
          <Link href="/admin/promotions" className="btn btn-ghost btn-sm">
            Driver promotions
          </Link>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><span>Driver partners</span><b>{stats.total}</b><small>{stats.approved} approved · {stats.pending} in review</small></div>
        <div className="stat-card"><span>Commission owed</span><b>{money(stats.owedCents)}</b><small>unsettled ledger entries</small></div>
        <div className="stat-card"><span>Commission paid</span><b style={{ color: "var(--green)" }}>{money(stats.paidCents)}</b><small>settled payouts</small></div>
        <div className="stat-card"><span>ATO rate ({financialYear()})</span><b>{settings.ato_cents_per_km_current}c</b><small>per km · 5,000 km cap</small></div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <section className="panel">
          <div className="panel-head"><h3>Delivery job assignment</h3></div>
          <p className="small muted" style={{ marginBottom: 12 }}>
            Assign an approved driver to a quoted or dispatched job. Commission
            is posted only when the delivery succeeds.
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Job</th><th>Order</th><th>Provider</th><th>Driver</th><th /></tr></thead>
              <tbody>
                {jobs.length === 0 ? <tr><td colSpan={5} className="muted">No open delivery jobs.</td></tr> : null}
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="tiny">#{job.id}</td>
                    <td><b>{job.order_code}</b></td>
                    <td className="tiny">{job.provider.replace(/_/g, " ")}</td>
                    <td className="tiny">
                      {drivers.find((driver) => driver.id === job.driver_id)?.code ?? "Unassigned"}
                    </td>
                    <td>
                      <ActionForm
                        endpoint="/api/ops/drivers"
                        action="assign"
                        compact
                        submitLabel="Assign"
                        hidden={{ jobId: job.id }}
                        fields={[
                          {
                            name: "driverId", label: "Driver", type: "select",
                            defaultValue: String(job.driver_id ?? drivers.find((d) => d.status === "approved")?.id ?? ""),
                            options: drivers.filter((d) => d.status === "approved").map((d) => ({
                              value: String(d.id), label: `${d.code} · ${d.first_name} ${d.last_name}`,
                            })),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Add a driver manually</h3></div>
          <ActionForm
            endpoint="/api/ops/drivers"
            action="create"
            submitLabel="Create application"
            fields={[
              { name: "firstName", label: "First name" },
              { name: "lastName", label: "Last name" },
              { name: "email", label: "Email", type: "email" },
              { name: "phone", label: "Mobile" },
              { name: "vehicleRego", label: "Registration" },
              { name: "licenceNumber", label: "Licence number" },
              { name: "abn", label: "ABN" },
              { name: "payId", label: "PayID" },
              { name: "baseLat", label: "Base latitude", type: "number" },
              { name: "baseLng", label: "Base longitude", type: "number" },
            ]}
          />
          <div style={{ marginTop: 16 }}>
            <SettingsForm
              values={settings}
              groups={[
                {
                  title: "Fleet defaults",
                  fields: [
                    { key: "own_fleet_enabled", label: "Offer our own drivers as a courier partner", type: "toggle" },
                    { key: "driver_onboarding_enabled", label: "Accept new applications", type: "toggle" },
                    { key: "driver_commission_percent", label: "Default commission", type: "number", suffix: "%" },
                    { key: "driver_base_fee_cents", label: "Default per-delivery fee", type: "number", suffix: "cents" },
                    { key: "own_fleet_base_fee_cents", label: "Fleet quote base", type: "number", suffix: "cents" },
                    { key: "own_fleet_per_km_cents", label: "Fleet quote per km", type: "number", suffix: "cents" },
                    { key: "driver_tracking_interval_seconds", label: "GPS ping interval", type: "number", suffix: "seconds" },
                    { key: "ato_cents_per_km_current", label: "Current ATO rate", type: "number", suffix: "c/km" },
                    {
                      key: "map_tile_provider", label: "Map background", type: "select",
                      options: [{ value: "osm", label: "OpenStreetMap tiles" }, { value: "none", label: "Offline grid (no external calls)" }],
                    },
                  ],
                },
              ]}
            />
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head"><h3>Driver register</h3><span className="tiny muted">Click a driver to verify and manage</span></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Driver</th><th>Contact</th><th>Vehicle</th><th>Verification</th><th>Jobs</th><th>Unpaid</th><th>Status</th></tr></thead>
            <tbody>
              {drivers.length === 0 ? (
                <tr><td colSpan={7} className="muted">No drivers yet — share the onboarding link to recruit.</td></tr>
              ) : null}
              {drivers.map((driver) => (
                <tr key={driver.id} data-active={driver.id === selectedId ? "true" : undefined}>
                  <td>
                    <Link href={`/admin/drivers?driver=${driver.id}`} style={{ color: "var(--accent)" }}>
                      <b>{driver.code}</b> · {driver.first_name} {driver.last_name}
                    </Link>
                  </td>
                  <td className="tiny">{driver.email}<div className="muted">{driver.phone}</div></td>
                  <td className="tiny">{driver.vehicle_type}{driver.vehicle_rego ? ` · ${driver.vehicle_rego}` : ""}</td>
                  <td>
                    <span className={`badge ${Number(driver.verified_count) >= REQUIRED_DOCUMENTS.length ? "badge-green" : "badge-amber"}`}>
                      {driver.verified_count}/{REQUIRED_DOCUMENTS.length} verified
                    </span>
                  </td>
                  <td>{Number(driver.completed_jobs)}</td>
                  <td>{money(Number(driver.unpaid_cents))}</td>
                  <td><span className={`badge ${driver.status === "approved" ? "badge-green" : driver.status === "suspended" || driver.status === "rejected" ? "badge-red" : "badge-amber"}`}>{driver.status.replace(/_/g, " ")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <>
          <section className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <div>
                <h3>{selected.code} · {selected.first_name} {selected.last_name}</h3>
                <span className="tiny muted">Applied {formatDateTime(selected.created_at)} · {selected.email}</span>
              </div>
              <span className={`badge ${selected.status === "approved" ? "badge-green" : "badge-amber"}`}>{selected.status.replace(/_/g, " ")}</span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {selected.status !== "approved" ? (
                <OpsButton endpoint="/api/ops/drivers" payload={{ action: "approve", driverId: selected.id }} successMessage="Driver approved" className="btn btn-primary btn-sm">
                  Approve driver
                </OpsButton>
              ) : null}
              {selected.status === "approved" ? (
                <OpsButton endpoint="/api/ops/drivers" payload={{ action: "status", driverId: selected.id, status: "suspended" }} className="btn btn-outline btn-sm" confirmMessage="Suspend this driver? They will no longer be dispatched.">
                  Suspend
                </OpsButton>
              ) : null}
              <OpsButton endpoint="/api/ops/drivers" payload={{ action: "payout", driverId: selected.id }} successMessage="Payout recorded" className="btn btn-outline btn-sm" confirmMessage="Mark all outstanding commission as paid?">
                Record payout
              </OpsButton>
            </div>
            {portalLink ? (
              <CopyField value={portalLink} label="Private driver portal link (live map + ATO history)" />
            ) : (
              <div className="notice">A private portal link is generated once every document is verified and the driver is approved.</div>
            )}
          </section>

          <div className="grid grid-2" style={{ marginTop: 18 }}>
            <section className="panel">
              <div className="panel-head"><h3>Verification checklist</h3><span className="tiny muted">Audited per document</span></div>
              {documents.map((document) => (
                <div key={document.id} className="verify-row">
                  <div>
                    <b className="small">{DOCUMENT_LABELS[document.kind] ?? document.kind}</b>
                    <div className="tiny muted">
                      Ref: {document.reference ?? "not supplied"} · status {document.status}
                      {document.verified_at ? ` · ${formatDateTime(document.verified_at)}` : ""}
                    </div>
                  </div>
                  <span className={`badge ${document.status === "verified" ? "badge-green" : document.status === "rejected" ? "badge-red" : "badge-amber"}`}>{document.status}</span>
                  <ActionForm
                    endpoint="/api/ops/drivers"
                    action="verify_document"
                    compact
                    submitLabel="Review"
                    hidden={{ documentId: document.id }}
                    fields={[
                      { name: "status", label: "Decision", type: "select", defaultValue: document.status === "verified" ? "verified" : "verified", options: [{ value: "verified", label: "Verify" }, { value: "rejected", label: "Reject" }, { value: "pending", label: "Reset to pending" }] },
                      { name: "notes", label: "Reviewer note", placeholder: "Optional" },
                    ]}
                  />
                </div>
              ))}
              <div className="panel-head" style={{ marginTop: 18 }}><h3>Commercials</h3></div>
              <ActionForm
                endpoint="/api/ops/drivers"
                action="commercials"
                submitLabel="Update commercials"
                hidden={{ driverId: selected.id }}
                fields={[
                  { name: "commissionPercent", label: "Commission", type: "number", suffix: "%", defaultValue: selected.commission_percent },
                  { name: "perDeliveryFeeCents", label: "Per-delivery fee", type: "number", suffix: "cents", defaultValue: selected.per_delivery_fee_cents },
                  { name: "maxRadiusKm", label: "Max radius", type: "number", suffix: "km", defaultValue: selected.max_radius_km },
                ]}
              />
            </section>

            <section className="panel">
              <div className="panel-head"><h3>Verification audit &amp; ledger</h3></div>
              <div className="timeline" style={{ marginBottom: 18 }}>
                {events.slice(0, 8).map((event) => (
                  <div key={event.id} className="timeline-item">
                    <span className="bar" />
                    <div><b>{event.action.replace(/_/g, " ")}</b><span>{formatDateTime(event.created_at)} · {event.actor}</span>{event.detail ? <p className="tiny muted">{event.detail}</p> : null}</div>
                  </div>
                ))}
              </div>
              {ledger.length === 0 ? <p className="small muted">No commission posted yet.</p> : null}
              {ledger.map((entry) => (
                <div className="summary-row" key={entry.id}>
                  <span>{entry.description ?? entry.kind}<div className="tiny muted">{formatDateTime(entry.created_at)}</div></span>
                  <b style={{ color: entry.amount_cents >= 0 ? "var(--green)" : "var(--muted)" }}>{money(entry.amount_cents)}</b>
                </div>
              ))}
            </section>
          </div>

          <section className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <h3>ATO kilometre report</h3>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {FYS.map((year) => (
                  <Link key={year} href={`/admin/drivers?driver=${selected.id}&fy=${year}`} className="chip" data-active={year === fy ? "true" : "false"}>{year}</Link>
                ))}
                <a className="btn btn-primary btn-sm" href={`/api/ops/drivers/ato-report?driver=${selected.id}&fy=${fy}`}>
                  Download CSV
                </a>
              </div>
            </div>
            {report ? (
              <div className="grid grid-3" style={{ marginBottom: 14 }}>
                <div className="stat-card"><span>Business km ({fy})</span><b>{report.totalKm.toFixed(2)}</b><small>{report.trips.length} logged trips</small></div>
                <div className="stat-card"><span>Claimable km</span><b>{report.claimableKm.toFixed(2)}</b><small>cap {report.capKm} km · {report.rate}c/km</small></div>
                <div className="stat-card"><span>Estimated deduction</span><b style={{ color: "var(--green)" }}>{money(report.claimCents)}</b><small>cents-per-km method</small></div>
              </div>
            ) : null}
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Order / trip</th><th>Date</th><th>Distance</th><th>Source</th><th>Rate</th><th>Claim</th></tr></thead>
                <tbody>
                  {trips.length === 0 ? <tr><td colSpan={6} className="muted">No trips recorded yet. GPS breadcrumbs are logged when the driver shares location.</td></tr> : null}
                  {trips.map((trip) => (
                    <tr key={trip.id}>
                      <td><b>{trip.order_code ?? `Trip #${trip.id}`}</b><div className="tiny muted">{trip.financial_year}</div></td>
                      <td className="tiny">{formatDateTime(trip.ended_at)}</td>
                      <td>{Number(trip.distance_km).toFixed(2)} km</td>
                      <td className="tiny">{trip.source}</td>
                      <td className="tiny">{trip.rate_cents_per_km}c/km</td>
                      <td>{money(trip.claim_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny muted" style={{ marginTop: 12 }}>
              ATO rates: 2026-27 = 91c/km, 2025-26 and 2024-25 = 88c/km. The
              rate is captured on each trip so older reports never change. The
              cents-per-km method is capped at 5,000 business km per car per
              year; the CSV is suitable for a tax agent or myTax records.
            </p>
          </section>
        </>
      ) : null}
    </>
  );
}
