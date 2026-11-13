import type { Db } from "./db";

export type PriceCartLine = { variantId: number; qty: number };

export type PricedLine = {
  variantId: number;
  itemId: number;
  name: string;
  slug: string;
  priceCents: number;
  qty: number;
  lineTotalCents: number;
};

/** Server-side cart pricing — never trust totals sent by the browser. */
export function priceCart(db: Db, lines: PriceCartLine[]): { lines: PricedLine[]; subtotalCents: number } {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("Your cart is empty");
  if (lines.length > 40) throw new Error("Too many items in one order");

  const stmt = db.prepare(
    `SELECT iv.id AS variant_id, iv.price_cents, iv.active AS variant_active,
            mi.id AS item_id, mi.name, mi.slug, mi.is_available, mi.published
     FROM item_variants iv JOIN menu_items mi ON mi.id = iv.item_id WHERE iv.id = ?`,
  );

  const priced = lines.map((line) => {
    const qty = Math.floor(Number(line.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 30) throw new Error("Invalid quantity in cart");
    const row = stmt.get(Number(line.variantId)) as
      | {
          variant_id: number;
          price_cents: number;
          variant_active: number;
          item_id: number;
          name: string;
          slug: string;
          is_available: number;
          published: number;
        }
      | undefined;
    if (!row) throw new Error("An item in your cart is no longer on the menu");
    if (!row.published || !row.is_available || !row.variant_active) {
      throw new Error(`${row.name} is currently unavailable`);
    }
    return {
      variantId: row.variant_id,
      itemId: row.item_id,
      name: row.name,
      slug: row.slug,
      priceCents: row.price_cents,
      qty,
      lineTotalCents: row.price_cents * qty,
    };
  });

  return { lines: priced, subtotalCents: priced.reduce((sum, line) => sum + line.lineTotalCents, 0) };
}
