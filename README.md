# Khan Baba — restaurant operating platform

A complete, dynamic replacement for the Khan Baba static Wix site: public ordering (delivery, click & collect,
dine-in), table QR ordering with live progress, counter → kitchen → courier workflow, multi-provider delivery quotes
(Uber Direct, DoorDash Drive and a verified own-driver fleet), driver onboarding, live delivery maps, ATO kilometre
reports, customer/driver promotions, returns redirected to the community as first-comment-wins Facebook posts, a
detached Square POS synchronisation bridge, manufacturing/costing, rule-based surcharges, a What's New release feed,
a WhatsApp Business ordering and catalogue channel, counter-only table settlement, feedback that becomes a Google
review draft, and a Lahore cultural theme with a scheduled in-room music system.

Next.js 15 (App Router) · React 19 · TypeScript · Postgres on Supabase · Supabase Storage for photos · self-hosted fonts · no third-party tracking.

---

## Quick start

```bash
npm install
cp .env.example .env.local      # paste your Supabase DATABASE_URL + SUPABASE_SECRET_KEY
npm run dev                     # http://localhost:3000
```

The schema is created and the demo dataset (menu, staff, recipes, pricing rules, demo orders) seeded automatically on
the first request — there is no migration step to run, locally or on Vercel. `npm run seed` only exists to prepare the
Supabase database ahead of time (add `-- --reset` to wipe it first).

No database handy? Everything can also run against **PGlite** (Postgres 17 compiled to WebAssembly, in-process):

