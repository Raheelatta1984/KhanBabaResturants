import { randomBytes } from "node:crypto";
import { getDb, type Db } from "../db";
import { buildLabel } from "../build";
import { SESSION_COOKIE, verifySessionToken, type StaffSession } from "../auth/core";
import {
  courseForAction,
  levelFor,
  outcomeFor,
  type ActionContext,
  type Course,
  type Level,
  type Outcome,
} from "./playbook";

/**
 * The action log: one row per action taken or attempted.
 *
 * Every staff-side change goes through a route handler wrapped in
 * `withActionLog`. When the handler finishes — or throws — one row is written
 * with a quotable reference, who did it, what it was done to, whether it
 * worked, and the course of action that follows (see ./playbook).
 *
 * Three rules this module keeps, because breaking any of them would make the
 * log worse than no log:
 *
 *   1. Logging never changes the action. The handler's response is returned
 *      untouched, a thrown error is re-thrown, and a logging failure is
 *      swallowed after being written to the function log.
 *   2. Secrets never reach the table. Request bodies are redacted by key name
 *      before they are stored; setting values are never stored at all, only
 *      which keys changed; customer contact details are masked.
 *   3. A row is never updated. It records what happened when it happened.
 */

/** Two-letter component code used in the reference. */
const COMPONENT_CODES: Record<string, string> = {
  auth: "AU",
  orders: "OR",
  menu: "MN",
  settings: "ST",
  whatsapp: "WA",
  marketing: "MK",
  diagnostics: "DG",
  staff: "SF",
  customers: "CU",
  drivers: "DR",
  logs: "LG",
  release: "RL",
  tables: "TB",
  pricing: "PC",
  promotions: "PM",
  production: "PD",
  reviews: "RV",
  feedback: "FB",
  community: "CM",
  integrations: "IN",
  music: "MU",
  media: "MD",
  system: "SY",
};

/** Crockford base32: no I, L, O or U, so a reference survives being read aloud. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * ACT-<component>-<yymmdd>-<5 chars>, e.g. ACT-OR-261115-K7Q2M.
 *
 * The date is UTC, to match the ISO timestamp printed next to it. Unlike a
 * finding's reference this one is random: a finding is a condition that
 * persists, an action is an event that happened once.
 */
export function newActionReference(component: string, at: Date = new Date()): string {
  const code = COMPONENT_CODES[component] ?? component.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase().padEnd(2, "X");
  const date = at.toISOString().slice(2, 10).replace(/-/g, "");
  const bytes = randomBytes(5);
  let suffix = "";
  for (let i = 0; i < 5; i += 1) suffix += ALPHABET[bytes[i] % ALPHABET.length];
  return `ACT-${code}-${date}-${suffix}`;
}

/* ------------------------------------------------------------------ redaction */

const SECRET_KEY =
  /(pass(word|wd)?|secret|token|authori[sz]ation|api[_-]?key|access[_-]?key|private|signature|credential|cvv|cvc|card|last4|hash|otp|pay_?id)/i;
const EMAIL_KEY = /e-?mail/i;
const PHONE_KEY = /(phone|mobile|wa_?id|msisdn|recipients?$|^to$)/i;
const LINK_KEY = /(url|link|href|uri|qr)/i;

/**
 * Components whose requests are about a person — a customer, a driver, a
 * member of staff. For these the rule is reversed: nothing is stored unless
 * its key is on the list below. A block-list would have to anticipate every
 * field a form might ever grow (licence number, police-check reference, gate
 * code in the order notes); an allow-list fails closed.
 */
const PEOPLE_COMPONENTS = new Set([
  "auth",
  "staff",
  "customers",
  "drivers",
  "orders",
  "community",
  "feedback",
  "reviews",
  "whatsapp",
]);

const SAFE_PEOPLE_KEY =
  /^(action|id|\w+Id|\w+_id|code|\w+Code|status|state|method|channel|type|kind|field|role|active|available|approved|verified|publish|published|priority|reason|resolution|rating|paymentMethod|paymentOption|paymentStatus|partySize|items|quantity|qty|spiceLevel|\w*Cents|\w*Percent|\w*Km|trackStock|stockQty|lowStockLevel|template|keyword|sinceDays|vehicleType|ok|sent|mode|count|total|found|written|updated|skipped|cleared|reopened|error|message)$/i;

