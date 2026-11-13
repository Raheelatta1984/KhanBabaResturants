# Khan Baba — restaurant operating platform

A complete, dynamic replacement for the Khan Baba static Wix site: public ordering (delivery, click & collect,
dine-in), table QR ordering with live progress, counter → kitchen → courier workflow, Uber Direct delivery quotes,
manufacturing/costing, rule-based surcharges and a What's New release feed.

Next.js 15 (App Router) · React 19 · TypeScript · Postgres on Neon · self-hosted fonts · no third-party tracking.

---

## Quick start

```bash
npm install
cp .env.example .env.local      # paste your Neon DATABASE_URL
npm run dev                     # http://localhost:3000
```

The schema is created and the demo dataset (menu, staff, recipes, pricing rules, demo orders) seeded automatically on
the first request — there is no migration step to run, locally or on Vercel. `npm run seed` only exists to prepare a
fresh Neon branch ahead of time (add `-- --reset` to wipe it first).

No database handy? Everything can also run against **PGlite** (Postgres 17 compiled to WebAssembly, in-process):

```bash
DATABASE_URL=postgres://pglite/khanbaba npm run dev
npm run test:pg        # the full data-layer suite, ~120 assertions, no server
```

### Demo staff logins

Password for every demo account: **`KhanBaba2026!`**

| Portal   | URL         | Email                      | Role                                 |
| -------- | ----------- | -------------------------- | ------------------------------------ |
| Counter  | `/counter`  | `counter@khanbaba.com.au`  | Accept orders, take payment          |
| Kitchen  | `/kitchen`  | `kitchen@khanbaba.com.au`  | Prepare, bump, production batches    |
| Delivery | `/delivery` | `delivery@khanbaba.com.au` | Quote, dispatch, track couriers      |
| Admin    | `/admin`    | `admin@khanbaba.com.au`    | Everything                           |
| Manager  | `/admin`    | `manager@khanbaba.com.au`  | Everything except admin-only actions |

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

| Rule                     | Type    | Default                    | Applies to       |
| ------------------------ | ------- | -------------------------- | ---------------- |
| Weekend surcharge        | percent | 5% Sat/Sun                 | all channels     |
| Public holiday surcharge | percent | 10% (per-holiday override) | all channels     |
| Priority preparation     | flat    | $2.50                      | delivery, pickup |
| Peak priority — lunch    | flat    | $4.50, Mon–Fri 12:00–14:00 | delivery, pickup |
| Peak priority — dinner   | flat    | $4.50, Thu–Sat 18:00–21:30 | delivery, pickup |

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
- Helper: `npm run whatsnew -- --from-git --limit 10` drafts entries from git history; add `--publish` to write them
  straight into Postgres (`DATABASE_URL`). Every PR should ship with a note, e.g.
  `npm run whatsnew -- --pr 42 --title "…" --summary "…" --category ops` (prints the JSON to paste) followed by
  `--publish` if you have a database connection.

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
  db/                      schema.sql (Postgres), Neon driver, seed data
  media.ts                 upload driver: Vercel Blob / Google Drive / local disk
  pricing.ts               rule engine
  delivery/                Uber Direct + sandbox provider, margin pricing
  payments.ts              Stripe / sandbox
  orders.ts                order lifecycle, progress, courier dispatch
  production.ts            materials, recipes, batches, cost postings
  auth/                    sessions, password hashing, API guards
