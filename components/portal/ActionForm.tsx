"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "../Icon";

export type ActionField = {
  name: string;
  label: string;
  type?: "text" | "number" | "select" | "textarea" | "date" | "datetime-local" | "checkbox" | "email";
  options?: { value: string; label: string }[];
  placeholder?: string;
  defaultValue?: string | number | boolean;
  suffix?: string;
  full?: boolean;
  help?: string;
};

/**
 * One small, reusable POST form for the new ops modules (promotions, returns,
 * drivers, community, Square). Keeps every admin action on the same fetch →
 * refresh → message path as the existing AdminForms helpers.
 */
export function ActionForm({
  endpoint,
  action,
  fields,
  hidden = {},
  submitLabel = "Save",
  confirmMessage,
  compact = false,
  onSuccess,
}: {
  endpoint: string;
  action: string;
  fields: ActionField[];
  hidden?: Record<string, unknown>;
  submitLabel?: string;
  confirmMessage?: string;
  compact?: boolean;
  onSuccess?: (data: Record<string, unknown>) => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      fields.map((field) => [
        field.name,
        field.type === "checkbox"
          ? Boolean(field.defaultValue ?? false)
          : String(field.defaultValue ?? ""),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [expanded, setExpanded] = useState(!compact);

  function update(name: string, value: string | boolean) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy(true);
    setMessage(null);
    const payload: Record<string, unknown> = { action, ...hidden };
    for (const field of fields) {
      const value = values[field.name];
      payload[field.name] =
        field.type === "checkbox"
          ? value === true
          : field.type === "number"
            ? Number(value)
            : value;
    }
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(data.error ?? "Could not save"));
      setMessage({
        kind: "ok",
        text:
          typeof data.message === "string" && data.message
            ? data.message
            : "Saved",
      });
      onSuccess?.(data);
      router.refresh();
    } catch (error) {
      setMessage({
        kind: "err",
        text: error instanceof Error ? error.message : "Could not save",
      });
    } finally {
      setBusy(false);
    }
  }

  if (compact && !expanded) {
    return (
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setExpanded(true)}>
        <Icon name="plus" size={13} /> {submitLabel}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="action-form">
      <div className="form-grid">
        {fields.map((field) =>
          field.type === "checkbox" ? (
            <label key={field.name} className={`check ${field.full ? "full" : ""}`} style={{ alignSelf: "end", paddingBottom: 8 }}>
              <input
                type="checkbox"
                checked={Boolean(values[field.name])}
                onChange={(event) => update(field.name, event.target.checked)}
              />
              {field.label}
            </label>
          ) : (
            <div key={field.name} className={`field ${field.full ? "full" : ""}`}>
              <span className="label">
                {field.label}
                {field.suffix ? ` (${field.suffix})` : ""}
              </span>
              {field.type === "select" ? (
                <select className="select" value={String(values[field.name])} onChange={(event) => update(field.name, event.target.value)}>
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea
                  className="input"
                  rows={2}
                  placeholder={field.placeholder}
                  value={String(values[field.name])}
                  onChange={(event) => update(field.name, event.target.value)}
                />
              ) : (
                <input
                  className="input"
                  type={field.type ?? "text"}
                  placeholder={field.placeholder}
                  value={String(values[field.name])}
                  onChange={(event) => update(field.name, event.target.value)}
                />
              )}
              {field.help ? <span className="tiny muted">{field.help}</span> : null}
            </div>
          ),
        )}
      </div>
      <div className="row" style={{ marginTop: 12, gap: 12, flexWrap: "wrap" }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Working…" : submitLabel}
        </button>
        {compact ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded(false)}>
            Cancel
          </button>
        ) : null}
        {message ? (
          <span className="tiny" style={{ color: message.kind === "err" ? "var(--red)" : "var(--green)" }}>
            {message.kind === "err" ? "! " : "✓ "}{message.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
