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

type TokenAttempt = {
  origin: "settings" | "env";
  envKey?: string;
  alias?: "primary" | "new";
  masked: string;
  ok: boolean;
  error?: string;
  errorCode?: number;
  hint?: string;
  verifiedName?: string;
  displayPhoneNumber?: string;
};

type CredentialProbe = {
  attempts: TokenAttempt[];
  winner: TokenAttempt | null;
  recommendation: { credentialMode: string; tokenAlias: string | null; message: string } | null;
  nextStep: string | null;
};

type CatalogDiscovery = {
  ok: boolean;
  configuredCatalogId: string | null;
  businessAccountId: string | null;
  businessAccountName: string | null;
  catalogs: {
    id: string;
    name: string;
    connected: boolean;
    source: string;
  }[];
  suggestedCatalogId: string | null;
  error?: string;
  hint?: string;
  setupSteps: string[];
  canCreate: boolean;
  createBlocked?: string;
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
    businessId: string | null;
    tokenAlias: "primary" | "new";
    tokenEnvKey: string;
    fieldSources: Record<string, string>;
    tokenVerified: boolean;
    verifiedToken: string | null;
    verifiedAt: string | null;
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
  catalog: CatalogDiscovery | null;
  tokens: CredentialProbe | null;
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

  const findCatalog = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/ops/diagnostics?catalog=1", { cache: "no-store" });
      const json = (await res.json()) as Diagnostics & { error?: string };
      if (json.error) setNote(json.error);
      else setData(json);
    } finally {
      setBusy(false);
    }
  };

  const saveCatalog = async (catalogId: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/ops/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-catalog-id", catalogId }),
      });
      const json = (await res.json()) as { message?: string; error?: string };
      setNote(json.message ?? json.error ?? null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const probeTokens = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/ops/diagnostics?tokens=1", { cache: "no-store" });
      const json = (await res.json()) as Diagnostics & { error?: string };
      if (json.error) setNote(json.error);
      else setData(json);
    } finally {
      setBusy(false);
    }
  };

  const setAlias = async (alias: "primary" | "new") => {
    setBusy(true);
    try {
      const res = await fetch("/api/ops/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-token-alias", alias }),
      });
      const json = (await res.json()) as { message?: string; error?: string };
      setNote(json.message ?? json.error ?? null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const setFieldSource = async (field: string, value: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/ops/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-field-source", field, value }),
      });
      const json = (await res.json()) as { message?: string; error?: string };
      setNote(json.message ?? json.error ?? null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const createCatalog = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/ops/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-catalog" }),
      });
      const json = (await res.json()) as {
        message?: string;
        error?: string;
        hint?: string;
        steps?: string[];
      };
      setNote(
        [json.message ?? json.error, json.hint, ...(json.steps ?? [])]
          .filter(Boolean)
          .join(" · ") || null,
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  const applyRecommendation = async () => {
    const rec = data?.tokens?.recommendation;
    if (!rec) return;
    setBusy(true);
    try {
      await fetch("/api/ops/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-credential-mode", mode: rec.credentialMode }),
      });
      if (rec.tokenAlias) {
        await fetch("/api/ops/diagnostics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set-token-alias", alias: rec.tokenAlias }),
        });
      }
      setNote("Applied. Test the connection again to confirm.");
      await load();
    } finally {
      setBusy(false);
    }
  };

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
        <button className="btn btn-sm" disabled={busy} onClick={() => void probeTokens()}>
          <Icon name="chart" /> Which token works?
        </button>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span className="tiny muted">
          Token variable:&nbsp;
          <code className="tiny">{data.whatsapp.tokenEnvKey}</code>
          {data.whatsapp.tokenVerified ? (
            <span className="badge badge-green" style={{ marginLeft: 6 }}>
              proven
            </span>
          ) : (
            <span className="badge badge-amber" style={{ marginLeft: 6 }}>
              untested
            </span>
          )}
        </span>
        {(["primary", "new"] as const).map((alias) => (
          <button
            key={alias}
            className={`btn btn-sm ${data.whatsapp.tokenAlias === alias ? "btn-primary" : ""}`}
            disabled={busy}
            onClick={() => void setAlias(alias)}
          >
            {alias === "new" ? "WHATSAPP_ACCESS_TOKEN_NEW" : "WHATSAPP_ACCESS_TOKEN"}
          </button>
        ))}
      </div>

      {!data.whatsapp.tokenVerified && data.whatsapp.tokenAlias === "new" ? (
        <p className="tiny muted" style={{ marginBottom: 12 }}>
          You are reading the spare variable. Press “Which token works?” — if it is rejected,
          one click puts you back on the original token.
        </p>
      ) : null}

      {note ? <p className="small muted">{note}</p> : null}

      <div className="table-scroll">
        <table className="table small">
          <thead>
            <tr>
              <th>Credential</th>
              <th>Source</th>
              <th>Value</th>
              <th>Read from</th>
            </tr>
          </thead>
          <tbody>
            {data.tokens ? (
              <tr>
                <td colSpan={4} style={{ padding: 0 }}>
                  <div
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      padding: 10,
                      margin: "8px 0",
                    }}
                  >
                    <b className="small">Which token works?</b>
                    {data.tokens.attempts.length === 0 ? (
                      <p className="tiny muted" style={{ marginTop: 6 }}>
                        {data.tokens.nextStep}
                      </p>
                    ) : (
                      <table className="table tiny" style={{ marginTop: 6 }}>
                        <thead>
                          <tr>
                            <th>Token from</th>
                            <th>Value</th>
                            <th>Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.tokens.attempts.map((attempt, index) => (
                            <tr key={`${attempt.origin}-${attempt.masked}-${index}`}>
                              <td>
                                {attempt.origin === "settings" ? (
                                  <>Admin portal</>
                                ) : (
                                  <code className="tiny">{attempt.envKey}</code>
                                )}
                              </td>
                              <td className="tiny muted">{attempt.masked || "—"}</td>
                              <td>
                                {attempt.ok ? (
                                  <span className="badge badge-green">accepted</span>
                                ) : (
                                  <span className="badge badge-amber">
                                    {attempt.error || "rejected"}
                                  </span>
                                )}
                                {attempt.ok && attempt.verifiedName ? (
                                  <span className="tiny muted"> {attempt.verifiedName}</span>
                                ) : null}
                                {!attempt.ok && attempt.hint ? (
                                  <div className="tiny muted">{attempt.hint}</div>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {data.tokens.recommendation ? (
                      <p className="tiny" style={{ marginTop: 6 }}>
                        {data.tokens.recommendation.message}{" "}
                        {!data.tokens.recommendation.message.startsWith("The token currently") ? (
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={busy}
                            onClick={() => void applyRecommendation()}
                          >
                            Apply
                          </button>
                        ) : null}
                      </p>
                    ) : null}
                    {data.tokens.nextStep ? (
                      <p className="tiny muted" style={{ marginTop: 6 }}>
                        {data.tokens.nextStep}
                      </p>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : null}
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
                <td>
                  <select
                    className="input input-sm"
                    disabled={busy}
                    value={data.whatsapp.fieldSources[row.field] ?? "auto"}
                    onChange={(event) => void setFieldSource(row.field, event.target.value)}
                  >
                    <option value="auto">Follow global</option>
                    <option value="env">Vercel</option>
                    <option value="settings">Portal</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

      <div className="card" style={{ padding: 14, marginTop: 18 }}>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <b className="small">WhatsApp catalog</b>
          <span className={`badge ${data.whatsapp.catalogId ? "badge-green" : "badge-amber"}`}>
            {data.whatsapp.catalogId ? `id ${data.whatsapp.catalogId}` : "not set"}
          </span>
          <button className="btn btn-sm" disabled={busy} onClick={() => void findCatalog()}>
            <Icon name="search" size={13} /> Find my catalog
          </button>
          {data.catalog?.canCreate ? (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void createCatalog()}>
              Create catalogue
            </button>
          ) : null}
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          “Find my catalog” asks Meta which catalogues this business account can already
          use and offers to save the right one. “Create catalogue” makes a new one owned by
          the business and connects it to WhatsApp in a single call, so you never have to
          copy a Content ID out of a Commerce Manager URL.
        </p>
        {data.catalog?.canCreate && data.catalog.createBlocked ? (
          <p className="tiny muted">{data.catalog.createBlocked}</p>
        ) : null}
        {!data.whatsapp.businessId ? (
          <p className="tiny muted">
            Creating a catalogue also needs the Meta business portfolio id (Business
            settings → Business info → ID) saved as <code className="tiny">WHATSAPP_BUSINESS_ID</code>.
            Paste it in the field on Meta&apos;s side or add it in Vercel.
          </p>
        ) : null}
        <p className="tiny muted">
          Catalogue source: <b>{data.whatsapp.credentialMode === "settings" ? "admin portal" : "credential source"}</b>
          {" "}— a Vercel <code className="tiny">WHATSAPP_CATALOG_ID</code> wins in Auto mode, so saving an id
          here does nothing until the source is “Use admin portal”. Set{" "}
          <code className="tiny">catalogId</code> to <b>portal</b> in the source column below to mix.
        </p>

        {data.catalog ? (
          data.catalog.ok ? (
            data.catalog.catalogs.length > 0 ? (
              <div className="table-scroll">
                <table className="table tiny" style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>Catalog</th>
                      <th>ID</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.catalog.catalogs.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>
                          <code className="tiny">{row.id}</code>
                        </td>
                        <td>
                          {row.connected ? (
                            <span className="badge badge-green">connected</span>
                          ) : (
                            <span className="badge">available</span>
                          )}
                        </td>
                        <td>
                          {data.whatsapp.catalogId === row.id ? (
                            <span className="tiny muted">in use</span>
                          ) : (
                            <button
                              className="btn btn-sm"
                              disabled={busy}
                              onClick={() => void saveCatalog(row.id)}
                            >
                              Use this
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                <p className="small">
                  <span className="badge badge-amber">no catalog yet</span> Meta returned no
                  catalog for this business account.
                </p>
                <ol className="small" style={{ margin: "8px 0 0 18px" }}>
                  {data.catalog.setupSteps.map((step) => (
                    <li key={step} style={{ marginBottom: 4 }}>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            )
          ) : (
            <div style={{ marginTop: 8 }}>
              <p className="small">
                <span className="badge badge-amber">lookup failed</span> {data.catalog.error}
                {data.catalog.hint ? <span className="muted"> — {data.catalog.hint}</span> : null}
              </p>
              <p className="tiny muted" style={{ marginTop: 6 }}>
                Fix the token first, then press “Find my catalog” again.
              </p>
            </div>
          )
        ) : null}

        {!data.whatsapp.catalogId ? (
          <details style={{ marginTop: 10 }}>
            <summary className="small">Do it by hand in Meta</summary>
            <ol className="small" style={{ margin: "8px 0 0 18px" }}>
              {[
                "business.facebook.com → All tools → Commerce Manager → Add catalog → “Khan Baba Menu”, Online products, currency AUD.",
                "In the catalog: Settings shows the Catalog ID as Content ID. It is also the digits in the URL /catalog/<id>/products.",
                "WhatsApp Manager → Account tools → Catalog → Choose catalog → Connect catalog.",
                "Turn on “Show catalog icon in chat header”.",
                "Paste the Content ID here, or in Admin → WhatsApp Business → WhatsApp Catalogue ID.",
              ].map((step) => (
                <li key={step} style={{ marginBottom: 4 }}>
                  {step}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>

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
            <div className="table-scroll">
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
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 14 }}>
          <b className="small">Social channels</b>
          <div className="table-scroll">
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
      </div>
    </section>
  );
}
