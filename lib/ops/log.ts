import { createHash } from "node:crypto";
import type { Db } from "../db";
import { BUILD } from "../build";
import { getSettings, settingValue } from "../settings";
import { whatsappConfig, maskSecret } from "../whatsapp/client";
import { zoneSummary } from "../delivery/zones";
import { unpublishedReleaseNotes } from "../whats-new";
import { demoStatus } from "../auth/users";
import { pruneActions, recordAction, UNKNOWN_ACCOUNT } from "./actions";
import { courseForAction, stepsToText, type Owner, type Step } from "./playbook";

/**
 * The operational log, part one: findings.
 *
 * A finding is a condition that is true right now — a token Meta rejects, a
 * dish with no price, an order nobody accepted — with a stable reference, the
 * evidence, and the course of action as ordered steps. (Part two, the action
 * log in ./actions, records what was done; this records what is wrong.)
 *
 * Rules this module keeps:
 *
 *   1. Every finding carries a course of action: who does what, where, and how
 *      to confirm it worked. A finding that only names a symptom has moved the
 *      problem, not solved it.
 *   2. A finding is idempotent on its `reference`. Re-running the audit bumps
 *      `last_seen_at` and `occurrences`; it never creates a duplicate.
 *   3. The audit decides what is open. A condition it no longer observes is
 *      closed automatically; one that comes back after being marked resolved is
 *      reopened, because "resolved" that the system cannot confirm is a wish.
 *      Only `ignored` is a mute: it stays closed whatever the audit sees.
 */

export type Severity = "info" | "warning" | "error" | "critical";
export type LogKind =
  | "whatsapp"
  | "delivery"
  | "menu"
  | "orders"
  | "credentials"
  | "music"
  | "release"
  | "security"
  | "system";
export type LogOwner = Owner;

export type Finding = {
  kind: LogKind;
  severity: Severity;
  /** Stable id of the check that raised it, e.g. WA_TOKEN_UNVERIFIED. */
  code?: string;
  title: string;
  detail?: string;
  /** Structured evidence: what to look at to confirm. */
  evidence?: Record<string, unknown>;
  /** The course of action as ordered steps. */
  steps?: Step[];
  /** The same course as one paragraph (derived from `steps` when present). */
  action: string;
  context?: string;
  owner?: LogOwner;
  /** The row this is about, e.g. `menu_item:1`. Keeps references stable. */
  subject?: string;
};

export type LogRow = {
  id: number;
  reference: string;
  kind: LogKind;
  severity: Severity;
  code: string | null;
  title: string;
  detail: string | null;
  evidence: string | null;
  action: string;
  steps: string | null;
  context: string | null;
  owner: LogOwner;
  subject: string | null;
  status: "open" | "acknowledged" | "resolved" | "ignored";
  first_seen_at: string;
  last_seen_at: string;
  occurrences: number;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
};

/** Prefix per kind, so a reference is readable at a glance. */
const PREFIX: Record<LogKind, string> = {
  whatsapp: "WA",
  delivery: "DL",
  menu: "MN",
  orders: "OR",
  credentials: "CR",
  music: "MU",
  release: "RL",
  security: "SC",
  system: "SY",
};

/**
 * A stable reference: kind + subject, hashed to four characters.
 *
 * Deliberately not a random id. If the same fault opens again next week it must
 * land on the same row, or the log fills with duplicates and stops being a
 * history. Hashing `title` would be wrong — rewording the message would fork the
 * reference — so the subject (which does not change) is the input.
 */
export function referenceFor(finding: Pick<Finding, "kind" | "title"> & Partial<Finding>): string {
  const seed = `${finding.kind}:${finding.subject ?? finding.title}`;
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 4).toUpperCase();
  // The subject's *label* is what a person recognises — "token", "catalog",
  // "menu_item:12" — so use the part after the colon and drop the table prefix.
  // "LOG-WA-TOKEN-94C4" is sayable on a phone; "LOG-WA-WHATSATOKEN-94C4" is not.
  const label = (finding.subject ?? "")
    .split(":")
    .pop()
    ?.replace(/[^a-z0-9]+/gi, "")
    .slice(0, 8)
    .toUpperCase();
  return ["LOG", PREFIX[finding.kind], label, hash].filter(Boolean).join("-");
}

/** Build a finding from structured steps; the paragraph form is derived. */
function finding(input: Omit<Finding, "action" | "steps"> & { steps: Step[] }): Finding {
  return {
    ...input,
    owner: input.owner ?? input.steps[0]?.owner ?? "manager",
    action: stepsToText(input.steps),
  };
}

export type RecordResult = {
  written: number;
  updated: number;
  /** Previously marked resolved, observed again, now open. */
  reopened: number;
  /** Muted with `ignored`; left alone. */
  skipped: number;
};

/**
 * Write findings, updating anything already known.
 *
 * One atomic statement per finding — the audit runs from several pages and a
 * button, and check-then-insert would collide on the unique reference.
 *
 *   absent        → inserted
 *   open / ack    → last_seen_at and occurrences bumped, wording refreshed
 *   resolved      → reopened: it was observed again, so it is not resolved
 *   ignored       → untouched; that is what ignoring means
 */
