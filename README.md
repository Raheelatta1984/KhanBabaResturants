# Khan Baba — restaurant operating platform

A complete, dynamic replacement for the Khan Baba static Wix site: public ordering (delivery, click & collect,
dine-in), table QR ordering with live progress, counter → kitchen → courier workflow, Uber Direct delivery quotes,
manufacturing/costing, rule-based surcharges and a What's New release feed.

Next.js 15 (App Router) · React 19 · TypeScript · SQLite (better-sqlite3) · self-hosted fonts · no third-party tracking.

---

## Quick start

```bash
npm install
npm run seed        # creates data/khanbaba.db with the full menu, staff, recipes and demo orders
npm run dev         # http://localhost:3000
```

The database is created automatically on first request if you skip the seed.

### Demo staff logins

Password for every demo account: **`KhanBaba2026!`**

| Portal | URL | Email | Role |
| --- | --- | --- | --- |
| Counter | `/counter` | `counter@khanbaba.com.au` | Accept orders, take payment |
| Kitchen | `/kitchen` | `kitchen@khanbaba.com.au` | Prepare, bump, production batches |
| Delivery | `/delivery` | `delivery@khanbaba.com.au` | Quote, dispatch, track couriers |
| Admin | `/admin` | `admin@khanbaba.com.au` | Everything |
| Manager | `/admin` | `manager@khanbaba.com.au` | Everything except admin-only actions |

Demo customer flows: `/table/T04` (table QR), `/menu` → checkout, `/order/KB-DEMO01` (live tracking).

---

## What is in the box

### Customer storefront
- **Dynamic menu** with live search, category filters, vegetarian/spice filters, sorting, ratings and "sold out" state.
- **Dish pages** with photography, inline YouTube (privacy-enhanced `youtube-nocookie`), full ingredient and allergen
  lists, spice levels (blend / mild / hot / extra hot), container sizes (500 ml / 1000 ml and any custom size) and
  guest reviews.
- **Cart + checkout** for delivery, click & collect or dine-in, with a live courier quote, transparent surcharge lines,
  optional priority preparation and card or pay-at-counter payment.
- **Live order tracking** (`/order/[code]`) polling every 6 seconds: percentage complete, per-item prep state, courier
  details and full event log.
- **Table QR ordering** (`/table/[code]`): scan, order, counter confirms, kitchen cooks, guest watches progress.

### Staff portals
- **Counter** — accept (auto-routes to kitchen and can jump the counter straight to the ticket), mark cash/card paid,
  cancel, hand over collections.
- **Kitchen display** — queue / on the fire / packed columns, per-item prep ticking (drives the customer percentage),
  bump-to-ready, elapsed timers, priority flags, plus the production panel for naan, roti and prep batches.
- **Delivery desk** — re-quote at dispatch, see courier cost vs customer charge and margin, request the courier,
  sync status, mark delivered, hand over pickups.
- **Admin** — overview with revenue/COGS/margins, orders, menu onboarding (photo upload + video), reviews moderation,
  production & material costing, pricing rules and holiday calendar, delivery/payment integration settings, table QR
  management, staff accounts and the What's New publisher.

### Platform engine
- **Pricing rule engine** (`lib/pricing.ts`): weekend %, public holiday %, priority/peak flat fees, channel scoping,
  minimum subtotals, time windows evaluated in `Australia/Sydney`. A public holiday replaces the weekend rate.
- **Delivery quoting** (`lib/delivery/*`): Uber Direct OAuth + `/delivery_quotes` + `/deliveries` integration, with a
  deterministic sandbox courier model as fallback. Quotes are HMAC-signed before checkout so the fee cannot be tampered
  with; the restaurant margin is applied on top (`delivery_markup_percent` + minimum + rounding + cap).
- **Manufacturing & costing** (`lib/production.ts`): materials with pack costs, recipes with material lines, production
  batches. Completing a batch consumes stock and **lodges a cost against every material used** (the `cost_postings`
  ledger), giving cost-per-portion and gross margin per dish.
- **Payments** (`lib/payments.ts`): Stripe Checkout when configured (hosted, PCI-safe) or a sandbox gateway that
  validates a demo card client-side and never transmits card numbers.
