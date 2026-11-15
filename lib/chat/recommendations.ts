import { getMenuItems } from "@/lib/catalog";
import type { Db } from "@/lib/db";
import { money } from "@/lib/money";
import { getTimeParts } from "@/lib/time";
import type { ItemView, VariantView } from "@/lib/types";

export const RECENT_PURCHASE_LIMIT = 5;

export type SuggestedItem = {
  itemId: number;
  variantId: number;
  slug: string;
  name: string;
  tagline: string | null;
  categorySlug: string;
  categoryName: string;
  image: string;
  variantLabel: string;
  sizeMl: number | null;
  unitPriceCents: number;
  spice: string | null;
  spiceLevels: string[];
  isVeg: boolean;
  reason: string;
  orderedCount?: number;
};

export type CartSnapshotItem = {
  itemId: number;
  variantId?: number;
  qty?: number;
};

export type ChatSuggestionsPayload = {
  date: string;
  signedIn: boolean;
  recentOrderCount: number;
  dessertOfTheDay: SuggestedItem | null;
  drinkOfTheDay: SuggestedItem | null;
  menuSuggestions: SuggestedItem[];
  cartSuggestions: SuggestedItem[];
  quickAddCatalog: SuggestedItem[];
};

export type AiPersonalizationHint = {
  date: string;
  recentDishNames: string[];
  preferredCategories: string[];
  preferredSpice: string | null;
  vegetarianOnly: boolean;
  cartDishNames: string[];
  dessertOfTheDay: { name: string; price: string } | null;
  drinkOfTheDay: { name: string; price: string } | null;
};

type PurchaseLineRow = {
  order_id: number;
  created_at: string;
  item_id: number;
  variant_id: number;
  spice_level: string | null;
  qty: number;
};

type ItemHistoryStats = {
  itemId: number;
  orderIds: Set<number>;
  totalQty: number;
  firstOrderRank: number;
  variantCounts: Map<number, number>;
  spiceCounts: Map<string, number>;
};

const COMPLEMENTARY_CATEGORIES: Record<string, string[]> = {
  "karahi-curries": ["breads", "biryani-rice", "sides"],
  "biryani-rice": ["tandoor-bbq", "sides", "karahi-curries"],
  "tandoor-bbq": ["breads", "karahi-curries", "sides"],
  breads: ["karahi-curries", "tandoor-bbq", "sides"],
  burgers: ["sides", "tandoor-bbq"],
  sides: ["biryani-rice", "karahi-curries", "tandoor-bbq"],
};

function isDessertItem(item: ItemView): boolean {
  return item.categorySlug === "desserts" || /dessert/i.test(item.categoryName);
}

function isDrinkItem(item: ItemView): boolean {
  return item.categorySlug === "drinks" || /drink/i.test(item.categoryName);
}

function dayNumberFromIso(iso: string): number {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : 0;
}

