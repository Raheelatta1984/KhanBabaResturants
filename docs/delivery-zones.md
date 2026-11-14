# Delivery zones

Delivery pricing and serviceability are read from Postgres — not from code, and not from a hash of the
address.

## The kitchen

**1/53 Bulolo Dr, Whalan NSW 2770** — `-33.757, 150.804`.

This matters more than it looks. The install was originally seeded as *Shop 4, 379 Pitt Street, Sydney
2000*, and `SYDNEY_CBD` was hardcoded as the origin for estimated delivery pins in six modules. Every
un-geocoded order therefore got a pin around the CBD, **39 km east of the actual fryer**, and the whole
delivery radius was measured from the wrong city.

Fixed in this release:

- `lib/geo.ts` exports `KITCHEN_FALLBACK` (Whalan) instead of the CBD.
- `createOrder` and `/api/quote` centre the estimate on **the kitchen in settings**, not a constant.
- `/api/quote` no longer fabricates a pin at all — only a coordinate the browser actually geocoded is
  passed to the quote.

## The table

`delivery_zones` holds one row per area:

| Column            | Meaning                                                     |
| ----------------- | ----------------------------------------------------------- |
| `postcodes`       | CSV of 4-digit postcodes. This is the serviceable area.     |
| `base_fee_cents`  | Flat fee for the zone                                       |
| `per_km_cents`    | Plus distance from the kitchen, **for geocoded pins only**  |
| `min_order_cents` | Minimum order in the zone                                   |
| `free_over_cents` | Free delivery over this subtotal (`0` = never)              |
| `eta_minutes`     | The promise quoted on the confirmation                      |
| `max_radius_km`   | Second guard, applied only to a real geocoded pin           |

Seeded around the Whalan kitchen:

| Zone | Postcodes | Fee | Min | Free over | ETA |
| --- | --- | --- | --- | --- | --- |
| Whalan & Mount Druitt | 2770 | $2.99 flat | $20 | $50 | 25m |
| Blacktown & St Marys | 2760–2768, 2148, 2777 | $3.99 + $1.20/km | $25 | $70 | 35m |
| Penrith & Nepean | 2747–2751, 2759, 2769, 2773–2776 | $4.99 + $1.50/km | $30 | $90 | 45m |
| Parramatta & Western Sydney | 2140–2166 | $5.99 + $1.75/km | $35 | $110 | 55m |

**Sydney CBD (2000/2009) is deliberately not served** — it is 39 km from this kitchen. The tests assert
that, so a future edit cannot quietly re-add it.

## Rules the code enforces

1. **A live courier quote always wins.** The zone card only answers when no partner could quote.
2. **The postcode decides serviceability**, not the distance estimate. A radius test against a
   randomly-estimated pin would refuse valid addresses.
3. **Distance is only charged on a real pin.** Without geocoded coordinates the customer sees the zone's
   flat fee — a number staff can quote at the counter — instead of a fee that changes with the spelling
   of their street. `orders.delivery_coords_verified` records which kind of pin an order has, so a
   re-quote at dispatch never prices an estimate.
4. **`delivery_zones_strict = 1`** refuses any postcode not on a zone list. This install sets it,
   because the list is complete.

## Sanity checks

`npm run test:pg` covers, in the "Delivery zones" section: 2770 is served and resolves to the local zone,
a verified pin near the kitchen measures under 5 km, Blacktown costs more than Whalan, Parramatta is
served, Byron Bay is refused with a readable reason, **the Sydney CBD is refused**, free delivery
triggers above the threshold, and an unserved address cannot be quoted at all.

Admin → Marketing → Integration diagnostics lists every zone and its live rate from the database.
