"use client";

import { useState } from "react";

/** Read-only field with a copy button, for capability links and pickup codes. */
export function CopyField({
  value,
  label = "Private link",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="row" style={{ gap: 8 }}>
        <input className="input mono" readOnly value={value} onFocus={(event) => event.target.select()} />
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
