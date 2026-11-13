import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function Stars({ rating, count }: { rating: number; count?: number }) {
  const rounded = Math.round(rating);
  return (
    <span className="rating" title={`${rating.toFixed(1)} out of 5`}>
      <span className="stars" aria-hidden="true">
        {"★".repeat(Math.max(0, rounded))}
        <span style={{ color: "var(--surface-3)" }}>{"★".repeat(Math.max(0, 5 - rounded))}</span>
      </span>
      <span style={{ color: "var(--muted-2)" }}>
        {rating.toFixed(1)}
        {typeof count === "number" ? ` (${count})` : ""}
      </span>
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  pending_confirm: "badge-amber",
  confirmed: "badge-blue",
  preparing: "badge-amber",
  ready: "badge-green",
  awaiting_collection: "badge-green",
  out_for_delivery: "badge-blue",
  completed: "badge-muted",
  cancelled: "badge-red",
  paid: "badge-green",
  unpaid: "badge-red",
  pending: "badge-amber",
  refunded: "badge-muted",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${STATUS_STYLES[status] ?? "badge-muted"}`}>{label ?? status.replace(/_/g, " ")}</span>;
}

export function SectionHead({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2 style={{ marginTop: 14 }}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, body, icon = "bag", action }: { title: string; body?: string; icon?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">
        <Icon name={icon} size={28} />
      </div>
      <h3 style={{ marginBottom: 6 }}>{title}</h3>
      {body ? <p className="small">{body}</p> : null}
      {action ? <div style={{ marginTop: 18 }}>{action}</div> : null}
    </div>
  );
}

export const SPICE_INFO: Record<string, { label: string; chillies: string; description: string }> = {
  blend: { label: "Blend", chillies: "•", description: "House blend — gentle, aromatic warmth" },
  mild: { label: "Mild", chillies: "🌶", description: "A soft kick for everyone at the table" },
  hot: { label: "Hot", chillies: "🌶🌶", description: "Proper Lahori heat" },
  extra_hot: { label: "Extra hot", chillies: "🌶🌶🌶", description: "For the brave — no refunds on bravery" },
};
