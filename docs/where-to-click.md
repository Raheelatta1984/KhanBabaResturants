# Where to click: WhatsApp token and catalogue

A map of the screens, in the order worth visiting.

---

## 1. The token check

**URL**

```
https://khanbabaresturants.vercel.app/staff/login
```

Sign in as **admin**, then go to:

```
https://khanbabaresturants.vercel.app/admin/marketing
```

Scroll to the bottom of that page. The card is headed **"Integration diagnostics"**.

Press **Which token works?**

You will get a table like this:

| Token from | Value | Result |
|---|---|---|
| Admin portal | ••••9f2a | rejected — Authentication Error |
| `WHATSAPP_ACCESS_TOKEN` | ••••1111 | **accepted** — Khan Baba |
| `WHATSAPP_ACCESS_TOKEN_NEW` | ••••2222 | rejected — Authentication Error |

- **One accepted** → press **Apply**. Done.
- **None accepted** → every token is invalid. Generate a new System User token;
  the screen tells you this in those words rather than making you guess.

**Sign-in details (demo accounts, still active):**

| Email | Password |
|---|---|
| `admin@khanbaba.com.au` | `KhanBaba2026!` |
| `manager@khanbaba.com.au` | `KhanBaba2026!` |

> If the password is refused, an admin has since changed it in
> Admin → Staff. Use your own login.

The same screen has the other two switches:
`Auto` / `Use Vercel env` / `Use admin portal`, and the two token-variable buttons.

---

## 2. The catalogue

On the **same page**, under **"WhatsApp catalogue"**.

**Press "Create catalogue"** — the app creates it on Meta and connects it to
WhatsApp in one step, then saves the id itself.

What it needs, and what the screen says if it is missing:

| Requirement | Where it comes from |
|---|---|
| `catalog_management` scope on the token | Add it when generating the token |
| `WHATSAPP_BUSINESS_ID` | **Business portfolio id** — *Business settings → Business info → ID* |

That id is **not** the WhatsApp Business Account ID, and confusing the two is the
most common mistake on this screen.

If a catalogue already exists, press **Find my catalog** instead. It lists what
the business owns and offers **Use this**.

---

## 3. Where the ids actually come from

All of these are on Meta's side, not ours.

| What | URL | Where on the page |
|---|---|---|
| System User token | `business.facebook.com/settings/system-users` | System user → **Generate token** → expiry **Never** |
| Business portfolio id | `business.facebook.com/settings/business-info` | **ID** field |
| WhatsApp Business Account id | `business.facebook.com/wa-manager` | **Account tools → Account info** |
| Phone number id | `developers.facebook.com/apps` → your app → WhatsApp → API setup | **Phone number ID** |
| Catalogues | `business.facebook.com/commerce` | Catalogue list; the id is in the URL and as **Content ID** |
| Connect a catalogue | `business.facebook.com/wa-manager` | **Account tools → Catalog → Connect catalogue** |

### Token scopes worth choosing

When generating the System User token, tick all four:

- `whatsapp_business_messaging` — send and receive messages
- `whatsapp_business_management` — read the account, phone numbers, catalogue link
- `business_management` — read the portfolio
- `catalog_management` — **create** a catalogue, not just connect one

Without the last one, "Create catalogue" is unavailable and the screen says so.

---

## 4. The content calendar

**URL**

```
https://khanbabaresturants.vercel.app/admin/marketing
```

The calendar itself is a file in the repo:

```
marketing/content_calendar.md
```

and is also readable at:

```
https://khanbabaresturants.vercel.app/api/ops/marketing/calendar?format=md
```

(signed in as admin or manager).

To regenerate it after a menu change:

```bash
npm run marketing:calendar
```

The file header says it is generated, because a hand-edited copy gets silently
overwritten the next time the command runs.

## Marketing and the operational log

| I want to… | Click |
|---|---|
| Change how the restaurant talks on Instagram | **Marketing → Marketing & social** (`/admin/marketing`) |
| Find out which WhatsApp token actually works | **Marketing → Integration diagnostics** |
| See the next 7 days of posts | **Marketing → Content calendar** |
| Know what is wrong and what to do about it | **Operational log** (`/admin/logs`) |

The Marketing console had no sidebar link until v3.6.0 — the page existed at
`/admin/marketing` but the only way in was typing the URL. That is fixed.