export async function recordFindings(db: Db, findings: Finding[]): Promise<RecordResult> {
  const result: RecordResult = { written: 0, updated: 0, reopened: 0, skipped: 0 };

  for (const entry of findings) {
    const reference = referenceFor(entry);
    const rows = await db.query<{ previous: string | null }>(
      `WITH prev AS (SELECT status FROM operation_logs WHERE reference = $1)
       INSERT INTO operation_logs
         (reference, kind, severity, code, title, detail, evidence, action, steps, context, owner, subject)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (reference) DO UPDATE SET
         last_seen_at = now(),
         occurrences = operation_logs.occurrences + 1,
         severity = excluded.severity,
         code = excluded.code,
         title = excluded.title,
         detail = excluded.detail,
         evidence = excluded.evidence,
         action = excluded.action,
         steps = excluded.steps,
         context = excluded.context,
         owner = excluded.owner,
         status = CASE WHEN operation_logs.status = 'resolved' THEN 'open' ELSE operation_logs.status END,
         resolved_at = CASE WHEN operation_logs.status = 'resolved' THEN NULL ELSE operation_logs.resolved_at END,
         resolution_note = CASE WHEN operation_logs.status = 'resolved'
           THEN 'Reopened by the audit: observed again after being closed by '
                || COALESCE(operation_logs.resolved_by, 'unknown')
                || COALESCE(' (' || operation_logs.resolution_note || ')', '')
           ELSE operation_logs.resolution_note END
       WHERE operation_logs.status <> 'ignored'
       RETURNING (SELECT status FROM prev) AS previous`,
      [
        reference,
        entry.kind,
        entry.severity,
        entry.code ?? null,
        entry.title,
        entry.detail ?? null,
        entry.evidence ? JSON.stringify(entry.evidence) : null,
        entry.action,
        entry.steps && entry.steps.length > 0 ? JSON.stringify(entry.steps) : null,
        entry.context ?? null,
        entry.owner ?? "manager",
        entry.subject ?? null,
      ],
    );

    if (rows.length === 0) result.skipped += 1;
    else if (rows[0].previous === null) result.written += 1;
    else if (rows[0].previous === "resolved") result.reopened += 1;
    else result.updated += 1;
  }

  return result;
}

const DIAGNOSTICS = "/admin/marketing#integration-diagnostics";

/** WhatsApp: configuration, credentials, the token, the last send, the catalogue. */
async function checkWhatsApp(db: Db): Promise<Finding[]> {
  const findings: Finding[] = [];
  const config = await whatsappConfig();

  if (!config.configured) {
    findings.push(
      finding({
        kind: "whatsapp",
        severity: "error",
        code: "WA_NOT_CONFIGURED",
        title: "WhatsApp is not configured — the channel is in sandbox mode",
        detail:
          "No phone number id or access token resolved. Messages are written to whatsapp_messages and never sent.",
        evidence: {
          phoneNumberId: config.phoneNumberId || null,
          tokenSource: config.sources.accessToken,
          tokenEnvKey: config.tokenEnvKey,
          check: "whatsappConfig().configured === false",
        },
        steps: [
          { do: "Read which credentials are reported “missing”.", where: DIAGNOSTICS, owner: "developer" },
          { do: "Set WHATSAPP_PHONE_NUMBER_ID and a valid access token as environment variables, then redeploy.", where: "Vercel → Project → Settings → Environment Variables", owner: "developer" },
          { do: "Or save both in the portal and set the credential source to “Use admin portal”.", where: "/admin/whatsapp", owner: "owner" },
          { do: "Press “Test live connection”.", where: DIAGNOSTICS, owner: "developer", verify: "Meta returns the business phone number; this finding closes on the next audit." },
        ],
        context: "Sandbox mode is deliberate and safe, but no customer receives anything while it is on.",
        subject: "whatsapp:config",
      }),
    );
  }

  if (config.shadowed.length > 0) {
    findings.push(
      finding({
        kind: "credentials",
        severity: "warning",
        code: "CRED_SHADOWED",
        title: `A Vercel variable is overriding ${config.shadowed.length} value(s) saved in the portal`,
        detail: `Overridden: ${config.shadowed.join(", ")}. Editing these in the portal appears to do nothing.`,
        evidence: {
          shadowed: config.shadowed,
          credentialMode: config.credentialMode,
          tokenEnvKey: config.tokenEnvKey,
        },
        steps: [
          { do: "Press “Which token works?” to see which of the two values Meta accepts.", where: DIAGNOSTICS, owner: "developer", verify: "Each source is marked accepted or rejected." },
          { do: "If the portal value is the good one, press “Use admin portal”.", where: DIAGNOSTICS, owner: "developer" },
          { do: "Otherwise delete the stale WHATSAPP_* variable and redeploy.", where: "Vercel → Project → Settings → Environment Variables", owner: "developer", verify: "The credential table shows one source per field." },
        ],
        context:
          "This is the fault that produced Meta error 190 for weeks: the portal showed a green tick while Vercel sent a different, expired token.",
        subject: "whatsapp:shadowed",
      }),
    );
  }

  if (config.configured && !config.tokenVerified) {
    findings.push(
      finding({
        kind: "whatsapp",
        severity: "warning",
        code: "WA_TOKEN_UNVERIFIED",
        title: "The WhatsApp token in use has never been proven against Meta",
        detail: `Reading ${config.tokenEnvKey} (${maskSecret(config.accessToken)}). No successful verification is recorded for this exact token.`,
        evidence: {
          tokenEnvKey: config.tokenEnvKey,
          masked: maskSecret(config.accessToken),
          verifiedToken: config.verifiedToken,
          verifiedAt: config.verifiedAt,
        },
        steps: [
          { do: "Press “Which token works?”.", where: DIAGNOSTICS, owner: "developer", verify: "The token in use is marked accepted; the verification records itself." },
          { do: "If it is rejected, generate a System User token (expiry: Never) and save it to the spare variable.", where: "business.facebook.com → Settings → Users → System users · then Vercel → WHATSAPP_ACCESS_TOKEN_NEW", owner: "owner" },
          { do: "Redeploy and switch the token alias to the new variable.", where: DIAGNOSTICS, owner: "developer", verify: "“Test live connection” succeeds." },
        ],
        context:
          "An unverified token is not necessarily broken — but until it is tested, a 190 is the expected first symptom and the cause is invisible.",
        subject: "whatsapp:token",
      }),
    );
  }

  // A failure only counts while it is the latest word on the channel: once a
  // later message is sent, the fault is over and the finding clears. Without
  // that, one bad message from last month keeps the finding open for ever.
  const lastFailure = await db.maybeOne<{
    id: number;
    created_at: string;
    error: string | null;
    kind: string;
  }>(
    `SELECT m.id, m.created_at::text, m.error, m.kind
       FROM whatsapp_messages m
      WHERE m.direction = 'outbound' AND m.status = 'failed'
        AND NOT EXISTS (
          SELECT 1 FROM whatsapp_messages ok
           WHERE ok.direction = 'outbound' AND ok.status IN ('sent','delivered','read') AND ok.id > m.id)
      ORDER BY m.id DESC LIMIT 1`,
  );
  if (lastFailure) {
    const course = courseForAction({
      component: "whatsapp",
      action: "whatsapp.send",
      outcome: "failed",
      httpStatus: 502,
      error: lastFailure.error ?? "",
      actorRole: "manager",
    });
    const isAuth = course.code === "META_190";
    findings.push(
      finding({
        kind: "whatsapp",
        severity: "error",
        code: isAuth ? "WA_AUTH_190" : "WA_SEND_FAILING",
        title: isAuth
          ? "WhatsApp sends are failing with an authentication error (190)"
          : `WhatsApp send failed: ${lastFailure.error ?? "unknown error"}`,
        detail: `Message #${lastFailure.id} at ${lastFailure.created_at}; no send has succeeded since. ${course.summary}`,
        evidence: {
          table: "whatsapp_messages",
          id: lastFailure.id,
          error: lastFailure.error,
          at: lastFailure.created_at,
          classifiedAs: course.code,
          sql: `SELECT id, status, error, created_at FROM whatsapp_messages WHERE id = ${lastFailure.id}`,
        },
        steps: course.steps,
        subject: "whatsapp:last-failure",
      }),
    );
  }

  if (!config.catalogId) {
    findings.push(
      finding({
        kind: "whatsapp",
        severity: "warning",
        code: "WA_NO_CATALOGUE",
        title: "No WhatsApp catalogue — dishes cannot be published to the chat",
        detail: "Menu ordering in chat still works; the browseable catalogue does not.",
        evidence: {
          catalogId: null,
          businessId: config.businessId || null,
          businessAccountId: config.businessAccountId || null,
        },
        steps: [
          { do: "Press “Find my catalog”; if one exists it is saved for you.", where: DIAGNOSTICS, owner: "owner", verify: "The catalogue id row is no longer “missing”." },
          { do: "If none is found, press “Create catalogue”.", where: DIAGNOSTICS, owner: "owner" },
          { do: "If creating is refused, set WHATSAPP_BUSINESS_ID to the business portfolio id (Business settings → Business info → ID — not the WABA id) and press it again.", where: "Vercel → Project → Settings → Environment Variables", owner: "developer" },
          { do: "Publish the menu to the catalogue.", where: "/admin/whatsapp", owner: "manager", verify: "Dishes show “published”." },
        ],
        context:
          "The catalogue id is the one value not visible on Meta's obvious screens, which is why it is generated here rather than hunted by hand.",
        subject: "whatsapp:catalog",
      }),
    );
  }

  return findings;
}

