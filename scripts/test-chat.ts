import assert from "node:assert/strict";
import { createHarness } from "./lib/pglite";
import { SCHEMA_SQL } from "../lib/db/schema";
import { seedDatabase } from "../lib/db/seed";
import { chatKey, encryptMessage, decryptMessage } from "../lib/chat/crypto";
import { addMessage, readMessages, minimiseForAI } from "../lib/chat/service";
import { askAssistant, isAiChatConfigured } from "../lib/chat/assistant";
import {
  getChatSuggestions,
  parseCartSnapshot,
  pickDailySpecials,
} from "../lib/chat/recommendations";
import { authorisedCron, pruneExpiredChats } from "../lib/chat/retention";
import { allowChatRequest, clientHash } from "../lib/chat/rate-limit";
import { redact } from "../lib/ops/actions";
import { getMenuItems } from "../lib/catalog";
import { priceCart } from "../lib/cart";
import { signupCustomer } from "../lib/auth/customer";
import { createOrder } from "../lib/orders";
import { setDbFactory } from "../lib/db";

async function main() {
  // 1. Encryption, tamper detection & key rotation
  delete process.env.CHAT_ENCRYPTION_KEY;
  assert.throws(chatKey);
  process.env.CHAT_ENCRYPTION_KEY = "01".repeat(32);
  const cipher = encryptMessage("Private message", "conversation", "customer");
  assert(!cipher.includes("Private message"));
  assert.equal(decryptMessage(cipher, "conversation", "customer"), "Private message");
  assert.throws(() => decryptMessage(cipher, "other", "customer"));
  assert.throws(() => decryptMessage(cipher, "conversation", "staff"));
  const parts = cipher.split(".");
  const tag = Buffer.from(parts[2], "base64");
  tag[0] ^= 1;
  parts[2] = tag.toString("base64");
  assert.throws(() => decryptMessage(parts.join("."), "conversation", "customer"));
  process.env.CHAT_ENCRYPTION_KEY = "02".repeat(32);
  process.env.CHAT_OLD_ENCRYPTION_KEYS = "01".repeat(32);
  assert.equal(decryptMessage(cipher, "conversation", "customer"), "Private message");
  delete process.env.CHAT_OLD_ENCRYPTION_KEYS;
  assert.throws(() => decryptMessage(cipher, "conversation", "customer"));

  // 2. Staff-only vs AI-enabled env var detection
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_CHAT_MODEL;
  assert.equal(isAiChatConfigured(), false);
  process.env.OPENAI_API_KEY = "";
  process.env.OPENAI_CHAT_MODEL = "";
  assert.equal(isAiChatConfigured(), false);
  process.env.OPENAI_API_KEY = "   ";
  process.env.OPENAI_CHAT_MODEL = "gpt-4o-mini";
  assert.equal(isAiChatConfigured(), false);
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_CHAT_MODEL = "  ";
  assert.equal(isAiChatConfigured(), false);
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_CHAT_MODEL = "gpt-4o-mini";
  assert.equal(isAiChatConfigured(), true);
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_CHAT_MODEL;

  // 3. Retention auth, minimisation & action log redaction
  assert(!authorisedCron("Bearer short", "short"));
  assert(!authorisedCron("Bearer wrong", "x".repeat(32)));
  assert(authorisedCron(`Bearer ${"x".repeat(32)}`, "x".repeat(32)));
  assert.equal(
    minimiseForAI("Email me at a@example.com or call 0412 345 678"),
    "Email me at [email removed] or call [number removed]",
  );
  assert.deepEqual(
    redact({ action: "reply", text: "private details", id: "abc" }, "", 0, "chat"),
    { action: "reply", text: "[withheld]", id: "[withheld]" },
  );

  // 4. Cart snapshot sanitization
  assert.deepEqual(parseCartSnapshot("1, 2, -5, abc, 2, 9999999999999999999"), [
    { itemId: 1 },
    { itemId: 2 },
  ]);
  assert.deepEqual(
    parseCartSnapshot([{ itemId: 3, variantId: 7, qty: 2 }, { itemId: "bad" }, { itemId: 3 }]),
    [{ itemId: 3, variantId: 7, qty: 2 }],
  );

  const { db, close } = await createHarness();
  setDbFactory(() => db);
  process.env.DATABASE_URL = "postgres://pglite/khanbaba";
  await db.exec(SCHEMA_SQL);
  await seedDatabase(db);

  // 5. Encrypted handoff boundary, direct counter chat, retention & rate limiting
  await db.run("INSERT INTO chat_conversations (id, token_hash) VALUES ($1,$2)", [
    "chat1",
    "hash",
  ]);
  await addMessage(db, "chat1", "customer", "private before handoff");
  const before = await db.one<{ id: number; ciphertext: string }>(
    "SELECT id,ciphertext FROM chat_messages WHERE conversation_id=$1",
    ["chat1"],
  );
  assert(!before.ciphertext.includes("private before handoff"));
  await addMessage(db, "chat1", "customer", "after handoff");
  assert.deepEqual(
    (await readMessages(db, "chat1", before.id)).map((m) => m.text),
    ["after handoff"],
  );
  // Direct counter chat (handoff_after_message_id = 0) exposes all messages in that thread to counter staff
  await db.run(
    "INSERT INTO chat_conversations (id, token_hash, status, handoff_at, handoff_after_message_id) VALUES ($1,$2,'waiting',now(),0)",
    ["direct1", "direct-hash"],
  );
  await addMessage(db, "direct1", "customer", "direct counter question");
  assert.deepEqual(
    (await readMessages(db, "direct1", 0)).map((m) => m.text),
    ["direct counter question"],
  );

  await db.run(
    "INSERT INTO chat_conversations (id, token_hash, updated_at) VALUES ($1,$2,now() - interval '8 days')",
    ["expired", "expired-hash"],
  );
  await addMessage(db, "expired", "customer", "old message");
  await db.run(
    "UPDATE chat_conversations SET updated_at=now() - interval '8 days' WHERE id='expired'",
  );
  assert.equal(await pruneExpiredChats(db), 1);
  assert.equal(
    (
      await db.one<{ count: number }>(
        "SELECT COUNT(*) AS count FROM chat_messages WHERE conversation_id='expired'",
      )
    ).count,
    0,
  );
  assert.equal((await readMessages(db, "chat1")).length, 2);

  const hash = clientHash(new Headers());
  assert(hash && hash !== "local");
  process.env.VERCEL = "1";
  assert.equal(clientHash(new Headers()), null);
  assert(clientHash(new Headers({ "x-vercel-forwarded-for": "203.0.113.4" })));
  assert.equal(clientHash(new Headers({ "x-vercel-forwarded-for": "spoofed" })), null);
  delete process.env.VERCEL;
  for (let i = 0; i < 30; i++) assert(await allowChatRequest(db, hash));
  assert.equal(await allowChatRequest(db, hash), false);

  // 6. RLS on all chat tables
  const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
    "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('chat_conversations','chat_messages','chat_ai_quota','chat_rate_limits')",
  );
  assert.equal(rls.length, 4);
  assert(rls.every((r) => r.relrowsecurity));

  // 7. Dessert of the Day & Drink of the Day rotation and availability
  const menu = await getMenuItems(db);
  const available = menu.filter((item) => item.available && item.variants.length > 0);
  const bySlug = new Map(available.map((item) => [item.slug, item]));
  // In the seeded DB, gulab-jamun starts out of stock (is_available = false),
  // so daily specials MUST skip it and pick suji-halwa, while drinks rotate.
  const day1Seeded = pickDailySpecials(available, new Date("2026-11-15T02:00:00Z"));
  const day2Seeded = pickDailySpecials(available, new Date("2026-11-16T02:00:00Z"));
  assert.equal(day1Seeded.dessertOfTheDay?.slug, "suji-halwa");
  assert.equal(day2Seeded.dessertOfTheDay?.slug, "suji-halwa");
  assert(day1Seeded.drinkOfTheDay && day1Seeded.drinkOfTheDay.categorySlug === "drinks");
  assert(day2Seeded.drinkOfTheDay && day2Seeded.drinkOfTheDay.categorySlug === "drinks");
  assert.notEqual(day1Seeded.drinkOfTheDay.slug, day2Seeded.drinkOfTheDay.slug);

  // When both desserts are available, Dessert of the Day also rotates daily.
  await db.run("UPDATE menu_items SET is_available = TRUE WHERE slug = 'gulab-jamun'");
  const availableAll = (await getMenuItems(db)).filter(
    (item) => item.available && item.variants.length > 0,
  );
  const day1 = pickDailySpecials(availableAll, new Date("2026-11-15T02:00:00Z"));
  const day2 = pickDailySpecials(availableAll, new Date("2026-11-16T02:00:00Z"));
  assert(day1.dessertOfTheDay && day1.dessertOfTheDay.categorySlug === "desserts");
  assert(day2.dessertOfTheDay && day2.dessertOfTheDay.categorySlug === "desserts");
  assert.notEqual(day1.dessertOfTheDay.slug, day2.dessertOfTheDay.slug);
  assert.notEqual(day1.drinkOfTheDay?.slug, day2.drinkOfTheDay?.slug);

  // 8. Personalized last-5-purchase recommendations, privacy isolation & vegetarian preference
  const alice = await signupCustomer(db, {
    name: "Alice SecretName",
    email: "alice.private@example.com",
    password: "AlicePassword123!",
    phone: "0411 222 333",
  });
  const bob = await signupCustomer(db, {
    name: "Bob VegOnly",
    email: "bob.private@example.com",
    password: "BobPassword123!",
    phone: "0422 333 444",
  });

  const itemFor = (slug: string) => {
    const found = bySlug.get(slug);
    assert(found, `Missing seeded item ${slug}`);
    const variant = found.variants.find((v) => v.isDefault) ?? found.variants[0];
    return { item: found, variant };
  };

  async function placeSimpleOrder(
    customerId: number,
    name: string,
    email: string,
    slugs: { slug: string; spice?: string }[],
    cancel = false,
  ) {
    const res = await createOrder(db, {
      channel: "pickup",
      customerName: name,
      email,
      phone: "0400 111 222",
      paymentMethod: "counter",
      customerId,
      items: slugs.map(({ slug, spice }) => {
        const { item, variant } = itemFor(slug);
        return {
          itemId: item.id,
          variantId: variant.id,
          qty: 1,
          spiceLevel: spice ?? (item.spiceLevels[0] ?? null),
        };
      }),
    });
    if (cancel) {
      await db.run("UPDATE orders SET status='cancelled' WHERE id=$1", [res.order.id]);
    }
    return res.order;
  }

  // Alice's Order #1 (oldest — OUTSIDE last 5): Beef Nihari
  await placeSimpleOrder(alice.customer.id, alice.customer.name, alice.customer.email, [
    { slug: "beef-nihari", spice: "mild" },
  ]);
  // Alice's Orders #2..#6 (her LAST 5 non-cancelled purchases):
  await placeSimpleOrder(alice.customer.id, alice.customer.name, alice.customer.email, [
    { slug: "butter-chicken", spice: "hot" },
    { slug: "garlic-naan" },
  ]);
  await placeSimpleOrder(alice.customer.id, alice.customer.name, alice.customer.email, [
    { slug: "butter-chicken", spice: "hot" },
  ]);
  await placeSimpleOrder(alice.customer.id, alice.customer.name, alice.customer.email, [
    { slug: "butter-chicken", spice: "hot" },
    { slug: "garlic-naan" },
  ]);
  await placeSimpleOrder(alice.customer.id, alice.customer.name, alice.customer.email, [
    { slug: "chicken-karahi", spice: "hot" },
  ]);
  await placeSimpleOrder(alice.customer.id, alice.customer.name, alice.customer.email, [
    { slug: "seekh-kebab", spice: "hot" },
  ]);
  // Alice's cancelled order (must NOT count as a purchase)
  await placeSimpleOrder(
    alice.customer.id,
    alice.customer.name,
    alice.customer.email,
    [{ slug: "kb-beef-burger" }],
    true,
  );

  // Bob's 2 vegetarian-only orders
  await placeSimpleOrder(bob.customer.id, bob.customer.name, bob.customer.email, [
    { slug: "daal-makhni", spice: "mild" },
  ]);
  await placeSimpleOrder(bob.customer.id, bob.customer.name, bob.customer.email, [
    { slug: "samosa-chaat" },
  ]);

  // Signed-out guest receives NO personal history
  const guestSug = await getChatSuggestions(db, {
    customerId: null,
    now: new Date("2026-11-15T02:00:00Z"),
  });
  assert.equal(guestSug.payload.signedIn, false);
  assert.equal(guestSug.payload.recentOrderCount, 0);
  assert(guestSug.payload.dessertOfTheDay);
  assert(guestSug.payload.drinkOfTheDay);
  assert(guestSug.payload.menuSuggestions.length > 0);
  assert(guestSug.payload.cartSuggestions.length > 0);
  assert(guestSug.payload.menuSuggestions.every((s) => s.orderedCount === undefined));
  assert.equal(guestSug.aiHint.recentDishNames.length, 0);

  // Alice gets suggestions strictly from her last 5 non-cancelled purchases
  const butterChickenId = itemFor("butter-chicken").item.id;
  const aliceSug = await getChatSuggestions(db, {
    customerId: alice.customer.id,
    cart: [{ itemId: butterChickenId, qty: 1 }],
    now: new Date("2026-11-15T02:00:00Z"),
  });
  assert.equal(aliceSug.payload.signedIn, true);
  assert.equal(aliceSug.payload.recentOrderCount, 5);
  assert.equal(aliceSug.payload.menuSuggestions[0]?.slug, "butter-chicken");
  assert.equal(aliceSug.payload.menuSuggestions[0]?.orderedCount, 3);
  assert.equal(aliceSug.payload.menuSuggestions[0]?.spice, "hot");
  assert.equal(aliceSug.payload.menuSuggestions[1]?.slug, "garlic-naan");
  assert.equal(aliceSug.payload.menuSuggestions[1]?.orderedCount, 2);
  // Purchase #6 (Beef Nihari) and cancelled order (KB Beef Burger) must NOT appear in recent history
  assert(!aliceSug.aiHint.recentDishNames.includes("Beef Nihari"));
  assert(!aliceSug.aiHint.recentDishNames.includes("KB Beef Burger"));
  // Cart suggestions must exclude items already in cart (Butter Chicken) and include Garlic Naan / daily specials
  assert(!aliceSug.payload.cartSuggestions.some((s) => s.itemId === butterChickenId));
  assert(aliceSug.payload.cartSuggestions.some((s) => s.slug === "garlic-naan"));

  // Privacy check: payload and AI hint must contain ZERO PII
  const serializedAlice = JSON.stringify({ payload: aliceSug.payload, aiHint: aliceSug.aiHint });
  for (const sensitive of [
    "Alice SecretName",
    "alice.private@example.com",
    "0411 222 333",
    "Bob VegOnly",
    "bob.private@example.com",
  ]) {
    assert(!serializedAlice.includes(sensitive), `Leaked sensitive string: ${sensitive}`);
  }

  // Bob gets strictly his own vegetarian-only history, never Alice's
  const bobSug = await getChatSuggestions(db, {
    customerId: bob.customer.id,
    now: new Date("2026-11-15T02:00:00Z"),
  });
  assert.equal(bobSug.payload.signedIn, true);
  assert.equal(bobSug.payload.recentOrderCount, 2);
  assert.equal(bobSug.aiHint.vegetarianOnly, true);
  assert(bobSug.payload.menuSuggestions.every((s) => s.isVeg));
  assert(bobSug.payload.cartSuggestions.every((s) => s.isVeg));
  assert(!bobSug.aiHint.recentDishNames.includes("Butter Chicken"));

  // 9. Cart pricing + existing checkout/order flow with chat-suggested items
  const chosenForCart = [
    aliceSug.payload.menuSuggestions[0]!,
    aliceSug.payload.dessertOfTheDay!,
    aliceSug.payload.drinkOfTheDay!,
  ];
  const priced = await priceCart(
    db,
    chosenForCart.map((s) => ({ variantId: s.variantId, qty: 1 })),
  );
  assert.equal(priced.lines.length, 3);
  const checkoutOrder = await createOrder(db, {
    channel: "pickup",
    customerName: alice.customer.name,
    email: alice.customer.email,
    phone: "0411 222 333",
    paymentMethod: "online",
    paymentOption: "card_visa",
    paymentLast4: "4242",
    customerId: alice.customer.id,
    items: chosenForCart.map((s) => ({
      itemId: s.itemId,
      variantId: s.variantId,
      qty: 1,
      spiceLevel: s.spice,
    })),
  });
  assert.equal(checkoutOrder.order.payment_status, "paid");
  assert(checkoutOrder.order.total_cents >= priced.subtotalCents);

  // 10. AI-enabled scenario: mocked OpenAI receives menu, daily specials & de-identified hint — NO PII
  const oldFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test";
  process.env.OPENAI_CHAT_MODEL = "test-model";
  globalThis.fetch = async (_input, init) => {
    const data = JSON.parse(String(init?.body));
    const systemPrompt: string = data.messages[0].content;
    assert(systemPrompt.includes("Biryani") || systemPrompt.includes("biryani"));
    assert(systemPrompt.includes("Dessert of the Day"));
    assert(systemPrompt.includes("Drink of the Day"));
    assert(systemPrompt.includes("Butter Chicken"));
    const fullBody = JSON.stringify(data);
    assert(!fullBody.includes("a@example.com"));
    assert(!fullBody.includes("alice.private@example.com"));
    assert(!fullBody.includes("Alice SecretName"));
    assert(!fullBody.includes("0411 222 333"));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Try Butter Chicken with Gulab Jamun!" } }],
      }),
      { status: 200 },
    );
  };
  try {
    const answer = await askAssistant(
      db,
      [{ sender: "customer", text: "a@example.com recommend a dish" }],
      aliceSug.aiHint,
    );
    assert.equal(answer, "Try Butter Chicken with Gulab Jamun!");
  } finally {
    globalThis.fetch = oldFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_CHAT_MODEL;
    await close();
  }

  console.log(
    "Chat staff-only/AI config, encryption, handoff boundary, RLS, redaction, last-5 recommendations, daily specials, cart/checkout and privacy checks passed",
  );
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
