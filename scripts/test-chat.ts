import assert from "node:assert/strict";
import { createHarness } from "./lib/pglite";
import { SCHEMA_SQL } from "../lib/db/schema";
import { seedDatabase } from "../lib/db/seed";
import { chatKey, encryptMessage, decryptMessage } from "../lib/chat/crypto";
import { addMessage, readMessages, minimiseForAI } from "../lib/chat/service";
import { askAssistant } from "../lib/chat/assistant";
import { authorisedCron, pruneExpiredChats } from "../lib/chat/retention";
import { allowChatRequest, clientHash } from "../lib/chat/rate-limit";
import { redact } from "../lib/ops/actions";

async function main() {
  delete process.env.CHAT_ENCRYPTION_KEY;
  assert.throws(chatKey);
  process.env.CHAT_ENCRYPTION_KEY = "01".repeat(32);
  const cipher = encryptMessage("Private message", "conversation", "customer");
  assert(!cipher.includes("Private message"));
  assert.equal(decryptMessage(cipher, "conversation", "customer"), "Private message");
  assert.throws(() => decryptMessage(cipher, "other", "customer"));
  assert.throws(() => decryptMessage(cipher, "conversation", "staff"));
  const parts = cipher.split("."); const tag = Buffer.from(parts[2], "base64"); tag[0] ^= 1; parts[2] = tag.toString("base64");
  assert.throws(() => decryptMessage(parts.join("."), "conversation", "customer"));
  process.env.CHAT_ENCRYPTION_KEY = "02".repeat(32);
  process.env.CHAT_OLD_ENCRYPTION_KEYS = "01".repeat(32);
  assert.equal(decryptMessage(cipher, "conversation", "customer"), "Private message");
  delete process.env.CHAT_OLD_ENCRYPTION_KEYS;
  assert.throws(() => decryptMessage(cipher, "conversation", "customer"));
  assert(!authorisedCron("Bearer short", "short"));
  assert(!authorisedCron("Bearer wrong", "x".repeat(32)));
  assert(authorisedCron(`Bearer ${"x".repeat(32)}`, "x".repeat(32)));
  assert.equal(minimiseForAI("Email me at a@example.com or call 0412 345 678"), "Email me at [email removed] or call [number removed]");
  assert.deepEqual(redact({ action: "reply", text: "private details", id: "abc" }, "", 0, "chat"), { action: "reply", text: "[withheld]", id: "[withheld]" });
  const { db, close } = await createHarness();
  await db.exec(SCHEMA_SQL); await seedDatabase(db);
  await db.run("INSERT INTO chat_conversations (id, token_hash) VALUES ($1,$2)", ["chat1", "hash"]);
  await addMessage(db, "chat1", "customer", "private before handoff");
  const before = await db.one<{ id: number; ciphertext: string }>("SELECT id,ciphertext FROM chat_messages WHERE conversation_id=$1", ["chat1"]);
  assert(!before.ciphertext.includes("private before handoff"));
  await addMessage(db, "chat1", "customer", "after handoff");
  assert.deepEqual((await readMessages(db, "chat1", before.id)).map((m) => m.text), ["after handoff"]);
  await db.run("INSERT INTO chat_conversations (id, token_hash, updated_at) VALUES ($1,$2,now() - interval '8 days')", ["expired", "expired-hash"]);
  await addMessage(db, "expired", "customer", "old message");
  await db.run("UPDATE chat_conversations SET updated_at=now() - interval '8 days' WHERE id='expired'");
  assert.equal(await pruneExpiredChats(db), 1);
  assert.equal((await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM chat_messages WHERE conversation_id='expired'")).count, 0);
  assert.equal((await readMessages(db, "chat1")).length, 2);
  const hash = clientHash(new Headers()); assert(hash && hash !== "local");
  process.env.VERCEL = "1";
  assert.equal(clientHash(new Headers()), null);
  assert(clientHash(new Headers({ "x-vercel-forwarded-for": "203.0.113.4" })));
  assert.equal(clientHash(new Headers({ "x-vercel-forwarded-for": "spoofed" })), null);
  delete process.env.VERCEL;
  for (let i = 0; i < 30; i++) assert(await allowChatRequest(db, hash));
  assert.equal(await allowChatRequest(db, hash), false);
  const rls = await db.query<{ relname: string; relrowsecurity: boolean }>("SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('chat_conversations','chat_messages','chat_ai_quota')");
  assert.equal(rls.length, 3); assert(rls.every((r) => r.relrowsecurity));
  const oldFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test"; process.env.OPENAI_CHAT_MODEL = "test-model";
  globalThis.fetch = async (_input, init) => {
    const data = JSON.parse(String(init?.body));
    assert(data.messages[0].content.includes("biryani") || data.messages[0].content.includes("Biryani"));
    assert(!JSON.stringify(data).includes("a@example.com"));
    return new Response(JSON.stringify({ choices: [{ message: { content: "Try biryani." } }] }), { status: 200 });
  };
  try { assert.equal(await askAssistant(db, [{ sender: "customer", text: "a@example.com" }]), "Try biryani."); }
  finally { globalThis.fetch = oldFetch; await close(); }
  console.log("Chat encryption, handoff boundary, RLS, redaction and AI request checks passed");
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
