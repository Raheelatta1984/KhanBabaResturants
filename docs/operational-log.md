# The operational log

**Page:** `/admin/logs` — top bar **Logs**, sidebar **Operations → Operational log**, or the Command centre tile
**API:** `GET|POST /api/ops/logs` (administrators and managers only)
**Code:** `lib/ops/log.ts` (findings), `lib/ops/actions.ts` (action log), `lib/ops/playbook.ts` (courses of action),
`lib/ops/format.ts` (text, CSV, NDJSON), `app/admin/logs/page.tsx`

The log has two parts. They answer different questions and are kept in different tables.

| | Findings | Action log |
|---|---|---|
| Question | What is wrong right now? | What was done, by whom, and did it work? |
| Table | `operation_logs` | `action_logs` |
| A row is | a condition that persists | an event that happened once |
| Written by | the audit | every staff-side route, as the action finishes |
| Reference | `LOG-WA-TOKEN-1245` — stable for the same fault | `ACT-OR-261115-K7Q2M` — unique per action |
| Changes after writing | yes: seen again, resolved, reopened | never |

Every row in both carries a **course of action**: ordered steps, each with an owner, where to do it, and how to
confirm it worked.

---

## 1. Findings

### What the audit checks

Seven checks, each run on its own so that one failing does not hide the others.

| Check | Codes it raises |
|---|---|
| `whatsapp` | `WA_NOT_CONFIGURED`, `WA_TOKEN_UNVERIFIED`, `CRED_SHADOWED` (a Vercel variable overriding a value saved in the portal), `WA_AUTH_190`, `WA_SEND_FAILING`, `WA_NO_CATALOGUE` |
| `menu` | `MENU_DISH_HIDDEN`, `MENU_STOCK_NEGATIVE`, `MENU_NO_PRICE` |
| `delivery` | `DLV_ADDRESS_MISSING`, `DLV_ADDRESS_MISMATCH`, `DLV_NO_ZONES` |
| `orders` | `ORD_NOT_ACCEPTED`, `ORD_STUCK_IN_KITCHEN` (waiting over 90 minutes) |
| `release` | `REL_NOTES_UNPUBLISHED` — a release note in this build is not on the What's new page |
| `security` | `SEC_DEMO_PASSWORD` — a live login still uses the published demo password; `SEC_TABLES_OPEN_TO_API` — tables with row level security off that Supabase's public API role can read; `SEC_LOGIN_FAILURES` — five or more refused sign-ins in an hour |
| `actions` | `ACT_REPEATED_FAILURE` — the same action failed the same way three times in 24 hours |

A check that throws raises `SYS_AUDIT_CHECK_FAILED` and is named in the audit result.

### When the audit runs

- When `/admin/logs` or the Command centre is opened, if the last audit is older than ten minutes.
- When someone presses **Run audit now**, or posts `{ "action": "audit" }` to the API.

It used to run only from the button. Nobody could find the page, so nobody pressed it, and the table in production
stayed empty.

The ten-minute slot is claimed with one statement on the `settings` row `ops_last_audit_at`, so two pages opened at
the same moment, or two server instances, cannot both audit.

**Do not audit from `getDb()`.** The audit reads settings, settings wait on `getDb()`, and `getDb()` would be waiting
on the audit. An earlier version did this and the first request hung with no error.

### What the audit does with what it finds

| The fault is… | The row was… | Result |
|---|---|---|
| observed | absent | written, status `open` |
| observed | `open` or `acknowledged` | `last_seen_at` and `occurrences` bumped, wording refreshed |
| observed | `resolved` | **reopened**, with a note saying who had closed it |
| observed | `ignored` | left alone |
| not observed | `open` or `acknowledged` | **closed by the audit** (`resolved_by = audit`) |
| not checked, because its check threw | any | left exactly as it was |

Two of those changed in v3.7.0 and are worth stating plainly:

- **Resolved is checked.** Marking a finding resolved while the fault is still there used to hide it for good. Now the
  next audit puts it back. To accept a fault knowingly, use **Ignore**: that is the mute, and it holds until someone
  reopens the row.
