/**
 * The playbook: the course of action against an action.
 *
 * A log line that says "401" or "Publish failed" and stops has recorded a
 * symptom. This module turns the action, its outcome and the error text into
 * ordered steps: who does what, where, and how to confirm it worked.
 *
 * Pure functions, no database, no network — so the mapping is unit-tested and a
 * failure to log can never be caused by the thing that explains the failure.
 *
 * Two kinds of course:
 *   - a failure class (META_190, AUTH_REQUIRED, …) decided from the HTTP status
 *     and the error wording. The class wins over the action: an expired Meta
 *     token needs the same fix whether it surfaced while publishing a dish or
 *     sending a receipt.
 *   - a follow-up for an action that worked, where working creates an
 *     obligation (a password was reset, a credential changed, an order was
 *     cancelled after payment).
 */

export type Owner =
  | "owner"
  | "manager"
  | "counter"
  | "kitchen"
  | "delivery"
  | "developer"
  | "meta";

export type Step = {
  /** The instruction, imperative, one action. */
  do: string;
  /** Where to do it: an in-app path, an external console, a variable name. */
  where?: string;
  owner: Owner;
  /** What you should observe when it has worked. */
  verify?: string;
};

export type Course = {
  /** Machine class: OK, META_190, AUTH_REQUIRED, INVALID_INPUT, … */
  code: string;
  /** One line stating the diagnosis. */
  summary: string;
  steps: Step[];
};

export type Outcome = "ok" | "rejected" | "denied" | "failed";
export type Level = "info" | "notice" | "warning" | "error" | "critical";

export type ActionContext = {
  component: string;
  /** component.verb */
  action: string;
  outcome: Outcome;
  httpStatus?: number | null;
  /** The error text the handler returned or threw. */
  error?: string | null;
  target?: string | null;
  actorRole?: string | null;
  reference?: string;
  /** Top-level keys of the request, for actions whose follow-up depends on them. */
  keys?: string[];
};

const OWNERS: Owner[] = ["owner", "manager", "counter", "kitchen", "delivery", "developer", "meta"];
const STAFF_ROLES = ["admin", "manager", "counter", "kitchen", "delivery"];

/** The person who took the action is who follows it up, unless a step says otherwise. */
function actorOwner(role?: string | null): Owner {
  if (role === "admin") return "owner";
  return OWNERS.includes(role as Owner) ? (role as Owner) : "manager";
}

/** HTTP status → outcome. A thrown error has no status and is a failure. */
export function outcomeFor(status: number | null | undefined, threw = false): Outcome {
  if (threw || status == null) return "failed";
  if (status >= 500) return "failed";
  if (status === 401 || status === 403 || status === 429) return "denied";
  if (status >= 400) return "rejected";
  return "ok";
}

/**
 * Classify a failure from its status and wording. Order matters: the specific
 * upstream causes are tested before the generic HTTP classes, because Meta's
 * expired token arrives wrapped in whatever status the route chose.
 */