middleware.ts              role-based portal protection
data/uploads/              local dish photos in dev only (gitignored)
scripts/                   seed, what's-new generator, PGlite test harness
```

## Scripts

```bash
npm run dev          # dev server on 0.0.0.0:3000
npm run build        # production build
npm run start        # production server
npm run seed         # migrate + seed a Neon branch (add -- --reset to wipe)
npm run test:pg      # whole data layer against PGlite — no database needed
npm run typecheck    # tsc --noEmit
npm run schema:build # regenerate lib/db/schema.ts from schema.sql
npm run whatsnew     # release-note helper (--publish writes to Postgres)
```

## Environment

Copy `.env.example` to `.env.local`. `DATABASE_URL` is the only mandatory value; `SESSION_SECRET` and
`PUBLIC_BASE_URL` are strongly recommended, and every integration (Uber Direct, Stripe, photo storage) degrades to a
clearly-labelled sandbox or local mode without credentials.

| Variable                                                      | Purpose                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`                                                | Neon Postgres connection string (pooled host, ends `-pooler`). Required. |
| `PUBLIC_BASE_URL`                                             | Canonical URL for QR codes, sitemap and payment redirects.               |
| `SESSION_SECRET`                                              | Signs staff sessions and delivery quotes.                                |
| `BLOB_READ_WRITE_TOKEN`                                       | Vercel Blob store for dish photos (option A).                            |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_FOLDER_ID` | Google Drive for dish photos (option B).                                 |
| `MEDIA_DRIVER`                                                | `auto` (default) / `blob` / `gdrive` / `local`.                          |
| `UBER_DIRECT_*`, `STRIPE_*`                                   | Live courier quotes and card payments.                                   |

## Deployment

Vercel + Neon. One durable Postgres database shared by every serverless instance — no volumes, no `/tmp`, no per-instance
state.

### 1. Create the database

1. Create a project at [neon.tech](https://neon.tech) in the **Sydney** (`ap-southeast-2`) region so queries stay next
   to the functions.
2. **Connect → Pooled connection** and copy the string — it looks like
   `postgresql://user:pass@ep-xxx-pooler.ap-southeast-2.aws.neon.tech/khanbaba?sslmode=require`.
   - _Pooled_ (`-pooler` host) is what the app should use: the driver talks to Neon over HTTPS, one round trip per
     statement, so no TCP pool is held open by a serverless function.
   - _Direct_ (no `-pooler`) is what you want for `npm run seed` and long-lived admin sessions; both strings work.
3. Set `DATABASE_URL` in **Vercel → Project → Settings → Environment Variables** for **Production** _and_ **Preview**
   (and in `.env.local` for development). Nothing else is required for the database.

### 2. Deploy

```bash
vercel --prod
```

`vercel.json` pins the `syd1` region. The first request to any instance creates the schema (`CREATE TABLE IF NOT EXISTS`
for all 20 tables, so it doubles as the migration) and seeds the demo dataset exactly once — a Postgres advisory lock
makes concurrent cold starts safe, so a fresh database never gets two menus. Nothing else to run: no migration command,
no seed script in the build.

Already have data? The seed is skipped whenever `menu_items` has rows, so redeploys never overwrite a live menu.

### 3. Dish photos

Pick a driver — the app picks one automatically in this order: Blob → Google Drive → local disk.

- **Vercel Blob** (least setup on Vercel): create a blob store, set `BLOB_READ_WRITE_TOKEN`. Uploads go to the CDN and
  the returned URL is stored on the dish.
- **Google Drive** (photos stay in your own Drive): create a Google Cloud project, enable the **Google Drive API**,
  create a service account and a JSON key, paste the key into `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` (raw or base64) and
  share your photos folder with the service account's `client_email` as **Editor**; put the folder id in
  `GOOGLE_DRIVE_FOLDER_ID`. Each upload is stored in that folder and made readable by anyone with the link, so the menu
  can display it without a Drive login. Deleting a dish deletes the file.
- **Local disk** is the dev fallback only: files land in `data/uploads` and are served by `/api/media/[name]`. On Vercel
  that directory is ephemeral, so the admin banner warns you and the upload endpoint returns a `note` telling you to
  configure Blob or Drive. Force a driver with `MEDIA_DRIVER=blob|gdrive|local` or the `media_driver` setting.

### 4. Backups

- Neon keeps a **point-in-time restore** window (1 day on the free plan, up to 30 on paid) — `Restore` in the console
  rolls the branch back to any second inside it.