- **A fault that goes away closes itself.** Before, a dish restocked on Tuesday was still reported hidden on Friday.

The last row of the table matters as much: a check that crashes is not evidence that the fault has gone.

### Closing requires a note

The API returns 400 if `status` is `resolved` or `ignored` and the note is shorter than four characters. A row closed
to clear the screen cannot be told apart from one that was fixed.

### References

A finding's reference is `LOG-<kind>-<label>-<4 hex>`, a hash of `kind:subject` — not a random id — so the same fault
always lands on the same row.

```
LOG-WA-CONFIG-94C4      whatsapp:config
LOG-WA-CATALOG-D3E9     whatsapp:catalog
LOG-MN-25-0048          menu_item:25
LOG-SC-DEMOPASS-D0E3    security:demo-password
```

---

## 2. The action log

### What is recorded

One row for each call to a route that changes something on the staff side:

- every `POST /api/ops/*` route (orders, menu, settings, WhatsApp, marketing, diagnostics, staff, customers, drivers,
  pricing, promotions, production, tables, reviews, feedback, community, music, uploads, release notes, the log itself)
- `/api/staff/login`, `/api/staff/logout`, `/api/staff/password`
- `/api/broadcast/todays-menu`
- `POST /api/orders` — an order placed by a customer, recorded with the actor `customer`

