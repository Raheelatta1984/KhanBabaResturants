"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
type Message = { id: number; sender: string; text: string };
type Chat = { status: "ai" | "waiting" | "closed" };
export function GuestChat({ phone }: { phone: string }) {
  const [chat, setChat] = useState<Chat | null>(null); const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [consent, setConsent] = useState(false);
  const refresh = useCallback(async () => { try { const res = await fetch("/api/chat", { cache: "no-store" }); const data = await res.json(); if (!res.ok) { setError(data.error); return; } setChat(data.chat); setMessages(data.messages); } catch { setError("Unable to reach chat. Please call us."); } }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer); }, [refresh]);
  async function action(action: string, message?: string) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, text: message, consent }) });
      const data = await res.json(); if (!res.ok) setError(data.error ?? "Chat unavailable"); else if (action === "message") setText("");
      await refresh();
    } catch { setError("Unable to reach chat. Please call us."); } finally { setBusy(false); }
  }
  return <div className="container-narrow section"><span className="eyebrow">Guest assistance</span><h1>Chat with Khan Baba</h1>
    <p style={{ margin: "18px 0" }}>Ask our AI menu assistant about dishes, spice and preferences, or request a counter team member. For allergies, always confirm with staff before ordering. The assistant cannot place an order or take payment.</p>
    <p className="muted">Chat messages are stored encrypted and can be reviewed by administrators. If you request staff, the counter team can see messages sent after the handoff. AI messages are sent to OpenAI for processing. Do not share names, contact details, payment information or other sensitive information here.</p>
    {!chat || chat.status === "closed" ? <div style={{ marginTop: 24 }}><label><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I understand and agree to the chat processing described above.</label><br /><button className="btn btn-primary" disabled={!consent || busy} onClick={() => void action("start")}>Start chat</button></div> : <>
      <p style={{ marginTop: 20 }}><strong>{chat.status === "waiting" ? "Waiting for or speaking with the counter team" : "AI assistant"}</strong></p>
      <div aria-live="polite" style={{ margin: "16px 0", padding: 16, background: "var(--surface)", borderRadius: 12, minHeight: 100, maxHeight: 420, overflowY: "auto" }}>
        {messages.length === 0 ? <p>Tell us what you enjoy, or ask for a team member.</p> : messages.map((m) => <p key={m.id} style={{ marginBottom: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><strong>{m.sender === "customer" ? "You" : m.sender === "staff" ? "Counter" : "AI"}:</strong> {m.text}</p>)}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) void action("message", text); }}><label htmlFor="chat-message">Message</label><textarea id="chat-message" value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} rows={3} style={{ display: "block", width: "100%", margin: "8px 0" }} /><button className="btn btn-primary" disabled={busy || !text.trim()}>Send</button></form>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>{chat.status === "ai" && <button className="btn btn-outline" disabled={busy} onClick={() => void action("handoff")}>Talk to staff</button>}<button className="btn btn-ghost" disabled={busy} onClick={() => void action("close")}>End conversation</button></div>
      {chat.status === "waiting" && <p className="muted" style={{ marginTop: 12 }}>Staff can only see messages sent after you requested them. Please repeat your question here. Replies depend on team availability.</p>}
    </>}
    {error && <p role="alert" style={{ marginTop: 16 }}>{error}</p>}
    <p style={{ marginTop: 24 }}><a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>Call {phone}</a> · <Link href="/menu">Browse and order from the menu</Link></p>
  </div>;
}