- Nightly logical backup, run anywhere with network access:
  `pg_dump "$DATABASE_URL_DIRECT" -Fc -f khanbaba-$(date +%F).dump`
  (use the **direct**, non-pooled string; pooled connections close during long dumps). Restore with `pg_restore`.
- Branch instead of copying for risky changes: `neon branches create --name pre-deploy`, restore or discard afterwards.
- Dish photos live in Blob or your Drive folder — back those up per their own retention rules.

### 5. Checking a deployment

```bash
curl -s https://your-domain/api/health | jq
```

`GET /api/health` returns `{ ok, database: { configured, target }, counts, media }` — real row counts straight from
Postgres (`menuItems`, `orders`, `staff`, `materials`…), which driver is storing photos, and `503` with the connection
error when `DATABASE_URL` is missing or the branch is asleep/unreachable.

### Troubleshooting: "Application error: a server-side exception has occurred"

That screen (with a digest number) is what Next.js shows when a server component throws and no error boundary catches
it. The most common cause by far is a deployment with **no `DATABASE_URL`** — the project builds fine, but every page
that reads the menu fails on its first query.

1. Open `/api/health`. `{"ok": false, "storage": "unconfigured"}` means the variable is missing; a message about the
   connection means it is set but the database is unreachable.
2. Confirm the variable exists for **both** Production and Preview: `vercel env ls` or Settings → Environment
   Variables. Vercel only injects variables set _before_ a build, so adding one requires a redeploy.
3. Paste the **pooled** Neon string (`…-pooler…`) and check the branch is not suspended.

Since this release the failure is no longer opaque: the root layout no longer touches the database (it renders the
restaurant name/address from `lib/settings.ts` defaults), and both `app/error.tsx` and `app/global-error.tsx` recognise
a database configuration error and print these steps instead of the digest page. `/api/health` stays the single source
of truth for diagnosis.

### 6. Local testing against the real engine

```bash
npm run test:pg
```

Boots PGlite, applies the schema and seed, then drives the app's own modules: all four order channels, counter →
kitchen → ready, courier quote/re-quote/dispatch, cancel + refund, a production batch with stock draw-down and five
cost postings, pricing rules with the holiday calendar, settings, reviews, reporting queries, transaction rollback and
five concurrent order creations. CI runs it on every PR, plus a smoke test that builds and serves the app with
`DATABASE_URL=postgres://pglite/khanbaba`.

### Self-hosting

```bash
npm ci && npm run build
DATABASE_URL="postgresql://…-pooler…/khanbaba?sslmode=require" \
  PUBLIC_BASE_URL=https://www.khanbabarestaurant.com.au \
  SESSION_SECRET="$(openssl rand -hex 32)" npm run start
```

Works on any Node 22 host (Fly.io, Railway, a VPS) — the database is remote, so the host needs no volume. Put it behind
HTTPS and point both webhooks (`/api/webhooks/uber`, `/api/webhooks/stripe`) at it.

### Operational checklist

- Update restaurant name, phone, email and address in **Admin → Pricing & holidays → Restaurant profile** (the seeded
  values are placeholders).
- Add real Uber Direct and Stripe credentials, then switch providers in **Admin → Delivery & payments**.
- Configure Blob or Google Drive for photos before adding dishes (see above).
- Print table QR codes from **Admin → Tables & QR codes**.
- Add a What's New entry for every release (`npm run whatsnew` or the admin publisher).
- Monitor `GET /api/health`: `ok: false` means the database is unreachable (usually a missing `DATABASE_URL` or a
  suspended Neon branch).

## Roadmap

- Versioned SQL migrations (today's idempotent schema is the migration) for multi-venue.
- Stripe Terminal for counter card payments.
- SMS/email order notifications (currently in-page tracking).
- Allergen filtering and dietary badges on the menu.
- Courier provider abstraction for DoorDash Drive / Sherpa.
