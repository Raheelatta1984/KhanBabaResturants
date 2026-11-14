# WhatsApp Business — getting the credentials and going live

This is the end-to-end runbook for switching the WhatsApp channel from **sandbox** to **live**: what to
create in Meta, which five values the app needs, where to put them in Vercel, and how to prove it works
before a real customer sees it.

The app never needs anything else. Every message — sent or received — is still written to
`whatsapp_messages` and shown in **Admin → WhatsApp Business**, whether the channel is live or sandbox.

---

## The five values, at a glance

| Variable                    | Required? | Where it comes from                                          | What it does                                              |
| --------------------------- | --------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| `WHATSAPP_PHONE_NUMBER_ID`  | **yes**   | Meta → WhatsApp → **API setup** → "Phone number ID"          | The business number every message is sent *from*          |
| `WHATSAPP_ACCESS_TOKEN`     | **yes**   | Meta → **System user** → permanent token                     | Authenticates every Cloud API call                        |
| `WHATSAPP_VERIFY_TOKEN`     | **yes**   | You choose it (a passphrase)                                 | Confirms the webhook handshake with Meta                  |
| `WHATSAPP_APP_SECRET`       | **yes**   | Meta → App settings → **Basic** → App secret                 | Verifies `X-Hub-Signature-256` on every inbound webhook   |
| `WHATSAPP_CATALOG_ID`       | for menu  | Commerce Manager → **Catalogue** → Settings → Catalogue ID   | Publishes the menu as WhatsApp products                   |

Optional, not secrets, and normally set in **Admin → WhatsApp Business** instead:

| Setting                                  | Purpose                                                       |
| ---------------------------------------- | ------------------------------------------------------------- |
| `WHATSAPP_COUNTER_NUMBER`                | The staff phone that is notified of each new order            |
| `WHATSAPP_DISPLAY_NUMBER`                | The public number used for the `wa.me` chat link and QR codes |
| `WHATSAPP_BUSINESS_ACCOUNT_ID`           | Only needed for WABA-level API calls (catalogue, templates)   |

The channel turns **live** as soon as *phone number id* **and** *access token* are present. The other
three are needed for a complete, secure setup: without a verify token Meta cannot subscribe the webhook,
without the app secret signatures are accepted unchecked, and without the catalogue id the menu cannot
be published.

> **Where the app reads them:** Vercel environment variables first, then the settings saved in the portal
> (stored in the database). Vercel wins when both exist. The checklist inside **Admin → WhatsApp
> Business** shows each value as *Vercel env*, *portal setting* or *missing*, and never prints the value
> itself.

---

## Step 1 — Create the Meta app

1. Go to <https://developers.facebook.com/apps> and sign in with the Facebook account that manages the
   Khan Baba Page and Business Manager.
2. **Create app** → use case **Other** → type **Business** → name it `Khan Baba Restaurant` → attach the
   Khan Baba Business portfolio if you have one.
3. In the app dashboard, find **WhatsApp** in the products list and press **Set up**. This creates (or
   attaches) a WhatsApp Business Account and gives you a free **test number** immediately.

You now have a working sandbox number you can message from your own phone. The app is still in **test
mode**: only numbers you add under *API setup → To* can receive messages, and only approved templates
can start a conversation.

## Step 2 — Collect the phone number id

**WhatsApp → API setup** shows a *From* number and, directly beneath it, a **Phone number ID** — a long
number such as `123456789012345`. That is `WHATSAPP_PHONE_NUMBER_ID`.

Copy the *Phone number ID*, not the phone number itself. They look nothing alike, and using the phone
number is the single most common setup mistake.

If you later add the restaurant's real number (Step 8), the number id changes — update the variable.

## Step 3 — Create a permanent access token

The token on the API setup page is a **temporary** 24-hour token. Do not put it in Vercel; it will expire
and the channel will fall back to sandbox without warning.

1. Go to **business.facebook.com → Business settings → Users → System users**.
2. **Add** a system user named `Khan Baba server`, role **Admin**.
3. **Add assets** → *Apps* → your app → **Full control**; and *WhatsApp accounts* → your WABA → **Full
   control**. Add the catalogue too if you will publish the menu.
