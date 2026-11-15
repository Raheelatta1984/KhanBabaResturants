# Customer chat: deployment and privacy

The `/chat` page offers an optional OpenAI menu assistant and a handoff to
`/counter/chat`. Orders still go through the existing menu and checkout; the
assistant does not submit orders, take payment, verify allergens or guarantee
that its suggestions are correct. Guests can call if chat is unavailable.

## Before enabling in production

1. Provision a random 32-byte key (`openssl rand -hex 32`) as the sensitive
   `CHAT_ENCRYPTION_KEY` environment variable. Keep a secure, independent backup.
   Missing or invalid keys disable chat. All message bodies use AES-256-GCM with
   random nonces and conversation/sender authenticated data. This is server-side
   encryption at rest, **not end-to-end encryption**. During rotation, place
   previous keys in `CHAT_OLD_ENCRYPTION_KEYS` (comma-separated, at most five),
   and retain them until old records and backups expire. Back up all keys safely.
2. To enable AI, configure `OPENAI_API_KEY` and `OPENAI_CHAT_MODEL` in the host's
   secret store and redeploy. Without them, the customer can still request a
   counter person. AI sends recent messages and the published available menu to
   OpenAI. The UI asks for consent and warns guests not to enter personal or
   payment information. Simple email/telephone masking is best effort, not a
   reliable PII detector. Review the provider's data retention and contractual
   terms before deployment. Do not use real personal data for testing.
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

Customers see their own transcript; counter/manager staff can read only active
handoffs and only messages sent after the handoff. Administrators can read the
separate archive, including pre-handoff AI exchanges. Chat access and staff
mutations are audited without message bodies; metadata such as timestamps and
conversation IDs is not encrypted. Customers can close a conversation; archived
conversations are no longer visible to counter staff. This does not encrypt
existing orders, customer profiles, delivery records, operational logs or other
application PII. Those existing schemas use searchable plaintext and require a
separate inventory, migration, key-management and recovery plan before an
application-wide encryption claim can be made.

## Tests

`npx tsx scripts/test-chat.ts` checks encryption, tamper detection, RLS,
redaction, handoff boundaries and the mocked AI request. For an HTTP test only
against a disposable local PGlite instance, start the dev server with a test
key and run `python3 scripts/test-chat-http.py`. It creates and closes a chat
and uses the seeded demo staff accounts. Never use that script against a live
database. A production-like security review and live-provider integration test
remain necessary.
