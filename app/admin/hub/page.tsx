import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { orderStats } from "@/lib/orders";
import { catalogStats } from "@/lib/whatsapp/catalog";
import { feedbackStats } from "@/lib/feedback";
import { getNowPlaying } from "@/lib/music";
import { money } from "@/lib/money";
import { Icon } from "@/components/Icon";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Command centre" };

type Tile = {
  href: string;
  label: string;
  blurb: string;
  icon: string;
  badge?: string;
};

type Group = { title: string; note: string; tiles: Tile[] };

/**
 * The administrator's main page — what the Khan Baba logo opens.
 *
 * Staff portals open their own queue; the administrator opens this, with every
 * option the role can use in one place and the live numbers that matter at the
 * top. No sidebar hunting, no memorised URLs.
 */
export default async function AdminHubPage() {
  const session = await requireRole(["admin", "manager"]);
  const db = await getDb();
  const [stats, catalog, feedback, now] = await Promise.all([
    orderStats(db),
    catalogStats(db),
    feedbackStats(db),
    getNowPlaying(db),
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

  const groups: Group[] = [
    {
      title: "Service floor",
      note: "The queues that keep the room moving.",
      tiles: [
        {
          href: "/counter",
          label: "Counter",
          blurb: "Accept orders, take payment, park table bills, send payment links.",
          icon: "shield",
          badge: stats.pending > 0 ? `${stats.pending} to accept` : undefined,
        },
        {
          href: "/kitchen",
          label: "Kitchen display",
          blurb: "The queue, on the fire and packed columns with per-item ticking.",
          icon: "flame",
          badge: stats.kitchen > 0 ? `${stats.kitchen} cooking` : undefined,
        },
        {
          href: "/delivery",
          label: "Delivery desk",
          blurb: "Re-quote, dispatch and track every courier partner.",
          icon: "truck",
        },
        {
          href: "/admin/orders",
          label: "Orders",
          blurb: "Every ticket with source, payment state and full event log.",
          icon: "bag",
        },
        {
          href: "/admin/tables",
          label: "Tables & QR codes",
          blurb: "Table ordering links for the room, printable QR posters.",
          icon: "table",
        },
        {
          href: "/counter/customers",
          label: "Customers",
          blurb: "Look a guest up by name, email or mobile — including guests.",
          icon: "user",
        },
      ],
    },
    {
      title: "WhatsApp & publishing",
      note: "One menu, centrally published; stock told once, everywhere.",
      tiles: [
        {
          href: "/admin/whatsapp",
          label: "WhatsApp Business",
          blurb: "Publish the catalogue, work conversations, take orders in the chat.",
          icon: "phone",
          badge: whatsappOrders.c > 0 ? `${whatsappOrders.c} today` : undefined,
        },
        {
          href: "/admin/menu",
          label: "Menu & dishes",
          blurb: "The single source of truth for prices, photos and availability.",
          icon: "box",
          badge: catalog.errors > 0 ? `${catalog.errors} sync error(s)` : undefined,
        },
        {
          href: "/admin/reviews",
          label: "Dish reviews",
          blurb: "Moderate guest reviews on individual dishes.",
          icon: "star",
        },
        {
          href: "/admin/feedback",
          label: "Feedback & Google",
          blurb: "Turn table feedback into Google review drafts with photos.",
          icon: "sparkle",
          badge: feedback.drafts > 0 ? `${feedback.drafts} draft(s)` : undefined,
        },
        {
          href: "/admin/whats-new",
          label: "What's new",
          blurb: "Publish a release note on the customer site.",
          icon: "layers",
        },
      ],
    },
    {
      title: "Lahore room",
      note: "Music, recitation sets and the cultural theme.",
      tiles: [
        {
          href: "/admin/music",
          label: "Music system",
          blurb: "Library, collections, schedules, live controls and charging rules.",
          icon: "play",
          badge: pendingRequests.c > 0 ? `${pendingRequests.c} request(s)` : undefined,
        },
        {
          href: "/counter/music",
          label: "Counter music desk",
          blurb: "Front-of-house controls: stop, resume, replay, approve requests.",
          icon: "gear",
        },
        {
          href: "/music",
          label: "Guest music page",
          blurb: "What is playing, the collections and the song-request form.",
          icon: "eye",
          badge: now.isReligious ? "recitation live" : undefined,
        },
      ],
    },
    {
      title: "Commercial",
      note: "Money rules, partners and promotions.",
      tiles: [
        { href: "/admin/pricing", label: "Pricing & holidays", blurb: "Surcharges, priority fees and the holiday calendar.", icon: "chart" },
        { href: "/admin/promotions", label: "Promotions", blurb: "Customer codes and driver rewards, with caps.", icon: "sparkle" },
        { href: "/admin/delivery", label: "Delivery & payments", blurb: "Partners, markup, Stripe and PayPal credentials.", icon: "truck" },
        { href: "/admin/integrations", label: "Integrations", blurb: "The detached Square POS bridge and partner status.", icon: "layers" },
        { href: "/admin/drivers", label: "Driver management", blurb: "Verification, assignment, commission and ATO exports.", icon: "bike" },
        { href: "/admin/community", label: "Returns & community", blurb: "Untouched returns offered to neighbours in need.", icon: "bag" },
      ],
    },
    {
      title: "Production & people",
      note: "Cost, stock and who can do what.",
      tiles: [
        { href: "/admin/production", label: "Production & costing", blurb: "Materials, recipes, batches and cost postings.", icon: "box" },
        { href: "/admin/staff", label: "Users & access", blurb: "Staff roles, customer logins, go-live checklist.", icon: "user" },
      ],
    },
  ];

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
        </div>
        <div className="hub-stats">
          <div><span>Today</span><b>{money(stats.today.revenue)}</b><small>{stats.today.orders} orders</small></div>
          <div><span>Awaiting accept</span><b>{stats.pending}</b><small>counter queue</small></div>
          <div><span>Tables parked</span><b>{tablesDue.c}</b><small>awaiting payment</small></div>
          <div><span>WhatsApp</span><b>{catalog.published}</b><small>dishes live</small></div>
        </div>
      </div>

      <div className="notice" style={{ marginBottom: 18 }}>
        <span>
          <strong>Payment rule:</strong> dine-in and table orders are settled at the counter after the
          meal. The counter parks the bill until it clears. Delivery is always paid before dispatch.
        </span>
      </div>

      {groups.map((group) => (
        <section key={group.title} className="hub-group">
          <div className="hub-group-head">
            <h2>{group.title}</h2>
            <span className="tiny muted">{group.note}</span>
          </div>
          <div className="hub-grid">
            {group.tiles.map((tile) => (
              <Link key={tile.href} href={tile.href} className="hub-tile">
                <span className="hub-icon">
                  <Icon name={tile.icon} size={20} />
                </span>
                <span className="hub-tile-body">
                  <b>{tile.label}</b>
                  <span className="tiny muted">{tile.blurb}</span>
                </span>
                {tile.badge ? <StatusBadge status="pending" label={tile.badge} /> : <Icon name="arrow" size={15} />}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