/**
 * Mask an address, and only an address. Anything else typed into an email box
 * — most often a password, which may well contain an "@" — is not echoed at all.
 */
function maskEmail(value: string): string {
  const text = value.trim();
  if (text.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "[not an email]";
  const at = text.lastIndexOf("@");
  return `${text.slice(0, 1)}***${text.slice(at).toLowerCase()}`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `…${digits.slice(-3)}` : "[phone]";
}

/** A link keeps its host and first path segment; the rest is usually a token. */
function trimUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const head = segments.length > 0 ? `/${segments[0]}` : "";
    const more = segments.length > 1 || parsed.search ? "/…" : "";
    return `${parsed.origin}${head}${more}`;
  } catch {
    return "[link]";
  }
}

/**
 * Make free text safe to store: error messages quote whatever failed, and what
 * failed is often a URL with a token in it.
 */
export function scrubText(text: string): string {
  return text
    .replace(/\b(access_token|token|key|secret|password|signature)=([^&\s"']+)/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bEAA[A-Za-z0-9]{20,}/g, "[meta-token]")
    .replace(/https?:\/\/[^\s"'<>)\]]+/g, (url) => trimUrl(url))
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (email) => maskEmail(email))
    .replace(/(\+61\s?4|\b04)\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g, (phone) => maskPhone(phone))
    .replace(/\+\d{10,14}\b/g, (phone) => maskPhone(phone));
}

/**
 * Make a request or response body safe to store.
 *
 * Decided by key name, not by guessing at values: a token does not look like a
 * token until it has already been written somewhere it should not be.
 */
export function redact(value: unknown, key = "", depth = 0, component = ""): unknown {
  if (component === "chat" && key) return key === "action" && (value === "reply" || value === "close") ? value : "[withheld]";
  if (value === null || value === undefined) return null;
  if (depth > 4) return "[…]";
  const people = PEOPLE_COMPONENTS.has(component);

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (key && SECRET_KEY.test(key)) return value === "" ? "" : "[redacted]";
    if (typeof value !== "string") {
      return people && key && !SAFE_PEOPLE_KEY.test(key) ? "[withheld]" : value;
    }
    if (key && EMAIL_KEY.test(key)) return value ? maskEmail(value) : "";
    if (key && PHONE_KEY.test(key)) {
      // Split on list separators only: "+61 412 345 678" is one number.
      return value
        .split(/[,;\n]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map(maskPhone)
        .join(",");
    }
    if (key && LINK_KEY.test(key)) return value ? (/^https?:\/\//.test(value) ? trimUrl(value) : "[link]") : "";
    if (people && key && !SAFE_PEOPLE_KEY.test(key)) return value ? "[withheld]" : "";
    const text = scrubText(value);
    return text.length > 160 ? `${text.slice(0, 160)}…(+${text.length - 160})` : text;
  }

  if (Array.isArray(value)) {
    if (key && SECRET_KEY.test(key)) return "[redacted]";
    if (people && key && !SAFE_PEOPLE_KEY.test(key)) return `[withheld ×${value.length}]`;
    const head = value.slice(0, 8).map((entry) => redact(entry, key, depth + 1, component));
    return value.length > 8 ? [...head, `…(+${value.length - 8})`] : head;
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    if (key && SECRET_KEY.test(key)) return "[redacted]";
    // Settings: record which keys changed, never what they changed to. A
    // setting is as likely to be an access token as an opening hour.
    if (key === "values" || key === "settings") {
      return Object.fromEntries(Object.keys(source).map((name) => [name, "[changed]"]));
    }
    if (people && key && !SAFE_PEOPLE_KEY.test(key)) return "[withheld]";
    const pair = typeof source.key === "string" && "value" in source;
    const out: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(source)) {
      out[name] = pair && name === "value" ? "[changed]" : redact(entry, name, depth + 1, component);
    }
    return out;
  }
  return String(value);
}

function capJson(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return null;
  }
  if (text.length <= max) return text;
  const keys =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value as Record<string, unknown>).slice(0, 30)
      : [];
  return JSON.stringify({ truncated: true, length: text.length, keys });
}

/* ------------------------------------------------------------------ recording */

export type ActionInput = {
  component: string;
  /** `verb`, or the full `component.verb`. */
  action: string;
  outcome?: Outcome;
  httpStatus?: number | null;
  actor?: string;
  actorRole?: string | null;
  target?: string | null;
  method?: string | null;
  route?: string | null;
  durationMs?: number | null;
  /** One line. Defaults to a sentence built from the action and outcome. */
  message?: string;
  error?: string | null;
  /** Stored as JSON after redaction by the caller. */
  detail?: unknown;
  findingReference?: string | null;
  requestId?: string | null;
  keys?: string[];
  occurredAt?: Date;
};

export type ActionRow = {
  id: number;
  reference: string;
  occurred_at: string;
  level: Level;
  component: string;
  action: string;
  outcome: Outcome;
  actor: string;
  actor_role: string | null;
  target: string | null;
  method: string | null;
  route: string | null;
  http_status: number | null;
  duration_ms: number | null;
  error_code: string | null;
  message: string;
  detail: string | null;
  course: string;
  finding_reference: string | null;
  build: string | null;
  request_id: string | null;
};

/** A failure class → the standing finding it belongs to, when one is open. */
const RELATED_SUBJECTS: Record<string, string[]> = {
  META_190: ["whatsapp:last-failure", "whatsapp:token", "whatsapp:shadowed"],
  META_100: ["whatsapp:catalog", "whatsapp:config"],
  NOT_CONFIGURED: ["whatsapp:config"],
  OUTSIDE_DELIVERY_AREA: ["delivery:zones", "settings:address-mismatch", "settings:address"],
  BAD_CREDENTIALS: ["security:login-failures"],
  RATE_LIMITED: ["security:login-failures"],
};

async function relatedFinding(db: Db, code: string): Promise<string | null> {
  const subjects = RELATED_SUBJECTS[code];
  if (!subjects) return null;
  const row = await db.maybeOne<{ reference: string }>(
    `SELECT reference FROM operation_logs
      WHERE subject = ANY($1::text[]) AND status IN ('open','acknowledged')
      ORDER BY last_seen_at DESC LIMIT 1`,
    [subjects],
  );
  return row?.reference ?? null;
}

/** How many references are drawn before a write is abandoned. */
const REFERENCE_ATTEMPTS = 4;

/**
 * Write one action. Never throws: returns the reference, or null when the row
 * could not be written (the reason goes to the function log).
 *
 * `nextReference` exists so a test can force a collision.
 */
export async function recordAction(
  db: Db,
  input: ActionInput,
  nextReference: (component: string, at: Date) => string = newActionReference,
): Promise<string | null> {
  try {
    const component = input.component;
    const action = input.action.includes(".") ? input.action : `${component}.${input.action}`;
    const outcome = input.outcome ?? outcomeFor(input.httpStatus);
    const at = input.occurredAt ?? new Date();
    // Scrubbed once, here, so neither the message nor the course of action
    // (which quotes the error back) can carry a token or a customer's details.
    const error = input.error ? scrubText(input.error) : null;
    // A caller's own message is scrubbed like any free text. The default is
    // built from the action and the target, which is stored beside it anyway.
    const message = input.message
      ? scrubText(input.message)
      : outcome === "ok"
        ? `${action} completed${input.target ? ` on ${input.target}` : ""}`
        : `${action} ${outcome}${input.httpStatus ? ` (HTTP ${input.httpStatus})` : ""}: ${
            error?.slice(0, 300) ?? "no error text returned"
          }`;

    let finding = input.findingReference ?? null;
    let lookedForFinding = false;

    // The reference ends in five random characters, and it is unique in the
    // table. Two rows written for the same component on the same day will
    // eventually draw the same five (about one chance in 33 million per pair),
    // and a row lost to that would be a silent hole in the record — so a taken
    // reference is drawn again rather than allowed to fail the insert.
    for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
      const reference = nextReference(component, at);
      const ctx: ActionContext = {
        component,
        action,
        outcome,
        httpStatus: input.httpStatus ?? null,
        error,
        target: input.target ?? null,
        actorRole: input.actorRole ?? null,
        reference,
        keys: input.keys,
      };
      const course: Course = courseForAction(ctx);
      const level = levelFor(ctx, course.code);

      if (!lookedForFinding && !finding && outcome !== "ok") {
        finding = await relatedFinding(db, course.code).catch(() => null);
        lookedForFinding = true;
      }

      const written = await db.query<{ reference: string }>(
        `INSERT INTO action_logs
           (reference, occurred_at, level, component, action, outcome, actor, actor_role, target,
            method, route, http_status, duration_ms, error_code, message, detail, course,
            finding_reference, build, request_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (reference) DO NOTHING
         RETURNING reference`,
        [
          reference,
          at.toISOString(),
          level,
          component,
          action,
          outcome,
          (input.actor ?? "system").slice(0, 160),
          input.actorRole ?? null,
          input.target ? input.target.slice(0, 200) : null,
          input.method ?? null,
          input.route ? input.route.slice(0, 200) : null,
          input.httpStatus ?? null,
          input.durationMs ?? null,
          outcome === "ok" ? null : course.code,
          message.slice(0, 500),
          capJson(input.detail, 2400),
          JSON.stringify(course),
          finding,
          buildLabel(),
          input.requestId ? input.requestId.slice(0, 120) : null,
        ],
      );
      if (written.length > 0) return reference;
    }
    throw new Error(`no free reference after ${REFERENCE_ATTEMPTS} draws`);
  } catch (error) {
    console.error("[khanbaba] action log write failed", input.component, input.action, error);
    return null;
  }
}

/* -------------------------------------------------------------- route wrapper */

/** What Next.js passes a route handler as its second argument. */
type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> };

