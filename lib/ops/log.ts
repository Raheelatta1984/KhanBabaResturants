import { createHash } from "node:crypto";
import type { Db } from "../db";
import { getSettings, settingValue } from "../settings";
import { whatsappConfig, maskSecret } from "../whatsapp/client";
import { zoneSummary } from "../delivery/zones";

/**
 * The operational log: findings with a reference and a course of action.
 *
 * The rest of this codebase records *events*. This module answers the question
 * an operator actually has — "what is wrong, where do I look, what do I do?" —
 * and it exists because diagnosing the WhatsApp 190 meant reading a Graph error
 * and knowing, from experience, that a stale Vercel variable was shadowing the
 * portal token. That knowledge belonged somewhere a person could read it.
 *
 * Two rules this module keeps:
 *
 *   1. Every finding carries a course of action. A log entry that says "token
 *      invalid" and stops has moved the problem, not solved it.
 *   2. A finding is idempotent on its `reference`. Re-running the audit updates
 *      `last_seen_at` and increments `occurrences`; it does not create a
 *      duplicate. The reference is stable and quotable — LOG-WA-190-A1B2 — so
 *      "the WhatsApp one, A1B2" means the same thing tomorrow.
 */

export type Severity = "info" | "warning" | "error" | "critical";
export type LogKind =
  | "whatsapp"
  | "delivery"
  | "menu"
  | "orders"
  | "credentials"
  | "music"
  | "release";
export type LogOwner = "owner" | "manager" | "counter" | "kitchen" | "developer" | "meta";

export type Finding = {
  kind: LogKind;
  severity: Severity;
  title: string;
  detail?: string;
  /** Structured evidence: what to look at to confirm. */
  evidence?: Record<string, unknown>;
  /** What to do. Ordered steps read better than a paragraph. */
  action: string;
  context?: string;
  owner?: LogOwner;
  /** The row this is about, e.g. `menu_item:1`. Keeps references stable. */
  subject?: string;
};

export type LogRow = Finding & {
  id: number;
  reference: string;
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
};

/**
 * A stable reference: kind + subject, hashed to four characters.
 *
 * Deliberately not a random id. If the same fault opens again next week it must
 * land on the same row, or the log fills with duplicates and stops being a
 * history. Hashing `title` would be wrong — rewording the message would fork the
 * reference — so the subject (which does not change) is the input.
 */
