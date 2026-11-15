import assert from "node:assert/strict";
import { createHarness } from "./lib/pglite";
import { SCHEMA_SQL } from "../lib/db/schema";
import { seedDatabase } from "../lib/db/seed";
import { chatKey, encryptMessage, decryptMessage } from "../lib/chat/crypto";
import { addMessage, readMessages, minimiseForAI } from "../lib/chat/service";
import { askAssistant } from "../lib/chat/assistant";
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