type RouteHandler<R extends Request, C> = (request: R, context: C) => Promise<Response> | Response;

type TargetInfo = {
  body: Record<string, unknown> | null;
  params: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
};

export type WrapOptions = {
  /** The verb when the body carries no `action` field. */
  fallback?: string;
  /** Who is acting when there is no staff session. */
  anonymous?: "customer" | "anonymous";
  /**
   * Verbs that only read, or that fire constantly (a music player's "next").
   * They are recorded when they go wrong and not when they simply work, so the
   * log is a record of decisions rather than of button presses.
   */
  quiet?: string[];
  /**
   * Name what the action was done to, when the request alone does not say it
   * in terms a person recognises (an order is known by its code, not its row id).
   */
  target?: (db: Db, info: TargetInfo) => Promise<string | null> | string | null;
  /** For tests: the database to write to. Defaults to the application's. */
  db?: () => Promise<Db>;
};

function slug(value: unknown): string {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/_/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 40)
    : "";
}

const TARGET_KEYS: [string, string][] = [
  ["orderId", "order"],
  ["orderCode", "order"],
  ["itemId", "menu_item"],
  ["variantId", "variant"],
  ["postId", "post"],
  ["driverId", "driver"],
  ["staffId", "staff"],
  ["customerId", "customer"],
  ["trackId", "track"],
  ["collectionId", "collection"],
  ["scheduleId", "schedule"],
  ["requestId", "request"],
  ["batchId", "batch"],
  ["recipeId", "recipe"],
  ["materialId", "material"],
  ["ruleId", "rule"],
  ["tableCode", "table"],
  ["tableId", "table"],
  ["code", "code"],
  ["slug", "slug"],
  ["id", "id"],
  ["key", "key"],
];

