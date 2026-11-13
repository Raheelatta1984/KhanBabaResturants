"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CartItem = {
  key: string;
  itemId: number;
  variantId: number;
  slug: string;
  name: string;
  image: string;
  variantLabel: string;
  sizeMl: number | null;
  unitPriceCents: number;
  spice: string | null;
  qty: number;
  notes?: string;
};

type CartContextValue = {
  items: CartItem[];
  hydrated: boolean;
  count: number;
  subtotalCents: number;
  add: (item: Omit<CartItem, "key" | "qty">, qty?: number) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  notify: (message: string) => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "kb_cart_v1";

export function cartKey(itemId: number, variantId: number, spice: string | null | undefined) {
  return `${itemId}:${variantId}:${spice ?? "-"}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CartItem[];
        if (Array.isArray(parsed)) setItems(parsed.filter((i) => i && i.variantId && i.qty > 0));
      }
    } catch {
      /* ignore corrupt cart */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage full / private mode */
    }
  }, [items, hydrated]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2800);
  }, []);

  const add = useCallback(
    (item: Omit<CartItem, "key" | "qty">, qty = 1) => {
      const key = cartKey(item.itemId, item.variantId, item.spice);
      setItems((current) => {
        const existing = current.find((i) => i.key === key);
        if (existing) {
          return current.map((i) => (i.key === key ? { ...i, qty: Math.min(30, i.qty + qty) } : i));
        }
        return [...current, { ...item, key, qty: Math.max(1, qty) }];
      });
      notify(`${item.name} added to your order`);
    },
    [notify],
  );

  const setQty = useCallback((key: string, qty: number) => {
    setItems((current) =>
      qty <= 0
        ? current.filter((i) => i.key !== key)
        : current.map((i) => (i.key === key ? { ...i, qty: Math.min(30, qty) } : i)),
    );
  }, []);

  const remove = useCallback((key: string) => {
    setItems((current) => current.filter((i) => i.key !== key));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((sum, item) => sum + item.qty, 0);
    const subtotalCents = items.reduce((sum, item) => sum + item.qty * item.unitPriceCents, 0);
    return { items, hydrated, count, subtotalCents, add, setQty, remove, clear, notify };
  }, [items, hydrated, add, setQty, remove, clear, notify]);

  return (
    <CartContext.Provider value={value}>
      {children}
      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          <span style={{ color: "var(--green)" }}>✓</span>
          {toast}
        </div>
      ) : null}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside <CartProvider>");
  return context;
}
