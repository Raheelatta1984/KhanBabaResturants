/**
 * Signed, tamper-proof tokens — the one primitive behind both login cookies.
 *
 * A token is `base64url(json payload) . base64url(HMAC-SHA256)`. The payload
 * carries an `exp` claim (seconds since epoch) and an `aud` claim (which kind of
 * session it is), so a staff cookie can never be replayed as a customer cookie
 * even though both are signed with the same secret.
 *
 * No database is involved: the signature is the proof, which is what lets the
 * public layout read the customer's name without touching Postgres.
 */

/** The signing secret. `SESSION_SECRET` in production; a dev default otherwise. */
export function authSecret(): string {
  return process.env.SESSION_SECRET || "khan-baba-dev-secret-change-me";
}

export function toBase64Url(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function hmac(data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

/** Constant-time-ish comparison: no early exit on the first differing byte. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Sign `payload`, adding an `exp` claim `ttlSeconds` from now. */
export async function signToken(
  payload: Record<string, unknown>,
  ttlSeconds: number,
): Promise<string> {
  const body = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        ...payload,
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      }),
    ),
  );
  const signature = toBase64Url(await hmac(body));
  return `${body}.${signature}`;
}

/**
 * Verify the signature and the expiry, then hand back the payload.
 * Returns null for anything that does not check out — never throws, because
 * every caller treats "not signed in" as a normal outcome.
 */
export async function verifyToken<T extends { exp?: number }>(
  token: string | undefined | null,
): Promise<T | null> {
  if (!token || !token.includes(".")) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = toBase64Url(await hmac(body));
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(body)),
    ) as T;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