/** The actor recorded when a sign-in names no account that exists. */
export const UNKNOWN_ACCOUNT = "unknown account";

/**
 * The account a sign-in attempt named — only if that account exists.
 *
 * People type their password into the email box, and a password can be shaped
 * exactly like an address ("P@ssw0rd.2026"), so no test of the text itself is
 * safe. The one thing that is: an email already in the staff table is not a
 * secret. Anything else typed there is never stored, in any column.
 */
async function claimedStaff(db: Db, value: unknown): Promise<{ email: string; role: string } | null> {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (!text || text.length > 160) return null;
  try {
    const row = await db.maybeOne<{ email: string; role: string }>(
      "SELECT email, role FROM staff WHERE lower(email) = $1",
      [text],
    );
    return row ? { email: row.email.toLowerCase(), role: row.role } : null;
  } catch {
    return null;
  }
}

function scalar(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 60);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function scalarText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** What a bare `id` refers to, per component. */
const ID_ENTITY: Record<string, string> = {
  menu: "menu_item",
  staff: "staff",
  customers: "customer",
  tables: "table",
  release: "release_note",
  reviews: "review",
  logs: "finding",
  promotions: "promotion",
  drivers: "driver",
  feedback: "feedback",
};

/** What the action was done to, from the route params, the body, then the response. */
export function deriveTarget(
  component: string,
  body: Record<string, unknown> | null,
  params: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
): string | null {
  if (component === "orders") {
    const fromParams = scalar(params?.id);
    if (fromParams) return `order:${fromParams}`;
    const placed =
      scalar(response?.code) ?? scalar((response?.order as Record<string, unknown> | undefined)?.code);
    if (placed) return `order:${placed}`;
  }
  // Sign-in is named by the wrapper, which knows whether the account exists.
  if (component === "auth") return null;
  if (component === "chat") {
    const id = body?.id;
    return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? `chat:${id}` : null;
  }
  if (component === "settings" && body?.values && typeof body.values === "object") {
    const keys = Object.keys(body.values as Record<string, unknown>);
    return `settings:${keys.slice(0, 6).join(",")}${keys.length > 6 ? `,+${keys.length - 6}` : ""}`;
  }
  // A finding is known by its reference, which the response carries.
  const reference = scalar(response?.reference);
  if (reference) return reference;
  const entity = (key: string, label: string) => (key === "id" ? (ID_ENTITY[component] ?? label) : label);
  for (const source of [params, body, response]) {
    if (!source) continue;
    for (const [key, label] of TARGET_KEYS) {
      const value = scalar(source[key]);
      if (value) return `${entity(key, label)}:${value}`;
    }
  }
  return null;
}

