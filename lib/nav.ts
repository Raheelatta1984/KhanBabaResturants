/**
 * The administrator's navigation — one list, used everywhere.
 *
 * The sidebar, the Command centre tiles and the top bar used to be three
 * hand-maintained lists. They drifted, and the drift is exactly what was
 * reported: Marketing had a page and no link for weeks; when a link was added
 * it went into the sidebar only, so the Command centre ("every option in one
 * place") still did not have it, and neither did the top bar.
 *
 * Everything that draws navigation now reads this file, and
 * `scripts/test-pg.ts` fails the build when:
 *   - a page exists under app/admin/ that nothing here links to, or
 *   - a link here points at a `#section` that no page defines.
 */

export type NavLink = {
  href: string;
  label: string;
  /** One line for the Command centre tile. */
  blurb: string;
  icon: string;
  /** A customer-facing page: a tile on the Command centre, not a sidebar entry. */
  hubOnly?: boolean;
};

export type NavGroup = {
  id: string;
  title: string;
  note: string;
  links: NavLink[];
};

export const ADMIN_NAV: NavGroup[] = [
  {
    id: "operations",
    title: "Operations",
    note: "The queues that keep the room moving, and what needs attention.",
    links: [
      { href: "/admin/hub", label: "Command centre", blurb: "Every option on one page, with today's live numbers.", icon: "layers" },
      { href: "/admin", label: "Overview", blurb: "Revenue, margin, alerts and the last seven days.", icon: "chart" },
      { href: "/admin/logs", label: "Operational log", blurb: "What is wrong now, what was done, and what to do next.", icon: "shield" },
      { href: "/admin/orders", label: "Orders", blurb: "Every ticket with source, payment state and full event log.", icon: "bag" },
      { href: "/counter", label: "Counter portal", blurb: "Accept orders, take payment, park table bills, send payment links.", icon: "shield" },
      { href: "/counter/customers", label: "Customers", blurb: "Look a guest up by name, email or mobile — including guests.", icon: "user" },
      { href: "/counter/music", label: "Counter music desk", blurb: "Front-of-house controls: stop, resume, replay, approve requests.", icon: "gear" },
      { href: "/kitchen", label: "Kitchen portal", blurb: "The queue, on the fire and packed columns with per-item ticking.", icon: "flame" },
      { href: "/delivery", label: "Delivery portal", blurb: "Re-quote, dispatch and track every courier partner.", icon: "truck" },
      { href: "/admin/drivers", label: "Driver management", blurb: "Verification, assignment, commission and ATO exports.", icon: "bike" },
      { href: "/admin/community", label: "Returns & community", blurb: "Untouched returns offered to neighbours in need.", icon: "bag" },
    ],
  },
  {
    id: "marketing",
    title: "Marketing",
    note: "Facebook, Instagram, WhatsApp broadcasts and the week's content.",
    links: [
      { href: "/admin/marketing", label: "Marketing & social", blurb: "Publish today's menu to Facebook, Instagram and WhatsApp.", icon: "sparkle" },
      { href: "/admin/marketing#content-calendar", label: "Content calendar", blurb: "Seven days of ready-to-post captions built from the live menu.", icon: "calendar" },
      { href: "/admin/marketing#integration-diagnostics", label: "Integration diagnostics", blurb: "Which WhatsApp token works, catalogue set-up, credential sources.", icon: "gear" },
    ],
  },
  {
    id: "catalogue",
    title: "Catalogue",
    note: "One menu, centrally published; stock told once, everywhere.",
    links: [
      { href: "/admin/menu", label: "Menu & dishes", blurb: "The single source of truth for prices, photos and availability.", icon: "box" },
      { href: "/admin/whatsapp", label: "WhatsApp Business", blurb: "Publish the catalogue, work conversations, take orders in the chat.", icon: "phone" },
      { href: "/admin/feedback", label: "Feedback & Google", blurb: "Turn table feedback into Google review drafts with photos.", icon: "sparkle" },
      { href: "/admin/music", label: "Music system", blurb: "Library, collections, schedules, live controls and charging rules.", icon: "play" },
      { href: "/music", label: "Guest music page", blurb: "What is playing, the collections and the song-request form.", icon: "eye", hubOnly: true },
      { href: "/admin/reviews", label: "Reviews", blurb: "Moderate guest reviews on individual dishes.", icon: "star" },
      { href: "/admin/whats-new", label: "What's new", blurb: "The release notes customers see, and which build is running.", icon: "layers" },
    ],
  },
  {
    id: "manufacturing",
    title: "Manufacturing",
    note: "Cost and stock.",
    links: [
      { href: "/admin/production", label: "Production & costing", blurb: "Materials, recipes, batches and cost postings.", icon: "box" },
    ],
  },
  {
    id: "commercial",
    title: "Commercial",
    note: "Money rules, partners, tables and who can do what.",
    links: [
      { href: "/admin/pricing", label: "Pricing & holidays", blurb: "Surcharges, priority fees and the holiday calendar.", icon: "chart" },
      { href: "/admin/promotions", label: "Promotions", blurb: "Customer codes and driver rewards, with caps.", icon: "sparkle" },
      { href: "/admin/delivery", label: "Delivery & payments", blurb: "Zones, partners, markup, Stripe and PayPal credentials.", icon: "truck" },
      { href: "/admin/integrations", label: "Integrations (Square POS)", blurb: "The detached Square POS bridge and partner status.", icon: "layers" },
      { href: "/admin/tables", label: "Tables & QR codes", blurb: "Table ordering links for the room, printable QR posters.", icon: "table" },
      { href: "/admin/staff", label: "Users & access", blurb: "Staff roles, customer logins, go-live checklist.", icon: "user" },
    ],
  },
];

/** Every link, flattened. */
export function adminNavLinks(): NavLink[] {
  return ADMIN_NAV.flatMap((group) => group.links);
}

/** The sidebar: the same groups, without the customer-facing extras. */
export function sidebarNav(): NavGroup[] {
  return ADMIN_NAV.map((group) => ({ ...group, links: group.links.filter((link) => !link.hubOnly) }));
}

/** The top bar lives with the role rules it depends on. */
export { PORTAL_LINKS } from "./auth/core";

/**
 * Which link is "current"? The most specific one that matches. Without this,
 * `/admin/marketing` lights up Admin and Marketing together.
 */
export function activeHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const path = href.split("#")[0];
    if (pathname === path || pathname.startsWith(`${path}/`)) {
      if (!best || path.length > best.split("#")[0].length) best = href;
    }
  }
  return best;
}