/** Menu: published dishes a customer cannot order. */
async function checkMenu(db: Db): Promise<Finding[]> {
  const findings: Finding[] = [];
  const hiddenDishes = await db.query<{ id: number; name: string; is_featured: boolean }>(
    "SELECT id, name, is_featured FROM menu_items WHERE published AND NOT is_available ORDER BY is_featured DESC, id",
  );
  for (const dish of hiddenDishes) {
    const stock = await db.maybeOne<{ stock_after: number | null; created_at: string; reason: string }>(
      `SELECT stock_after, created_at::text, reason
         FROM inventory_movements WHERE item_id = $1
        ORDER BY id DESC LIMIT 1`,
      [dish.id],
    );
    const negative = Number(stock?.stock_after ?? 0) < 0;
    findings.push(
      finding({
        kind: "menu",
        severity: dish.is_featured ? "warning" : "info",
        code: negative ? "MENU_STOCK_NEGATIVE" : "MENU_DISH_HIDDEN",
        title: `${dish.name} is hidden from the menu${dish.is_featured ? " and it is a featured dish" : ""}`,
        detail: negative
          ? `Stock went negative (${stock?.stock_after}) on ${stock?.created_at} via a ${stock?.reason}. The dish auto-hides at zero.`
          : `Marked unavailable. Last stock movement: ${stock?.reason ?? "none recorded"}.`,
        evidence: {
          table: "menu_items",
          id: dish.id,
          isFeatured: dish.is_featured,
          stock: stock ?? null,
          sql: `SELECT id, name, is_available, stock_qty, track_stock FROM menu_items WHERE id = ${dish.id}`,
        },
        steps: negative
          ? [
              { do: `Count the portions of ${dish.name} actually on hand.`, owner: "kitchen" },
              { do: "Enter that count as the stock figure — a negative count means an order took the last portion and the figure was never corrected.", where: "/admin/menu", owner: "manager", verify: "Stock is zero or above." },
              { do: "Set the dish available again.", where: "/admin/menu", owner: "manager", verify: `${dish.name} appears on /menu and can be added to a basket.` },
            ]
          : [
              { do: `Confirm the kitchen can serve ${dish.name}.`, owner: "kitchen" },
              { do: "Set it available.", where: "/admin/menu", owner: "manager", verify: `${dish.name} appears on /menu.` },
              { do: "If it is off the menu for good, unpublish it instead so this finding closes.", where: "/admin/menu", owner: "manager" },
            ],
        context: dish.is_featured
          ? "A featured dish is shown on the homepage and in marketing captions, so hiding it removes a dish customers came for."
          : undefined,
        subject: `menu_item:${dish.id}`,
      }),
    );
  }

  const noPrice = await db.query<{ id: number; name: string }>(
    `SELECT mi.id, mi.name FROM menu_items mi
      WHERE mi.published
        AND NOT EXISTS (SELECT 1 FROM item_variants v WHERE v.item_id = mi.id AND v.active)`,
  );
  for (const dish of noPrice) {
    findings.push(
      finding({
        kind: "menu",
        severity: "error",
        code: "MENU_NO_PRICE",
        title: `${dish.name} has no active price and cannot be ordered`,
        detail: "Published, but every size variant is inactive, so the dish renders without a price.",
        evidence: {
          table: "menu_items",
          id: dish.id,
          sql: `SELECT id, label, price_cents, active FROM item_variants WHERE item_id = ${dish.id}`,
        },
        steps: [
          { do: "Open the dish and add or reactivate a size with a price.", where: "/admin/menu", owner: "manager", verify: `${dish.name} shows a price on /menu.` },
        ],
        subject: `menu_item-price:${dish.id}`,
      }),
    );
  }

  return findings;
}