- **Order state machine** (`lib/orders.ts`): pending → confirmed → preparing → ready → out for delivery/collection →
  completed, with progress percentages, event log and refund handling on cancel.
- **Auth**: scrypt password hashes, HMAC-signed HTTP-only session cookies, role-based middleware on every portal route.

---

## Integrations

### Uber Direct
1. Create a Uber Direct app and add the restaurant's customer ID.
2. Set `UBER_DIRECT_CLIENT_ID`, `UBER_DIRECT_CLIENT_SECRET`, `UBER_DIRECT_CUSTOMER_ID` (env preferred) or paste them in
   **Admin → Delivery & payments**.
3. Point Uber's webhook at `POST /api/webhooks/uber` and set `UBER_WEBHOOK_SECRET`.
4. Set **Courier provider** to `auto` (uses Uber when configured) or `uber`.

Without credentials the platform uses the sandbox courier: deterministic fees by address, 25–40 minute ETAs and status
progression. The UI labels it "sandbox" everywhere so nobody mistakes it for a live quote.

The fee model: quote the courier for the address → apply `delivery_markup_percent` with a minimum service fee → round up
→ cap. The customer sees the courier fee and the service fee separately (configurable), and the delivery desk sees the
exact margin on every job. Re-quoting at dispatch records the real cost, so any variance is visible.

### Stripe
Set `STRIPE_SECRET_KEY` (and `STRIPE_WEBHOOK_SECRET`) and choose **Stripe Checkout** in Admin → Delivery & payments.
Customers are redirected to Stripe; the webhook at `POST /api/webhooks/stripe` marks the order paid. No card data is
handled by this app. Without a key the sandbox gateway is used (test card `4242 4242 4242 4242`).

---

## Pricing rules

Seeded defaults (all editable in **Admin → Pricing & holidays**):

| Rule | Type | Default | Applies to |
| --- | --- | --- | --- |
| Weekend surcharge | percent | 5% Sat/Sun | all channels |
| Public holiday surcharge | percent | 10% (per-holiday override) | all channels |
| Priority preparation | flat | $2.50 | delivery, pickup |
| Peak priority — lunch | flat | $4.50, Mon–Fri 12:00–14:00 | delivery, pickup |
| Peak priority — dinner | flat | $4.50, Thu–Sat 18:00–21:30 | delivery, pickup |

Priority is never offered to dine-in or table guests. The holiday calendar ships with NSW 2026/2027 public holidays and
can be extended in the admin UI.

---

## Manufacturing example

`Naan — 50 piece batch` uses 6 kg atta, 0.5 kg yoghurt, 0.3 kg ghee, 0.1 kg sugar and 0.15 kg milk powder.
Completing the batch:
- deducts each quantity from `materials.stock_qty`,
- writes a `cost_postings` row per material (qty × unit cost),
- totals the batch cost and stores it on `production_batches`,
- makes cost-per-naan available to the menu margin view.

Costs are reset each batch, never averaged, so you can see the impact of a supplier price change immediately.

---

## What's New

- Public feed at `/whats-new`, filterable by category, with PR links.
- Admin publisher at `/admin/whats-new` (pin, delete, version, PR number).
- Helper: `node scripts/whats-new.mjs --from-git --limit 10` drafts entries from git history; add `--publish` to write
  them to the local database. Every PR template reminds contributors to add a note.

---

## Project layout

```
app/
  page.tsx                 marketing home (live dish data, QR, release feed)
  menu/                    dynamic menu + dish pages (reviews, video, options)
  checkout/                delivery / pickup / dine-in checkout
  order/[code]/            customer tracking
  table/[code]/            table QR ordering
  whats-new/               public release feed
  counter/ kitchen/ delivery/   staff portals
  admin/                   admin console (menu, production, pricing, tables, staff…)
  api/                     quote, orders, reviews, ops actions, uploads, webhooks
components/                shared UI, cart, checkout, tracking, portal forms
lib/
  db/                      schema.sql, connection, seed data
  pricing.ts               rule engine
  delivery/                Uber Direct + sandbox provider, margin pricing
  payments.ts              Stripe / sandbox
  orders.ts                order lifecycle, progress, courier dispatch
  production.ts            materials, recipes, batches, cost postings
  auth/                    sessions, password hashing, API guards
middleware.ts              role-based portal protection
data/                      SQLite database + uploaded images (gitignored)
scripts/                   seed, what's-new generator
```

