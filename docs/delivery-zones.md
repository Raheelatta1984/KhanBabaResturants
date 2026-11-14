# Delivery zones

Delivery pricing and serviceability are read from Postgres, not from code and not from a hash of the
address.

## Why this exists

The app used to bound delivery with `delivery_radius_km` alone — a straight line from the kitchen — and
when no courier partner could quote it priced the job with a **deterministic hash of the address**
across roughly 1–10 km. Two consequences:

- **2770 (Mount Druitt) priced like 2000 (the CBD).** One is ~40 km from the kitchen.
- **Nothing could say "we do not deliver there."** Every address got a number.

## The table

`delivery_zones` holds one row per area:

| Column            | Meaning                                                  |
| ----------------- | -------------------------------------------------------- |
| `postcodes`       | CSV of 4-digit postcodes. This is the serviceable area.  |
| `base_fee_cents`  | Flat fee for the zone                                    |
| `per_km_cents`    | Plus distance from the kitchen, **for geocoded pins only** |
| `min_order_cents` | Minimum order in the zone                                |
| `free_over_cents` | Free delivery over this subtotal (`0` = never)           |
| `eta_minutes`     | The promise quoted on the confirmation                   |
| `max_radius_km`   | Second guard, applied only to a real geocoded pin        |

Seeded Sydney coverage:

| Zone                        | Fee                                | Min  | Free over | ETA |
| --------------------------- | ---------------------------------- | ---- | --------- | --- |
| CBD & Inner City            | $2.99 flat                         | $20  | $60       | 25m |
| Inner West & Eastern Subs   | $3.99 + $1.20/km                   | $25  | $75       | 35m |
| Western Sydney              | $4.99 + $1.50/km                   | $30  | $90       | 45m |
| Mount Druitt & 2770         | $6.99 + $1.75/km                   | $35  | $120      | 55m |

## Rules the code enforces

1. **A live courier quote always wins.** The zone card only answers when no partner could quote.
2. **The postcode decides serviceability**, not the distance estimate. A radius test against a
   randomly-estimated pin would refuse valid addresses (a Pyrmont order 2 km away "measuring" 11 km).
3. **Distance is only charged on a real pin.** Without geocoded coordinates the customer sees the zone's
   flat fee — a number staff can quote at the counter — instead of a fee that changes with the spelling
   of their street. `orders.delivery_coords_verified` records which kind of pin an order has, so a
   re-quote at dispatch never prices an estimate.
4. **`delivery_zones_strict = 1`** refuses any postcode not on a zone list. The seeded install sets this,
   because its list is complete. An install that has not filled its zones in keeps the permissive
   default and prices on the kitchen radius with a note saying so.

## Sanity checks

- `quotes` from `lib/delivery/zones.ts` are covered in `scripts/test-pg.ts` ("Delivery zones" section):
  the CBD is serviceable, 2770 is serviceable **and costs more**, 2481 is refused with a readable
  reason, free delivery triggers above the threshold, and an unserved address cannot be quoted at all.
- Admin → Marketing → Integration diagnostics lists every zone and its rate from the live database.