/** Delivery: the address fees are computed from, and the zones. */
async function checkDelivery(db: Db): Promise<Finding[]> {
  const findings: Finding[] = [];
  const settings = await getSettings();
  const zones = await zoneSummary(db);
  const address = settingValue(settings, "restaurant_address", "");
  if (!address) {
    findings.push(
      finding({
        kind: "delivery",
        severity: "error",
        code: "DLV_ADDRESS_MISSING",
        title: "The kitchen address is not set",
        detail: "Delivery is quoted from a fallback point, so every fee and ETA is approximate.",
        evidence: { setting: "restaurant_address", value: "" },
        steps: [
          { do: "Enter the kitchen address: 1/53 Bulolo Dr, Whalan NSW 2770.", where: "/admin/delivery", owner: "owner", verify: "A quote to a Whalan address returns the zone's base fee." },
        ],
        context: "The courier integrations read the same value, so a wrong address sends a driver to the wrong shop.",
        subject: "settings:address",
      }),
    );
  } else if (!/Whalan/i.test(address)) {
    findings.push(
      finding({
        kind: "delivery",
        severity: "warning",
        code: "DLV_ADDRESS_MISMATCH",
        title: `The stored address does not look like the Whalan kitchen: “${address}”`,
        detail: "Delivery fees and ETAs are computed from this address.",
        evidence: { setting: "restaurant_address", value: address, expected: "contains “Whalan”" },
        steps: [
          { do: "Correct it to 1/53 Bulolo Dr, Whalan NSW 2770.", where: "/admin/delivery", owner: "owner", verify: "The address on the page and in a courier quote both read Whalan." },
        ],
        context:
          "The address was wrong once before — Pitt Street in the CBD — and every delivery was priced from 39 km away before anyone noticed.",
        subject: "settings:address-mismatch",
      }),
    );
  }

  if (zones.zones.length === 0) {
    findings.push(
      finding({
        kind: "delivery",
        severity: "warning",
        code: "DLV_NO_ZONES",
        title: "No delivery zones are defined",
        detail: "Every address is quoted the same way, including ones the kitchen cannot reach.",
        evidence: { table: "delivery_zones", activeRows: 0 },
        steps: [
          { do: "Add the postcode zones with their fees.", where: "/admin/delivery", owner: "owner", verify: "The zone table lists each area and its postcodes." },
        ],
        subject: "delivery:zones",
      }),
    );
  }

  return findings;
}

/** Orders: anything waiting far longer than a kitchen takes. */
async function checkOrders(db: Db): Promise<Finding[]> {
  const findings: Finding[] = [];
  // `pending_confirm` is the state an order waits in for the counter to accept
  // it. This check used to ask for a status called `pending`, which does not
  // exist, so the orders most likely to be forgotten were never reported.
  const stuck = await db.query<{ id: number; code: string; status: string; created_at: string; payment_status: string }>(
    `SELECT id, code, status, created_at::text, payment_status FROM orders
      WHERE status IN ('pending_confirm','confirmed','preparing')
        AND created_at < now() - interval '90 minutes'
      ORDER BY created_at LIMIT 20`,
  );
  for (const order of stuck) {
    const waiting = order.status === "pending_confirm";
    findings.push(
      finding({
        kind: "orders",
        severity: "error",
        code: waiting ? "ORD_NOT_ACCEPTED" : "ORD_STUCK_IN_KITCHEN",
        title: waiting
          ? `Order ${order.code} has waited over 90 minutes to be accepted`
          : `Order ${order.code} has been ${order.status} for over 90 minutes`,
        detail: `Created ${order.created_at}; payment ${order.payment_status}.`,
        evidence: {
          table: "orders",
          id: order.id,
          code: order.code,
          status: order.status,
          paymentStatus: order.payment_status,
          sql: `SELECT type, message, actor, created_at FROM order_events WHERE order_id = ${order.id} ORDER BY created_at`,
        },
        steps: waiting
          ? [
              { do: `Open ${order.code} and phone the customer if it can still be made.`, where: "/counter", owner: "counter" },
              { do: "Accept it, or cancel it with a reason.", where: "/counter", owner: "counter", verify: "The order leaves the “to accept” column." },
              { do: "If it was paid online and is cancelled, confirm the refund.", where: `/admin/orders`, owner: "manager", verify: "Payment status “refunded”." },
            ]
          : [
              { do: `Find ${order.code} on the kitchen display and mark it ready, or cancel it.`, where: "/kitchen", owner: "kitchen", verify: "The ticket leaves the kitchen columns." },
              { do: "If the food went out and the ticket was never closed, complete it so the day's figures are right.", where: "/counter", owner: "counter" },
            ],
        subject: `order:${order.code}`,
      }),
    );
  }

  return findings;
}

