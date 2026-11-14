# Getting the Meta system-user token and the WhatsApp catalog ID

Short version:

- **Token** — generate it in Meta, paste it into **Admin → WhatsApp Business** (or Vercel). It never
  needs to be typed into a chat, a ticket or a commit.
- **Catalog ID** — you do not have to find it. Press **Find my catalog** in **Admin → Marketing →
  Integration diagnostics** and the app asks Meta.

---

## 1. Permanent system-user token

A token from the *API setup* page expires in about 24 hours. That is what broke sending here. A
**system-user** token does not expire (it stays valid until you revoke it).

1. Open **https://business.facebook.com/settings/system-users**
   (Business settings → Users → System users).
2. **Add** a system user if there isn't one: name it `khanbaba-automation`, role **Admin**.
3. Select the system user → **Add assets**:
   - **Apps** → your Meta app → **Full control**
   - **WhatsApp accounts** → your WABA → **Full control**
   - **Catalogs** → your catalog → **Manage catalog** (needed to publish dishes)
4. Click **Generate new token**.
5. Choose the app, set expiry to **Never**, and tick:
   - `whatsapp_business_messaging` — send and receive messages
   - `whatsapp_business_management` — templates, phone numbers, catalog connection
   - `business_management` — read the business account and catalogs
   - `catalog_management` — create and update catalog products
6. Copy the token **once** — Meta will not show it again.

### Where to paste it

Pick **one** place. Two places is the bug that caused error 190: a hidden Vercel variable silently wins
over the value in the database.

| Where | Good when | Then |
| --- | --- | --- |
| **Admin → WhatsApp Business → Access token** | you want to rotate keys without a deploy | set *Credential source* to **Use admin portal** |
| **Vercel → Settings → Environment Variables → `WHATSAPP_ACCESS_TOKEN`** | you want it in infrastructure, not in the DB | redeploy, leave *Credential source* on **Auto** |

Then: **Admin → Marketing → Integration diagnostics → Test live connection**.

- `Connected as <business name>` → done.
- `Authentication Error` (code 190) → the token is wrong, expired, or the *other* source is winning.
  The diagnostics table shows which source each credential came from and flags overrides.

---

## 2. Catalog ID

The catalog ID is the one value that is hard to find by clicking around: it is not on the API setup
page, it is not the WABA id, and in Commerce Manager it is only visible in the URL of a page you must
already be on.

**The app can read it for you.** It is an attribute of the business account:

```
GET /{WABA_ID}?fields=id,name,product_catalogs
GET /{WABA_ID}/product_catalogs
```

**Admin → Marketing → Integration diagnostics → Find my catalog** does exactly that, lists every catalog
the token can see, marks the one already connected, and saves the one you pick with **Use this**.

If Meta returns nothing, the catalog does not exist yet. Create it:

1. **https://business.facebook.com/commerce** → **Add catalog**
   - Name: `Khan Baba Menu`
   - Type: **Online products** (e-commerce)
   - Currency: **AUD**
2. Open the catalog → **Settings** → **Catalog ID** (shown as **Content ID**).
   Also visible as the digits in the URL: `business.facebook.com/commerce/catalogs/<ID>/products`.
3. **WhatsApp Manager → Account tools → Catalog → Choose catalog → Connect catalog.**
   One catalog per WhatsApp business account — this is the step that makes it usable in chat.
4. Turn on **Show catalog icon in chat header** and **Show "Add to cart" button**.
5. Paste the ID into the diagnostics panel, or **Admin → WhatsApp Business → WhatsApp Catalogue ID**.

### Then publish the menu

With the token and catalog ID in place: **Admin → WhatsApp Business → Publish catalogue**. Each dish
goes to Meta as a product (`retailer_id = kb-item-<id>`, price in the catalog currency, availability
derived from stock). The result per dish is written to `channel_publications`, so a rejected product is
visible rather than silently missing.

> **Note on images.** Meta requires a publicly reachable HTTPS image per product. Dishes with only a
> local path fall back to the site's stock photo. Upload real photos in **Admin → Menu** before
> publishing for a proper catalog.

---

## Business details in this install

| Field | Value |
| --- | --- |
| Kitchen | 1/53 Bulolo Dr, Whalan NSW 2770 |
| Coordinates | -33.757, 150.804 |
| Phone | 0461 382 923 |
| WhatsApp business number (sender) | +61 410 913 853 |
| Counter / staff notifications | 0461 382 923 |

`whatsapp_display_number` is the number customers see and tap; `whatsapp_counter_number` is the staff
line that receives each new order. They are different on purpose — the business number is the Cloud API
sender, and the personal line is where the team actually watches for orders.
