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

**Sign in with your own staff login.** The demo logins that ship with the seed data share one password, and that
password is printed in this repository's README, so it must not be in use on the live site. If it still is, the
Operational log (`/admin/logs`) shows a critical finding, `SEC_DEMO_PASSWORD`, naming the accounts. To retire them all
in one step: **Admin → Users & access → Remove demo credentials**. That step also switches off every other login still
on the demo password, so do it at a quiet moment, then reset each of those passwords and enable the accounts again.

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

Sign in at `https://khanbabaresturants.vercel.app/staff/login` as an administrator or manager. Both are then one
click from every staff screen, in three places.

| I want to… | Click | Address |
|---|---|---|
| Open the Marketing console | top bar **Marketing** · sidebar **Marketing → Marketing & social** · Command centre tile | `/admin/marketing` |
| See the next 7 days of posts | sidebar **Marketing → Content calendar** | `/admin/marketing#content-calendar` |
| Find out which WhatsApp token works | sidebar **Marketing → Integration diagnostics** | `/admin/marketing#integration-diagnostics` |
| Enter Facebook and Instagram credentials | the **Credentials** button at the top of the Marketing page | `/admin/marketing#credentials` |
| Know what is wrong and what to do about it | top bar **Logs** · sidebar **Operations → Operational log** | `/admin/logs` |
| See what was done, by whom, and whether it worked | **Logs → Action log** | `/admin/logs?view=actions` |
| See which version is running | the footer of any page, beside your name in the staff bar, or | `/api/health` |
| See what changed in each version | sidebar **Catalogue → What's new** | `/admin/whats-new` |

On a phone or a tablet the sidebar is behind the **Admin menu** button at the top of each admin page. The top bar
links are always visible.

### If a change does not appear

1. Read the version in the footer, or open `/api/health` and read `build`. That is what the server is running.
2. Compare it with the newest entry on `/whats-new`. If the page is behind the build, `/api/health` lists the missing
   notes under `release.notesMissing` and the Operational log raises `REL_NOTES_UNPUBLISHED`.
3. If the build itself is old, the deployment did not happen: check Vercel → Deployments for the commit.

How this went wrong before, so it is recognisable if it happens again: the sidebar rendered its links as one run-on
paragraph, Marketing and the log were missing from the top bar and the Command centre, two Marketing links pointed at
sections that did not exist, release notes were read from a folder that is not present on the live server, and no
screen said which version was running. `scripts/test-pg.ts` now fails if a page exists that the navigation does not
link to, or if a link names a section its page does not have.
