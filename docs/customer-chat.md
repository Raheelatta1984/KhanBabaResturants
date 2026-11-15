# Customer chat: deployment, recommendations and privacy

The `/chat` page supports direct counter-staff chat even when `OPENAI_API_KEY`
and `OPENAI_CHAT_MODEL` are empty, and automatically enables the OpenAI menu
assistant once both variables are configured and deployed.

Alongside the chat transcript, `/chat` offers:
- **Today's specials**: a deterministic **Dessert of the Day** and **Drink of
  the Day** rotated daily in `Australia/Sydney` time from currently available
  menu items.
- **Menu & cart suggestions**: when a customer is signed in, suggestions adapt
  to their **last five non-cancelled purchases** (respecting availability and
  vegetarian-only history) and their current cart. Signed-out visitors see
  general popular picks and today's specials without any personal history.
- **Add to cart → Checkout**: guests can add suggested dishes, daily specials,
  or dishes mentioned in chat replies directly to the shared cart and continue
  into the existing `/checkout` and payment flow. Neither the AI nor chat
  submits orders or takes payment directly.

## Before enabling in production

1. Provision a random 32-byte key (`openssl rand -hex 32`) as the sensitive
   `CHAT_ENCRYPTION_KEY` environment variable. Keep a secure, independent backup.
   Missing or invalid keys disable chat. All chat message bodies use AES-256-GCM
   with random nonces and conversation/sender authenticated data. This is
   server-side encryption at rest, **not end-to-end encryption**. During
   rotation, place previous keys in `CHAT_OLD_ENCRYPTION_KEYS` (comma-separated,
   at most five), and retain them until old records and backups expire. Back up
   all keys safely.
2. **Staff-only vs AI-enabled mode**:
   - When `OPENAI_API_KEY` or `OPENAI_CHAT_MODEL` is empty (or blank whitespace),
     `/chat` runs in **counter-staff mode**: starting a chat immediately opens a
     counter conversation (`status = 'waiting'`, `handoff_after_message_id = 0`)
     so guests can talk to counter staff at `/counter/chat` without any OpenAI
     configuration.
   - Once both `OPENAI_API_KEY` and `OPENAI_CHAT_MODEL` are set in the host's
     environment and redeployed, AI menu chat becomes available automatically
     (alongside direct counter chat and AI-to-staff handoff).
   - AI sends recent messages (with best-effort email/phone masking, not a
     reliable PII detector), the published available menu, today's Dessert/Drink
     of the Day, and (for signed-in guests) de-identified dish/category/spice
     hints from their last five orders and current cart to OpenAI — never the
     customer's name, email, phone, address, customer ID, order codes or
     timestamps. Review the provider's data retention and contractual terms
     before enabling AI. Do not use real personal data for testing.
3. Deploy behind HTTPS; review existing staff accounts, access and default
   passwords. Chat tables have RLS enabled with no API-role policies, and the
   application database role must be able to use them. Verify permissions on the
   deployed database, including any privileged service roles and backups.
4. Add edge/WAF rate limiting and monitoring for `/api/chat` before exposing the
   service publicly. A database-backed limit allows 30 chat POSTs per minute
   per Vercel-supplied IP (stored as a keyed hash); a shared ceiling of 60 AI
   calls per hour limits provider spend. These are not comprehensive DDoS defence.
   Sessions are bearer cookies, expire after seven days and do not follow guests
   between devices. There is no automatic notification to counter staff; the
   queue must be monitored. The UI polls every five seconds.
5. Set a random `CRON_SECRET` of at least 32 characters in Vercel. The daily
   Vercel cron removes chats after seven days of inactivity in batches of up
   to 10,000, and removes old rate and quota counters. Failed or missed runs,
   large backlogs, database backups and provider retention can extend storage;
   monitor the cron and apply a separate backup/provider retention policy.

## Privacy & access-control boundaries

- **Customer purchase history isolation**: `/api/chat/suggestions` and
  `/api/chat` resolve customer identity exclusively from the HMAC-signed
  `kb_customer` session cookie (verifying the account is active). Any
  `customerId`, `email` or similar parameter in query strings or request bodies
  is ignored. Responses include `Cache-Control: no-store, private` and
  `Vary: Cookie`, and contain no customer PII or order codes.
- **Shared-browser conversation isolation**: signed-in chat conversations are
  bound to `chat_conversations.customer_id`. Logging out or signing into a
  different customer account on the same browser prevents access to the previous
  customer's transcript.
- **Staff handoff boundary**: counter/manager staff can read only active
  counter conversations (`status = 'waiting'`). For AI handoffs, counter staff
  see only messages sent after the handoff; pre-handoff AI exchanges remain
  hidden from counter/manager roles. Administrators can read the separate
  archive (`/admin/chat`). Counter and archive views never expose customer
  profile details or purchase history.
- **Honest encryption scope**: chat message encryption covers `chat_messages`
  bodies only. Metadata such as timestamps and conversation IDs is not
  encrypted. **This does not encrypt existing orders, customer profiles,
  delivery records, operational logs or other application PII.** Those existing
  schemas use searchable plaintext and require a separate inventory, migration,
  key-management and recovery plan before an application-wide encryption claim
  can be made.

## Tests

- `npx tsx scripts/test-chat.ts` checks encryption, tamper detection, key
  rotation, RLS, redaction, handoff boundaries, staff-only vs AI-enabled
  configuration detection, last-5-purchase recommendations, Dessert/Drink of
  the Day rotation, cart-aware suggestions, privacy/isolation controls, and
  mocked AI requests (verifying no PII is sent to OpenAI).
- For end-to-end HTTP tests against a disposable local PGlite instance (never
  against a live database), start the server with a test `CHAT_ENCRYPTION_KEY`
  and run `python3 scripts/test-chat-http.py`. It verifies both staff-only mode
  (empty OpenAI vars) and AI-enabled mode (mocked provider), customer sign-in
  purchase-history isolation, IDOR rejection, cart pricing + checkout + payment
  from chat-suggested items, and role/archive boundaries.