/** Release: notes that shipped in this build and are not in the feed. */
async function checkRelease(db: Db): Promise<Finding[]> {
  const findings: Finding[] = [];
  // A note that shipped in this build and is not in the feed. This is the fault
  // that left the site reading 3.5.0 after 3.6.0 deployed; the check that stood
  // here before tested `published_at IS NULL` on a NOT NULL column and could
  // never fire.
  const unpublished = await unpublishedReleaseNotes(db);
  if (unpublished.length > 0) {
    findings.push(
      finding({
        kind: "release",
        severity: "warning",
        code: "REL_NOTES_UNPUBLISHED",
        title: `${unpublished.length} release note(s) in this build are not on the “What's new” page`,
        detail: `Missing from the feed: PR ${unpublished.map((pr) => `#${pr}`).join(", ")}. Build v${BUILD.version}.`,
        evidence: {
          build: BUILD.version,
          commit: BUILD.shortCommit || null,
          missingPrs: unpublished,
          sql: "SELECT pr_number, version, published_at FROM whats_new ORDER BY published_at DESC LIMIT 5",
        },
        steps: [
          { do: "Reload this page: notes publish when the application starts, and a start may be in progress.", owner: "manager" },
          { do: "Read the function log for “Release notes not published”.", where: "Vercel → Project → Logs", owner: "developer", verify: "The error names the cause, usually a database permission or a constraint." },
          { do: "Check the release block of the health check.", where: "/api/health", owner: "developer", verify: "`release.notesMissing` is an empty list." },
        ],
        subject: "release:unpublished",
      }),
    );
  }

  return findings;
}

/** Tables whose rows are about people, or are credentials or logs. */
const PERSONAL_TABLES = new Set([
  "action_logs",
  "customer_activity",
  "customers",
  "driver_documents",
  "driver_ledger",
  "driver_location_pings",
  "driver_trips",
  "driver_verification_events",
  "drivers",
  "feedback_invites",
  "operation_logs",
  "orders",
  "order_events",
  "payments",
  "settings",
  "staff",
  "whatsapp_conversations",
  "whatsapp_messages",
]);

/**
 * Tables in `public` with row level security off that Supabase's API roles may
 * read. Empty anywhere those roles do not exist (a plain Postgres, the test
 * engine), so the check costs one small query outside Supabase.
 */
async function tablesOpenToDataApi(db: Db): Promise<{ name: string; ident: string; writable: boolean }[]> {
  const roles = await db.query<{ rolname: string }>(
    "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname",
  );
  if (roles.length === 0) return [];
  // Role names come from the fixed list above, never from input.
  const any = (privilege: string) =>
    roles.map((role) => `has_table_privilege('${role.rolname}', c.oid, '${privilege}')`).join(" OR ");
  return db.query<{ name: string; ident: string; writable: boolean }>(
    `SELECT c.relname AS name, quote_ident(c.relname) AS ident, (${any("INSERT, UPDATE, DELETE")}) AS writable
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
        AND (${any("SELECT")})
      ORDER BY c.relname`,
  );
}

