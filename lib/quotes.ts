import { createHmac, timingSafeEqual } from "node:crypto";

export type QuotePayload = {
  provider: string;
  quoteId: string;
  costCents: number;
  customerFeeCents: number;
  etaMinutes: number;
  expiresAt: string;
  live: boolean;
  addressHash: string;
};

function secret(): string {
  return process.env.SESSION_SECRET || "khan-baba-dev-secret-change-me";
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

/** Sign a delivery quote so the checkout cannot tamper with the courier fee. */
export function signQuote(payload: QuotePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyQuote(token: string | undefined | null): QuotePayload | null {
  if (!token || !token.includes(".")) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as QuotePayload;
    if (!payload.expiresAt || new Date(payload.expiresAt).getTime() < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function addressHash(address: string): string {
  return createHmac("sha256", "kb-address").update(address.trim().toLowerCase()).digest("hex").slice(0, 16);
}
