"use client";

import { useEffect, useState } from "react";
import { Icon } from "../Icon";

/**
 * Server-side integration health, rendered in the admin portal.
 *
 * The data comes from /api/ops/diagnostics, which masks every secret to its
 * last four characters before it leaves the server. This component never sees
 * a token in full, and nothing here is fetched on the public site.
 */

type Credential = {
  field: string;
  envKey: string;
  source: "env" | "settings" | "none";
  value: string;
  shadowed: boolean;
};

type Diagnostics = {
  ok: boolean;
  checkedAt: string;
  whatsapp: {
    enabled: boolean;
    configured: boolean;
    mode: string;
    credentialMode: string;
    phoneNumberId: string;
    businessAccountId: string;
    catalogId: string | null;
    mixedSources: boolean;
    shadowed: string[];
  };
  credentials: Credential[];
  lastFailure: {
    created_at: string;
    error: string | null;
    kind: string;
    status: string;
  } | null;
  connection: { ok: boolean; error?: string; hint?: string; verifiedName?: string } | null;
  deliveryZones: {
    count: number;
    postcodes: number;
    rates: {
      name: string;
      postcodes: string;
      baseFee: number;
      perKm: number;
      minOrder: number;
      freeOver: number | null;
    }[];
  };
  social: {
    facebookPageId: string | null;
    facebookToken: string;
    instagramAccountId: string | null;
    instagramToken: string;
  };
  problems: string[];
};

const SOURCE_LABEL: Record<Credential["source"], string> = {
  env: "Vercel env",
  settings: "Admin portal",
  none: "missing",
};

export function IntegrationDiagnostics() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = async (probe = false) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/ops/diagnostics${probe ? "?probe=1" : ""}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as Diagnostics & { error?: string };
      if (json.error) setNote(json.error);
      else setData(json);
    } catch {
      setNote("Could not reach the diagnostics endpoint.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const setMode = async (mode: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/ops/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-credential-mode", mode }),
      });
      const json = (await res.json()) as { message?: string; error?: string };
      setNote(json.message ?? json.error ?? null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h3>Integration diagnostics</h3>
        </div>
        <p className="small muted">{note ?? "Reading configuration…"}</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Integration diagnostics</h3>
        <span className="tiny muted">
          checked {new Date(data.checkedAt).toLocaleTimeString("en-AU")}
        </span>
      </div>

      {data.problems.length > 0 ? (
        <div
          className="card"
          style={{ padding: 14, marginBottom: 14, borderLeft: "3px solid #b45309" }}
        >
          <b className="small">Needs attention</b>
          <ul className="small" style={{ margin: "8px 0 0 18px" }}>
            {data.problems.map((problem) => (
              <li key={problem} style={{ marginBottom: 6 }}>
                {problem}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <span className="badge badge-green">all integrations healthy</span>
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button className="btn btn-sm" disabled={busy} onClick={() => void load(true)}>
          <Icon name="chart" /> Test live connection
        </button>
        <button className="btn btn-sm" disabled={busy} onClick={() => void load()}>
          Refresh
        </button>
        <span className="tiny muted">
          Credential source:&nbsp;
          <b>{data.whatsapp.credentialMode}</b>
        </span>
        {["auto", "settings", "env"].map((mode) => (
          <button
            key={mode}
            className={`btn btn-sm ${data.whatsapp.credentialMode === mode ? "btn-primary" : ""}`}
            disabled={busy}
            onClick={() => void setMode(mode)}
          >
            {mode === "settings" ? "Use admin portal" : mode === "env" ? "Use Vercel env" : "Auto"}
          </button>
        ))}
      </div>

      {note ? <p className="small muted">{note}</p> : null}

      <table className="table small">
        <thead>
          <tr>
            <th>Credential</th>
            <th>Source</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {data.credentials.map((row) => (
            <tr key={row.field}>
              <td>
                <code className="tiny">{row.envKey}</code>
              </td>
              <td>
                <span
                  className={`badge ${
                    row.source === "none"
                      ? "badge-amber"
                      : row.shadowed
                        ? "badge-amber"
                        : "badge-green"
                  }`}
                >
                  {SOURCE_LABEL[row.source]}
                </span>
                {row.shadowed ? (
                  <span className="tiny muted"> overriding portal value</span>
                ) : null}
              </td>
              <td className="tiny muted">{row.value || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.connection ? (
        <p className="small" style={{ marginTop: 12 }}>
          {data.connection.ok ? (
            <>
              <span className="badge badge-green">live</span> Connected as{" "}
              <b>{data.connection.verifiedName || "the business"}</b>.
            </>
          ) : (
            <>
              <span className="badge badge-amber">failed</span> {data.connection.error}
              {data.connection.hint ? <span className="muted"> — {data.connection.hint}</span> : null}
            </>
          )}
        </p>
      ) : null}

      {data.lastFailure ? (
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Last failed send: {data.lastFailure.error} · {new Date(data.lastFailure.created_at).toLocaleString("en-AU")}
        </p>
      ) : null}

      <div className="grid grid-2" style={{ marginTop: 18, gap: 14 }}>
        <div className="card" style={{ padding: 14 }}>
          <div className="row">
            <b className="small">Delivery zones</b>
            <span className="badge">{data.deliveryZones.postcodes} postcodes</span>
          </div>
          {data.deliveryZones.rates.length === 0 ? (
            <p className="tiny muted" style={{ marginTop: 8 }}>
              No zones configured — delivery falls back to the kitchen radius.
            </p>
          ) : (
            <table className="table tiny" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Base</th>
                  <th>/km</th>
                  <th>Min</th>
                </tr>
              </thead>
              <tbody>
                {data.deliveryZones.rates.map((zone) => (
                  <tr key={zone.name}>
                    <td>
                      {zone.name}
                      <div className="muted">{zone.postcodes}</div>
                    </td>
                    <td>${zone.baseFee.toFixed(2)}</td>
                    <td>${zone.perKm.toFixed(2)}</td>
                    <td>${zone.minOrder.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ padding: 14 }}>
          <b className="small">Social channels</b>
          <table className="table tiny" style={{ marginTop: 8 }}>
            <tbody>
              <tr>
                <td>Facebook Page</td>
                <td>{data.social.facebookPageId ?? "not set"}</td>
              </tr>
              <tr>
                <td>Facebook token</td>
                <td>{data.social.facebookToken || "not set"}</td>
              </tr>
              <tr>
                <td>Instagram account</td>
                <td>{data.social.instagramAccountId ?? "not set"}</td>
              </tr>
              <tr>
                <td>Instagram token</td>
                <td>{data.social.instagramToken || "not set"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