/** A few top-level scalars from a JSON response — enough to say what came back. */
function responseSummary(
  json: Record<string, unknown> | null,
  component: string,
): Record<string, unknown> | null {
  if (!json) return null;
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(json)) {
    if (kept >= 10) break;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      out[key] = redact(value, key, 0, component);
      kept += 1;
    } else if (Array.isArray(value)) {
      out[key] = `[${value.length} item(s)]`;
      kept += 1;
    }
  }
  return kept > 0 ? out : null;
}

/** Only JSON (or text a client forgot to label) is ever copied for the log. */
function isJsonBody(headers: Headers): boolean {
  return /json|text\/plain/i.test(headers.get("content-type") ?? "");
}

async function readJson(
  source: Request | Response | null,
  limit: number,
): Promise<Record<string, unknown> | null> {
  if (!source) return null;
  try {
    const text = await source.text();
    if (!text || text.length > limit) return null;
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Who the request's cookie says is asking.
 *
 * Read straight from the header and checked by signature only — no database,
 * so it costs nothing and cannot fail with it. It is read before the handler
 * runs because an action can end the very session it was made with (sign-out,
 * a password change, go-live). An account that has since been disabled still
 * shows up here by name, with the outcome `denied`: who tried is the point.
 */
async function sessionFromRequest(request: Request): Promise<StaffSession | null> {
  try {
    const header = request.headers.get("cookie") ?? "";
    const prefix = `${SESSION_COOKIE}=`;
    const part = header.split(/;\s*/).find((entry) => entry.startsWith(prefix));
    if (!part) return null;
    return await verifySessionToken(decodeURIComponent(part.slice(prefix.length)));
  } catch {
    return null;
  }
}

/** Next.js signals redirects and not-found by throwing; those are not failures. */
function isControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

/** How long a response may wait for its own log line. */
const LOG_BUDGET_MS = 2500;

/**
 * Wrap a mutating route handler so the action is logged.
 *
 *   export const POST = withActionLog("orders", handler);
 *
 * The verb is the body's `action` field (`{ action: "confirm" }` →
 * `orders.confirm`), or `options.fallback` for routes that only do one thing.
 *
 * The row is written before the response is returned: on a serverless host
 * work left running after the response is frozen and may never finish.
 */
export function withActionLog<R extends Request = Request, C = RouteContext>(
  component: string,
  handler: RouteHandler<R, C>,
  options: WrapOptions = {},
): (request: R, context: C) => Promise<Response> {
  return async function logged(request: R, context: C): Promise<Response> {
    const started = Date.now();

    // Take a copy of a JSON body before the handler consumes the stream. Uploads
    // and other non-JSON bodies are left alone: copying one would buffer the
    // whole file in memory for the sake of a log line.
    let copy: Request | null = null;
    let session: StaffSession | null = null;
    try {
      const length = Number(request.headers.get("content-length") ?? 0);
      if (isJsonBody(request.headers) && length < 65_536) copy = request.clone();
      session = await sessionFromRequest(request);
    } catch {
      // Never let preparation for logging stop the action.
    }

    let response: Response | undefined;
    let thrown: unknown;
    try {
      response = await handler(request, context);
    } catch (error) {
      thrown = error;
    }

    if (!(thrown && isControlFlow(thrown))) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          capture(),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, LOG_BUDGET_MS);
          }),
        ]);
      } catch (error) {
        console.error("[khanbaba] action log capture failed", component, error);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    if (thrown) throw thrown;
    return response as Response;

    async function capture(): Promise<void> {
      const body = await readJson(copy, 65_536);
      const verb = component === "chat"
        ? (body?.action === "reply" || body?.action === "close" ? body.action : "invalid")
        : slug(body?.action) || options.fallback || request.method.toLowerCase();
      const status = thrown ? null : (response?.status ?? null);
      const outcome = outcomeFor(status, Boolean(thrown));
      if (outcome === "ok" && options.quiet?.includes(verb)) return;

      // The response is copied only when it is JSON: cloning a download would
      // hold the whole file in memory for a copy nobody reads.
      const responseJson =
        response && response.body && isJsonBody(response.headers)
          ? await readJson(response.clone(), 24_000)
          : null;
      let params: Record<string, unknown> | null = null;
      try {
        const raw = (context as { params?: unknown } | undefined)?.params;
        const resolved = raw ? await raw : null;
        params = resolved && typeof resolved === "object" ? (resolved as Record<string, unknown>) : null;
      } catch {
        params = null;
      }

      const errorText = thrown
        ? thrown instanceof Error
          ? thrown.message
          : String(thrown)
        : status !== null && status >= 400
          ? (scalarText(responseJson?.error) ?? scalarText(responseJson?.message))
          : null;

      let route: string | null = null;
      try {
        route = new URL(request.url).pathname;
      } catch {
        route = null;
      }

      const db = await (options.db ? options.db() : getDb());

      // A sign-in has no session yet: the actor is the account it named, when
      // that account exists, and on success the role is what was just granted.
      let actor = session?.email ?? null;
      let role: string | null = session?.role ?? null;
      let target: string | null = null;
      let requestDetail = body ? (redact(body, "", 0, component) as Record<string, unknown>) : null;
      if (component === "auth") {
        const claimed = await claimedStaff(db, body?.email);
        if (!actor) {
          actor = claimed?.email ?? UNKNOWN_ACCOUNT;
          if (outcome === "ok") role = claimed?.role ?? scalarText(responseJson?.role);
        }
        const account = claimed?.email ?? session?.email ?? null;
        target = account ? `staff:${account}` : null;
        if (requestDetail && "email" in requestDetail) {
          requestDetail = { ...requestDetail, email: claimed ? maskEmail(claimed.email) : "[not a staff account]" };
        }
      }

      if (options.target) {
        try {
          target = await options.target(db, { body, params, response: responseJson });
        } catch {
          target = null;
        }
      }
      await recordAction(db, {
        component,
        action: verb,
        outcome,
        httpStatus: status,
        actor: actor ?? options.anonymous ?? "anonymous",
        actorRole: role ?? (actor ? null : (options.anonymous ?? null)),
        target: target ?? deriveTarget(component, body, params, responseJson),
        method: request.method,
        route,
        durationMs: Date.now() - started,
        error: errorText,
        detail: {
          request: requestDetail,
          ...(params ? { params: redact(params, "", 0, component) } : {}),
          response: responseSummary(responseJson, component),
        },
        requestId: request.headers.get("x-vercel-id"),
        keys:
          body?.values && typeof body.values === "object"
            ? Object.keys(body.values as Record<string, unknown>)
            : body
              ? Object.keys(body)
              : undefined,
      });
    }
  };
}

