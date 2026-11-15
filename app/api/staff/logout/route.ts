import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/core";
import { withActionLog } from "@/lib/ops/actions";

async function post() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: SESSION_COOKIE, value: "", path: "/", maxAge: 0 });
  return response;
}

/** Every call is written to the action log: who, what, the outcome, what to do next. */
export const POST = withActionLog("auth", post, { fallback: "logout" });
