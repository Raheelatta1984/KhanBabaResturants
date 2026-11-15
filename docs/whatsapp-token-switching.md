# WhatsApp credentials: which token, from where

Two problems kept sending into limbo:

1. **A stale Vercel variable beat a good token saved in the portal.** The portal
   showed a green "configured" tick, and Meta answered `Authentication Error`
   (code 190). Nothing on screen said which token was actually used.
2. **The catalogue id could not be found.** It is not the WABA id, not on the API
   setup page, and in Commerce Manager it only appears inside a URL.

Both are now answerable from **Admin → Marketing → Integration diagnostics**.

---

## The one button that answers "which token works?"

Press **Which token works?**. It takes every token the app can see — the portal
value and both Vercel aliases — and makes one read-only call per candidate:

```
GET https://graph.facebook.com/v21.0/{phone_number_id}?fields=verified_name
```

You get a table like this:

| Token from | Value | Result |
|---|---|---|
| Admin portal | ••••9f2a | rejected — Authentication Error |
| `WHATSAPP_ACCESS_TOKEN` | ••••1111 | **accepted** — Khan Baba |
| `WHATSAPP_ACCESS_TOKEN_NEW` | ••••2222 | rejected — Authentication Error |

If one works, an **Apply** button switches the app to it. If none works, it says
so plainly: *"Every token was rejected with 190, so the problem is not which
token you pick — all of them are invalid."* That is the difference between a
five-minute fix and an afternoon of guessing.

Nothing is written until you press **Apply**. The probe never sends a message.

---

## Two independent switches

### 1. Which source wins

| Button | Meaning |
|---|---|
| **Use admin portal** | The value in Admin → WhatsApp Business wins. Best when you rotate tokens in the portal. |
| **Use Vercel env** | The Vercel variable wins. Best when you manage secrets in Vercel. |
| **Auto** | Vercel wins when a variable is set, otherwise the portal value. The historical behaviour. |

### 2. Which Vercel variable the token comes from

| Button | Variable |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | The original. |
| `WHATSAPP_ACCESS_TOKEN_NEW` | The spare. |

**Why a spare alias exists:** rotating a Meta token used to mean editing the one
variable the app reads — mid-deploy, with no way to try the new token without
breaking the live one, and no way to roll back except another deploy. Now the
swap is a setting:

1. Save the new token into `WHATSAPP_ACCESS_TOKEN_NEW` in Vercel (keep the old one).
2. Redeploy so the variable exists.
3. Press **WHATSAPP_ACCESS_TOKEN_NEW**, then **Which token works?**.
4. If it is accepted, you are done. If not, press **WHATSAPP_ACCESS_TOKEN** — one
   click, no deploy, no downtime.

The old variable stays as your rollback until you are satisfied.

### Per field, if you want to mix

The credential table has a **Read from** column: *Follow global / Vercel / Portal*
for each value. So "token from the portal, catalogue id from Vercel" is
expressible — which matters, because the catalogue id is often already in Vercel
while the token lives in the portal.

---

## Where the catalogue id comes from

The catalogue id (Meta calls it **Content ID**) identifies the product catalogue
that WhatsApp shows in the chat. Three routes, easiest first:

### A. Create it from the portal (new)

Press **Create catalogue** on the catalogue card. The app calls:

```
POST /{business_id}/owned_product_catalogs   { name, vertical: "commerce" }
POST /{waba_id}/product_catalogs             { catalog_id }
```

…then saves the returned id automatically. You never copy anything out of a URL.

This needs two things:
- the token must have the **`catalog_management`** scope
- `WHATSAPP_BUSINESS_ID` must be set — the **business portfolio id** from
  *Business settings → Business info → ID*. It is **not** the WABA id.

### B. Find an existing one

Press **Find my catalog**. It asks Meta which catalogues the business account can
already use, shows which one is already connected, and offers **Use this**.

### C. By hand in Meta

1. `business.facebook.com/commerce` → **Add catalogue** → *Online products*, AUD.
2. The **Catalog ID** is the digits in the URL (`/catalog/1234567890/...`) or the
   **Content ID** in the catalogue's settings. It is not the WABA id.
3. `business.facebook.com/wa-manager` → **Account tools → Catalog** →
   **Connect catalogue**.
4. Paste the id into the portal, then confirm with **Find my catalog**.

---

## Settings this uses

All additive; nothing existing is overwritten.

| Key | Meaning |
|---|---|
| `whatsapp_credential_mode` | `auto` / `env` / `settings` |
| `whatsapp_env_alias` | `primary` / `new` — which Vercel variable holds the token |
| `whatsapp_source_<field>` | Per-field override, e.g. `whatsapp_source_catalogId = env` |
| `whatsapp_verified_token` | `<alias>:<last four>` of the token last accepted by Meta |
| `whatsapp_verified_at` | When that happened |
| `whatsapp_catalog_id` | The catalogue id |
| `whatsapp_business_id` | The business portfolio id (only needed to create a catalogue) |

`whatsapp_verified_token` stores the last four characters only — enough to say
"this is the token that worked", never enough to send a message with it.

---

## Safety rules this keeps

- Every secret is masked to its last four characters before it leaves the server.
- The probe is read-only: one `GET` per candidate token, no messages sent.
- Nothing is written until you press a button.
- A token is only ticked **proven** when the stored fingerprint matches the token
  actually in use — a tick against a token you are not sending with would be a lie.
