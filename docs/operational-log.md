# The operational log

**Page:** `/admin/logs` — Admin → Operational log
**API:** `GET|POST /api/ops/logs`
**Code:** `lib/ops/log.ts`, `app/admin/logs/page.tsx`, `components/portal/LogActions.tsx`

## Why it exists

Every fault in this system was already recorded somewhere. `driver_verification_events`
had the trail for one driver. `inventory_movements` had the trail for one dish.
`whatsapp_messages` had Meta's exact error, word for word.

None of them answered the question an operator actually has: **what is wrong right
now, where do I look, and what do I do about it?** Each table was a fragment, in a
different shape, with no remedy attached. That is why diagnosing the WhatsApp 190
meant reading `Invalid OAuth access token` and already knowing that a stale Vercel
variable was shadowing the portal token — knowledge that lived in one person's head.

The operational log is one table where a finding arrives with its reference, its
evidence, and its course of action already written.

## What a row is

| Field | Meaning |
|---|---|
| `reference` | Stable, quotable handle: `LOG-WA-TOKEN-1245`. Derived from kind + subject. |
| `kind` | `whatsapp`, `delivery`, `menu`, `orders`, `credentials`, `music`, `release` |
| `severity` | `info` → `warning` → `error` → `critical` |
| `title` | The problem in one line |
| `detail` | Meta's own words, the row, the number. No interpretation. |
| `evidence` | JSON: table, id, URL, values. Enough to confirm it yourself. |
| `action` | **What to do**, in order. The point of the row. |
| `context` | Why it matters, when the action needs justifying |
| `owner` | `owner` / `manager` / `counter` / `kitchen` / `developer` / `meta` |
| `subject` | The row this is about: `menu_item:12`, `whatsapp:token` |
| `status` | `open` → `acknowledged` → `resolved` / `ignored` |
| `occurrences` | How many audits have seen it. Bumped, never duplicated. |

## Two rules the table keeps

**1. A finding is idempotent on its reference.**
The reference is a hash of `kind:subject`, not a random id. If the same fault opens
again next week it lands on the same row and bumps `occurrences`. If it were random,
the log would fill with duplicates and stop being a history.

```
LOG-WA-CONFIG-94C4      whatsapp:config
LOG-WA-TOKEN-1245       whatsapp:token
LOG-WA-CATALOG-D3E9     whatsapp:catalog
LOG-MN-12-465E          menu_item:12
LOG-OR-KB1234-84F9      order:KB-1234
```

The label is taken from the part after the colon, not the table prefix, because
`LOG-WA-TOKEN-1245` is sayable on a phone and `LOG-WA-WHATSATOKEN-1245` is not.

**2. Resolved stays resolved.**
A `resolved` or `ignored` row is skipped by later audits. A fault the owner has
deliberately accepted — the sandbox WhatsApp mode, for instance — must not flip
itself back to open on every sweep, or the log becomes noise nobody reads. Reopening
is a deliberate act.

## What the audit checks

| Kind | Finds |
|---|---|
| `whatsapp` | Not configured; token never proven against Meta; last send failed (and whether Meta's error is auth `190`); no catalogue |
| `credentials` | A Vercel variable shadowing a value saved in the portal — the 190 root cause |
| `menu` | A published dish hidden at zero stock (with the movement that did it); a dish with no active price |
| `delivery` | Address unset; address not Whalan 2770; no delivery zones |
| `orders` | Orders stuck in `pending`/`confirmed`/`preparing` for over 90 minutes |
| `release` | Release notes with no publish date |

Every action names the screen to open. Not "check the token" — *"open Admin →
Marketing → Integration diagnostics and press Which token works?"*.

## Do not audit on boot

An earlier version ran the audit inside `getDb()`, next to the release-note
publisher. It deadlocked the first request:

```
first request → getDb() → auditSystem() → getSettings() → getDb()  ← already awaiting
```

The app hung with no error and no log line. `getDb()` must not call anything that
calls `getDb()`. The audit runs from the page and the API route instead, which is
also better: it is fresh every time somebody looks, rather than frozen at boot.

## Closing requires a note

The API returns 400 if `status` is `resolved` or `ignored` and the note is shorter
than four characters. A row closed to clear the screen is indistinguishable from one
that was actually fixed, and six months later nobody can tell which it was.

## Tests

`npm run test:pg` — 405 checks, 24 of them on this feature: reference stability,
every finding has an action, idempotent recording, occurrence counting, resolved
rows not reopening, resolution notes surviving, reopen clearing the timestamp.

`bash scripts/smoke.sh` — 167 checks, 8 on this feature against the running server.
