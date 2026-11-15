import type { Db } from "@/lib/db";
import { decryptMessage, encryptMessage } from "./crypto";

export type ChatMessage = { id: number; sender: "customer" | "assistant" | "staff"; ciphertext: string; created_at: string };
export type Conversation = { id: string; status: "ai" | "waiting" | "closed"; handoff_at: string | null; handoff_after_message_id: number | null; created_at: string; updated_at: string };
export type ConversationRecord = Conversation & { customer_id: number | null };
export function publicConversation(row: ConversationRecord): Conversation {
  return {
    id: row.id,
    status: row.status,
    handoff_at: row.handoff_at,
    handoff_after_message_id: row.handoff_after_message_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
export async function addMessage(db: Db, id: string, sender: ChatMessage["sender"], text: string) {
  await db.run("INSERT INTO chat_messages (conversation_id, sender, ciphertext) VALUES ($1,$2,$3)", [id, sender, encryptMessage(text, id, sender)]);
  await db.run("UPDATE chat_conversations SET updated_at = now() WHERE id = $1", [id]);
}
export async function readMessages(db: Db, id: string, afterId?: number | null) {
  const rows = await db.query<ChatMessage>("SELECT id, sender, ciphertext, created_at FROM chat_messages WHERE conversation_id=$1 AND ($2::integer IS NULL OR id > $2::integer) ORDER BY id LIMIT 200", [id, afterId ?? null]);
  return rows.map(({ ciphertext, ...row }) => ({ ...row, text: decryptMessage(ciphertext, id, row.sender) }));
}
/** Best effort minimisation, not a guarantee: customers should not enter PII. */
export function minimiseForAI(text: string): string {
  return text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email removed]").replace(/(?:\+?\d[\d ()-]{7,}\d)/g, "[number removed]");
}