Not recorded: the customer account, driver app, feedback, music-request, payment and webhook routes. Reads are not
recorded. A few actions that only read, or that fire constantly (a music player's "next"), are recorded only when they
fail.

`scripts/test-pg.ts` fails if a staff route that changes something is not wrapped.

### What a row holds

| Field | Meaning |
|---|---|
| `reference` | `ACT-<component>-<yymmdd UTC>-<5 characters>`. Quote it and the row can be found. |
| `occurred_at` | When the action finished. |
| `level` | `info`, `notice` (a sensitive change that worked), `warning` (refused), `error`, `critical` |
| `action` | `component.verb`: `orders.confirm`, `settings.update`, `auth.login` |
| `outcome` | `ok`, `rejected` (a rule refused it), `denied` (not signed in or not permitted), `failed` (the system failed) |
| `actor`, `actor_role` | The signed-in member of staff, `customer`, `system`, or `unknown account` |
| `target` | What it was done to: `order:KB-1042`, `menu_item:12`, `settings:restaurant_phone` |
| `http_status`, `duration_ms`, `method`, `route` | The request |
| `error_code` | The class of failure: `META_190`, `AUTH_REQUIRED`, `INVALID_INPUT`, `DB_UNREACHABLE`, … |
| `message` | One line: what happened, in the server's own words |
| `course` | The course of action: `{ code, summary, steps: [{ do, where, owner, verify }] }` |
| `detail` | The request and a summary of the response, redacted |
| `finding_reference` | The open finding this failure belongs to, when there is one |
| `build` | The build that handled it, e.g. `v3.7.0+ab0c60b` |
| `request_id` | Vercel's request id: filter the function logs by it to find the stack trace |

### One entry, as exported

```
2026-11-15T15:56:06.807Z WARNING  ACT-AU-261115-WNGWZ auth.change-password outcome=denied http=403 code=WRONG_CURRENT_PASSWORD actor=smoke-cook@khanbaba.com.au role=kitchen target=staff:smoke-cook@khanbaba.com.au duration_ms=44
  message: auth.change-password denied (HTTP 403): Your current password is not correct
  request: method=POST route=/api/staff/password build=v3.7.0+ab0c60b
  course_of_action: WRONG_CURRENT_PASSWORD — The current password entered was wrong, so the new one was not saved. The account and its session are unchanged.
    1. [kitchen] Enter the current password again — check Caps Lock and the keyboard layout.
       where:  /staff/password
       verify: A row auth.change-password with outcome ok.
    2. [owner] If it is forgotten, have an administrator reset it instead.
       where:  /admin/staff → the user → Reset password
  detail:
    {
      "request": {
        "currentPassword": "[redacted]",
        "newPassword": "[redacted]"
      },
      "response": {
        "error": "Your current password is not correct"
      }
    }
```

The first line is `key=value` pairs so that a search can match it. The page shows the same text under
**Technical record**, with a button to copy it.

### The course of action

`lib/ops/playbook.ts` decides it, from the action, the HTTP status and the error text. It is a pure function with no
database access, so it is unit-tested and cannot itself fail an action.

- **A failure** is first classified (`classify`). Specific causes are tested before generic HTTP classes, because an
  expired Meta token needs the same fix whether it surfaced while publishing a dish or sending a receipt.
- **A success** gets a follow-up where succeeding leaves something to do: a new password must be handed over, a
  changed credential must be tested, a cancelled paid order needs its refund confirmed. Otherwise the row says that
  nothing is left to do.

To add a course for a new action, add a `case` to `followUp` (success) or a class to `classify` and `failureCourse`
(failure). `scripts/test-pg.ts` checks that every in-app path a step names is a page that exists.

### What is never stored

| Data | What is stored instead |
|---|---|
| Passwords, tokens, keys, card digits, anything in a field named like one | `[redacted]` |
| The value of a setting | `[changed]` — only which keys changed |
| Email addresses | `a***@example.com` |
| Phone numbers | `…678` |
| Links | host and first path segment |
| Anything else in a request about a person (customers, drivers, staff, orders, sign-in) | `[withheld]`, unless the field is on a short list of identifiers and states |
| Whatever was typed into the sign-in form's email box | nothing, unless it is the address of an existing staff account |

The last rule exists because people type their password into the email box, and a password can be shaped exactly like
an address. The only safe test is whether the staff table already knows the address.

Error text is scrubbed of tokens, addresses and phone numbers before it is stored.

Both tables have row level security enabled with no policies, so Supabase's public Data API cannot read them. The
application connects as the table owner, which row level security does not apply to. The schema enables it once, and a
failure to do so (a role that is not allowed to, a lock that could not be taken) does not stop the site from starting:
it leaves a notice, the audit reports the tables under `SEC_TABLES_OPEN_TO_API`, and the next start tries again.

That finding covers every table, not only the logs. Supabase serves each table in the `public` schema through its Data
API, and a table without row level security can be read, and usually written, with the project's publishable key. The
finding lists the tables, says which hold personal data, and carries the statement that closes each one. This
application does not use the Data API, so closing them changes nothing it does. It is left as a decision rather than
done automatically because another tool may be reading those tables through that API.

### Retention

`info` rows are kept 30 days. Everything else — sensitive changes that worked, and every problem — is kept 180 days.
Pruning runs with the audit. Findings are kept.

### Logging never changes the action

The handler's response is returned untouched and a thrown error is re-thrown. If the log line cannot be written, the
reason goes to the function log and the action still completes. The response waits up to 2.5 seconds for its log line,
because on a serverless host work left running after the response may never finish.

---

## 3. The API

```
GET  /api/ops/logs                          open findings
GET  /api/ops/logs?view=history             closed findings
GET  /api/ops/logs?view=all                 every finding
GET  /api/ops/logs?view=actions             the action log, newest first
       &level=  &component=  &outcome=  &q=  &since=YYYY-MM-DD  &problems=1  &limit=  &offset=
GET  /api/ops/logs?ref=ACT-… | LOG-…        one entry
GET  /api/ops/logs?summary=1                counts
       …any of the above with &format=text | csv | ndjson

POST /api/ops/logs  { "action": "audit" }
POST /api/ops/logs  { "action": "set-status", "id": 1, "status": "resolved", "note": "what was done" }
```

`format=text` is the record shown above. `csv` opens in a spreadsheet; cells that would run as a formula are defused.
`ndjson` is one JSON object per line, for a log pipeline.

---

## 4. Tests

`npm run test:pg` covers both parts against a real Postgres engine: the audit semantics in the table above, including
a check that throws; the playbook for every failure class; redaction, with a search of the whole table for every
secret sent through it; the wrapper end to end; reference collisions; filters; the three export formats; retention;
row level security.

`bash scripts/smoke.sh` does the same over HTTP against the built server, including that the log already holds the
actions the script itself performed, and that none of the passwords it used appear anywhere in the export.
