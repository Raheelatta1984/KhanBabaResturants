"use client";
import { useCallback, useEffect, useState } from "react";
type Conversation = {
  id: string;
  status: string;
  handoff_after_message_id?: number | null;
  updated_at: string;
};
type Message = { id: number; sender: string; text: string };
export function StaffChat({ archive = false }: { archive?: boolean }) {
  const [chats, setChats] = useState<Conversation[]>([]);
  const [id, setId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const suffix = archive ? "archive=1" : "";
      const list = await fetch(`/api/ops/chat?${suffix}`, { cache: "no-store" });
      const data = await list.json();
      if (!list.ok) {
        setError(data.error);
        return;
      }
      setChats(data.chats);
      if (id) {
        const res = await fetch(
          `/api/ops/chat?${suffix}&id=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );
        const detail = await res.json();
        if (res.ok) setMessages(detail.messages);
        else {
          setMessages([]);
          setError(detail.error);
        }
      }
    } catch {
      setError("Unable to reach chat.");
    }
  }, [archive, id]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function send(action: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ops/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, text }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error);
      else {
        setText("");
        if (action === "close") {
          setId("");
          setMessages([]);
        }
      }
      await refresh();
    } catch {
      setError("Unable to reach chat.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>{archive ? "Chat archive" : "Guest chat queue"}</h1>
      <p className="muted" style={{ margin: "12px 0" }}>
        {archive
          ? "Administrator-only conversation history. Reads are audited. Chat encryption covers chat message bodies only, not orders or customer profiles."
          : "Active guest counter chats and post-handoff messages from AI conversations. Pre-handoff AI exchanges remain hidden. Refreshes every five seconds."}
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {chats.length === 0 && <p>No conversations.</p>}
        {chats.map((chat) => {
          const origin =
            chat.status === "waiting"
              ? (chat.handoff_after_message_id ?? 0) > 0
                ? "AI handoff"
                : "Direct counter"
              : chat.status;
          return (
            <button
              className="btn btn-outline"
              key={chat.id}
              onClick={() => {
                setId(chat.id);
                setMessages([]);
                setError("");
              }}
            >
              Chat {chat.id.slice(0, 8)} · {origin} ·{" "}
              {new Date(chat.updated_at).toLocaleString()}
            </button>
          );
        })}
      </div>
      {id && (
        <section style={{ marginTop: 25 }}>
          <h2>Conversation {id.slice(0, 8)}</h2>
          <div
            aria-live="polite"
            style={{ margin: "16px 0", maxHeight: 400, overflowY: "auto" }}
          >
            {messages.length === 0 ? (
              <p className="muted">
                No messages visible yet — waiting for the guest&apos;s message.
              </p>
            ) : (
              messages.map((m) => (
                <p
                  key={m.id}
                  style={{
                    marginBottom: 12,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  <strong>{m.sender}:</strong> {m.text}
                </p>
              ))
            )}
          </div>
          {!archive && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (text.trim()) void send("reply");
                }}
              >
                <label htmlFor="staff-reply">Reply</label>
                <textarea
                  id="staff-reply"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  maxLength={1500}
                  style={{ display: "block", width: "100%", margin: "8px 0" }}
                />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="btn btn-primary"
                    disabled={busy || !text.trim()}
                  >
                    Send
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => void send("close")}
                  >
                    End conversation
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
