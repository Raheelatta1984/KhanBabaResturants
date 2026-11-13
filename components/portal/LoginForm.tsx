"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const DEMO_ACCOUNTS = [
  { email: "admin@khanbaba.com.au", role: "Administrator" },
  { email: "counter@khanbaba.com.au", role: "Counter" },
  { email: "kitchen@khanbaba.com.au", role: "Kitchen" },
  { email: "delivery@khanbaba.com.au", role: "Delivery" },
];

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("admin@khanbaba.com.au");
  const [password, setPassword] = useState("KhanBaba2026!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as { error?: string; redirectTo?: string };
      if (!response.ok) throw new Error(data.error || "Sign in failed");
      router.push(nextPath || data.redirectTo || "/admin");
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Sign in failed");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field" style={{ marginBottom: 12 }}>
        <span className="label">Staff email</span>
        <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
      </div>
      <div className="field" style={{ marginBottom: 16 }}>
        <span className="label">Password</span>
        <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
      </div>
      {error ? <div className="notice notice-red" style={{ marginBottom: 12 }}>{error}</div> : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </button>

      <div className="demo-accounts">
        <span className="label">Demo accounts · password KhanBaba2026!</span>
        {DEMO_ACCOUNTS.map((account) => (
          <button
            key={account.email}
            type="button"
            className="demo-account"
            onClick={() => {
              setEmail(account.email);
              setPassword("KhanBaba2026!");
            }}
          >
            <span>{account.role}</span>
            <code>{account.email}</code>
          </button>
        ))}
      </div>
    </form>
  );
}