## Scripts

```bash
npm run dev          # dev server on 0.0.0.0:3000
npm run build        # production build
npm run start        # production server
npm run seed         # seed if empty (add -- --reset to wipe)
npm run typecheck    # tsc --noEmit
npm run whatsnew     # release-note helper
```

## Environment

Copy `.env.example` to `.env.local`. Only `SESSION_SECRET` and `PUBLIC_BASE_URL` matter for a local run; every
integration degrades to a clearly-labelled sandbox mode.

## Deployment

### Vercel / serverless (preview)
The repo deploys to Vercel as-is — previews work, with one deliberate caveat:

- Serverless functions get a **read-only** bundle, so the SQLite database is created in the platform temp directory
  (`/tmp/khanbaba`) and seeded on first request. That means the app runs fully (menu, ordering, portals, QR) but **data
  is per-instance and resets on redeploy**. The admin portal shows a "preview storage" banner while this is true.
- The schema is embedded at build time (`lib/db/schema.ts`, generated from `lib/db/schema.sql` by `npm run schema:build`)
  so no loose SQL files need to be traced into the function, and `outputFileTracingIncludes` keeps the native
  `better-sqlite3` binary in the bundle.
- `vercel.json` pins the `syd1` (Sydney) region — the restaurant, kitchen and guests are all in one city.
- Set `PUBLIC_BASE_URL` (or rely on Vercel's `VERCEL_PROJECT_PRODUCTION_URL`) so QR codes, sitemap and payment
  redirects point at the right host.

To make a Vercel deployment durable, point `KB_DATA_DIR` at a writable volume (Fly.io, Railway, Render, a VPS) — or port
the database layer to Postgres. All queries are plain SQL and the schema is portable:

1. Translate `lib/db/schema.sql` (SQLite types → `SERIAL`/`TIMESTAMPTZ`/`NUMERIC`).
2. Replace `getDb()` in `lib/db/index.ts` with a connection pool; keep the `Db` type shape (`prepare().get/all/run`) or
   wrap `pg` in a thin adapter so the rest of the app is unchanged.
3. Move uploads to object storage by swapping `getUploadsDir()` usage in `app/api/ops/upload/route.ts` and
   `app/api/media/[name]/route.ts` for signed S3/R2 URLs.

Recommended production path today: **Fly.io, Railway or a small VPS with a persistent volume** — deploy the Next.js
server as-is, set `KB_DATA_DIR=/data`, mount the volume, and SQLite (WAL) comfortably handles a single restaurant.

### Self-hosting
```bash
npm ci
npm run build
KB_DATA_DIR=/var/lib/khanbaba PUBLIC_BASE_URL=https://www.khanbabarestaurant.com.au \
  SESSION_SECRET="$(openssl rand -hex 32)" npm run start
```
Put it behind HTTPS, back up `khanbaba.db` plus `uploads/`, and configure both webhooks
(`/api/webhooks/uber`, `/api/webhooks/stripe`).

### Checking a deployment
`GET /api/health` returns `{ ok, storage: "persistent" | "ephemeral", counts }`. If a deployment shows an error page,
check it first: `ephemeral` on a host without a volume means the database was recreated in temp storage, and `ok: false`
returns the database error message (usually a missing/unwritable `KB_DATA_DIR`).

### Operational checklist
- Update restaurant name, phone, email and address in **Admin → Pricing & holidays → Restaurant profile** (the seeded
  values are placeholders).
- Add real Uber Direct and Stripe credentials, then switch providers in **Admin → Delivery & payments**.
- Print table QR codes from **Admin → Tables & QR codes**.
- Add a What's New entry for every release (`npm run whatsnew` or the admin publisher).

## Roadmap

- Postgres adapter + Prisma-style migrations for multi-venue.
- Stripe Terminal for counter card payments.
- SMS/email order notifications (currently in-page tracking).
- Allergen filtering and dietary badges on the menu.
- Courier provider abstraction for DoorDash Drive / Sherpa.
