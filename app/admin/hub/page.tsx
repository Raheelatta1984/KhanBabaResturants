import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { orderStats } from "@/lib/orders";
import { catalogStats } from "@/lib/whatsapp/catalog";
import { feedbackStats } from "@/lib/feedback";
import { getNowPlaying } from "@/lib/music";
import { money } from "@/lib/money";
import { ADMIN_NAV } from "@/lib/nav";
import { ensureFreshAudit, logSummary } from "@/lib/ops/log";
import { buildLabel } from "@/lib/build";
import { Icon } from "@/components/Icon";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Command centre" };

type Badge = { label: string; status: string };

/**
 * The administrator's main page — what the Khan Baba logo opens.
 *
 * Staff portals open their own queue; the administrator opens this, with every
 * option the role can use in one place and the live numbers that matter at the
 * top. No sidebar hunting, no memorised URLs.
 *
 * The tiles are the same list the sidebar draws (lib/nav.ts), so a page cannot
 * be reachable from one and missing from the other — which is how Marketing
 * and the operational log came to be absent from the page that promises
 * "every option".
 */
export default async function AdminHubPage() {
  const session = await requireRole(["admin", "manager"]);
  const db = await getDb();
  await ensureFreshAudit(db);
  const [stats, catalog, feedback, now, findings] = await Promise.all([
    orderStats(db),
    catalogStats(db),
    feedbackStats(db),
    getNowPlaying(db),
    logSummary(db),
  ]);
  const [whatsappOrders, pendingRequests, tablesDue] = await Promise.all([
    db.one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM orders WHERE source = 'whatsapp' AND created_at::date = CURRENT_DATE",
    ),
    db.one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM music_requests WHERE status = 'pending'",
    ),
    db.one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM orders WHERE parked AND status != 'cancelled'",
    ),
  ]);

  const urgent = findings.critical + findings.error;
  const badge = (when: boolean, label: string, status = "pending"): Badge | undefined =>
    when ? { label, status } : undefined;

  /** Live numbers, keyed by the link they belong to. */
  const badges: Record<string, Badge | undefined> = {
    "/counter": badge(stats.pending > 0, `${stats.pending} to accept`),
    "/kitchen": badge(stats.kitchen > 0, `${stats.kitchen} cooking`),
    "/admin/logs": badge(findings.open > 0, `${findings.open} open`, urgent > 0 ? "cancelled" : "pending"),
    "/admin/whatsapp": badge(whatsappOrders.c > 0, `${whatsappOrders.c} today`),
    "/admin/menu": badge(catalog.errors > 0, `${catalog.errors} sync error(s)`),
    "/admin/feedback": badge(feedback.drafts > 0, `${feedback.drafts} draft(s)`),
    "/admin/music": badge(pendingRequests.c > 0, `${pendingRequests.c} request(s)`),
    "/music": badge(now.isReligious, "recitation live"),
    "/admin/whats-new": { label: buildLabel(), status: "completed" },
  };

  // This page is the hub, so it does not offer a tile to itself.
  const groups = ADMIN_NAV.map((group) => ({
    ...group,
    links: group.links.filter((link) => link.href !== "/admin/hub"),
  }));

  return (
    <>
      <AutoRefresh intervalMs={20000} />
      <div className="hub-hero">
        <div>
          <span className="eyebrow">Khan Baba Ops · {session.name}</span>
          <h1 style={{ fontSize: "clamp(2.2rem, 4vw, 3rem)", marginTop: 10 }}>
            Command centre
          </h1>
          <p className="muted" style={{ maxWidth: 640 }}>
            Every option this role can use, in one place. The logo always brings an administrator
            back here; everyone else lands on their own queue.
          </p>
          <p className="build-stamp" style={{ marginTop: 10 }}>
            Running {buildLabel()} · <Link href="/admin/whats-new" style={{ textDecoration: "underline" }}>what changed</Link>
          </p>
        </div>
        <div className="hub-stats">
          <div><span>Today</span><b>{money(stats.today.revenue)}</b><small>{stats.today.orders} orders</small></div>
          <div><span>Awaiting accept</span><b>{stats.pending}</b><small>counter queue</small></div>
          <div><span>Tables parked</span><b>{tablesDue.c}</b><small>awaiting payment</small></div>
          <div><span>WhatsApp</span><b>{catalog.published}</b><small>dishes live</small></div>
        </div>
      </div>

      {findings.open > 0 ? (
        <Link
          href="/admin/logs"
          className={urgent > 0 ? "notice notice-red" : "notice"}
          style={{ marginBottom: 12 }}
        >
          <span>
            <strong>
              {findings.open} open finding{findings.open === 1 ? "" : "s"}
            </strong>{" "}
            in the operational log
            {urgent > 0 ? ` — ${urgent} need attention now` : ""}. Each has a reference and the steps to clear it.{" "}
            <u>Open the log</u>
          </span>
        </Link>
      ) : null}

      <div className="notice" style={{ marginBottom: 18 }}>
        <span>
          <strong>Payment rule:</strong> dine-in and table orders are settled at the counter after the
          meal. The counter parks the bill until it clears. Delivery is always paid before dispatch.
        </span>
      </div>

      {groups.map((group) => (
        <section key={group.id} className="hub-group" id={`hub-${group.id}`}>
          <div className="hub-group-head">
            <h2>{group.title}</h2>
            <span className="tiny muted">{group.note}</span>
          </div>
          <div className="hub-grid">
            {group.links.map((tile) => {
              const live = badges[tile.href];
              return (
                <Link key={tile.href} href={tile.href} className="hub-tile">
                  <span className="hub-icon">
                    <Icon name={tile.icon} size={20} />
                  </span>
                  <span className="hub-tile-body">
                    <b>{tile.label}</b>
                    <span className="tiny muted">{tile.blurb}</span>
                  </span>
                  {live ? <StatusBadge status={live.status} label={live.label} /> : <Icon name="arrow" size={15} />}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