/* -------------------------------------------------------------------- reading */

export type ActionFilter = {
  level?: string;
  component?: string;
  outcome?: string;
  /** Matches reference, actor, target, action and message. */
  q?: string;
  /** ISO timestamp or YYYY-MM-DD. */
  since?: string;
  /** Anything that did not simply work. */
  problems?: boolean;
  limit?: number;
  offset?: number;
};

const LEVELS = ["info", "notice", "warning", "error", "critical"];
const OUTCOMES = ["ok", "rejected", "denied", "failed"];

function whereFor(filter: ActionFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    clauses.push(clause.replace("?", `$${params.length}`));
  };
  if (filter.level && LEVELS.includes(filter.level)) add("level = ?", filter.level);
  if (filter.outcome && OUTCOMES.includes(filter.outcome)) add("outcome = ?", filter.outcome);
  if (filter.component && /^[a-z]{2,20}$/.test(filter.component)) add("component = ?", filter.component);
  if (filter.problems) clauses.push("outcome <> 'ok'");
  if (filter.since && /^\d{4}-\d{2}-\d{2}/.test(filter.since)) {
    const when = new Date(filter.since.length === 10 ? `${filter.since}T00:00:00Z` : filter.since);
    if (!Number.isNaN(when.getTime())) add("occurred_at >= ?", when.toISOString());
  }
  const q = (filter.q ?? "").trim().slice(0, 80);
  if (q) {
    params.push(`%${q.replace(/[%_\\]/g, (char) => `\\${char}`)}%`);
    const p = `$${params.length}`;
    clauses.push(
      `(reference ILIKE ${p} OR actor ILIKE ${p} OR target ILIKE ${p} OR action ILIKE ${p} OR message ILIKE ${p} OR error_code ILIKE ${p})`,
    );
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export async function listActions(
  db: Db,
  filter: ActionFilter = {},
): Promise<{ rows: ActionRow[]; total: number }> {
  const { sql, params } = whereFor(filter);
  const limit = Math.min(Math.max(Number(filter.limit) || 100, 1), 5000);
  const offset = Math.max(Number(filter.offset) || 0, 0);
  const total = await db.one<{ c: number }>(`SELECT COUNT(*) AS c FROM action_logs ${sql}`, params);
  const rows = await db.query<ActionRow>(
    `SELECT * FROM action_logs ${sql} ORDER BY occurred_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { rows, total: Number(total.c) };
}

export async function getAction(db: Db, reference: string): Promise<ActionRow | null> {
  return db.maybeOne<ActionRow>("SELECT * FROM action_logs WHERE reference = $1", [reference]);
}

export async function actionSummary(db: Db): Promise<{
  total: number;
  last24h: number;
  ok24h: number;
  problems24h: number;
  failed24h: number;
  oldest: string | null;
  components: string[];
}> {
  const totals = await db.one<{ total: number; oldest: string | null }>(
    "SELECT COUNT(*) AS total, MIN(occurred_at) AS oldest FROM action_logs",
  );
  const day = await db.query<{ outcome: string; c: number }>(
    `SELECT outcome, COUNT(*) AS c FROM action_logs
      WHERE occurred_at >= now() - interval '24 hours' GROUP BY outcome`,
  );
  const components = await db.query<{ component: string }>(
    "SELECT DISTINCT component FROM action_logs ORDER BY component",
  );
  const count = (outcome: string) =>
    day.filter((row) => row.outcome === outcome).reduce((sum, row) => sum + Number(row.c), 0);
  const last24h = day.reduce((sum, row) => sum + Number(row.c), 0);
  return {
    total: Number(totals.total),
    last24h,
    ok24h: count("ok"),
    problems24h: last24h - count("ok"),
    failed24h: count("failed"),
    oldest: totals.oldest,
    components: components.map((row) => row.component),
  };
}

/**
 * How long rows are kept. Routine successes (`info`) go first. Everything
 * above `info` — sensitive changes that worked, and every problem — is the
 * security and configuration trail, and is kept six times as long.
 */
export const RETENTION_DAYS = { routine: 30, problems: 180 } as const;

/** Drop rows past retention. Returns how many were removed. */
export async function pruneActions(db: Db): Promise<number> {
  // One statement, counted in SQL: the driver's row count is not reported by
  // the in-process test database.
  const row = await db.one<{ c: number }>(
    `WITH gone AS (
       DELETE FROM action_logs
        WHERE (level = 'info' AND occurred_at < now() - make_interval(days => $1::int))
           OR occurred_at < now() - make_interval(days => $2::int)
        RETURNING 1)
     SELECT COUNT(*) AS c FROM gone`,
    [RETENTION_DAYS.routine, RETENTION_DAYS.problems],
  );
  return Number(row.c);
}

export function parseCourse(raw: string | null | undefined): Course {
  try {
    const parsed = JSON.parse(raw ?? "") as Course;
    if (parsed && Array.isArray(parsed.steps)) return parsed;
  } catch {
    // fall through
  }
  return { code: "UNKNOWN", summary: "No course of action was recorded.", steps: [] };
}