/** Security: published passwords still in use, sign-in failures, tables open to the public API. */
async function checkSecurity(db: Db): Promise<Finding[]> {
  const findings: Finding[] = [];
  const demo = await demoStatus(db);
  if (demo && demo.staffIds.length > 0) {
    const accounts = await db.query<{ id: number; email: string; role: string; active: boolean }>(
      "SELECT id, email, role, active FROM staff WHERE id = ANY($1::int[]) ORDER BY id",
      [demo.staffIds],
    );
    const live = accounts.filter((account) => account.active);
    if (live.length > 0) {
      const admin = live.some((account) => account.role === "admin" || account.role === "manager");
      findings.push(
        finding({
          kind: "security",
          severity: admin ? "critical" : "error",
          code: "SEC_DEMO_PASSWORD",
          title: `${live.length} staff login(s) still use the published demo password`,
          detail: `${live.map((account) => `${account.email} (${account.role})`).join(", ")}. The demo password is printed in the README${demo.enabled ? " and on the sign-in page" : ""}, so anyone can sign in with it.`,
          evidence: {
            accounts: live.map((account) => ({ id: account.id, email: account.email, role: account.role })),
            signInPageListsDemoAccounts: demo.enabled,
            demoCustomerAccounts: demo.customers,
          },
          steps: [
            { do: "Open Users & access and, under “Demo credentials are still switched on”, press “Remove demo credentials”. If your own login is on the demo password it asks you for a new one first. Pick a quiet moment: every other login still on the demo password is switched off in the same step.", where: "/admin/staff", owner: "owner", verify: "The sign-in page no longer lists demo accounts and the demo password is refused." },
            { do: "Give each person their login back: reset the password on each account that was switched off, then enable it again.", where: "/admin/staff", owner: "owner", verify: "Each person can sign in on their own device." },
            { do: "Review who signed in while the demo password was live.", where: "/admin/logs?view=actions&component=auth", owner: "owner", verify: "Every auth.login row is a person you recognise." },
          ],
          context:
            "With an administrator login on a published password, every order, customer record and credential in this portal is readable and changeable by anyone who finds the site.",
          subject: "security:demo-password",
        }),
      );
    }
  }

  const exposed = await tablesOpenToDataApi(db);
  if (exposed.length > 0) {
    const personal = exposed.filter((table) => PERSONAL_TABLES.has(table.name));
    const writable = exposed.filter((table) => table.writable);
    const names = exposed.map((table) => table.name);
    findings.push(
      finding({
        kind: "security",
        severity: personal.length > 0 ? "critical" : "error",
        code: "SEC_TABLES_OPEN_TO_API",
        title: `${exposed.length} database table(s) can be read through Supabase's public API`,
        detail: `Row level security is off on: ${names.slice(0, 40).join(", ")}${names.length > 40 ? `, +${names.length - 40} more` : ""}. Supabase serves every table in the public schema through its Data API, and the API's public role holds privileges on these${writable.length > 0 ? ` (${writable.length} of them writable)` : ""}. Anyone with the project's publishable key can use them without signing in to this application.`,
        evidence: {
          tables: names,
          writable: writable.map((table) => table.name),
          holdPersonalData: personal.map((table) => table.name),
          sql: "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity ORDER BY 1",
          fix: exposed.map((table) => `ALTER TABLE public.${table.ident} ENABLE ROW LEVEL SECURITY;`),
        },
        steps: [
          { do: "Confirm nothing outside this application reads these tables through the Data API. The application connects to Postgres directly as the table owner; it does not use the Data API, and row level security does not apply to it.", where: "Supabase dashboard → Logs → API Gateway, filter on /rest/v1", owner: "developer", verify: "No requests for these tables from a tool you rely on." },
          { do: "Enable row level security on each table listed, using the statements under “fix” in the evidence. With no policies added, the API roles are denied everything.", where: "Supabase dashboard → SQL Editor", owner: "developer", verify: "The Security Advisor in the Supabase dashboard no longer lists “RLS Disabled in Public”, and this finding closes on the next audit." },
          { do: "Alternatively, if nothing uses the Data API at all, switch it off for the public schema.", where: "Supabase dashboard → Project Settings → Data API → Exposed schemas", owner: "developer" },
          { do: "Check whether the tables were read while they were open, and treat what they hold as disclosed if they were.", where: "Supabase dashboard → Logs → API Gateway", owner: "owner" },
        ],
        context:
          "The publishable (anon) key is designed to be public: it is safe only because row level security decides what it may touch. On a table without it, that key is a database login.",
        subject: "security:data-api",
      }),
    );
  }

  const loginFailures = await db.maybeOne<{ c: number; accounts: number; unknown: number }>(
    `SELECT COUNT(*) AS c,
            COUNT(DISTINCT actor) FILTER (WHERE actor <> $1) AS accounts,
            COUNT(*) FILTER (WHERE actor = $1) AS unknown
       FROM action_logs
      WHERE action = 'auth.login' AND outcome <> 'ok' AND occurred_at > now() - interval '60 minutes'`,
    [UNKNOWN_ACCOUNT],
  );
  if (Number(loginFailures?.c ?? 0) >= 5) {
    findings.push(
      finding({
        kind: "security",
        severity: "warning",
        code: "SEC_LOGIN_FAILURES",
        title: `${loginFailures?.c} failed staff sign-ins in the last hour`,
        detail: `${Number(loginFailures?.c) - Number(loginFailures?.unknown)} against ${loginFailures?.accounts} staff account(s); ${loginFailures?.unknown} named no account that exists.`,
        evidence: {
          table: "action_logs",
          attempts: Number(loginFailures?.c),
          staffAccountsTried: Number(loginFailures?.accounts),
          attemptsOnUnknownAccounts: Number(loginFailures?.unknown),
          sql: "SELECT occurred_at, actor, outcome, error_code FROM action_logs WHERE action = 'auth.login' AND outcome <> 'ok' ORDER BY occurred_at DESC LIMIT 20",
        },
        steps: [
          { do: "Read the attempts: one account and a tired member of staff is a forgotten password; many accounts is somebody guessing.", where: "/admin/logs?view=actions&component=auth&problems=1", owner: "owner" },
          { do: "For a forgotten password, reset it.", where: "/admin/staff", owner: "owner" },
          { do: "For guessing, change the passwords of the accounts being tried and disable any that are unused.", where: "/admin/staff", owner: "owner", verify: "No further failed attempts in the next hour." },
        ],
        subject: "security:login-failures",
      }),
    );
  }

  return findings;
}

/** System: the same action failing the same way, repeatedly. */
async function checkRepeatedFailures(db: Db): Promise<Finding[]> {
  const findings: Finding[] = [];
  // The action log records each failure once. Three of the same in a day is a
  // standing fault, and belongs here with the others.
  const repeated = await db.query<{
    action: string;
    error_code: string;
    c: number;
    last_ref: string;
    last_at: string;
    last_message: string;
  }>(
    `SELECT action, error_code, COUNT(*) AS c,
            (ARRAY_AGG(reference ORDER BY occurred_at DESC))[1] AS last_ref,
            MAX(occurred_at)::text AS last_at,
            (ARRAY_AGG(message ORDER BY occurred_at DESC))[1] AS last_message
       FROM action_logs
      WHERE outcome = 'failed' AND occurred_at > now() - interval '24 hours' AND error_code IS NOT NULL
      GROUP BY action, error_code
     HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) DESC LIMIT 10`,
  );
  for (const group of repeated) {
    const component = group.action.split(".")[0];
    const course = courseForAction({
      component,
      action: group.action,
      outcome: "failed",
      httpStatus: 500,
      error: group.last_message,
      actorRole: "manager",
      reference: group.last_ref,
    });
    findings.push(
      finding({
        kind: "system",
        severity: "error",
        code: "ACT_REPEATED_FAILURE",
        title: `${group.action} has failed ${group.c} times in 24 hours (${group.error_code})`,
        detail: `Most recent: ${group.last_ref} at ${group.last_at}. ${course.summary}`,
        evidence: {
          action: group.action,
          errorCode: group.error_code,
          failures24h: Number(group.c),
          latestReference: group.last_ref,
          view: `/admin/logs?view=actions&q=${encodeURIComponent(group.action)}&problems=1`,
        },
        steps: course.steps,
        subject: `action:${group.action}:${group.error_code}`,
      }),
    );
  }

  return findings;
}

export type AuditCheck = {
  name: string;
  /** The finding kinds this check is the only source of. */
  kinds: LogKind[];
  run: (db: Db) => Promise<Finding[]>;
};