4. With the system user selected, press **Generate new token**, choose the app, and tick:
   - `whatsapp_business_messaging` — send and receive messages
   - `whatsapp_business_management` — phone numbers, templates, catalogue connection
   - `catalog_management` — create/update catalogue products (only if you publish the menu)
5. Set the expiry to **Never** and copy the token. It is shown once.

That value is `WHATSAPP_ACCESS_TOKEN`. Treat it like a password: it can send messages as the business.

## Step 4 — Choose a verify token

The verify token is not issued by Meta — you invent it, and the same string is typed in two places. Any
long random string works. To generate one:

```bash
openssl rand -hex 24
```

Use that as `WHATSAPP_VERIFY_TOKEN` in Vercel **and** in the webhook form in Step 6. If the two differ,
Meta's "Verify and save" fails with a generic error and no webhook events ever arrive.

## Step 5 — Copy the app secret

**App settings → Basic** in the Meta dashboard shows **App secret** (press *Show*). That is
`WHATSAPP_APP_SECRET`.

Every inbound webhook is signed with it; the app recomputes the HMAC-SHA256 of the raw body and compares
it in constant time. If the secret is missing the app still accepts the delivery (so a first setup is not
blocked), but anything that can reach the URL could then create orders — set it before going public.

## Step 6 — Point the webhook at Vercel

1. In the Meta app: **WhatsApp → Configuration → Webhook → Edit**.
2. **Callback URL:** `https://khanbabaresturants.vercel.app/api/webhooks/whatsapp`
   (or your own domain, if you have attached one — either way it must be the public HTTPS URL, not
   localhost).
3. **Verify token:** the exact string from Step 4.
4. Press **Verify and save**. Meta calls the URL with `hub.mode=subscribe`; the app answers with the
   challenge when the token matches.
5. Press **Manage** next to the webhook and subscribe to the **messages** field. Without that
   subscription the handshake succeeds but no message is ever delivered.

You can see the handshake in action at any time:

```bash
curl "https://khanbabaresturants.vercel.app/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=hello"
# → hello
```

## Step 7 — Connect the catalogue (for menu publishing)

1. Go to **business.facebook.com → Commerce Manager** and open (or create) the Khan Baba catalogue.
2. **Settings → Catalogue ID** — a long number. That is `WHATSAPP_CATALOG_ID`.
3. **Settings → Catalog → Connected assets**, or in the Meta app under **WhatsApp → Settings → Commerce**,
   connect the catalogue to the WhatsApp Business Account.
4. In the portal, **Admin → WhatsApp Business → Publish whole menu**.

With no credentials the publish is recorded as a **sandbox** publication (`sandbox-kb-item-<id>`) with the
exact product payload, so the mapping can be reviewed before anything is public.

## Step 8 — Add the restaurant's real number (when ready)

The test number cannot be shown to customers. To use the real number:

1. **WhatsApp → API setup → Add phone number**, verify the number by SMS/voice, and complete the display
   name review.
2. Add a **payment method** to the WhatsApp Business Account (Meta bills per conversation).
3. Complete **Business verification** in Business Manager (ABN/business documents). Until the business is
   verified, messaging is capped at the test-mode limits and the number cannot message arbitrary
   customers.

Note the new **Phone number ID** after verification and update `WHATSAPP_PHONE_NUMBER_ID`.

## Step 9 — Put the values in Vercel

Either in the dashboard or with the CLI. **All five go to Production, Preview and Development**, as
`Sensitive`.

**Dashboard:** Project `khanbabaresturants` → **Settings → Environment Variables** → *Add new* → paste the
key and value → tick all three environments → **Save**.

**CLI:**

```bash
npm i -g vercel
vercel login
vercel link                      # choose the khanbabaresturants project

printf '%s' "$VALUE" | vercel env add WHATSAPP_PHONE_NUMBER_ID production
printf '%s' "$VALUE" | vercel env add WHATSAPP_ACCESS_TOKEN production
printf '%s' "$VALUE" | vercel env add WHATSAPP_VERIFY_TOKEN production
printf '%s' "$VALUE" | vercel env add WHATSAPP_APP_SECRET production
printf '%s' "$VALUE" | vercel env add WHATSAPP_CATALOG_ID production
# repeat with `preview` and `development`, or add them once in the dashboard for all three
```