export function classify(ctx: ActionContext): string {
  if (ctx.outcome === "ok") return "OK";
  const text = ctx.error ?? "";
  const status = ctx.httpStatus ?? 0;

  if (/\b190\b|OAuthException|Error validating access token|session has expired|invalid oauth/i.test(text))
    return "META_190";
  if (/\b131047\b|24.?hour|re-?engagement/i.test(text)) return "META_131047";
  if (/\b131030\b|not in allowed list|recipient phone number not in/i.test(text)) return "META_131030";
  if (/\(#100\)|\bcode 100\b|Unsupported (post|get) request|missing permissions?/i.test(text))
    return "META_100";
  if (/\b(131056|130429|80007)\b|rate limit hit|too many messages/i.test(text)) return "META_RATE_LIMIT";
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo|DATABASE_URL|password authentication failed|pooler|too many clients|Connection terminated/i.test(text))
    return "DB_UNREACHABLE";
  if (/sandbox mode|not configured|no (phone number id|access token)|needs setup/i.test(text))
    return "NOT_CONFIGURED";
  if (/out of stock|sold out|insufficient stock|not available/i.test(text)) return "OUT_OF_STOCK";
  if (/outside (the |our )?delivery|do not deliver|not in a delivery zone|beyond .* km/i.test(text))
    return "OUTSIDE_DELIVERY_AREA";

  // "Not permitted" is the wrong diagnosis for a mistyped current password,
  // and "sign in again" is the wrong one for a wrong sign-in: say which it is.
  if (/current password is not correct/i.test(text)) return "WRONG_CURRENT_PASSWORD";
  if (status === 429 || /too many attempts/i.test(text)) return "RATE_LIMITED";
  if (status === 401) return ctx.action === "auth.login" ? "BAD_CREDENTIALS" : "AUTH_REQUIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "STATE_CONFLICT";
  if (status === 413) return "PAYLOAD_TOO_LARGE";
  if (status >= 400 && status < 500) return "INVALID_INPUT";
  return "SERVER_ERROR";
}

/** Severity of the row. A failure that stops customers being served is critical. */
export function levelFor(ctx: ActionContext, code: string): Level {
  if (ctx.outcome === "failed") {
    return code === "DB_UNREACHABLE" || code === "META_190" ? "critical" : "error";
  }
  if (code === "META_190") return "error";
  if (ctx.outcome === "denied" || ctx.outcome === "rejected") return "warning";
  return SENSITIVE.some((pattern) => pattern.test(ctx.action)) ? "notice" : "info";
}

/**
 * Actions that change who can sign in, what is charged, or what is configured —
 * or that delete. They are recorded at `notice` even when they succeed, so a
 * filter for "anything above info" is the security and configuration trail.
 */
const SENSITIVE: RegExp[] = [
  /^auth\.(change-password)$/,
  /^staff\./,
  /^customers\./,
  /^settings\./,
  /^diagnostics\.set-/,
  /^diagnostics\.create-catalog$/,
  /\.delete(-|$)/,
  /^orders\.(cancel|paid|settle-table)$/,
  /^pricing\./,
  /^promotions\./,
  /^drivers\.(approve|payout|settle|commercials)$/,
  /^marketing\.(publish|publish-saved|broadcast)$/,
  /^release\./,
];

const DIAGNOSTICS = "/admin/marketing#integration-diagnostics";

/** The course of action for a failure class. */
function failureCourse(code: string, ctx: ActionContext): Course {
  const who = actorOwner(ctx.actorRole);
  const ref = ctx.reference ?? "this reference";
  const quoted = ctx.error ? `“${ctx.error.slice(0, 180)}”` : "the error shown";

  switch (code) {
    case "META_190":
      return {
        code,
        summary: "Meta rejected the access token itself (OAuth 190). Nothing sends until the token is replaced.",
        steps: [
          { do: "Press “Which token works?” to test every stored token against Meta.", where: DIAGNOSTICS, owner: "developer", verify: "At least one row reports “accepted”." },
          { do: "If a different token is accepted, switch to it with “Use admin portal” / the token alias toggle.", where: DIAGNOSTICS, owner: "developer", verify: "“Test live connection” returns the business phone number." },
          { do: "If every token is refused, create a System User token with expiry “Never” and the scopes whatsapp_business_messaging + whatsapp_business_management.", where: "business.facebook.com → Settings → Users → System users → Generate token", owner: "owner" },
          { do: "Save the new token in the spare variable, redeploy, then switch the alias to it.", where: "Vercel → Project → Settings → Environment Variables → WHATSAPP_ACCESS_TOKEN_NEW", owner: "developer", verify: "The open finding LOG-WA-* closes on the next audit." },
          { do: "Repeat the action that failed.", owner: who, verify: "A new log row for the same action with outcome ok." },
        ],
      };
    case "META_131047":
      return {
        code,
        summary: "Meta refused a free-form message: the customer's 24-hour window is closed (131047).",
        steps: [
          { do: "Send an approved template instead of free text; only templates may open a conversation.", where: "/admin/whatsapp", owner: who },
          { do: "If no template fits, ask the customer to message the business number first, then resend.", owner: "counter", verify: "The message row changes from failed to sent." },
        ],
      };
    case "META_131030":
      return {
        code,
        summary: "The recipient is not on the allowed list — the WhatsApp number is still in test mode (131030).",
        steps: [
          { do: "Add the recipient to the test recipients list, or move the app to Live mode.", where: "developers.facebook.com → your app → WhatsApp → API Setup", owner: "developer" },
          { do: "Resend.", owner: who, verify: "Status sent, then delivered." },
        ],
      };
    case "META_100":
      return {
        code,
        summary: "Meta did not recognise an id, or the token lacks permission for it (100).",
        steps: [
          { do: "Check the id in the error against the ids resolved by diagnostics — the WABA id, the business portfolio id and the catalogue id are three different numbers.", where: DIAGNOSTICS, owner: "developer", verify: `The id named in ${quoted} matches the row it belongs to.` },
          { do: "Confirm the System User is assigned to the WhatsApp account and the catalogue with full control.", where: "business.facebook.com → Settings → Users → System users → Assign assets", owner: "owner" },
          { do: "Repeat the action.", owner: who },
        ],
      };
    case "META_RATE_LIMIT":
      return {
        code,
        summary: "Meta is rate-limiting this number or this recipient pair.",
        steps: [
          { do: "Wait 10 minutes before retrying; repeated attempts extend the limit.", owner: who },
          { do: "For a broadcast, check the messaging tier and reduce the audience to fit it.", where: "business.facebook.com → WhatsApp Manager → Phone numbers → Insights", owner: "owner" },
        ],
      };
    case "DB_UNREACHABLE":
      return {
        code,
        summary: "The database could not be reached. Every page that reads or writes is affected.",
        steps: [
          { do: "Open the health check and read `reason` and `hint`.", where: "/api/health", owner: "developer", verify: "`ok: true` and a latency in milliseconds." },
          { do: "Confirm the Supabase project is not paused.", where: "supabase.com → project → Home", owner: "owner" },
          { do: "Confirm DATABASE_URL is the pooler string (port 6543) for Production, with the current password URL-encoded.", where: "Vercel → Project → Settings → Environment Variables → DATABASE_URL", owner: "developer" },
          { do: "Redeploy after changing the variable; a running deployment keeps the old value.", where: "Vercel → Deployments → Redeploy", owner: "developer", verify: "/api/health returns 200." },
        ],
      };
    case "NOT_CONFIGURED":
      return {
        code,
        summary: "The channel has no credentials, so the action ran in sandbox mode or was refused.",
        steps: [
          { do: "Open diagnostics and read which credentials are “missing”.", where: DIAGNOSTICS, owner: "developer" },
          { do: "Enter the missing values, or set them as Vercel variables and redeploy.", where: "/admin/whatsapp (WhatsApp) · /admin/marketing#credentials (Facebook, Instagram)", owner: "owner", verify: "Platform status shows “configured”." },
          { do: "Repeat the action.", owner: who },
        ],
      };
    case "OUT_OF_STOCK":
      return {
        code,
        summary: "A dish in the request is sold out or hidden.",
        steps: [
          { do: "Restock the dish, or leave it hidden and tell the customer.", where: "/admin/menu", owner: "kitchen", verify: "The dish shows as available on /menu." },
          { do: "If stock is counted and went negative, correct the count before re-enabling.", where: "/admin/menu → the dish → Stock", owner: "manager" },
        ],
      };
    case "OUTSIDE_DELIVERY_AREA":
      return {
        code,
        summary: "The address is outside every published delivery zone.",
        steps: [
          { do: "Offer pickup, or add the postcode to a zone if the kitchen will deliver there.", where: "/admin/delivery", owner: "manager", verify: "A quote for the same postcode returns a fee." },
        ],
      };
    case "BAD_CREDENTIALS": {
      // The wrapper names the account only when it exists, so the target says
      // which of two different situations this is.
      const account = ctx.target?.startsWith("staff:") ? ctx.target.slice(6) : null;
      if (!account) {
        return {
          code,
          summary: "The sign-in named no staff account that exists. What was typed is not stored.",
          steps: [
            { do: "If this was a member of staff, have them sign in with the address listed for them — it is usually a typo.", where: "/admin/staff", owner: "manager", verify: "A row auth.login with outcome ok for that person." },
            { do: "If nobody on staff made the attempt, read the recent refusals together: several naming accounts that do not exist is someone guessing.", where: "/admin/logs?view=actions&component=auth&problems=1", owner: "owner", verify: "No further refusals in the next hour." },
          ],
        };
      }
      return {
        code,
        summary: `The password did not match ${account}, or that account is disabled — the sign-in page gives the same answer for both.`,
        steps: [
          { do: `Check ${account} is active.`, where: "/admin/staff", owner: "manager", verify: "The account is listed and not disabled." },
          { do: "If the password is forgotten, reset it and hand the new one over in person.", where: "/admin/staff → the user → Reset password", owner: "owner", verify: `A row auth.login with outcome ok for ${account}.` },
          { do: "If the account's owner did not make these attempts, change its password now and review every sign-in from the last 24 hours.", where: "/admin/logs?view=actions&component=auth", owner: "owner" },
        ],
      };
    }
    case "WRONG_CURRENT_PASSWORD":
      return {
        code,
        summary: "The current password entered was wrong, so the new one was not saved. The account and its session are unchanged.",
        steps: [
          { do: "Enter the current password again — check Caps Lock and the keyboard layout.", where: "/staff/password", owner: who, verify: "A row auth.change-password with outcome ok." },
          { do: "If it is forgotten, have an administrator reset it instead.", where: "/admin/staff → the user → Reset password", owner: "owner" },
        ],
      };
    case "RATE_LIMITED":
      return {
        code,
        summary: "Too many attempts in a short time; further attempts are refused for about 10 minutes.",
        steps: [
          { do: "Stop retrying and wait 10 minutes — each attempt is counted.", owner: who },
          { do: "If the password is forgotten, have an administrator reset it rather than guessing.", where: "/admin/staff", owner: "owner" },
        ],
      };
    case "AUTH_REQUIRED": {
      // A signed cookie was presented and the request was refused anyway: that
      // is a different situation from having no session, and the row knows it.
      const role = STAFF_ROLES.includes(ctx.actorRole ?? "") ? ctx.actorRole : null;
      return {
        code,
        summary: role
          ? `A ${role} session was presented and refused. Either it was ended (the password or role changed, or the account was disabled), or the ${role} role does not include this action.`
          : "The request carried no valid staff session: signed out, or expired after 12 hours.",
        steps: [
          { do: "Sign in again and repeat the action.", where: "/staff/login", owner: who, verify: "The action is logged with outcome ok." },
          role
            ? { do: `If it is refused again straight after signing in, the ${role} role is not allowed to do this: have a manager or administrator do it, or change the role.`, where: "/admin/staff", owner: "owner" }
            : { do: "If it is refused straight after signing in, the role does not include this action — change the role.", where: "/admin/staff", owner: "owner" },
        ],
      };
    }
    case "FORBIDDEN":
      return {
        code,
        summary: "The account is signed in but is not permitted to do this.",
        steps: [
          { do: "Have an administrator do it, or change this user's role.", where: "/admin/staff", owner: "owner", verify: "The user signs out and in, and the action succeeds." },
        ],
      };
    case "NOT_FOUND":
      return {
        code,
        summary: `The record this action names does not exist${ctx.target ? ` (${ctx.target})` : ""}. It was deleted, or the screen was out of date.`,
        steps: [
          { do: "Reload the screen and repeat the action on a row that is still listed.", owner: who },
          { do: "If the record should exist, search the action log for the action that removed it.", where: `/admin/logs?view=actions&q=${encodeURIComponent(ctx.target ?? "")}`, owner: "manager" },
        ],
      };
    case "STATE_CONFLICT":
      return {
        code,
        summary: "The record is not in a state that allows this action — someone else moved it first, or a step was skipped.",
        steps: [
          { do: "Reload the screen to see the current state, then take the action that state allows.", owner: who },
          { do: `Read ${quoted}: it names the state the record is in.`, owner: who },
        ],
      };
    case "PAYLOAD_TOO_LARGE":
      return {
        code,
        summary: "The upload is larger than the server accepts.",
        steps: [
          { do: "Resize the photo to under 4 MB (2000 px on the long edge is plenty) and upload again.", owner: who, verify: "The photo appears on the dish." },
        ],
      };
    case "INVALID_INPUT":
      return {
        code,
        summary: `The request was refused by a validation rule: ${quoted}.`,
        steps: [
          { do: "Correct the field the message names and submit again.", owner: who, verify: "The action is logged with outcome ok." },
          { do: `If the message is unclear or the value looks correct, send ${ref} to the developer.`, owner: "manager" },
        ],
      };
    default:
      return {
        code: "SERVER_ERROR",
        summary: "The server failed while handling the action. Whether the change was applied is not known.",
        steps: [
          { do: "Reload the screen and check whether the change was applied before repeating it — repeating a payment or a dispatch twice is worse than the error.", owner: who },
          { do: "Find the stack trace: filter the function logs by the request id on this row.", where: "Vercel → Project → Logs", owner: "developer", verify: "A log line with the same request id and an error stack." },
          { do: "Check the platform is healthy.", where: "/api/health", owner: "developer", verify: "`ok: true`." },
          { do: `Quote ${ref} when reporting it.`, owner: "manager" },
        ],
      };
  }
}

/** Follow-ups for actions that worked, where working leaves something to do. */
function followUp(ctx: ActionContext): Step[] | null {
  const who = actorOwner(ctx.actorRole);
  const action = ctx.action;
  const keys = ctx.keys ?? [];

  switch (action) {
    case "auth.login":
      return null;
    case "auth.change-password":
      return [
        { do: "Sign in again on every other device; the old sessions were ended by the change.", where: "/staff/login", owner: who },
      ];
    case "staff.create":
    case "staff.password":
    case "customers.password":
      return [
        { do: "Hand the password over in person or by phone — not by email or chat.", owner: "owner" },
        { do: "Have the user set their own password at first sign-in.", where: "/staff/password", owner: who, verify: "A row auth.change-password for that user." },
      ];
    case "staff.go-live":
      return [
        { do: "Confirm the demo accounts no longer sign in.", where: "/staff/login", owner: "owner", verify: "No “Demo accounts” list; the demo password is refused." },
        { do: "Create a named login for each staff member; do not share the administrator login.", where: "/admin/staff", owner: "owner" },
      ];
    case "staff.toggle":
    case "staff.delete":
    case "staff.update":
      return [
        { do: "Confirm the change took effect: a disabled or deleted user is signed out on their next request.", where: "/admin/staff", owner: "owner" },
      ];
    case "settings.update": {
      const steps: Step[] = [];
      if (keys.some((key) => /whatsapp|facebook|instagram/i.test(key))) {
        steps.push({ do: "Press “Test live connection” — a saved credential is not a working credential.", where: DIAGNOSTICS, owner: "developer", verify: "Each changed credential reports its source as “admin portal” and tests green." });
      }
      if (keys.some((key) => /address|lat|lng|radius|delivery/i.test(key))) {
        steps.push({ do: "Re-quote one address in each delivery zone; fees and ETAs are computed from these values.", where: "/admin/delivery", owner: "manager", verify: "Quotes match the published fee table." });
      }
      if (keys.some((key) => /stripe|paypal|square|payment/i.test(key))) {
        steps.push({ do: "Place a small test order with the affected payment method.", where: "/checkout", owner: "owner", verify: "The payment row is recorded as paid." });
      }
      steps.push({ do: "Reload the screen and confirm each changed value persisted.", owner: who });
      return steps;
    }
    case "diagnostics.set-token-alias":
    case "diagnostics.set-credential-mode":
    case "diagnostics.set-field-source":
    case "diagnostics.set-catalog-id":
      return [
        { do: "Press “Test live connection” to prove the new source works.", where: DIAGNOSTICS, owner: "developer", verify: "The business phone number is returned by Meta." },
        { do: "Run the audit so findings about the old source close.", where: "/admin/logs", owner: "manager" },
      ];
    case "diagnostics.create-catalog":
      return [
        { do: "Publish the menu to the new catalogue.", where: "/admin/whatsapp", owner: "manager", verify: "Dishes show “published”; the catalogue opens in WhatsApp." },
      ];
    case "orders.place":
      return [
        { do: "Accept the order at the counter.", where: "/counter", owner: "counter", verify: "A row orders.confirm for the same order." },
      ];
    case "orders.confirm":
      return [
        { do: "Start preparation; the ticket is now in the kitchen queue.", where: "/kitchen", owner: "kitchen", verify: "A row orders.ready for the same order." },
      ];
    case "orders.ready":
      return [
        { do: "Hand over, serve, or dispatch the order.", where: "/counter (pickup, table) · /delivery (delivery)", owner: "counter" },
      ];
    case "orders.dispatch":
      return [
        { do: "Watch the courier status until delivered; re-dispatch if it fails.", where: "/delivery", owner: "delivery", verify: "A row orders.delivered, or the job status “delivered”." },
      ];
    case "orders.cancel":
      return [
        { do: "If the order was paid online, confirm the refund reached the customer — cancelling records the intent, the provider moves the money.", where: "/admin/orders → the order → Payments", owner: "manager", verify: "Payment status “refunded”." },
        { do: "Tell the kitchen if preparation had started.", where: "/kitchen", owner: "counter" },
      ];
    case "orders.paid":
    case "orders.settle-table":
      return [
        { do: "Reconcile the till: cash and card totals must match today's collected figure.", where: "/admin", owner: "manager" },
      ];
    case "orders.payment-link":
    case "whatsapp.payment-link":
      return [
        { do: "Confirm the customer received the link and the order moves to paid.", where: "/counter", owner: "counter", verify: "Payment status “paid” before the food leaves." },
      ];
    case "orders.park":
      return [
        { do: "Settle the bill before the table leaves.", where: "/counter", owner: "counter", verify: "A row orders.settle-table for the same order." },
      ];
    case "menu.save":
    case "menu.toggle":
    case "whatsapp.stock":
      return [
        { do: "Check the dish on the customer menu.", where: "/menu", owner: who, verify: "Price, photo and availability are as intended." },
        { do: "If the dish is published to WhatsApp, re-sync the catalogue so the chat shows the same thing.", where: "/admin/whatsapp", owner: "manager" },
      ];
    case "menu.delete":
      return [
        { do: "Remove the dish from the WhatsApp catalogue as well, or customers can still order it in chat.", where: "/admin/whatsapp", owner: "manager", verify: "The dish is absent from the catalogue list." },
      ];
    case "whatsapp.publish":
    case "whatsapp.sync":
      return [
        { do: "Read the per-dish result; a dish that failed to sync is listed with Meta's reason.", where: "/admin/whatsapp", owner: "manager", verify: "No rows in state “error”." },
      ];
    case "marketing.publish":
    case "marketing.publish-saved":
    case "marketing.broadcast":
      return [
        { do: "Read the per-channel result; a post can reach Facebook and fail on Instagram.", where: "/admin/marketing#content", owner: "manager", verify: "Each intended channel shows a post id." },
        { do: "Open the post on each channel and check the photo and link.", owner: "manager" },
      ];
    case "logs.audit":
      return [
        { do: "Work the open findings, most severe first.", where: "/admin/logs", owner: "manager" },
      ];
    case "logs.set-status":
      return [
        { do: "If it was marked resolved, run the audit to confirm it: a fault that is still there reopens. One marked ignored stays muted until someone reopens it.", where: "/admin/logs", owner: who, verify: "After the audit a resolved finding is still under History." },
      ];
    case "release.create":
    case "release.delete":
    case "release.toggle-pin":
      return [{ do: "Check the public page.", where: "/whats-new", owner: who }];
    case "pricing.rule-create":
    case "pricing.rule-update":
    case "pricing.holiday-add":
    case "pricing.holiday-delete":
    case "promotions.create":
    case "promotions.toggle":
      return [
        { do: "Price a test basket and confirm the total is what you intended.", where: "/checkout", owner: "manager", verify: "The surcharge or discount line matches the rule." },
      ];
    case "drivers.approve":
      return [
        { do: "Confirm every document is verified; an approved driver is dispatchable immediately.", where: "/admin/drivers", owner: "manager" },
      ];
    case "drivers.payout":
    case "drivers.settle":
      return [
        { do: "Make the bank transfer for the amount recorded, then keep the reference with this log row.", owner: "owner", verify: "The ledger balance for the driver is zero." },
      ];
    case "tables.create":
      return [
        { do: "Print the QR poster and scan it from a phone before putting it on the table.", where: "/admin/tables", owner: "manager", verify: "The scan opens the table's ordering page." },
      ];
    case "media.upload":
      return [{ do: "Attach the photo to the dish and save.", where: "/admin/menu", owner: who }];
    default:
      return null;
  }
}

/** The course of action against an action — always at least one step. */
export function courseForAction(ctx: ActionContext): Course {
  const code = classify(ctx);
  if (code !== "OK") return failureCourse(code, ctx);

  const steps = followUp(ctx);
  if (steps && steps.length > 0) {
    return { code: "OK", summary: "Completed. Follow-up required.", steps };
  }
  return {
    code: "OK",
    summary: "Completed. No follow-up required.",
    steps: [
      {
        do: "None. The action completed and leaves nothing to do.",
        owner: actorOwner(ctx.actorRole),
      },
    ],
  };
}

/** Render steps as one paragraph, for the places that still want text. */
export function stepsToText(steps: Step[]): string {
  return steps
    .map((step, index) => {
      const where = step.where ? ` [${step.where}]` : "";
      const verify = step.verify ? ` Verify: ${step.verify}` : "";
      return `${index + 1}. (${step.owner}) ${step.do}${where}${verify}`;
    })
    .join(" ");
}