const CHECKS: AuditCheck[] = [
  { name: "whatsapp", kinds: ["whatsapp", "credentials"], run: checkWhatsApp },
  { name: "menu", kinds: ["menu"], run: checkMenu },
  { name: "delivery", kinds: ["delivery"], run: checkDelivery },
  { name: "orders", kinds: ["orders"], run: checkOrders },
  { name: "release", kinds: ["release"], run: checkRelease },
  { name: "security", kinds: ["security"], run: checkSecurity },
  { name: "actions", kinds: ["system"], run: checkRepeatedFailures },
];

export type FailedCheck = { check: string; kinds: LogKind[]; error: string };
export type Inspection = { findings: Finding[]; failed: FailedCheck[] };

/**
 * Run every check, each on its own.
 *
 * A check that throws is reported as a finding of its own and named in
 * `failed`. That matters for what happens next: findings are closed when the
 * audit stops observing them, and "the check crashed" must never be read as
 * "the fault went away".
 *
 * Read-only: nothing here changes a setting. It looks, it reports, and the
 * steps tell a person what to change.
 */
export async function inspectSystem(db: Db, checks: AuditCheck[] = CHECKS): Promise<Inspection> {
  const findings: Finding[] = [];
  const failed: FailedCheck[] = [];

  for (const check of checks) {
    try {
      findings.push(...(await check.run(db)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ check: check.name, kinds: check.kinds, error: message });
      findings.push(
        finding({
          kind: "system",
          severity: "error",
          code: "SYS_AUDIT_CHECK_FAILED",
          title: `The ${check.name} audit check could not run`,
          detail: `It threw “${message.slice(0, 240)}”. Findings of kind ${check.kinds.join(", ")} were left as they were: not refreshed, and not cleared.`,
          evidence: { check: check.name, covers: check.kinds, error: message.slice(0, 600) },
          steps: [
            { do: "Run the audit again; a dropped database connection clears on a retry.", where: "/admin/logs", owner: "manager", verify: "This finding closes." },
            { do: "If it repeats, read the error above against the schema: a renamed column or a missing table is the usual cause.", where: "lib/ops/log.ts", owner: "developer" },
            { do: "Check the platform is healthy.", where: "/api/health", owner: "developer", verify: "`ok: true`." },
          ],
          subject: `audit:${check.name}`,
        }),
      );
    }
  }

  return { findings, failed };
}

/** The checks the audit runs, exported so a test can swap one for a failing one. */
export function auditChecks(): AuditCheck[] {
  return [...CHECKS];
}

/** Audit the running system and produce findings. */
export async function auditSystem(db: Db): Promise<Finding[]> {
  return (await inspectSystem(db)).findings;
}

export type AuditResult = RecordResult & {
  findings: Finding[];
  /** Open findings the audit no longer observes, closed by it. */
  cleared: number;
  /** Checks that threw. Their findings were neither refreshed nor cleared. */
  failedChecks: FailedCheck[];
};

/**
 * Close what is no longer true. Without this the open list only ever grows:
 * a dish restocked on Tuesday would still be reported hidden on Friday.
 *
 * Kinds whose check did not run are excluded — not seeing a fault because the
 * check crashed is not the same as the fault being gone.
 */
async function clearUnobserved(db: Db, observed: string[], uncheckedKinds: string[]): Promise<number> {
  // Counted in SQL rather than from the driver's row count, which the
  // in-process test database does not report.
  const row = await db.one<{ c: number }>(
    `WITH closed AS (
       UPDATE operation_logs
          SET status = 'resolved',
              resolved_at = now(),
              resolved_by = 'audit',
              resolution_note = 'Cleared automatically: the audit no longer observes this condition.'
        WHERE status IN ('open','acknowledged')
          AND NOT (reference = ANY($1::text[]))
          AND NOT (kind = ANY($2::text[]))
        RETURNING 1)
     SELECT COUNT(*) AS c FROM closed`,
    [observed, uncheckedKinds],
  );
  return Number(row.c);
}

/** Where the time of the last audit is kept: one row, shared by every instance. */
const AUDIT_MARKER = "ops_last_audit_at";

async function stampAudit(db: Db, at: Date): Promise<void> {
  await db.query(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [AUDIT_MARKER, at.toISOString()],
  );
}

/** When the system was last audited, by anyone, from any instance. */
export async function lastAuditAt(db: Db): Promise<string | null> {
  const row = await db.maybeOne<{ value: string }>("SELECT value FROM settings WHERE key = $1", [AUDIT_MARKER]);
  return row?.value || null;
}

/** Audit, record, and close what cleared. Returns what changed. */
export async function runAudit(db: Db, checks?: AuditCheck[]): Promise<AuditResult> {
  const { findings, failed } = await inspectSystem(db, checks);
  const result = await recordFindings(db, findings);
  const cleared = await clearUnobserved(
    db,
    findings.map((entry) => referenceFor(entry)),
    [...new Set(failed.flatMap((entry) => entry.kinds))],
  );
  await stampAudit(db, new Date());
  return { findings, ...result, cleared, failedChecks: failed };
}

/** How stale the findings may get before a page that shows them re-audits. */
export const AUDIT_MAX_AGE_MINUTES = 10;

/**
 * Keep the findings fresh without a button.
 *
 * The first version only audited when somebody pressed “Run audit” — and since
 * the page could not be found, nobody did, and the table in production stayed
 * empty. The pages that show findings call this instead: it audits when the
 * last audit is older than ten minutes and does nothing otherwise.
 *
 * The slot is claimed in one statement, so two pages opened at the same moment
 * — or two instances — cannot both audit. A scheduled audit is written to the
 * action log only when it changed something; "nothing changed", every ten
 * minutes, is not a record anyone needs.
 *
 * It must never be called from getDb(): the audit reads settings, which waits
 * on getDb(), which would be waiting on this.
 */
