"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useCart } from "@/components/CartProvider";
import { Icon } from "@/components/Icon";
import { money } from "@/lib/money";
import type {
  ChatSuggestionsPayload,
  SuggestedItem,
} from "@/lib/chat/recommendations";

type Message = { id: number; sender: "customer" | "assistant" | "staff"; text: string; created_at?: string };
type Chat = {
  id: string;
  status: "ai" | "waiting" | "closed";
  handoff_after_message_id: number | null;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Find up to 4 available menu items mentioned by name in an assistant/staff reply. */
function findMentionedItems(text: string, catalog: SuggestedItem[]): SuggestedItem[] {
  if (!text || catalog.length === 0) return [];
  const sorted = [...catalog].sort((a, b) => b.name.length - a.name.length);
  const found: SuggestedItem[] = [];
  const seenIds = new Set<number>();
  let remaining = text;
  for (const item of sorted) {
    if (found.length >= 4) break;
    if (seenIds.has(item.itemId) || item.name.length < 3) continue;
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(item.name)}(?![A-Za-z0-9])`, "i");
    if (pattern.test(remaining)) {
      found.push(item);
      seenIds.add(item.itemId);
      remaining = remaining.replace(pattern, " ");
    }
  }
  return found;
}

function SuggestionRow({
  item,
  badge,
  inCartQty,
  justAdded,
  onAdd,
}: {
  item: SuggestedItem;
  badge?: string;
  inCartQty: number;
  justAdded: boolean;
  onAdd: (item: SuggestedItem) => void;
}) {
  return (
    <div className="chat-suggestion-card">
      <Link href={`/menu/${item.slug}`} className="chat-suggestion-thumb" aria-label={`View ${item.name}`}>
        <img src={item.image} alt={item.name} loading="lazy" />
      </Link>
      <div className="chat-suggestion-body">
        <div className="chat-suggestion-top">
          <Link href={`/menu/${item.slug}`} className="chat-suggestion-name">
            {item.name}
          </Link>
          <span className="mono chat-suggestion-price">{money(item.unitPriceCents)}</span>
        </div>
        <div className="chat-suggestion-meta tiny muted">
          {badge ? <span className="badge badge-amber">{badge}</span> : null}
          <span>{item.reason}</span>
          <span>· {item.variantLabel}</span>
          {item.spice ? <span>· {item.spice.replace("_", " ")}</span> : null}
          {item.isVeg ? <span className="badge badge-green">Veg</span> : null}
        </div>
        <div className="chat-suggestion-actions">
          <button
            type="button"
            className={`btn btn-sm ${justAdded ? "btn-green" : "btn-primary"}`}
            onClick={() => onAdd(item)}
          >
            <Icon name={justAdded ? "check" : "plus"} size={14} />
            {justAdded
              ? "Added to cart"
              : inCartQty > 0
                ? `Add another (${inCartQty} in cart)`
                : "Add to cart"}
          </button>
          <Link href={`/menu/${item.slug}`} className="btn btn-ghost btn-sm">
            Customise
          </Link>
        </div>
      </div>
    </div>
  );
}

export function GuestChat({
  phone,
  initialAiEnabled,
  initialSignedIn,
}: {
  phone: string;
  initialAiEnabled: boolean;
  initialSignedIn: boolean;
}) {
  const { items: cartItems, count: cartCount, subtotalCents, hydrated, add, setQty } = useCart();

  const [aiEnabled, setAiEnabled] = useState(initialAiEnabled);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);

  const [suggestions, setSuggestions] = useState<ChatSuggestionsPayload | null>(null);
  const [suggestionsError, setSuggestionsError] = useState("");
  const [addedKey, setAddedKey] = useState<string | null>(null);

  const cartSignature = useMemo(
    () =>
      cartItems
        .map((entry) => `${entry.itemId}:${entry.variantId}:${entry.qty}`)
        .sort()
        .join(","),
    [cartItems],
  );

  const cartQtyByItemId = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of cartItems) {
      map.set(entry.itemId, (map.get(entry.itemId) ?? 0) + entry.qty);
    }
    return map;
  }, [cartItems]);

  const cartSnapshotPayload = useMemo(
    () =>
      cartItems.map((entry) => ({
        itemId: entry.itemId,
        variantId: entry.variantId,
        qty: entry.qty,
      })),
    [cartItems],
  );

  const refreshChat = useCallback(async () => {
    try {
      const res = await fetch("/api/chat", { cache: "no-store" });
      const data = await res.json();
      if (typeof data.aiEnabled === "boolean") setAiEnabled(data.aiEnabled);
      if (!res.ok) {
        setError(data.error ?? "Unable to reach chat. Please call us.");
        return;
      }
      setChat(data.chat);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch {
      setError("Unable to reach chat. Please call us.");
    }
  }, []);

  useEffect(() => {
    void refreshChat();
    const timer = setInterval(() => void refreshChat(), 5000);
    return () => clearInterval(timer);
  }, [refreshChat]);

  const refreshSuggestions = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ cart: cartSnapshotPayload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSuggestionsError(data.error ?? "Menu suggestions are temporarily unavailable.");
        return;
      }
      setSuggestionsError("");
      setSuggestions(data as ChatSuggestionsPayload);
    } catch {
      setSuggestionsError("Menu suggestions are temporarily unavailable.");
    }
  }, [cartSnapshotPayload]);

  useEffect(() => {
    if (!hydrated) return;
    void refreshSuggestions();
  }, [hydrated, cartSignature, refreshSuggestions]);

  async function runAction(
    actionName: "start" | "message" | "handoff" | "close",
    opts?: { message?: string; mode?: "ai" | "staff" },
  ) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: actionName,
          text: opts?.message,
          mode: opts?.mode,
          consent,
          cart: actionName === "message" ? cartSnapshotPayload : undefined,
        }),
      });
      const data = await res.json();
      if (typeof data.aiEnabled === "boolean") setAiEnabled(data.aiEnabled);
      if (!res.ok) {
        setError(data.error ?? "Chat unavailable");
      } else if (actionName === "message") {
        setText("");
      }
      await refreshChat();
    } catch {
      setError("Unable to reach chat. Please call us.");
    } finally {
      setBusy(false);
    }
  }

  function handleAddSuggested(item: SuggestedItem) {
    add({
      itemId: item.itemId,
      variantId: item.variantId,
      slug: item.slug,
      name: item.name,
      image: item.image,
      variantLabel: item.variantLabel,
      sizeMl: item.sizeMl,
      unitPriceCents: item.unitPriceCents,
      spice: item.spice,
    });
    const marker = `${item.itemId}:${item.variantId}`;
    setAddedKey(marker);
    window.setTimeout(() => {
      setAddedKey((current) => (current === marker ? null : current));
    }, 1800);
  }

  const signedIn = suggestions ? suggestions.signedIn : initialSignedIn;
  const quickAddCatalog = suggestions?.quickAddCatalog ?? [];
  const isDirectCounterChat =
    chat?.status === "waiting" && (chat.handoff_after_message_id ?? 0) === 0;
  const isPostHandoffChat =
    chat?.status === "waiting" && (chat.handoff_after_message_id ?? 0) > 0;

  return (
    <section className="section-tight" style={{ paddingTop: 34, paddingBottom: 64 }}>
      <div className="container">
        <div className="chat-header">
          <div>
            <span className="eyebrow">Guest assistance</span>
            <h1 style={{ fontSize: "clamp(2rem, 4.4vw, 3.1rem)", margin: "12px 0 8px" }}>
              Chat with Khan Baba
            </h1>
            <p className="muted" style={{ maxWidth: "62ch" }}>
              {aiEnabled
                ? "Chat with our AI menu assistant or connect directly with counter staff. Add any suggested dish straight to your cart, then continue to checkout."
                : "Chat directly with our counter team about dishes, spice levels, allergies or your order. AI menu chat will become available automatically once configured."}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className={`badge ${aiEnabled ? "badge-green" : "badge-amber"}`}>
              {aiEnabled
                ? "AI assistant & counter staff live"
                : "Counter staff chat live · AI offline"}
            </span>
            {hydrated && cartCount > 0 ? (
              <Link href="/checkout" className="btn btn-primary btn-sm">
                <Icon name="cart" size={14} /> Checkout · {money(subtotalCents)}
              </Link>
            ) : null}
          </div>
        </div>

        <div className="chat-layout">
          {/* ---------------- Main column: Live Chat ---------------- */}
          <div className="panel chat-main-panel">
            <div className="panel-head" style={{ marginBottom: 14 }}>
              <div>
                <h2 style={{ fontSize: "1.35rem" }}>
                  {chat && chat.status !== "closed"
                    ? chat.status === "waiting"
                      ? "Counter team chat"
                      : "AI menu assistant"
                    : aiEnabled
                      ? "Start a conversation"
                      : "Talk to counter staff"}
                </h2>
                <p className="tiny muted" style={{ marginTop: 4 }}>
                  For allergies or severe dietary needs, always confirm directly with counter staff before ordering.
                </p>
              </div>
              {chat && chat.status !== "closed" ? (
                <span className={`badge ${chat.status === "waiting" ? "badge-amber" : "badge-green"}`}>
                  {chat.status === "waiting" ? "Counter team" : "AI assistant"}
                </span>
              ) : null}
            </div>

            <div className="chat-privacy-note tiny muted">
              <strong>Privacy &amp; data handling:</strong> Chat message bodies are encrypted at rest on our server and scheduled for deletion after seven days without activity (database backups may be retained longer). Other application records such as orders and customer profiles are stored separately and are not covered by chat message encryption.
              {aiEnabled
                ? " AI replies send recent chat messages and (when you are signed in) de-identified dish names from your last five orders and cart to OpenAI — never your name, email, phone, address or payment details. If you hand off from AI to counter staff, counter staff only see messages sent after the handoff."
                : " When AI is offline, your chat messages go directly to our counter team and are not sent to OpenAI."}{" "}
              Administrators can review the chat archive. Do not enter payment card details or sensitive personal information here.
            </div>

            {!chat || chat.status === "closed" ? (
              <div style={{ marginTop: 20 }}>
                <label className="check" style={{ marginBottom: 16 }}>
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>I understand and agree to the chat processing described above.</span>
                </label>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {aiEnabled ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={!consent || busy}
                        onClick={() => void runAction("start", { mode: "ai" })}
                      >
                        Start AI menu chat
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline"
                        disabled={!consent || busy}
                        onClick={() => void runAction("start", { mode: "staff" })}
                      >
                        Talk directly to counter staff
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!consent || busy}
                      onClick={() => void runAction("start", { mode: "staff" })}
                    >
                      Start counter chat
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {chat.status === "ai" && !aiEnabled ? (
                  <div className="notice" style={{ marginTop: 14 }}>
                    <span>
                      The AI assistant is currently offline. Click{" "}
                      <strong>Talk to counter staff</strong> below to continue with our team (earlier AI messages remain hidden from counter staff).
                    </span>
                  </div>
                ) : null}

                <div
                  className="chat-transcript"
                  aria-live="polite"
                  aria-label="Chat messages"
                >
                  {messages.length === 0 ? (
                    <p className="small muted">
                      {chat.status === "waiting"
                        ? "Send a message to our counter team — ask about dishes, spice levels, allergens or your order."
                        : "Ask about dishes, spice levels, vegetarian options, today's dessert & drink of the day, or what to add to your cart."}
                    </p>
                  ) : (
                    messages.map((m) => {
                      const matches =
                        m.sender === "assistant" || m.sender === "staff"
                          ? findMentionedItems(m.text, quickAddCatalog)
                          : [];
                      return (
                        <div
                          key={m.id}
                          className={`chat-bubble chat-bubble-${m.sender}`}
                        >
                          <div className="chat-bubble-sender tiny">
                            {m.sender === "customer"
                              ? "You"
                              : m.sender === "staff"
                                ? "Counter team"
                                : "AI assistant"}
                          </div>
                          <p className="chat-bubble-text">{m.text}</p>
                          {matches.length > 0 ? (
                            <div className="chat-inline-picks">
                              {matches.map((item) => {
                                const key = `${item.itemId}:${item.variantId}`;
                                const isAdded = addedKey === key;
                                return (
                                  <button
                                    key={key}
                                    type="button"
                                    className={`btn btn-sm ${isAdded ? "btn-green" : "btn-outline"}`}
                                    onClick={() => handleAddSuggested(item)}
                                  >
                                    <Icon name={isAdded ? "check" : "plus"} size={13} />
                                    {isAdded
                                      ? `Added ${item.name}`
                                      : `Add ${item.name} · ${money(item.unitPriceCents)}`}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (text.trim()) void runAction("message", { message: text });
                  }}
                  style={{ marginTop: 14 }}
                >
                  <label htmlFor="chat-message" className="label">
                    Message
                  </label>
                  <textarea
                    id="chat-message"
                    className="textarea"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={1500}
                    rows={3}
                    placeholder={
                      chat.status === "waiting"
                        ? "Write a message to our counter team…"
                        : "Ask for menu ideas, spice guidance, or what goes well with your cart…"
                    }
                    style={{ margin: "8px 0 12px" }}
                  />
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={busy || !text.trim()}
                    >
                      {busy ? "Sending…" : "Send message"}
                    </button>
                    {chat.status === "ai" ? (
                      <button
                        type="button"
                        className="btn btn-outline"
                        disabled={busy}
                        onClick={() => void runAction("handoff")}
                      >
                        Talk to counter staff
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => void runAction("close")}
                    >
                      End conversation
                    </button>
                  </div>
                </form>

                {isPostHandoffChat ? (
                  <p className="tiny muted" style={{ marginTop: 12 }}>
                    Counter staff can only see messages sent after you requested them. Please repeat your question here. Replies depend on team availability.
                  </p>
                ) : isDirectCounterChat ? (
                  <p className="tiny muted" style={{ marginTop: 12 }}>
                    Your messages go straight to our counter team. Replies depend on team availability.
                  </p>
                ) : null}
              </>
            )}

            {error ? (
              <div className="notice notice-red" role="alert" style={{ marginTop: 16 }}>
                {error}
              </div>
            ) : null}

            <div className="chat-footer-links small muted">
              <a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>Call {phone}</a>
              <span>·</span>
              <Link href="/menu">Browse full menu</Link>
              <span>·</span>
              <Link href="/checkout">Go to checkout</Link>
            </div>
          </div>

          {/* ---------------- Companion column: Cart, Daily Specials & Suggestions ---------------- */}
          <aside className="chat-sidebar" aria-label="Cart and menu suggestions">
            {/* 1. Mini-cart & Continue to Checkout */}
            <div className="panel">
              <div className="panel-head" style={{ marginBottom: 10 }}>
                <h2 style={{ fontSize: "1.15rem" }}>Your order cart</h2>
                <span className="mono small" style={{ color: "var(--accent)" }}>
                  {hydrated ? `${cartCount} ${cartCount === 1 ? "item" : "items"} · ${money(subtotalCents)}` : "Loading…"}
                </span>
              </div>

              {hydrated && cartItems.length > 0 ? (
                <>
                  <ul className="chat-cart-list">
                    {cartItems.map((entry) => (
                      <li key={entry.key} className="chat-cart-row">
                        <div className="chat-cart-item-info">
                          <span className="strong small">{entry.name}</span>
                          <span className="tiny muted">
                            {entry.variantLabel}
                            {entry.spice ? ` · ${entry.spice.replace("_", " ")}` : ""}
                          </span>
                        </div>
                        <div className="chat-cart-qty">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-label={`Decrease quantity of ${entry.name}`}
                            onClick={() => setQty(entry.key, entry.qty - 1)}
                          >
                            −
                          </button>
                          <span className="mono small">{entry.qty}</span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-label={`Increase quantity of ${entry.name}`}
                            onClick={() => setQty(entry.key, entry.qty + 1)}
                          >
                            +
                          </button>
                        </div>
                        <span className="mono small">
                          {money(entry.unitPriceCents * entry.qty)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/checkout" className="btn btn-primary btn-block" style={{ marginTop: 14 }}>
                    Continue to checkout · {money(subtotalCents)}
                    <Icon name="arrow" size={15} />
                  </Link>
                </>
              ) : (
                <p className="small muted">
                  Your cart is empty. Add any suggested dish, dessert or drink below, then continue to the existing checkout and payment flow.
                </p>
              )}
            </div>

            {/* 2. Dessert of the Day & Drink of the Day */}
            <div className="panel">
              <div className="panel-head" style={{ marginBottom: 12 }}>
                <div>
                  <h2 style={{ fontSize: "1.15rem" }}>Today&apos;s specials</h2>
                  <p className="tiny muted">
                    Fresh daily picks{suggestions?.date ? ` · ${suggestions.date} (Sydney)` : ""}
                  </p>
                </div>
              </div>
              {suggestionsError ? (
                <p className="small muted">{suggestionsError}</p>
              ) : !suggestions ? (
                <p className="small muted">Loading today&apos;s dessert and drink…</p>
              ) : (
                <div className="chat-suggestion-list">
                  {suggestions.dessertOfTheDay ? (
                    <SuggestionRow
                      item={suggestions.dessertOfTheDay}
                      badge="Dessert of the day"
                      inCartQty={cartQtyByItemId.get(suggestions.dessertOfTheDay.itemId) ?? 0}
                      justAdded={
                        addedKey ===
                        `${suggestions.dessertOfTheDay.itemId}:${suggestions.dessertOfTheDay.variantId}`
                      }
                      onAdd={handleAddSuggested}
                    />
                  ) : null}
                  {suggestions.drinkOfTheDay ? (
                    <SuggestionRow
                      item={suggestions.drinkOfTheDay}
                      badge="Drink of the day"
                      inCartQty={cartQtyByItemId.get(suggestions.drinkOfTheDay.itemId) ?? 0}
                      justAdded={
                        addedKey ===
                        `${suggestions.drinkOfTheDay.itemId}:${suggestions.drinkOfTheDay.variantId}`
                      }
                      onAdd={handleAddSuggested}
                    />
                  ) : null}
                </div>
              )}
            </div>

            {/* 3. Menu Suggestions (Last 5 Purchases) */}
            <div className="panel">
              <div className="panel-head" style={{ marginBottom: 12 }}>
                <div>
                  <h2 style={{ fontSize: "1.15rem" }}>
                    {signedIn && (suggestions?.recentOrderCount ?? 0) > 0
                      ? "Menu suggestions for you"
                      : "Menu suggestions"}
                  </h2>
                  <p className="tiny muted">
                    {signedIn
                      ? (suggestions?.recentOrderCount ?? 0) > 0
                        ? `Personalised from your last ${suggestions?.recentOrderCount} ${suggestions?.recentOrderCount === 1 ? "purchase" : "purchases"}`
                        : "Popular dishes — suggestions personalise from your last 5 orders once you place an order."
                      : "Sign in to unlock personalised picks from your last 5 purchases."}
                  </p>
                </div>
                {!signedIn ? (
                  <Link href="/login?next=/chat" className="btn btn-outline btn-sm">
                    Sign in
                  </Link>
                ) : null}
              </div>

              {suggestions && suggestions.menuSuggestions.length > 0 ? (
                <div className="chat-suggestion-list">
                  {suggestions.menuSuggestions.map((item) => (
                    <SuggestionRow
                      key={`menu-${item.itemId}`}
                      item={item}
                      inCartQty={cartQtyByItemId.get(item.itemId) ?? 0}
                      justAdded={addedKey === `${item.itemId}:${item.variantId}`}
                      onAdd={handleAddSuggested}
                    />
                  ))}
                </div>
              ) : !suggestions ? (
                <p className="small muted">Loading menu suggestions…</p>
              ) : (
                <p className="small muted">Browse the full menu to explore all dishes.</p>
              )}
            </div>

            {/* 4. Cart Suggestions */}
            <div className="panel">
              <div className="panel-head" style={{ marginBottom: 12 }}>
                <div>
                  <h2 style={{ fontSize: "1.15rem" }}>Cart suggestions</h2>
                  <p className="tiny muted">
                    {cartCount > 0
                      ? "Recommended additions that are not yet in your cart"
                      : "Quick additions to start your order"}
                  </p>
                </div>
              </div>

              {suggestions && suggestions.cartSuggestions.length > 0 ? (
                <div className="chat-suggestion-list">
                  {suggestions.cartSuggestions.map((item) => (
                    <SuggestionRow
                      key={`cart-${item.itemId}`}
                      item={item}
                      inCartQty={cartQtyByItemId.get(item.itemId) ?? 0}
                      justAdded={addedKey === `${item.itemId}:${item.variantId}`}
                      onAdd={handleAddSuggested}
                    />
                  ))}
                </div>
              ) : !suggestions ? (
                <p className="small muted">Loading cart suggestions…</p>
              ) : (
                <p className="small muted">Your cart looks well balanced — ready to check out whenever you are.</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