```bash
DATABASE_URL=postgres://pglite/khanbaba npm run dev
npm run test:pg        # the full data-layer suite, 281 assertions, no server
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

These logins are for the demo only. Before real customers use the site, open
**Admin → Users & access** and press **Remove demo credentials** (see
[Users & access](#users--access) below).

### Demo customer accounts

Same password, **`KhanBaba2026!`**:

| Customer          | Email                | What is in there                   |
| ----------------- | -------------------- | ---------------------------------- |
| Ayesha Khan       | `ayesha@example.com` | Seeded orders, saved delivery address |
| Daniel Mercer     | `daniel@example.com` | Completed click & collect history   |

Demo customer flows: `/table/T04` (table QR), `/menu` → checkout, `/order/KB-DEMO01`
(live tracking by code), `/order/KB-DEMO07` (own-fleet delivery with a live map),
`/t/demo-kb-demo01-token` (the shareable link), `/track`
(find an order from a code *or* a link), `/login` (sign in / create an account),
`/account` (history, live orders, saved details), `/driver/apply` (driver onboarding),
`/community` (meals for neighbours in need) and `/community/demo-community-offer`
(first-comment-wins claim), `/music` (the room's music, requests and the sound switch),
`/pay/demo-pay-kb-demo10` (the secure link a WhatsApp order receives) and
`/feedback/demo-feedback-kb-demo08` (a settled table's feedback → Google review draft). The private driver portal link is generated in
**Admin → Driver management** after approval; try `WELCOME10` at checkout.

### Users & access

`/admin/staff` (administrators and managers) is where every login is managed:

- **Staff**: create a login, edit the name, sign-in email and role, reset a password (with a generated one), disable
  or delete the account. The role decides which portals open: counter, kitchen, delivery, manager (admin console and
  every portal) or administrator (everything).
- **Customers**: set or reset a customer's password and disable or enable the login.
- **My password**: every staff member changes their own at `/staff/password` (the shield icon in the portal bar).
- **Rules**: managers cannot create, edit or become administrators; nobody can change their own role or disable
  themselves; the last active administrator cannot be demoted, disabled or deleted.
- **Sessions follow the database**: each request re-checks the account, so a disabled account, a role change or a
  password reset applies on the next click instead of when the 12-hour cookie expires.
- **Remove demo credentials** (administrator only) is the go-live step. It sets a real password on your own account,
  disables every other account still on the demo password (reset the password, then enable it again), removes the
  two demo customer logins while keeping their orders, and stops `/staff/login` listing and prefilling demo logins.
  The demo password cannot be chosen for any account.

---

## What is in the box

### Customer storefront

- **Dynamic menu** with live search, category filters, vegetarian/spice filters, sorting, ratings and "sold out" state.
- **Dish pages** with photography, inline YouTube (privacy-enhanced `youtube-nocookie`), full ingredient and allergen
  lists, spice levels (blend / mild / hot / extra hot), container sizes (500 ml / 1000 ml and any custom size) and
  guest reviews.
- **Cart + checkout** for delivery, click & collect or dine-in, with a live quote compared across Uber Direct,
  DoorDash Drive and our own verified drivers, transparent surcharge lines, promotion codes, optional priority
  preparation, a delivery map pin (latitude/longitude) and Visa / Mastercard / Amex / Afterpay / PayPal or
  pay-at-counter payment.
- **Live order tracking** (`/order/[code]`) polling every 6 seconds: percentage complete, per-item prep state, courier
  details, a shared SVG/OpenStreetMap live delivery map and the full event log.
- **Table QR ordering** (`/table/[code]`): scan, order, counter confirms, kitchen cooks, guest watches progress.
- **Optional customer accounts** (`/login`, `/account`): ordering never requires a login — browsing, table QR,
  counter walk-ins and the tracking link all work signed out. An account adds order history, one-tap reorder, a
  saved delivery address that prefills checkout, and a single place to find a live order. Signing up with the email
  used for a guest order sweeps that history into the account.
- **Shareable tracking link** (`/t/[token]`): every order gets a 16-byte tracking token at creation, so the link a
  customer keeps, texts to whoever is collecting or reopens on another device cannot be guessed from an order code.
  The page offers copy / native share / SMS / email, and `/track` resolves either a code or a pasted link.
- **One-time claim links** (`/claim/[token]`): for guest orders the counter can mint a single-use link that attaches
  the order to an account without a password. Only the SHA-256 of the token is stored, and it is redeemed on a button
  press so a mail-scanner prefetch cannot burn it.
- **Driver onboarding** (`/driver/apply`): a four-step application with seven compliance checks, vehicle/licence
  details, consent and an optional starting coordinate. Approval is impossible until every document is verified.
- **Community meals** (`/community`, `/community/[token]`): untouched returns are offered free as click & collect
  only. The first valid comment books the meal, receives the exact `thank you we have got it booked` auto-reply,
  closes the post to further comments and creates a zero-cost counter ticket.

### Staff portals

- **Counter** — accept (auto-routes to kitchen and can jump the counter straight to the ticket), mark cash/card paid,
  cancel, hand over collections, and look a customer up by name, email or mobile (including guest orders not yet
  linked to an account) at **Counter → Customers**.
- **Kitchen display** — queue / on the fire / packed columns, per-item prep ticking (drives the customer percentage),
  bump-to-ready, elapsed timers, priority flags, plus the production panel for naan, roti and prep batches.
- **Delivery desk** — re-quote at dispatch across every configured partner, see courier cost vs customer charge and
  margin, request the courier, watch the live map, sync status, mark delivered, hand over pickups.
- **Admin** — overview with revenue/COGS/margins, orders, menu onboarding (photo upload + video), reviews moderation,
  production & material costing, pricing rules and holiday calendar, **Promotions**, **Driver management** (verification,
  assignment, commission payout and ATO CSV), **Returns & community**, **Integrations (Square POS)**,
  delivery/payment integration settings, table QR management, staff accounts, the What's New publisher,
  **WhatsApp Business**, **Music system**, **Feedback & Google** and the **Command centre** (`/admin/hub`, the page the
  Khan Baba logo opens for admins and managers — every admin option on one screen).
- **Music desk** (`/counter/music`, and the same studio in **Admin → Music system**): the live player with
  stop / resume / replay / next, the day-by-time schedule, the library, guest requests awaiting approval and the
  on-demand charge controls.

### Platform engine

- **Pricing rule engine** (`lib/pricing.ts`): weekend %, public holiday %, priority/peak flat fees, channel scoping,
  minimum subtotals, time windows evaluated in `Australia/Sydney`. A public holiday replaces the weekend rate.
- **Delivery quoting** (`lib/delivery/*`): Uber Direct OAuth, DoorDash Drive JWT-signed quote/dispatch, own-fleet
  distance-based quotes and a deterministic sandbox courier fallback. `auto` compares every configured partner by
  cheapest or fastest; provider webhooks share one status mapper. Quotes are HMAC-signed before checkout so the fee
  cannot be tampered with; the restaurant margin is applied on top.
- **Manufacturing & costing** (`lib/production.ts`): materials with pack costs, recipes with material lines, production
  batches. Completing a batch consumes stock and **lodges a cost against every material used** (the `cost_postings`
  ledger), giving cost-per-portion and gross margin per dish.
- **Payments** (`lib/payments.ts`): Stripe Checkout hosts Visa, Mastercard, Amex and Afterpay/Clearpay; PayPal uses
  Orders v2 with a capture/return webhook flow. With no credentials, every option runs through a clearly-labelled
  sandbox gateway that never transmits card numbers.
- **Promotions** (`lib/promotions.ts`): customer percent/flat/free-delivery discounts and driver bonuses/commission
  uplifts. Codes are validated at quote time **and again at order creation**; redemptions are recorded atomically.
- **Order state machine** (`lib/orders.ts`): pending → confirmed → preparing → ready → out for delivery/collection →
  completed, with progress percentages, discount/payment metadata, delivery coordinates, driver settlement on
  successful hand-over, a live tracking snapshot, event log and refund handling on cancel. **No Square calls live here.**
- **Auth**: scrypt password hashes, HMAC-signed HTTP-only session cookies, role-based middleware on every portal route.
  Staff and customer cookies are signed with the same secret but carry different `aud` claims, so one can never be
  replayed as the other. Customer sessions last 30 days; every query is scoped by the id inside the signed cookie,
  never by anything the browser sends.

### ERP expansion

- **DoorDash Drive as a second courier partner.** `lib/delivery/doordash.ts` signs short-lived JWTs, requests quotes,
  dispatches with our order-scoped idempotency key and verifies webhook signatures. `auto` mode compares it with Uber
  Direct and our own drivers (`cheapest` or `fastest`); staff can force one partner from **Admin → Delivery & payments**.
- **Verified own-driver fleet.** `/driver/apply` collects identity, vehicle, licence, insurance, police check,
  right-to-work, ABN and payout references. Every one of the seven documents must be marked verified before
  **Admin → Driver management** can approve the driver. Approval issues a 180-day signed capability link to a private
  portal with an active route, GPS sharing, a commission ledger and the ATO report.
- **Commission only on success.** `settleDriverJob()` posts the per-delivery fee, percentage commission, active driver
  bonus and an ATO trip row exactly once when a delivery completes. Payouts are recorded separately, so an unpaid
  ledger cannot silently disappear.
- **ATO kilometre history.** `lib/drivers.ts` captures the cents-per-km rate on each trip (2026-27 = 91c, 2025-26 and
  2024-25 = 88c, 2023-24 = 85c, 2022-23 = 78c, 2021-22/2020-21 = 72c), applies the 5,000 business-km cap and
  exports `ato-km-<driver>-<fy>.csv` from the driver portal or driver management. Rates are also editable in settings;
  see the [ATO rate table](https://atotaxrates.info/tax-deductions/work-related-car-expenses/cents-per-kilometre/)
  and the [2026-27 determination coverage](https://www.baronaccounting.com/post/ato-cents-per-kilometre-rate-2026-27).
- **Live delivery maps.** `components/DeliveryMap.tsx` is a pure SVG component with optional OpenStreetMap raster
  tiles and an offline grid fallback (`map_tile_provider = none`). The same snapshot powers the customer tracking
  page, the delivery desk, the driver portal and `/api/ops/tracking`; no mapping SDK or API key is required.
- **Coordinates with delivery addresses.** Checkout resolves latitude/longitude from the browser's geolocation or
  Nominatim, with a deterministic server-side fallback. `orders.delivery_lat/lng` and `customers.address_lat/lng`
  feed courier quotes, driver assignment, the map and kilometre logs.
- **Returns → community in need.** `/admin/community` logs a return and publishes it as a Facebook Page post (or a
  local sandbox preview). The **first** comment containing the configured keyword wins a free click & collect meal:
  a conditional `UPDATE … WHERE status='posted' AND claimed_at IS NULL` makes the claim race-safe, the platform
  auto-comments exactly `thank you we have got it booked`, the post is closed (or later comments hidden on Page API
  versions without `comment_enabled`), and a zero-cost pickup ticket is created for the counter.
- **Promotions for customers and driver partners.** `/admin/promotions` manages percent, flat, free-delivery, driver
  bonus and commission-uplift campaigns with windows, usage caps, per-customer caps and channel scoping. Customer
  codes appear at checkout; driver rewards post only on a successful delivery.
- **More payment options.** Visa, Mastercard, American Express, Afterpay/Clearpay and PayPal are selectable at
  checkout. Stripe or PayPal hosted checkout is used when credentials exist; every option is explicitly labelled
  sandbox otherwise. The chosen option is persisted on the order and shown on tracking.
- **Square POS: completely detached.** `lib/integrations/square.ts`, `app/api/ops/square/*`, the Square webhook, the
  two `square_*` tables and the optional `item_variants.square_variation_id` column are the entire synchronisation
  boundary. The bridge can push completed orders, import POS payments, map catalog variations and receive webhooks, but
  `lib/orders.ts` contains **no Square import or call**. Run it manually from **Admin → Integrations** or out-of-band
  via `GET /api/ops/square/cron` with `Authorization: Bearer $SQUARE_SYNC_SECRET`. Removing those files/tables leaves
  the ordering core untouched.

### WhatsApp Business, dine-in settlement, feedback and the Lahore room

- **WhatsApp as an ordering channel** (`lib/whatsapp/*`, `app/api/webhooks/whatsapp`). The portal publishes every
  dish to the WhatsApp Business catalogue (`channel_publications` records the exact product payload, price, stock and
  sandbox/live status), central stock in `menu_items.stock_qty` is decremented by orders and mirrored to WhatsApp, and
  availability flips to sold out automatically at zero. A guest who messages the business number gets the catalogue
  reply, can order in plain text, and the ticket lands in the portal as `source = 'whatsapp'`. Counter staff are
  notified on WhatsApp; the counter accepts, sends the guest a secure payment link (`/pay/[token]`, one-time,
  expiring), and once payment clears the same ticket is accepted and forwarded to the kitchen. With no Meta
  credentials the channel runs in **sandbox**: every message is stored and shown in **Admin → WhatsApp Business** with
  its exact body. Setup steps are in `.env.example`; the webhook verifies `X-Hub-Signature-256` whenever
  `WHATSAPP_APP_SECRET` is set.
- **Counter-only table settlement.** Dine-in and table orders never take payment upfront — the guest eats first.
  The counter can **park** a bill (`orders.parked`, with who/when/why), the table page shows "settle at the counter",
  and `settle-table` takes cash or card, stamps `paid_at`, closes the table and immediately mints the feedback link.
  Online payment for these channels is coerced to `counter` server-side, so the rule cannot be bypassed from the
  browser.
- **Feedback → Google review draft** (`lib/feedback.ts`). Settlement (or any completed order) sends a two-tap
  feedback link. The guest rates the meal, confirms party size and picks the dishes; the portal then prepares a Google
  review draft containing the dish names **and their photos**, the headcount ("served 3 people"), the served cost
  range and the bill range, ready for staff to copy or open straight into Google's own review page. Google forbids a
  third party from posting a review in a guest's name, so the final publish is a one-tap hand-off — the draft, the
  copy button and the tracking of draft → published → skipped all live in **Admin → Feedback & Google**.
- **Lahore cultural theme.** `data-theme="lahore"` on `<html>` (set by the music player, or forced from
  **Admin → Music system**) brings the deep-green/marigold palette, arched motifs and the low-volume room sound.
  Every visitor — online or at a table — has a persistent sound switch, and the choice is remembered in
  `localStorage`. Ambience never starts above 20/100 and staff cannot raise it past 60.
- **Music system** (`lib/music.ts`). Tracks can be audio files or YouTube links and are tagged `music` or
  `religious` (naat, tilawat, qawwali). Collections group tracks; schedules play a collection by **day of week and
  time window** with priority (a Friday 17:00–20:00 religious collection beats the lunch service, and a window may
  cross midnight). Counter and admin can stop, resume, replay the current track or skip to the next at any time; the
  player is a singleton row so every device shows the same thing. Guests can **request a song** with a mandatory
  link; requests wait for staff approval in `/music`, `/counter/music` and **Admin → Music system**, and an approved
  request becomes a track in the "On demand" collection.
- **On-demand music charging.** Each approved request can carry a charge from the predefined rules (base $5, peak
  $8 between 18:00 and 21:30, both editable) or any amount staff choose — including **zero** to waive it. The charge
  is posted to `orders.music_charge_cents`, printed on the bill and shown on the guest's own request card. Maximum
  play time default 15 minutes, so one request cannot monopolise the room.
- **Ordering encouragement, respectfully.** A table order triggers a one-time thank-you cue in the room. It is
  suppressed for the whole duration of a religious collection — and while one is scheduled, the ambience channel stays
  silent too. This is enforced in `lib/music.ts` and covered by the data-layer suite.

---

## Integrations

### Uber Direct

1. Create a Uber Direct app and add the restaurant's customer ID.
2. Set `UBER_DIRECT_CLIENT_ID`, `UBER_DIRECT_CLIENT_SECRET`, `UBER_DIRECT_CUSTOMER_ID` (env preferred) or paste them in
   **Admin → Delivery & payments**.
3. Point Uber's webhook at `POST /api/webhooks/uber` and set `UBER_WEBHOOK_SECRET`.
4. Set **Courier provider** to `auto` (compares every configured partner) or `uber` to force Uber Direct.

Without credentials the platform uses the sandbox courier: deterministic fees by address, 25–40 minute ETAs and status
progression. The UI labels it "sandbox" everywhere so nobody mistakes it for a live quote.

The fee model: quote the courier for the address → apply `delivery_markup_percent` with a minimum service fee → round up
→ cap. The customer sees the courier fee and the service fee separately (configurable), and the delivery desk sees the
exact margin on every job. Re-quoting at dispatch records the real cost, so any variance is visible.

### Stripe

Set `STRIPE_SECRET_KEY` (and `STRIPE_WEBHOOK_SECRET`) and choose **Stripe Checkout** in Admin → Delivery & payments.
Customers are redirected to Stripe; the webhook at `POST /api/webhooks/stripe` marks the order paid. No card data is
handled by this app. Without a key the sandbox gateway is used (test card `4242 4242 4242 4242`). Stripe Checkout also
serves the Afterpay/Clearpay option.

### DoorDash Drive

1. Create a DoorDash Drive developer app and copy the developer ID, key ID and signing secret into
   `DOORDASH_DEVELOPER_ID`, `DOORDASH_KEY_ID` and `DOORDASH_SIGNING_SECRET` (or **Admin → Delivery & payments**).
2. Set `DOORDASH_STORE_ID`, point the Drive webhook at `POST /api/webhooks/doordash` and set
   `DOORDASH_WEBHOOK_SECRET`.
3. Choose `auto` to let the quote engine compare DoorDash with Uber Direct and the own fleet, or force
   `doordash` / `own_fleet` for troubleshooting.

Quotes are signed with a short-lived JWT; dispatch uses an idempotent external delivery ID derived from the order code.
Without credentials DoorDash is excluded from the comparison and every other partner keeps working.

### PayPal and Afterpay

Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE` and `PAYPAL_WEBHOOK_ID`, then point PayPal's webhook at
`POST /api/webhooks/paypal`. PayPal uses Orders v2: the customer approves on PayPal, returns through
`/api/payments/paypal/return`, and the capture/webhook marks the order paid. Afterpay/Clearpay needs no extra key — it
is a Stripe Checkout payment method. Enable or disable each option with the `payment_methods` CSV setting.

### Square POS (detached bridge)

Set `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT` and `SQUARE_WEBHOOK_SIGNATURE_KEY` only if you
want to synchronise POS/transaction data. Point Square's webhook at `POST /api/webhooks/square`. Use
**Admin → Integrations → Run full sync**, or schedule `GET /api/ops/square/cron` with
`Authorization: Bearer $SQUARE_SYNC_SECRET`. The bridge writes to `square_sync_records` and `square_transactions` only;
it never participates in checkout, quoting, dispatch or order completion. Sandbox mirror mode needs no credentials.

### Facebook Page (community meals)

Set `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `FACEBOOK_APP_SECRET` and `FACEBOOK_VERIFY_TOKEN`; subscribe the
Page's `feed` field to `GET/POST /api/webhooks/facebook`. Without credentials the post is mirrored locally so the
first-comment-wins flow is fully testable. The first matching comment receives the exact auto-reply
`thank you we have got it booked`, the post is closed to further comments (or later comments are hidden), and the
counter receives a zero-cost click & collect ticket.

### WhatsApp Business

The Cloud API boundary lives in `lib/whatsapp/client.ts`: configuration (environment wins over the settings saved in
**Admin → WhatsApp Business**), text and call-to-action sends, catalogue publishing, webhook signature verification and
the `whatsapp_messages` audit log. Nothing else in the app talks to Meta.

1. Meta for Developers → your app → **WhatsApp → API setup**: copy the phone number id and a permanent access token
   into `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN`.
2. Webhook URL `https://<your-domain>/api/webhooks/whatsapp`, verify token repeated in `WHATSAPP_VERIFY_TOKEN`,
   subscribe to the **messages** field. Set `WHATSAPP_APP_SECRET` so every delivery is signature-checked.
3. Commerce Manager → connect a catalogue, copy its id into `WHATSAPP_CATALOG_ID`, then press **Publish whole menu**
   in **Admin → WhatsApp Business**.
4. Put the counter's phone in `WHATSAPP_COUNTER_NUMBER` (or the settings field) — that is where new orders land.

Without those values the channel is labelled **sandbox** and every message is captured in the portal instead.

### Maps and driver GPS

Maps need no key. The default `map_tile_provider = osm` loads OpenStreetMap raster tiles inside the SVG; `none`
renders an offline grid for kiosks and locked-down networks. Checkout geocodes with Nominatim and falls back to a
deterministic Sydney estimate on the server. Approved drivers share GPS from their signed portal link only while they
turn location on for an active job (`/api/driver/location`). `Admin → Driver management` exposes the live map,
verification checklist, commission ledger and ATO CSV.

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
  checkout/                delivery / pickup / dine-in checkout, promos, pay options
  order/[code]/            customer tracking + live delivery map
  community/               public community board + first-comment claim pages
  driver/apply/            staged driver onboarding
  driver/[token]/          signed driver portal (map, GPS, ledger, ATO CSV)
  table/[code]/            table QR ordering
  music/                   the room's music, requests and the sound switch
  pay/[token]/             the secure payment link sent over WhatsApp
  feedback/[token]/        two-tap feedback → Google review draft
  whats-new/               public release feed
  counter/ kitchen/ delivery/   staff portals (counter/music is the music desk)
  admin/                   admin console (menu, production, pricing, promotions,
                           drivers, community, integrations, tables, staff,
                           whatsapp, music, feedback) + hub/ command centre
  api/                     quote, orders, driver/ops/community/payment/webhook routes
components/                shared UI, cart, checkout, tracking, DeliveryMap,
                           DriverPortal, driver onboarding, portal forms
lib/
  db/                      schema.sql (Postgres), Supabase/pg driver, seed data
  media.ts                 upload driver: Supabase Storage / Vercel Blob / Google Drive / local disk
  geo.ts                   haversine, road-km estimates, route interpolation, tiles
  pricing.ts               rule engine + promotion adjustments
  delivery/                Uber Direct, DoorDash Drive, own fleet, sandbox, status mapper
  payments.ts              Stripe / PayPal / sandbox, payment option catalogue
  orders.ts                order lifecycle, promos, coordinates, driver settlement
  drivers.ts               onboarding, verification, GPS, commission, ATO reports
  community.ts             returns → Facebook posts → first-comment-wins claims
  promotions.ts            customer offers + driver rewards
  integrations/            detached Square POS bridge + Facebook Graph helpers
  whatsapp/                Cloud API client, catalogue publishing, order intake
  music.ts                 player singleton, schedules, religious rules, song charges
  feedback.ts              feedback invites, party size, bill range, Google drafts
  dine-in.ts               parking, counter settlement, table release
  production.ts            materials, recipes, batches, cost postings
  auth/                    sessions, password hashing, API guards
middleware.ts              role-based portal protection
data/uploads/              local dish photos in dev only (gitignored)
scripts/                   seed, what's-new generator, PGlite + HTTP smoke tests
```

## Scripts

```bash
npm run dev          # dev server on 0.0.0.0:3000
npm run build        # production build
npm run start        # production server
npm run seed         # migrate + seed the Supabase database (add -- --reset to wipe)
npm run db:check     # dial the configured database and say exactly what is wrong
npm run test:pg      # whole data layer against PGlite — no database needed
npm run test:smoke   # HTTP smoke test against an already-running server
npm run test         # typecheck + PGlite suite + smoke test
npm run typecheck    # tsc --noEmit
npm run schema:build # regenerate lib/db/schema.ts from schema.sql
npm run whatsnew     # release-note helper (--publish writes to Postgres)
```

## Environment

Copy `.env.example` to `.env.local`. `DATABASE_URL` is the only mandatory value; `SESSION_SECRET` and
`PUBLIC_BASE_URL` are strongly recommended. Every integration (Uber Direct, DoorDash, Stripe, PayPal, Square,
Facebook, photo storage and maps) degrades to a clearly-labelled sandbox, offline or local mode without credentials.

| Variable                                                | Purpose                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                          | Supabase pooler string (host contains `pooler`, port `6543`). Required.                        |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`                   | Supabase Storage for dish photos (the default, durable driver).                               |
| `SUPABASE_STORAGE_BUCKET`                               | Photo bucket, default `menu-photos` (created on first upload).                                |
| `PUBLIC_BASE_URL`                                       | Canonical URL for QR codes, sitemap, payment redirects and community links.                   |
| `SESSION_SECRET`                                        | Signs staff sessions, delivery quote tokens and driver capability links.                      |
| `BLOB_READ_WRITE_TOKEN`                                 | Optional: Vercel Blob instead of Supabase Storage.                                            |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_FOLDER_ID` | Optional: Google Drive instead of Supabase Storage.                                     |
| `MEDIA_DRIVER`                                          | `auto` (default) / `supabase` / `blob` / `gdrive` / `local`.                                  |
| `UBER_DIRECT_*`, `UBER_WEBHOOK_SECRET`, `UBER_STORE_ID` | Uber Direct live courier quotes and status webhooks.                                         |
| `DOORDASH_*`                                            | DoorDash Drive developer ID, JWT key/signing secret, store ID and webhook secret.             |
| `STRIPE_*`                                              | Stripe Checkout for Visa, Mastercard, Amex and Afterpay/Clearpay + payment webhook.           |
| `PAYPAL_*`                                              | PayPal Orders v2 client, mode, webhook ID; hosted wallet checkout.                            |
| `SQUARE_*`, `SQUARE_SYNC_SECRET`, `CRON_SECRET`         | Detached Square POS bridge and optional scheduled out-of-band sync authorisation.             |
| `FACEBOOK_*`                                            | Facebook Page post/comment API, app-secret signatures and webhook verification.                |
| `WHATSAPP_*`                                            | WhatsApp Business Cloud API: phone number id, token, catalogue id, verify token, app secret, staff number. |

## Deployment

Vercel + Supabase. One durable Postgres database shared by every serverless instance — no volumes, no `/tmp`, no
per-instance state.

### 1. Create the database

The project is **khanbaba** on Supabase (`phjsppfyhlgeznhiaqsc`, `ap-southeast-2` = Sydney).

1. Supabase → **khanbaba** → **Connect** → **Connection pooling** → copy the **Transaction** string (port `6543`):
   `postgresql://postgres.phjsppfyhlgeznhiaqsc:PASSWORD@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres`
   (the pooler number in the host — `aws-0` / `aws-1` — follows the copy button; both work.)
   - Use the **pooler**, not the direct `db.<ref>.supabase.co` host: the direct host resolves to IPv6 only and is not
     reachable from Vercel's functions.
   - Transaction mode is fine for everything this app does (the driver uses unnamed statements, and any transaction is
     pinned to one checked-out connection). Port `5432` on the same host is session mode if you prefer it.
   - If the password contains `@ : / ? #`, URL-encode those characters, or reset it in
     **Project Settings → Database**. The driver decodes them exactly once.
   - TLS: node-postgres normally re-parses the URL over any explicit `ssl` option, so a
     `?sslmode=require` string ends up *verifying* Supavisor's certificate and failing with
     `self-signed certificate in certificate chain`. `lib/db/driver.ts` builds the options itself: no
     TLS for localhost, no CA verification for `require`/`prefer`/`no-verify`, real verification only
     for `sslmode=verify-full` (or `PGSSL_VERIFY=full`).
2. Set `DATABASE_URL` in **Vercel → Project → Settings → Environment Variables** for **Production** _and_ **Preview**
   (and in `.env.local` for development). A variable that exists with an **empty value** counts as missing — the app
   reports `blank-connection-string` on `/api/health` so this cannot masquerade as a code bug again.
3. Set `SUPABASE_URL=https://phjsppfyhlgeznhiaqsc.supabase.co` and `SUPABASE_SECRET_KEY` (Project Settings → API
   Keys → secret key) for photo uploads, plus `SUPABASE_STORAGE_BUCKET=menu-photos`.

Nothing else is required for the database: the schema lives in the app.

### 2. Deploy

```bash
vercel --prod
```

`vercel.json` pins the `syd1` region. The first request to any instance creates the schema (`CREATE TABLE IF NOT EXISTS`
for all 36 tables, plus `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for columns added to an existing table by a
later release, so it doubles as the migration) and seeds the demo dataset exactly once — a Postgres advisory lock
makes concurrent cold starts safe, so a fresh database never gets two menus. Nothing else to run: no migration command,
no seed script in the build.

Already have data? The seed is skipped whenever `menu_items` has rows, so redeploys never overwrite a live menu.

### 3. Dish photos

Pick a driver — the app picks one automatically in this order: Supabase Storage → Vercel Blob → Google Drive → local
disk.

- **Supabase Storage** (default): set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Uploads land in the public
  `menu-photos` bucket (created automatically on the first upload if it is missing, public, 5 MB, images only) and the
  CDN URL is stored on the dish. Keep the secret key server-side — it bypasses row-level security.
- **Vercel Blob**: create a blob store, set `BLOB_READ_WRITE_TOKEN`.
- **Google Drive** (photos stay in your own Drive): create a Google Cloud project, enable the **Google Drive API**,
  create a service account and a JSON key, paste the key into `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` (raw or base64) and
  share your photos folder with the service account's `client_email` as **Editor**; put the folder id in
  `GOOGLE_DRIVE_FOLDER_ID`.
- **Local disk** is the dev fallback only: files land in `data/uploads` and are served by `/api/media/[name]`. On Vercel
  that directory is ephemeral, so the admin banner warns you. Force a driver with
  `MEDIA_DRIVER=supabase|blob|gdrive|local` or the `media_driver` setting.

### 4. Backups

- Supabase takes daily backups (Pro plan) and keeps **point-in-time restore** for the retention window — see
  Project Settings → Database → Backups.
- Nightly logical backup, run anywhere with network access:
  `pg_dump "$DATABASE_URL" -Fc -f khanbaba-$(date +%F).dump`
  (session mode on port `5432` is the safer choice for long dumps). Restore with `pg_restore`.
- For risky changes use a Supabase **branch** (or a copy) rather than working on production.
- Dish photos live in the `menu-photos` bucket — Supabase Storage is covered by the same project's backups.

### 5. Checking a deployment

```bash
curl -s https://your-domain/api/health | jq
```

`GET /api/health` returns `{ ok, storage, target, counts, media, warnings }` — real row counts straight from
Postgres (`menuItems`, `orders`, `staff`, `drivers`, `promotions`, `communityOffers`, `squareTransactions`,
`deliveryJobs`…), which driver is storing photos, and `503` with the connection error when `DATABASE_URL` is missing
or the branch is asleep/unreachable.

### Troubleshooting: "Application error: a server-side exception has occurred"

That screen (with a digest number) is what Next.js shows when a server component throws and no error boundary catches
it. The most common cause by far is a deployment with **no `DATABASE_URL`** — the project builds fine, but every page
that reads the menu fails on its first query.

1. Open `/api/health`. It distinguishes the cases that all look the same in the browser:
   - `storage: "unconfigured"` with `reason: "missing-connection-string"` — no `DATABASE_URL` at all.
   - `storage: "unconfigured"` with `reason: "blank-connection-string"` — the variable exists but its value is empty
     (this was the live outage).
   - `reason: "invalid-connection-string"` — an `https://` REST URL, or the IPv6-only direct host.
   - `reason: "authentication-failed"` — wrong password; re-copy the pooler string, URL-encoding special characters.
   - `reason: "tls-verification-failed"` — certificate rejected (see the TLS note above).
   - `reason: "unreachable"` — wrong host/region, or the project is paused.
2. Confirm the variable exists for **both** Production and Preview: `vercel env ls` or Settings → Environment
   Variables. Vercel only injects variables set _before_ a build, so adding one requires a redeploy.
3. Paste the Supabase **pooler** string (port `6543`) and check the project is not paused.

Since this release the failure is no longer opaque: the root layout no longer touches the database (it renders the
restaurant name/address from `lib/settings.ts` defaults), and both `app/error.tsx` and `app/global-error.tsx` recognise
a database configuration error and print these steps instead of the digest page. `/api/health` stays the single source
of truth for diagnosis, and now also warns when `SUPABASE_URL` and `DATABASE_URL` point at different projects.

### 6. Local testing against the real engine

```bash
npm run test:pg
```

Boots PGlite, applies the schema and seed, then drives the app's own modules: all four order channels, counter →
kitchen → ready, courier quote/re-quote/dispatch, cancel + refund, a production batch with stock draw-down and five
cost postings, pricing rules with the holiday calendar, settings, reviews, reporting queries, transaction rollback and
five concurrent order creations. It also checks the ERP expansion: verified driver documents, the 91c/km ATO report
and cap, GPS breadcrumbs for the live map, server-side promotion validation, every payment option, first-comment-wins
community claims with the exact auto-reply and zero-cost ticket, and out-of-band Square sync leaving orders untouched.
CI runs it on every PR, plus a smoke test that builds and serves the app with
`DATABASE_URL=postgres://pglite/khanbaba`.

### Self-hosting

```bash
npm ci && npm run build
DATABASE_URL="postgresql://…-pooler…/khanbaba?sslmode=require" \
  PUBLIC_BASE_URL=https://www.khanbabarestaurant.com.au \
  SESSION_SECRET="$(openssl rand -hex 32)" npm run start
```

Works on any Node 22 host (Fly.io, Railway, a VPS) — the database is remote, so the host needs no volume. Put it behind
HTTPS and point the enabled webhooks (`/api/webhooks/uber`, `/api/webhooks/doordash`, `/api/webhooks/stripe`,
`/api/webhooks/paypal`, `/api/webhooks/square`, `/api/webhooks/facebook`) at it.

### Operational checklist

- Update restaurant name, phone, email and address in **Admin → Pricing & holidays → Restaurant profile** (the seeded
  values are placeholders).
- Add real Uber Direct, DoorDash Drive, Stripe and PayPal credentials, then switch providers in
  **Admin → Delivery & payments**. Enable the customer payment brands you actually accept.
- Verify every driver's seven documents before approval, then send their private portal link from
  **Admin → Driver management**. Download ATO CSVs before each tax return.
- If you use Square POS, configure only the detached bridge in **Admin → Integrations** and secure the optional cron
  endpoint with `SQUARE_SYNC_SECRET`. Never add Square calls to the order lifecycle.
- Configure the Facebook Page's `feed` webhook and confirm the exact `thank you we have got it booked` auto-reply for
  community returns.
- Configure Supabase Storage (`SUPABASE_URL` + `SUPABASE_SECRET_KEY`) before adding dishes (see above).
- Print table QR codes from **Admin → Tables & QR codes**.
- Add a What's New entry for every release (`npm run whatsnew` or the admin publisher).
- Monitor `GET /api/health`: `ok: false` means the database is unreachable (usually a missing or blank `DATABASE_URL`, or
  a paused Supabase project).

## Roadmap

- Versioned SQL migrations (today's idempotent schema is the migration) for multi-venue.
- Stripe Terminal for counter card payments.
- SMS/email order notifications (currently in-page tracking and the live map).
- Allergen filtering and dietary badges on the menu.
- Additional courier partners behind the existing provider interface (e.g. Sherpa).