export async function ensureFreshAudit(
  db: Db,
  maxAgeMinutes = AUDIT_MAX_AGE_MINUTES,
): Promise<{ ran: boolean; result?: AuditResult }> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - maxAgeMinutes * 60_000).toISOString();
  let claimed = false;
  try {
    // The usual answer is "still fresh", and a page that refreshes itself asks
    // every few seconds: answer that with a read, and take the lock only when
    // there is an audit to run.
    const last = await lastAuditAt(db);
    if (last && last >= staleBefore) return { ran: false };

    const claim = await db.query<{ value: string }>(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value
         WHERE settings.value < $3
       RETURNING value`,
      [AUDIT_MARKER, now.toISOString(), staleBefore],
    );
    if (claim.length === 0) return { ran: false };
    claimed = true;

    const started = Date.now();
    const result = await runAudit(db);
    const pruned = await pruneActions(db).catch(() => 0);
    if (result.written + result.reopened + result.cleared > 0 || result.failedChecks.length > 0) {
      await recordAction(db, {
        component: "logs",
        action: "audit",
        outcome: "ok",
        actor: "system",
        actorRole: "system",
        durationMs: Date.now() - started,
        message: `Scheduled audit: ${result.findings.length} finding(s) — ${result.written} new, ${result.updated} still open, ${result.reopened} reopened, ${result.cleared} cleared`,
        detail: {
          trigger: "page-view",
          findings: result.findings.length,
          written: result.written,
          updated: result.updated,
          reopened: result.reopened,
          cleared: result.cleared,
          ignored: result.skipped,
          failedChecks: result.failedChecks.map((entry) => entry.check),
          prunedActionRows: pruned,
        },
      });
    }
    return { ran: true, result };
  } catch (error) {
    console.error("[khanbaba] scheduled audit failed", error);
    // Give the slot back, so the next page view tries again rather than
    // trusting an audit that never finished.
    if (claimed) {
      await db.query("DELETE FROM settings WHERE key = $1", [AUDIT_MARKER]).catch(() => undefined);
    }
    return { ran: false };
  }
}

const SEVERITY_ORDER = `CASE severity
                 WHEN 'critical' THEN 0 WHEN 'error' THEN 1
                 WHEN 'warning' THEN 2 ELSE 3 END`;

/** What an operator opens first: unresolved rows, worst and newest first. */
export async function openLogs(db: Db, limit = 50): Promise<LogRow[]> {
  return db.query<LogRow>(
    `SELECT * FROM operation_logs
      WHERE status IN ('open','acknowledged')
      ORDER BY ${SEVERITY_ORDER}, last_seen_at DESC
      LIMIT $1`,
    [limit],
  );
}

/** Closed rows — the history of what was wrong and who closed it. */
export async function closedLogs(db: Db, limit = 100): Promise<LogRow[]> {
  return db.query<LogRow>(
    `SELECT * FROM operation_logs
      WHERE status IN ('resolved','ignored')
      ORDER BY resolved_at DESC NULLS LAST, last_seen_at DESC
      LIMIT $1`,
    [limit],
  );
}

export async function allLogs(db: Db, limit = 1000): Promise<LogRow[]> {
  return db.query<LogRow>(
    `SELECT * FROM operation_logs
      ORDER BY CASE WHEN status IN ('open','acknowledged') THEN 0 ELSE 1 END,
               ${SEVERITY_ORDER}, last_seen_at DESC
      LIMIT $1`,
    [limit],
  );
}

export async function logSummary(db: Db): Promise<{
  open: number;
  critical: number;
  error: number;
  warning: number;
  info: number;
  resolved: number;
  ignored: number;
  byKind: { kind: string; count: number }[];
}> {
  const counts = await db.query<{ severity: string; c: number; status: string }>(
    "SELECT severity, status, COUNT(*) AS c FROM operation_logs GROUP BY severity, status",
  );
  const isOpen = (status: string) => status === "open" || status === "acknowledged";
  // Severity counts are of what is open. Counting closed rows too made the
  // strip read "3 errors" beside "0 open".
  const row = (severity: string) =>
    counts
      .filter((entry) => entry.severity === severity && isOpen(entry.status))
      .reduce((sum, entry) => sum + Number(entry.c), 0);
  const byStatus = (status: string) =>
    counts.filter((entry) => entry.status === status).reduce((sum, entry) => sum + Number(entry.c), 0);
  const byKind = await db.query<{ kind: string; count: number }>(
    `SELECT kind, COUNT(*)::int AS count FROM operation_logs
      WHERE status IN ('open','acknowledged') GROUP BY kind ORDER BY count DESC`,
  );
  return {
    open: counts.filter((entry) => isOpen(entry.status)).reduce((sum, entry) => sum + Number(entry.c), 0),
    critical: row("critical"),
    error: row("error"),
    warning: row("warning"),
    info: row("info"),
    resolved: byStatus("resolved"),
    ignored: byStatus("ignored"),
    byKind,
  };
}

/** Mark a row resolved, ignored, or acknowledged. Records who and why. */
export async function setLogStatus(
  db: Db,
  id: number,
  status: "open" | "acknowledged" | "resolved" | "ignored",
  actor: string,
  note?: string,
): Promise<boolean> {
  const existing = await db.maybeOne<{ id: number }>(
    "SELECT id FROM operation_logs WHERE id = $1",
    [id],
  );
  if (!existing) return false;
  await db.query(
    `UPDATE operation_logs
        SET status = $1,
            resolved_at = CASE WHEN $1 IN ('resolved','ignored') THEN now() ELSE NULL END,
            resolved_by = CASE WHEN $1 IN ('resolved','ignored') THEN $2 ELSE NULL END,
            resolution_note = $3
      WHERE id = $4`,
    [status, actor, note ?? null, id],
  );
  return true;
}
