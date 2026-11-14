"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDate } from "@/lib/time";
import { money } from "@/lib/money";
import { Icon } from "../Icon";

export function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  async function save(
    endpoint: string,
    payload: unknown,
    successText = "Saved",
  ) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not save");
      setMessage({ kind: "ok", text: successText });
      router.refresh();
      return true;
    } catch (error) {
      setMessage({
        kind: "err",
        text: error instanceof Error ? error.message : "Could not save",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, message, save };
}

export function Message({
  message,
}: {
  message: { kind: "ok" | "err"; text: string } | null;
}) {
  if (!message) return null;
  return (
    <span
      className={`tiny ${message.kind === "err" ? "" : ""}`}
      style={{ color: message.kind === "err" ? "var(--red)" : "var(--green)" }}
    >
      {message.text}
    </span>
  );
}

/* ------------------------------------------------------------------ settings */

export type SettingField = {
  key: string;
  label: string;
  type?: "text" | "number" | "password" | "select" | "toggle" | "textarea";
  help?: string;
  options?: { value: string; label: string }[];
  suffix?: string;
};

export function SettingsForm({
  groups,
  values,
}: {
  groups: { title: string; description?: string; fields: SettingField[] }[];
  values: Record<string, string>;
}) {
  const [state, setState] = useState<Record<string, string>>(values);
  const { busy, message, save } = useSave();

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {groups.map((group) => (
        <section key={group.title} className="panel">
          <div className="panel-head">
            <h3>{group.title}</h3>
          </div>
          {group.description ? (
            <p
              className="small muted"
              style={{ marginTop: -8, marginBottom: 14 }}
            >
              {group.description}
            </p>
          ) : null}
          <div className="form-grid">
            {group.fields.map((field) => {
              const value = state[field.key] ?? "";
              if (field.type === "toggle") {
                return (
                  <label
                    key={field.key}
                    className="check"
                    style={{ alignSelf: "end", paddingBottom: 10 }}
                  >
                    <input
                      type="checkbox"
                      checked={value === "1"}
                      onChange={(event) =>
                        setState({
                          ...state,
                          [field.key]: event.target.checked ? "1" : "0",
                        })
                      }
                    />
                    {field.label}
                  </label>
                );
              }
              return (
                <div
                  key={field.key}
                  className={field.type === "textarea" ? "field full" : "field"}
                >
                  <span className="label">
                    {field.label}
                    {field.suffix ? ` (${field.suffix})` : ""}
                  </span>
                  {field.type === "select" ? (
                    <select
                      className="select"
                      value={value}
                      onChange={(event) =>
                        setState({ ...state, [field.key]: event.target.value })
                      }
                    >
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      className="textarea"
                      style={{ minHeight: 70 }}
                      value={value}
                      onChange={(event) =>
                        setState({ ...state, [field.key]: event.target.value })
                      }
                    />
                  ) : (
                    <input
                      className="input"
                      type={
                        field.type === "password"
                          ? "password"
                          : field.type === "number"
                            ? "number"
                            : "text"
                      }
                      value={value}
                      onChange={(event) =>
                        setState({ ...state, [field.key]: event.target.value })
                      }
                      autoComplete="off"
                    />
                  )}
                  {field.help ? (
                    <span className="tiny" style={{ color: "var(--muted-2)" }}>
                      {field.help}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            save("/api/ops/settings", { values: state }, "Settings saved")
          }
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
        <Message message={message} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- pricing */

type Rule = {
  id: number;
  code: string;
  label: string;
  kind: string;
  calc: string;
  value: number;
  applies_to: string;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  active: boolean;
};

export function PricingRulesEditor({ rules }: { rules: Rule[] }) {
  const [values, setValues] = useState<Record<number, string>>(
    Object.fromEntries(rules.map((rule) => [rule.id, String(rule.value)])),
  );
  const { busy, message, save } = useSave();

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Pricing rules</h3>
        <span className="tiny muted">
          Weekend / holiday percentages, priority fees
        </span>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="card"
            style={{
              padding: 14,
              display: "grid",
              gap: 8,
              gridTemplateColumns: "1fr auto",
              alignItems: "center",
            }}
          >
            <div>
              <div className="small strong">
                {rule.label}{" "}
                <span className="tag" style={{ marginLeft: 6 }}>
                  {rule.kind.replace("_", " ")}
                </span>
                {rule.active ? null : (
                  <span className="badge badge-muted" style={{ marginLeft: 6 }}>
                    off
                  </span>
                )}
              </div>
              <div className="tiny muted">
                {rule.description}
                {rule.days ? ` · days ${rule.days}` : ""}
                {rule.start_time
                  ? ` · ${rule.start_time}–${rule.end_time}`
                  : ""}
                {` · applies to ${rule.applies_to}`}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div className="field" style={{ width: 110 }}>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={values[rule.id] ?? ""}
                  onChange={(event) =>
                    setValues({ ...values, [rule.id]: event.target.value })
                  }
                />
              </div>
              <span className="tiny muted">
                {rule.calc === "percent" ? "%" : "AUD"}
              </span>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={busy}
                onClick={() =>
                  save(
                    "/api/ops/pricing",
                    {
                      action: "rule-update",
                      id: rule.id,
                      value: Number(values[rule.id]),
                      active: Boolean(rule.active),
                    },
                    "Rule updated",
                  )
                }
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() =>
                  save(
                    "/api/ops/pricing",
                    {
                      action: "rule-update",
                      id: rule.id,
                      value: Number(values[rule.id]),
                      active: !rule.active,
                    },
                    rule.active ? "Rule disabled" : "Rule enabled",
                  )
                }
              >
                {rule.active ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <Message message={message} />
      </div>
    </section>
  );
}

type Holiday = {
  id: number;
  date: string;
  name: string;
  surcharge_percent: number | null;
  active: boolean;
};

export function HolidayManager({ holidays }: { holidays: Holiday[] }) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [percent, setPercent] = useState("");
  const { busy, message, save } = useSave();

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Public holiday calendar</h3>
        <span className="tiny muted">
          Holiday rate replaces the weekend rate
        </span>
      </div>
      <div className="form-row" style={{ marginBottom: 16 }}>
        <div className="field" style={{ width: 170 }}>
          <span className="label">Date</span>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <span className="label">Holiday name</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Christmas Day"
          />
        </div>
        <div className="field" style={{ width: 130 }}>
          <span className="label">Surcharge %</span>
          <input
            className="input"
            type="number"
            step="0.5"
            value={percent}
            onChange={(event) => setPercent(event.target.value)}
            placeholder="10"
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !date || !name}
          onClick={async () => {
            const ok = await save(
              "/api/ops/pricing",
              { action: "holiday-add", date, name, percent },
              "Holiday saved",
            );
            if (ok) {
              setDate("");
              setName("");
              setPercent("");
            }
          }}
        >
          Add
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Holiday</th>
              <th>Surcharge</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {holidays.map((holiday) => (
              <tr key={holiday.id}>
                <td>{formatDate(holiday.date)}</td>
                <td>{holiday.name}</td>
                <td>
                  {holiday.surcharge_percent != null
                    ? `${holiday.surcharge_percent}%`
                    : "Rule default"}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      save(
                        "/api/ops/pricing",
                        { action: "holiday-delete", id: holiday.id },
                        "Removed",
                      )
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {holidays.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No holidays in the calendar.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10 }}>
        <Message message={message} />
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------- tables */

type TableRow = {
  id: number;
  code: string;
  name: string;
  zone: string | null;
  seats: number;
  active: boolean;
  qrSvg: string;
};

export function TableManager({
  tables,
  baseUrl,
}: {
  tables: TableRow[];
  baseUrl: string;
}) {
  const [form, setForm] = useState({
    code: "",
    name: "",
    zone: "",
    seats: "4",
  });
  const [copied, setCopied] = useState("");
  const { busy, message, save } = useSave();

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(`${baseUrl}/table/${code}`);
      setCopied(code);
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      setCopied("");
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section className="panel">
        <div className="panel-head">
          <h3>Add a table</h3>
          <span className="tiny muted">Each table gets its own QR code</span>
        </div>
        <div className="form-row">
          <div className="field" style={{ width: 120 }}>
            <span className="label">Code</span>
            <input
              className="input"
              value={form.code}
              onChange={(event) =>
                setForm({ ...form, code: event.target.value.toUpperCase() })
              }
              placeholder="T13"
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <span className="label">Name</span>
            <input
              className="input"
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="Table 13"
            />
          </div>
          <div className="field" style={{ width: 150 }}>
            <span className="label">Zone</span>
            <input
              className="input"
              value={form.zone}
              onChange={(event) =>
                setForm({ ...form, zone: event.target.value })
              }
              placeholder="Mezzanine"
            />
          </div>
          <div className="field" style={{ width: 100 }}>
            <span className="label">Seats</span>
            <input
              className="input"
              type="number"
              min={1}
              value={form.seats}
              onChange={(event) =>
                setForm({ ...form, seats: event.target.value })
              }
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              const ok = await save(
                "/api/ops/tables",
                { action: "create", ...form, seats: Number(form.seats) },
                "Table added",
              );
              if (ok) setForm({ code: "", name: "", zone: "", seats: "4" });
            }}
          >
            Add table
          </button>
        </div>
        <div style={{ marginTop: 10 }}>
          <Message message={message} />
        </div>
      </section>

      <div className="grid grid-3">
        {tables.map((table) => (
          <article
            key={table.id}
            className="panel"
            style={{ opacity: table.active ? 1 : 0.5 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div>
                <div className="small strong">{table.name}</div>
                <div className="tiny muted">
                  {table.code} · {table.zone ?? "—"} · {table.seats} seats
                </div>
              </div>
              <span
                className={`badge ${table.active ? "badge-green" : "badge-muted"}`}
              >
                {table.active ? "Active" : "Paused"}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                gap: 14,
                alignItems: "center",
                marginTop: 14,
              }}
            >
              <div
                className="qr-wrap"
                style={{ padding: 8 }}
                dangerouslySetInnerHTML={{ __html: table.qrSvg }}
              />
              <div style={{ display: "grid", gap: 6 }}>
                <a
                  href={`/api/ops/tables/${table.code}/qr`}
                  className="btn btn-outline btn-sm"
                >
                  <Icon name="arrow" size={12} /> Download
                </a>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => copy(table.code)}
                >
                  {copied === table.code ? "Copied!" : "Copy link"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    save(
                      "/api/ops/tables",
                      { action: "toggle", id: table.id },
                      "Table updated",
                    )
                  }
                >
                  {table.active ? "Pause" : "Activate"}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ what's new */

type Entry = {
  id: number;
  title: string;
  summary: string;
  body: string | null;
  category: string;
  version: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pinned: number;
  published_at: string;
};

export function WhatsNewManager({ entries }: { entries: Entry[] }) {
  const [form, setForm] = useState({
    title: "",
    summary: "",
    body: "",
    category: "feature",
    version: "1.1.0",
    prNumber: "",
    prUrl: "",
    pinned: false,
  });
  const { busy, message, save } = useSave();

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section className="panel">
        <div className="panel-head">
          <h3>Publish an update</h3>
          <span className="tiny muted">
            Appears on the public What&apos;s New page
          </span>
        </div>
        <div className="form-grid">
          <div className="field full">
            <span className="label">Title</span>
            <input
              className="input"
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
              placeholder="Priority ordering for peak hours"
            />
          </div>
          <div className="field full">
            <span className="label">Summary</span>
            <input
              className="input"
              value={form.summary}
              onChange={(event) =>
                setForm({ ...form, summary: event.target.value })
              }
              placeholder="One or two sentences customers will read"
            />
          </div>
          <div className="field full">
            <span className="label">Details (optional)</span>
            <textarea
              className="textarea"
              value={form.body}
              onChange={(event) =>
                setForm({ ...form, body: event.target.value })
              }
            />
          </div>
          <div className="field">
            <span className="label">Category</span>
            <select
              className="select"
              value={form.category}
              onChange={(event) =>
                setForm({ ...form, category: event.target.value })
              }
            >
              {["feature", "improvement", "fix", "portal", "ops"].map(
                (category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ),
              )}
            </select>
          </div>
          <div className="field">
            <span className="label">Version</span>
            <input
              className="input"
              value={form.version}
              onChange={(event) =>
                setForm({ ...form, version: event.target.value })
              }
            />
          </div>
          <div className="field">
            <span className="label">PR number</span>
            <input
              className="input"
              type="number"
              value={form.prNumber}
              onChange={(event) =>
                setForm({ ...form, prNumber: event.target.value })
              }
              placeholder="12"
            />
          </div>
          <div className="field">
            <span className="label">PR URL</span>
            <input
              className="input"
              value={form.prUrl}
              onChange={(event) =>
                setForm({ ...form, prUrl: event.target.value })
              }
              placeholder="https://github.com/…/pull/12"
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={form.pinned}
              onChange={(event) =>
                setForm({ ...form, pinned: event.target.checked })
              }
            />{" "}
            Pin to top
          </label>
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            marginTop: 14,
          }}
        >
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => {
              const ok = await save(
                "/api/ops/whatsnew",
                {
                  action: "create",
                  ...form,
                  prNumber: form.prNumber ? Number(form.prNumber) : null,
                },
                "Update published",
              );
              if (ok)
                setForm({
                  ...form,
                  title: "",
                  summary: "",
                  body: "",
                  prNumber: "",
                  prUrl: "",
                  pinned: false,
                });
            }}
          >
            Publish update
          </button>
          <Message message={message} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Release feed</h3>
          <span className="tiny muted">{entries.length} entries</span>
        </div>
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="summary-row"
            style={{
              alignItems: "flex-start",
              padding: "10px 0",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <div>
              <div className="small strong">
                {entry.title}{" "}
                {entry.pinned ? (
                  <span className="badge badge-amber">Pinned</span>
                ) : null}
              </div>
              <div className="tiny muted">
                {entry.category} · v{entry.version ?? "—"} ·{" "}
                {formatDate(entry.published_at.slice(0, 10))}
                {entry.pr_number ? ` · PR #${entry.pr_number}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  save(
                    "/api/ops/whatsnew",
                    { action: "toggle-pin", id: entry.id },
                    "Updated",
                  )
                }
              >
                {entry.pinned ? "Unpin" : "Pin"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  save(
                    "/api/ops/whatsnew",
                    { action: "delete", id: entry.id },
                    "Deleted",
                  )
                }
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- reviews */

export function ReviewRowActions({ id }: { id: number }) {
  const { busy, save } = useSave();
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button
        type="button"
        className="btn btn-green btn-sm"
        disabled={busy}
        onClick={() =>
          save("/api/ops/reviews", { action: "publish", id }, "Published")
        }
      >
        Publish
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={busy}
        onClick={() =>
          save("/api/ops/reviews", { action: "hide", id }, "Hidden")
        }
      >
        Hide
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={busy}
        onClick={() =>
          save("/api/ops/reviews", { action: "delete", id }, "Deleted")
        }
      >
        Delete
      </button>
    </div>
  );
}