function pickTopKey<K>(counts: Map<K, number>): K | null {
  let bestKey: K | null = null;
  let bestCount = -1;
  for (const [key, count] of counts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  return bestKey;
}

function pickVariant(item: ItemView, preferredVariantId?: number | null): VariantView | null {
  if (item.variants.length === 0) return null;
  if (preferredVariantId) {
    const matched = item.variants.find((v) => v.id === preferredVariantId);
    if (matched) return matched;
  }
  return item.variants.find((v) => v.isDefault) ?? item.variants[0] ?? null;
}

function pickSpice(item: ItemView, preferredSpice?: string | null): string | null {
  if (item.spiceLevels.length === 0) return null;
  if (preferredSpice) {
    const matched = item.spiceLevels.find(
      (level) => level.toLowerCase() === preferredSpice.toLowerCase(),
    );
    if (matched) return matched;
  }
  return item.spiceLevels[0] ?? null;
}

function toSuggestedItem(
  item: ItemView,
  reason: string,
  opts?: {
    preferredVariantId?: number | null;
    preferredSpice?: string | null;
    orderedCount?: number;
  },
): SuggestedItem | null {
  const variant = pickVariant(item, opts?.preferredVariantId);
  if (!variant) return null;
  return {
    itemId: item.id,
    variantId: variant.id,
    slug: item.slug,
    name: item.name,
    tagline: item.tagline,
    categorySlug: item.categorySlug,
    categoryName: item.categoryName,
    image: item.image,
    variantLabel: variant.label,
    sizeMl: variant.sizeMl,
    unitPriceCents: variant.priceCents,
    spice: pickSpice(item, opts?.preferredSpice),
    spiceLevels: item.spiceLevels,
    isVeg: item.isVeg,
    reason,
    ...(opts?.orderedCount !== undefined ? { orderedCount: opts.orderedCount } : {}),
  };
}

/** Sanitize client-supplied cart item IDs (numeric only, bounded to 40 items). */
export function parseCartSnapshot(input: unknown): CartSnapshotItem[] {
  if (typeof input === "string") {
    const parts = input
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    return [...new Set(parts)].slice(0, 40).map((itemId) => ({ itemId }));
  }
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const out: CartSnapshotItem[] = [];
  for (const entry of input) {
    if (out.length >= 40) break;
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as { itemId?: unknown; variantId?: unknown; qty?: unknown };
    const itemId = Number(raw.itemId);
    if (!Number.isSafeInteger(itemId) || itemId <= 0 || seen.has(itemId)) continue;
    seen.add(itemId);
    const variantId = Number(raw.variantId);
    const qty = Number(raw.qty);
    out.push({
      itemId,
      ...(Number.isSafeInteger(variantId) && variantId > 0 ? { variantId } : {}),
      ...(Number.isSafeInteger(qty) && qty > 0 && qty <= 30 ? { qty } : {}),
    });
  }
  return out;
}

async function fetchLastFivePurchaseLines(
  db: Db,
  customerId: number,
): Promise<{ recentOrderIds: number[]; lines: PurchaseLineRow[] }> {
  const recentOrders = await db.query<{ id: number }>(
    `SELECT id
     FROM orders
     WHERE customer_id = $1 AND status != 'cancelled'
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [customerId, RECENT_PURCHASE_LIMIT],
  );
  if (recentOrders.length === 0) {
    return { recentOrderIds: [], lines: [] };
  }

  const lines = await db.query<PurchaseLineRow>(
    `WITH recent_orders AS (
       SELECT id, created_at
       FROM orders
       WHERE customer_id = $1 AND status != 'cancelled'
       ORDER BY created_at DESC, id DESC
       LIMIT $2
     )
     SELECT ro.id AS order_id, ro.created_at, oi.item_id, oi.variant_id, oi.spice_level, oi.qty
     FROM recent_orders ro
     JOIN order_items oi ON oi.order_id = ro.id
     ORDER BY ro.created_at DESC, ro.id DESC, oi.id ASC`,
    [customerId, RECENT_PURCHASE_LIMIT],
  );
  return {
    recentOrderIds: recentOrders.map((row) => Number(row.id)),
    lines,
  };
}

function buildPurchaseProfile(
  recentOrderIds: number[],
  lines: PurchaseLineRow[],
  itemsById: Map<number, ItemView>,
) {
  const orderRank = new Map<number, number>();
  recentOrderIds.forEach((id, idx) => orderRank.set(id, idx));

  const itemStats = new Map<number, ItemHistoryStats>();
  const categoryCounts = new Map<string, number>();
  const overallSpiceCounts = new Map<string, number>();
  let observedCatalogItems = 0;
  let allVeg = true;

  for (const line of lines) {
    const itemId = Number(line.item_id);
    const orderId = Number(line.order_id);
    const variantId = Number(line.variant_id);
    const qty = Math.max(1, Number(line.qty) || 1);
    const rank = orderRank.get(orderId) ?? RECENT_PURCHASE_LIMIT;

    let stats = itemStats.get(itemId);
    if (!stats) {
      stats = {
        itemId,
        orderIds: new Set<number>(),
        totalQty: 0,
        firstOrderRank: rank,
        variantCounts: new Map<number, number>(),
        spiceCounts: new Map<string, number>(),
      };
      itemStats.set(itemId, stats);
    }
    stats.orderIds.add(orderId);
    stats.totalQty += qty;
    if (rank < stats.firstOrderRank) stats.firstOrderRank = rank;
    stats.variantCounts.set(variantId, (stats.variantCounts.get(variantId) ?? 0) + qty);

    const spice = (line.spice_level ?? "").trim();
    if (spice) {
      stats.spiceCounts.set(spice, (stats.spiceCounts.get(spice) ?? 0) + qty);
      overallSpiceCounts.set(spice, (overallSpiceCounts.get(spice) ?? 0) + qty);
    }

    const catalogItem = itemsById.get(itemId);
    if (catalogItem) {
      observedCatalogItems += 1;
      if (!catalogItem.isVeg) allVeg = false;
      if (!isDessertItem(catalogItem) && !isDrinkItem(catalogItem)) {
        categoryCounts.set(
          catalogItem.categorySlug,
          (categoryCounts.get(catalogItem.categorySlug) ?? 0) + qty,
        );
      }
    }
  }

  const rankedStats = [...itemStats.values()].sort((a, b) => {
    if (b.orderIds.size !== a.orderIds.size) return b.orderIds.size - a.orderIds.size;
    if (b.totalQty !== a.totalQty) return b.totalQty - a.totalQty;
    return a.firstOrderRank - b.firstOrderRank;
  });

  const topCategories = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([slug]) => slug);

  return {
    rankedStats,
    orderedItemIds: new Set(itemStats.keys()),
    topCategories,
    preferredOverallSpice: pickTopKey(overallSpiceCounts),
    vegetarianOnly: observedCatalogItems > 0 && allVeg,
  };
}

/** Pick deterministic Dessert of the Day & Drink of the Day for Sydney's calendar date. */
export function pickDailySpecials(
  availableItems: ItemView[],
  now: Date = new Date(),
): {
  date: string;
  dessertOfTheDay: SuggestedItem | null;
  drinkOfTheDay: SuggestedItem | null;
} {
  const { iso } = getTimeParts(now);
  const day = Math.abs(dayNumberFromIso(iso));

  const desserts = availableItems.filter(isDessertItem).sort((a, b) => a.id - b.id);
  const drinks = availableItems.filter(isDrinkItem).sort((a, b) => a.id - b.id);

  const dessertItem = desserts.length > 0 ? desserts[day % desserts.length] : null;
  const drinkItem = drinks.length > 0 ? drinks[day % drinks.length] : null;

  return {
    date: iso,
    dessertOfTheDay: dessertItem
      ? toSuggestedItem(dessertItem, "Dessert of the day")
      : null,
    drinkOfTheDay: drinkItem
      ? toSuggestedItem(drinkItem, "Drink of the day")
      : null,
  };
}

/**
 * Compute personalized menu & cart suggestions + Dessert/Drink of the Day.
 *
 * SECURITY: `customerId` MUST come strictly from a server-verified customer
 * session (`getCurrentCustomer(db)`), NEVER from browser parameters.
 * Returned payload contains zero customer PII (no name, email, phone, address,
 * customerId, or order codes/timestamps).
 */
export async function getChatSuggestions(
  db: Db,
  opts: {
    customerId: number | null;
    cart?: CartSnapshotItem[];
    now?: Date;
  },
): Promise<{ payload: ChatSuggestionsPayload; aiHint: AiPersonalizationHint }> {
  const allItems = await getMenuItems(db);
  const allItemsById = new Map<number, ItemView>(allItems.map((item) => [item.id, item]));
  const availableItems = allItems.filter(
    (item) => item.available && item.variants.length > 0,
  );
  const availableById = new Map<number, ItemView>(
    availableItems.map((item) => [item.id, item]),
  );

  const now = opts.now ?? new Date();
  const { date, dessertOfTheDay, drinkOfTheDay } = pickDailySpecials(availableItems, now);

  const signedIn = typeof opts.customerId === "number" && Number.isSafeInteger(opts.customerId) && opts.customerId > 0;
  const purchaseData = signedIn
    ? await fetchLastFivePurchaseLines(db, opts.customerId as number)
    : { recentOrderIds: [], lines: [] };
  const recentOrderCount = purchaseData.recentOrderIds.length;
  const profile = buildPurchaseProfile(
    purchaseData.recentOrderIds,
    purchaseData.lines,
    allItemsById,
  );

  const cart = parseCartSnapshot(opts.cart ?? []);
  const cartItemIds = new Set(cart.map((entry) => entry.itemId));
  const cartItemsResolved = cart
    .map((entry) => availableById.get(entry.itemId))
    .filter((item): item is ItemView => Boolean(item));
  const cartCategories = new Set(cartItemsResolved.map((item) => item.categorySlug));
  const cartHasDessert = cartItemsResolved.some(isDessertItem);
  const cartHasDrink = cartItemsResolved.some(isDrinkItem);

  const statsByItemId = new Map(profile.rankedStats.map((s) => [s.itemId, s]));

  // ---------------- 1. Menu suggestions (up to 4) ----------------
  const menuSuggestions: SuggestedItem[] = [];
  const menuPickedIds = new Set<number>();

  if (signedIn && recentOrderCount > 0) {
    // Up to 2 top available favourites from the customer's last 5 purchases
    for (const stats of profile.rankedStats) {
      if (menuSuggestions.length >= 2) break;
      const item = availableById.get(stats.itemId);
      if (!item || menuPickedIds.has(item.id)) continue;
      const orderCount = stats.orderIds.size;
      const reason =
        orderCount > 1
          ? `Ordered ${orderCount}× in your last ${recentOrderCount} orders`
          : recentOrderCount === 1
            ? "From your recent order"
            : `From your last ${recentOrderCount} orders`;
      const suggestion = toSuggestedItem(item, reason, {
        preferredVariantId: pickTopKey(stats.variantCounts),
        preferredSpice: pickTopKey(stats.spiceCounts) ?? profile.preferredOverallSpice,
        orderedCount: orderCount,
      });
      if (suggestion) {
        menuSuggestions.push(suggestion);
        menuPickedIds.add(item.id);
      }
    }

    // Up to 2 complementary / taste-matched dishes they have NOT ordered in those 5 orders
    const complementarySet = new Set(
      profile.topCategories.flatMap((slug) => COMPLEMENTARY_CATEGORIES[slug] ?? []),
    );
    const discoveryCandidates = availableItems
      .filter(
        (item) =>
          !menuPickedIds.has(item.id) &&
          !profile.orderedItemIds.has(item.id) &&
          !isDessertItem(item) &&
          !isDrinkItem(item) &&
          (!profile.vegetarianOnly || item.isVeg),
      )
      .map((item) => {
        let score = 0;
        let reason = "Recommended for your taste";
        if (profile.topCategories.includes(item.categorySlug)) {
          score += 5;
          reason = `Matches your ${item.categoryName} picks`;
        } else if (complementarySet.has(item.categorySlug)) {
          score += 3;
          reason = "Pairs well with your recent orders";
        }
        if (item.isFeatured) score += 2;
        score += Math.min(2, item.rating.avg / 2.5);
        return { item, score, reason };
      })
      .sort((a, b) => b.score - a.score || a.item.id - b.item.id);

    for (const candidate of discoveryCandidates) {
      if (menuSuggestions.length >= 4) break;
      const suggestion = toSuggestedItem(candidate.item, candidate.reason, {
        preferredSpice: profile.preferredOverallSpice,
      });
      if (suggestion) {
        menuSuggestions.push(suggestion);
        menuPickedIds.add(candidate.item.id);
      }
    }
  }

  // Fallback / guest / fill remaining menu suggestion slots with popular available mains/sides
  if (menuSuggestions.length < 4) {
    const popularPool = availableItems
      .filter(
        (item) =>
          !menuPickedIds.has(item.id) &&
          !isDessertItem(item) &&
          !isDrinkItem(item) &&
          (!profile.vegetarianOnly || item.isVeg),
      )
      .sort((a, b) => {
        if (Number(b.isFeatured) !== Number(a.isFeatured)) {
          return Number(b.isFeatured) - Number(a.isFeatured);
        }
        if (b.rating.avg !== a.rating.avg) return b.rating.avg - a.rating.avg;
        return a.id - b.id;
      });

    for (const item of popularPool) {
      if (menuSuggestions.length >= 4) break;
      const suggestion = toSuggestedItem(
        item,
        item.isFeatured ? "House favourite" : "Popular on the menu",
        { preferredSpice: profile.preferredOverallSpice },
      );
      if (suggestion) {
        menuSuggestions.push(suggestion);
        menuPickedIds.add(item.id);
      }
    }
  }

  // ---------------- 2. Cart suggestions (up to 4, never duplicating items already in cart) ----------------
  const cartSuggestions: SuggestedItem[] = [];
  const cartPickedIds = new Set<number>(cartItemIds);

  const pushCartSuggestion = (
    item: ItemView | undefined | null,
    reason: string,
    opts?: {
      preferredVariantId?: number | null;
      preferredSpice?: string | null;
      orderedCount?: number;
    },
  ) => {
    if (!item || cartPickedIds.has(item.id) || cartSuggestions.length >= 4) return;
    const suggestion = toSuggestedItem(item, reason, opts);
    if (suggestion) {
      cartSuggestions.push(suggestion);
      cartPickedIds.add(item.id);
    }
  };

  // Priority A: Signed-in customer's recent favourites not yet in cart (up to 2)
  if (signedIn && recentOrderCount > 0) {
    let addedFromHistory = 0;
    for (const stats of profile.rankedStats) {
      if (addedFromHistory >= 2 || cartSuggestions.length >= 4) break;
      const item = availableById.get(stats.itemId);
      if (!item || cartPickedIds.has(item.id)) continue;
      const reason =
        cartItemIds.size > 0
          ? `Often in your orders · add to cart`
          : `Start your cart · ordered recently`;
      pushCartSuggestion(item, reason, {
        preferredVariantId: pickTopKey(stats.variantCounts),
        preferredSpice: pickTopKey(stats.spiceCounts) ?? profile.preferredOverallSpice,
        orderedCount: stats.orderIds.size,
      });
      addedFromHistory += 1;
    }
  }

  // Priority B: Smart cart pairings based on what's in the cart right now
  const wantedPairingCategories: string[] = [];
  if (cartItemIds.size > 0) {
    if (
      (cartCategories.has("karahi-curries") || cartCategories.has("tandoor-bbq")) &&
      !cartCategories.has("breads")
    ) {
      wantedPairingCategories.push("breads");
    }
    if (
      (cartCategories.has("biryani-rice") ||
        cartCategories.has("karahi-curries") ||
        cartCategories.has("burgers")) &&
      !cartCategories.has("sides")
    ) {
      wantedPairingCategories.push("sides");
    }
    if (
      !cartCategories.has("biryani-rice") &&
      !cartCategories.has("karahi-curries") &&
      !cartCategories.has("tandoor-bbq") &&
      !cartCategories.has("burgers")
    ) {
      wantedPairingCategories.push("biryani-rice", "karahi-curries");
    }
  } else {
    wantedPairingCategories.push("biryani-rice", "breads");
  }

  for (const categorySlug of wantedPairingCategories) {
    if (cartSuggestions.length >= 4) break;
    const candidates = availableItems
      .filter(
        (item) =>
          item.categorySlug === categorySlug &&
          !cartPickedIds.has(item.id) &&
          (!profile.vegetarianOnly || item.isVeg),
      )
      .sort((a, b) => {
        const aHist = statsByItemId.get(a.id)?.orderIds.size ?? 0;
        const bHist = statsByItemId.get(b.id)?.orderIds.size ?? 0;
        if (bHist !== aHist) return bHist - aHist;
        if (Number(b.isFeatured) !== Number(a.isFeatured)) {
          return Number(b.isFeatured) - Number(a.isFeatured);
        }
        return b.rating.avg - a.rating.avg || a.id - b.id;
      });
    const best = candidates[0];
    if (best) {
      const hist = statsByItemId.get(best.id);
      pushCartSuggestion(
        best,
        cartItemIds.size > 0 ? "Pairs well with your cart" : "Great way to start your cart",
        {
          preferredVariantId: hist ? pickTopKey(hist.variantCounts) : null,
          preferredSpice:
            (hist ? pickTopKey(hist.spiceCounts) : null) ?? profile.preferredOverallSpice,
          orderedCount: hist?.orderIds.size,
        },
      );
    }
  }

  // Priority C: Include Drink of the Day & Dessert of the Day to round out the cart
  if (!cartHasDrink && drinkOfTheDay && !cartPickedIds.has(drinkOfTheDay.itemId)) {
    const drinkItem = availableById.get(drinkOfTheDay.itemId);
    pushCartSuggestion(
      drinkItem,
      cartItemIds.size > 0
        ? "Drink of the day · completes your order"
        : "Drink of the day",
    );
  }
  if (!cartHasDessert && dessertOfTheDay && !cartPickedIds.has(dessertOfTheDay.itemId)) {
    const dessertItem = availableById.get(dessertOfTheDay.itemId);
    pushCartSuggestion(
      dessertItem,
      cartItemIds.size > 0
        ? "Dessert of the day · sweet finish"
        : "Dessert of the day",
    );
  }

  // Fill any remaining cart suggestion slots with popular available items not in cart
  if (cartSuggestions.length < 4) {
    for (const item of availableItems) {
      if (cartSuggestions.length >= 4) break;
      if (cartPickedIds.has(item.id)) continue;
      if (profile.vegetarianOnly && !item.isVeg) continue;
      pushCartSuggestion(
        item,
        cartItemIds.size > 0 ? "Popular add-on" : "Popular pick",
        { preferredSpice: profile.preferredOverallSpice },
      );
    }
  }

  // ---------------- 3. Quick-add catalog (all available items) ----------------
  const quickAddCatalog: SuggestedItem[] = availableItems
    .map((item) => {
      const hist = statsByItemId.get(item.id);
      return toSuggestedItem(item, item.categoryName, {
        preferredVariantId: hist ? pickTopKey(hist.variantCounts) : null,
        preferredSpice:
          (hist ? pickTopKey(hist.spiceCounts) : null) ?? profile.preferredOverallSpice,
      });
    })
    .filter((entry): entry is SuggestedItem => Boolean(entry));

  // ---------------- 4. De-identified AI context (ZERO PII) ----------------
  const recentDishNames = profile.rankedStats
    .map((s) => availableById.get(s.itemId)?.name ?? allItemsById.get(s.itemId)?.name)
    .filter((name): name is string => Boolean(name))
    .slice(0, 8);

  const aiHint: AiPersonalizationHint = {
    date,
    recentDishNames,
    preferredCategories: profile.topCategories.slice(0, 3),
    preferredSpice: profile.preferredOverallSpice,
    vegetarianOnly: profile.vegetarianOnly,
    cartDishNames: cartItemsResolved.map((item) => item.name).slice(0, 10),
    dessertOfTheDay: dessertOfTheDay
      ? { name: dessertOfTheDay.name, price: money(dessertOfTheDay.unitPriceCents) }
      : null,
    drinkOfTheDay: drinkOfTheDay
      ? { name: drinkOfTheDay.name, price: money(drinkOfTheDay.unitPriceCents) }
      : null,
  };

  return {
    payload: {
      date,
      signedIn,
      recentOrderCount,
      dessertOfTheDay,
      drinkOfTheDay,
      menuSuggestions,
      cartSuggestions,
      quickAddCatalog,
    },
    aiHint,
  };
}