**Environment variables only take effect on a new deployment.** After saving, redeploy:

```bash
vercel --prod
```

or push any commit to `main` — Vercel builds and promotes automatically.

The five variables already exist in the project (empty, ready to fill). Only `WHATSAPP_VERIFY_TOKEN` is
pre-filled with a generated passphrase — use that same string in Meta's webhook form.

> **Demo data warning.** The seeded dataset sets placeholder numbers (`+61400000000` for the counter,
> `+61290001234` for the business). Replace both in **Admin → WhatsApp Business → Settings** with real
> numbers before launch, or the notification for the first live order goes to nobody.

## Step 10 — Prove it end to end

Work down this list; each step is one click unless noted.

1. **Admin → WhatsApp Business** — *Connection* should read **live credentials**, and the *Go-live
   variables* checklist should show all five as **Vercel env**.
2. Press **Test message**. The exact text appears in *Message log*; the status becomes `sent` (not
   `logged`) and the message arrives on the counter phone.
3. Press **Publish whole menu** — `channel_publications` rows turn `published` and the catalogue shows
   the dishes in Commerce Manager.
4. From a phone that is allowed to message the number, send `menu` — the catalogue card comes back and a
   conversation appears in *Conversations*.
5. Send `1 chicken biryani` — a ticket is created with source `whatsapp`, and the counter phone is
   notified.
6. On the counter board, accept the ticket and press **Send pay link**. The guest receives
   `/pay/<token>`; pay with a test card; the counter then accepts the paid ticket and it goes to the
   kitchen.
7. Set stock of any dish to `0` in the portal — the dish goes unavailable and the catalogue publishes it
   as out of stock.

## Step 11 — Message templates and the 24-hour window (know this before launch)

WhatsApp allows free-form replies only inside the **24-hour customer service window** — that is, within
24 hours of the customer's last message. Outside it, the business may only send an **approved template**.

The app handles this by replying to inbound messages, which is always inside the window. If you want
proactive messages (an order-ready nudge the next morning, a marketing broadcast), create a template in
**WhatsApp Manager → Message templates**, wait for approval, and send it with the template sender in
`lib/whatsapp/client.ts`.

## Troubleshooting

| Symptom                                            | Cause and fix                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Checklist still says **sandbox** after filling Vercel | No redeploy yet. Environment variables are captured at deployment time — redeploy, then reload the page.               |
| Meta webhook "Verify and save" fails                | `WHATSAPP_VERIFY_TOKEN` in Vercel differs from the form, or the deployment is not reachable yet. Try the `curl` in Step 6 first. |
| Handshake succeeded but no messages arrive          | The **messages** field is not subscribed (Step 6.5), or the sender is not an allowed test recipient while in test mode.     |
| `401` / `OAuthException` on send                    | The token expired (24-hour token instead of the System User token) or lacks `whatsapp_business_messaging`.                  |
| Messages send but the counter is never notified     | `WHATSAPP_COUNTER_NUMBER` is empty or in local format. Use E.164 digits, e.g. `+61412345678`.                              |
| Catalogue publish fails with a permissions error    | `catalog_management` is missing from the token, or the catalogue is not connected to the WABA.                              |
| Webhook deliveries rejected in the log              | `WHATSAPP_APP_SECRET` is wrong — copy it again from App settings → Basic.                                                   |

## Security notes

- The access token and app secret are secrets: Vercel-only, **Sensitive** type, never committed and never
  printed in the UI. The portal checklist reports presence, not values.
- Rotate the token immediately if it is ever pasted into a chat, ticket or screenshot: generate a new one
  on the system user, update Vercel, redeploy, then revoke the old one.
- The webhook is signature-checked on every delivery once `WHATSAPP_APP_SECRET` is set. Do not disable it.
- Payment links are single-use and expiring, and they never expose card details — the gateway handles the
  card, the portal only records the result.
