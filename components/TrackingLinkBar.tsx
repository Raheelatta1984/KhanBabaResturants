"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";

/**
 * Copy / share / text me the tracking link. The Web Share API is used when the
 * browser has it (phones), clipboard otherwise (desktop), and the plain URL is
 * always visible so it can be copied by hand.
 */
export function TrackingLinkBar({
  token,
  orderCode,
}: {
  token: string;
  orderCode: string;
}) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}/t/${token}`);
  }, [token]);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked — the URL is on screen to copy manually */
    }
  }

  async function share() {
    if (!url) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Khan Baba order ${orderCode}`,
          text: `Track my Khan Baba order ${orderCode}:`,
          url,
        });
        return;
      } catch {
        /* user dismissed the sheet */
      }
    }
    copy();
  }

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div className="panel-head">
        <h3 style={{ fontSize: "1.05rem" }}>
          <span className="step-number">↗</span>Your tracking link
        </h3>
        <span className="tiny muted">Works on any device, no login</span>
      </div>
      <code className="tracking-url">{url || `/t/${token}`}</code>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={copy}>
          <Icon name={copied ? "check" : "layers"} size={14} />
          {copied ? "Copied" : "Copy link"}
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={share}>
          <Icon name="arrow" size={14} /> Share
        </button>
        <a
          href={`sms:?&body=${encodeURIComponent(`Tracking my Khan Baba order ${orderCode}: `)}${
            url ? encodeURIComponent(url) : ""
          }`}
          className="btn btn-ghost btn-sm"
        >
          <Icon name="phone" size={14} /> Send by SMS
        </a>
        <a
          href={`mailto:?subject=${encodeURIComponent(`Khan Baba order ${orderCode}`)}&body=${encodeURIComponent(
            `Track my order ${orderCode}: ${url}`,
          )}`}
          className="btn btn-ghost btn-sm"
        >
          Email it
        </a>
        <Link href="/login?mode=signup" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }}>
          Save this order to an account
        </Link>
      </div>
    </div>
  );
}
