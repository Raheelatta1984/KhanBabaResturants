"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "signin" | "signup";

/**
 * One form for both modes: customers do not think in terms of "sign up" vs
 * "log in" until they have an account, so the toggle is a single click and the
 * fields that only matter to sign-up appear in place.
 */
export function CustomerAuthForm({
  mode,
  nextPath,
  reason,
}: {
  mode: Mode;
  nextPath?: string;
  reason?: string;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<Mode>(mode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/customer/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: current,
          name,
          email,
          password,
          phone,
          marketingOptIn: marketing,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        redirectTo?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not sign you in");
      router.push(nextPath || data.redirectTo || "/account");
      router.refresh();
    } catch (authError) {
      setError(
        authError instanceof Error ? authError.message : "Could not sign you in",
      );
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="auth-switch">
        <button
          type="button"
          data-active={current === "signin" ? "true" : "false"}
          onClick={() => setCurrent("signin")}
        >
          Sign in
        </button>
        <button
          type="button"
          data-active={current === "signup" ? "true" : "false"}
          onClick={() => setCurrent("signup")}
        >
          Create account
        </button>
      </div>

      {reason === "signin" ? (
        <div className="notice" style={{ marginBottom: 14 }}>
          Sign in to see that page and your order history.
        </div>
      ) : null}

      {current === "signup" ? (
        <div className="field" style={{ marginBottom: 12 }}>
          <span className="label">Your name</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
          />
        </div>
      ) : null}

      <div className="field" style={{ marginBottom: 12 }}>
        <span className="label">Email</span>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />
      </div>

      {current === "signup" ? (
        <div className="field" style={{ marginBottom: 12 }}>
          <span className="label">Mobile (for the courier)</span>
          <input
            className="input"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
            placeholder="0412 345 678"
          />
        </div>
      ) : null}

      <div className="field" style={{ marginBottom: 16 }}>
        <span className="label">Password</span>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={current === "signup" ? "new-password" : "current-password"}
          minLength={current === "signup" ? 8 : undefined}
          required
        />
        {current === "signup" ? (
          <span className="tiny muted">At least 8 characters.</span>
        ) : null}
      </div>

      {current === "signup" ? (
        <label className="check" style={{ marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={marketing}
            onChange={(event) => setMarketing(event.target.checked)}
          />
          Send me the occasional specials message
        </label>
      ) : null}

      {error ? <div className="notice notice-red" style={{ marginBottom: 12 }}>{error}</div> : null}

      <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
        {loading
          ? "One moment…"
          : current === "signup"
            ? "Create my account"
            : "Sign in"}
      </button>

      <p className="tiny muted" style={{ marginTop: 14, textAlign: "center" }}>
        You do not need an account to order —{" "}
        <Link href="/menu" style={{ color: "var(--accent)" }}>
          order as a guest
        </Link>{" "}
        and the tracking link still works.
      </p>

      <div className="notice" style={{ marginTop: 16 }}>
        <span>
          Already ordered as a guest? Sign in with the email you used and your
          past orders attach to your account automatically.
        </span>
      </div>
    </form>
  );
}