export function referenceFor(finding: Finding): string {
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

/**
 * Write findings, updating anything already known.
 *
 * An `open` or `acknowledged` row sees its `last_seen_at` and `occurrences`
 * bumped. A `resolved` or `ignored` row is left resolved: a fault the owner has
 * deliberately accepted should not flip itself back to open on the next audit.
 * If it matters again they will reopen it deliberately.
 */
export async function recordFindings(db: Db, findings: Finding[]): Promise<{
  written: number;
  updated: number;
  skipped: number;
}> {
  let written = 0;
  let updated = 0;
  let skipped = 0;

  for (const finding of findings) {
    const reference = referenceFor(finding);
    const existing = await db.maybeOne<{ id: number; status: string }>(
      "SELECT id, status FROM operation_logs WHERE reference = $1",
      [reference],
    );

    if (!existing) {
      await db.query(
        `INSERT INTO operation_logs
           (reference, kind, severity, title, detail, evidence, action, context, owner, subject)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          reference,
          finding.kind,
          finding.severity,
          finding.title,
          finding.detail ?? null,
          finding.evidence ? JSON.stringify(finding.evidence) : null,
          finding.action,
          finding.context ?? null,
          finding.owner ?? "manager",
          finding.subject ?? null,
        ],
      );
      written += 1;
      continue;
    }

    if (existing.status === "resolved" || existing.status === "ignored") {
      skipped += 1;
      continue;
    }

    await db.query(
      `UPDATE operation_logs
          SET last_seen_at = now(),
              occurrences = occurrences + 1,
              severity = $1,
              title = $2,
              detail = $3,
              evidence = $4,
              action = $5,
              context = $6,
              owner = $7
        WHERE id = $8`,
      [
        finding.severity,
        finding.title,
        finding.detail ?? null,
        finding.evidence ? JSON.stringify(finding.evidence) : null,
        finding.action,
        finding.context ?? null,
        finding.owner ?? "manager",
        existing.id,
      ],
    );
    updated += 1;
  }

  return { written, updated, skipped };
}

/**
 * Audit the running system and produce findings.
 *
 * Read-only: nothing here changes a setting. It looks, it reports, and the
 * action text tells a person what to change.
 */
export async function auditSystem(db: Db): Promise<Finding[]> {
  const findings: Finding[] = [];
  const settings = await getSettings();

  // --- WhatsApp ------------------------------------------------------------
  const config = await whatsappConfig();

  if (!config.configured) {
    findings.push({
      kind: "whatsapp",
      severity: "error",
      title: "WhatsApp is not configured — the channel is in sandbox mode",
      detail:
        "No phone number id or access token resolved. Messages are logged to whatsapp_messages and never sent.",
      evidence: {
        phoneNumberId: config.phoneNumberId || null,
        tokenSource: config.sources.accessToken,
        tokenEnvKey: config.tokenEnvKey,
      },
      action:
        "Set WHATSAPP_PHONE_NUMBER_ID and a valid token. Either add them in Vercel → Settings → Environment Variables, or save them in Admin → WhatsApp Business and set the credential source to “Use admin portal”.",
      context:
        "Sandbox mode is deliberate and safe, but no customer receives anything while it is on.",
      owner: "owner",
      subject: "whatsapp:config",
    });
  }

  if (config.shadowed.length > 0) {
    findings.push({
      kind: "credentials",
      severity: "warning",
      title: `A Vercel variable is overriding ${config.shadowed.length} value(s) saved in the portal`,
      detail: `Overridden: ${config.shadowed.join(", ")}. Editing these in the portal appears to do nothing.`,
      evidence: {
        shadowed: config.shadowed,
        credentialMode: config.credentialMode,
        tokenEnvKey: config.tokenEnvKey,
      },
      action:
        "Open Admin → Marketing → Integration diagnostics and press “Which token works?”. If the portal token is the good one, press “Use admin portal”. Otherwise delete the stale WHATSAPP_* variable in Vercel.",
      context:
        "This is the exact fault that produced months of Meta error 190: the portal showed a green tick while Vercel sent a different, expired token.",
      owner: "developer",
      subject: "whatsapp:shadowed",
    });
  }

  if (config.configured && !config.tokenVerified) {
    findings.push({
      kind: "whatsapp",
      severity: "warning",
      title: "The WhatsApp token in use has never been proven against Meta",
      detail: `Reading ${config.tokenEnvKey} (${maskSecret(config.accessToken)}). No successful verification is recorded for this exact token.`,
      evidence: {
        tokenEnvKey: config.tokenEnvKey,
        masked: maskSecret(config.accessToken),
        verifiedToken: config.verifiedToken,
        verifiedAt: config.verifiedAt,
      },
      action:
        "Press “Which token works?” in Admin → Marketing → Integration diagnostics. If it is accepted, the tick records itself. If it is rejected, generate a new System User token and save it to the spare alias so fallback is one click.",
      context:
        "An unverified token is not necessarily broken — but until it is tested, a 190 is the expected first symptom, and the cause is invisible.",
      owner: "developer",
      subject: "whatsapp:token",
    });
  }

  const lastFailure = await db.maybeOne<{
    id: number;
    created_at: string;
    error: string | null;
    kind: string;
  }>(
    `SELECT id, created_at::text, error, kind
       FROM whatsapp_messages
      WHERE direction = 'outbound' AND status = 'failed'
      ORDER BY id DESC LIMIT 1`,
  );
  if (lastFailure) {
    const isAuth = /authentication|190/i.test(lastFailure.error ?? "");
    findings.push({
      kind: "whatsapp",
      severity: "error",
      title: isAuth
        ? "WhatsApp sends are failing with an authentication error (190)"
        : `WhatsApp send failed: ${lastFailure.error ?? "unknown error"}`,
      detail: `Message #${lastFailure.id} at ${lastFailure.created_at}.`,
      evidence: { messageId: lastFailure.id, error: lastFailure.error, at: lastFailure.created_at },
      action: isAuth
        ? "Meta is rejecting the token itself. Open Admin → Marketing → Integration diagnostics → “Which token works?”. If every token is refused, generate a new System User token (expiry: Never) at business.facebook.com/settings/system-users with whatsapp_business_messaging and whatsapp_business_management, save it into WHATSAPP_ACCESS_TOKEN_NEW, redeploy, then switch the alias."
        : "Read Meta's error in the message log at Admin → WhatsApp Business. The wording names the fix: 131047 means the 24-hour window is closed and a template is required; 131030 means the recipient is not on the test list.",
      owner: isAuth ? "developer" : "manager",
      subject: "whatsapp:last-failure",
    });
  }

  if (!config.catalogId) {
    findings.push({
      kind: "whatsapp",
      severity: "warning",
      title: "No WhatsApp catalogue — dishes cannot be published to the chat",
      detail: "Menu ordering in chat still works; the browseable catalogue does not.",
      evidence: {
        catalogId: null,
        businessId: config.businessId || null,
        businessAccountId: config.businessAccountId || null,
      },
      action:
        "In Admin → Marketing → Integration diagnostics, press “Create catalogue”. If that is unavailable, set WHATSAPP_BUSINESS_ID (the business portfolio id from Business settings → Business info → ID — not the WABA id) and press it again.",
      context:
        "The catalogue id is the one value not visible on Meta's obvious screens, which is why it is generated here rather than hunted by hand.",
      owner: "owner",
      subject: "whatsapp:catalog",
    });
  }

  // --- Menu ----------------------------------------------------------------
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
    findings.push({
      kind: "menu",
      severity: dish.is_featured ? "warning" : "info",
      title: `${dish.name} is hidden from the menu${dish.is_featured ? " and it is a featured dish" : ""}`,
      detail: negative
        ? `Stock went negative (${stock?.stock_after}) on ${stock?.created_at} via a ${stock?.reason}. The dish auto-hides at zero.`
        : `Marked unavailable. Last movement: ${stock?.reason ?? "none recorded"}.`,
      evidence: { table: "menu_items", id: dish.id, isFeatured: dish.is_featured, stock: stock ?? null },
      action: negative
        ? `Restock it in Admin → Menu (or raise the stock figure), then set it available again. Negative stock usually means an order consumed the last portion and the count was not corrected.`
        : `Set it available in Admin → Menu once the kitchen has it.`,
      context: dish.is_featured
        ? "A featured dish is shown on the homepage and in marketing captions, so hiding it removes a dish customers came for."
        : undefined,
      owner: "kitchen",
      subject: `menu_item:${dish.id}`,
    });
  }

  const noPrice = await db.query<{ id: number; name: string }>(
    `SELECT mi.id, mi.name FROM menu_items mi
      WHERE mi.published
        AND NOT EXISTS (SELECT 1 FROM item_variants v WHERE v.item_id = mi.id AND v.active)`,
  );
  for (const dish of noPrice) {
    findings.push({
      kind: "menu",
      severity: "error",
      title: `${dish.name} has no active price and cannot be ordered`,
      detail: "Published but every size variant is inactive, so the dish renders without a price.",
      evidence: { table: "menu_items", id: dish.id },
      action: "Open Admin → Menu → the dish → add or reactivate a size and price.",
      owner: "manager",
      subject: `menu_item-price:${dish.id}`,
    });
  }

  // --- Delivery ------------------------------------------------------------
  const zones = await zoneSummary(db);
  const address = settingValue(settings, "restaurant_address", "");
  if (!address) {
    findings.push({
      kind: "delivery",
      severity: "error",
      title: "The kitchen address is not set",
      detail: "Delivery is quoted from a fallback point, so every fee and ETA is approximate.",
      action:
        "Set the kitchen address in Admin → Delivery & payments. The courier integrations also read it, so a wrong address sends a driver to the wrong shop.",
      owner: "owner",
      subject: "settings:address",
    });
  } else if (!/Whalan/i.test(address)) {
    findings.push({
      kind: "delivery",
      severity: "warning",
      title: `The stored address does not look like the Whalan kitchen: “${address}”`,
      detail: "Delivery fees and ETAs are computed from this address.",
      evidence: { address },
      action: "Correct it in Admin → Delivery & payments to 1/53 Bulolo Dr, Whalan NSW 2770.",
      context:
        "The address was wrong once before — Pitt Street in the CBD — and every delivery was priced from 39 km away for weeks before anyone noticed.",
      owner: "owner",
      subject: "settings:address-mismatch",
    });
  }

  if (zones.zones.length === 0) {
    findings.push({
      kind: "delivery",
      severity: "warning",
      title: "No delivery zones are defined",
      detail: "Every address will be quoted the same way, including ones the kitchen cannot reach.",
      action: "Add the postcode zones in Admin → Delivery & payments.",
      owner: "owner",
      subject: "delivery:zones",
    });
  }

  // --- Orders --------------------------------------------------------------
  const stuck = await db.query<{ id: number; code: string; status: string; created_at: string }>(
    `SELECT id, code, status, created_at::text FROM orders
      WHERE status IN ('pending','confirmed','preparing')
        AND created_at < now() - interval '90 minutes'
      ORDER BY created_at LIMIT 20`,
  );
  for (const order of stuck) {
    findings.push({
      kind: "orders",
      severity: "error",
      title: `Order ${order.code} has been ${order.status} for over 90 minutes`,
      detail: `Created ${order.created_at}. It has not moved to the kitchen queue.`,
      evidence: { table: "orders", id: order.id, code: order.code, status: order.status },
      action: `Open the order in the counter portal and either confirm it or cancel and refund. A stuck order usually means payment never cleared or nobody accepted it.`,
      owner: "counter",
      subject: `order:${order.code}`,
    });
  }

  // --- Release hygiene -----------------------------------------------------
  const unpublished = await db.maybeOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM whats_new WHERE published_at IS NULL",
  );
  if (Number(unpublished?.c ?? 0) > 0) {
    findings.push({
      kind: "release",
      severity: "info",
      title: `${unpublished?.c} release note(s) have no publish date`,
      action: "Set a published_at on them in Admin → What's new, or they sort to the bottom of the feed.",
      owner: "developer",
      subject: "release:unpublished",
    });
  }

  return findings;
}

/** Audit, then record. Returns what changed so the caller can log honestly. */
export async function runAudit(db: Db): Promise<{
  findings: Finding[];
  written: number;
  updated: number;
  skipped: number;
}> {
  const findings = await auditSystem(db);
  const result = await recordFindings(db, findings);
  return { findings, ...result };
}

/** What an operator opens first: unresolved rows, worst and newest first. */
export async function openLogs(db: Db, limit = 50): Promise<LogRow[]> {
  return db.query<LogRow>(
    `SELECT * FROM operation_logs
      WHERE status IN ('open','acknowledged')
      ORDER BY CASE severity
                 WHEN 'critical' THEN 0 WHEN 'error' THEN 1
                 WHEN 'warning' THEN 2 ELSE 3 END,
               last_seen_at DESC
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
  byKind: { kind: string; count: number }[];
}> {
  const counts = await db.query<{ severity: string; c: number; status: string }>(
    "SELECT severity, status, COUNT(*) AS c FROM operation_logs GROUP BY severity, status",
  );
  const row = (severity: string) =>
    counts
      .filter((entry) => entry.severity === severity)
      .reduce((sum, entry) => sum + Number(entry.c), 0);
  const open = counts
    .filter((entry) => entry.status === "open" || entry.status === "acknowledged")
    .reduce((sum, entry) => sum + Number(entry.c), 0);
  const byKind = await db.query<{ kind: string; count: number }>(
    `SELECT kind, COUNT(*)::int AS count FROM operation_logs
      WHERE status IN ('open','acknowledged') GROUP BY kind ORDER BY count DESC`,
  );
  return {
    open,
    critical: row("critical"),
    error: row("error"),
    warning: row("warning"),
    info: row("info"),
    resolved: counts
      .filter((entry) => entry.status === "resolved")
      .reduce((sum, entry) => sum + Number(entry.c), 0),
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
