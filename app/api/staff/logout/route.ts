import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/core";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: SESSION_COOKIE, value: "", path: "/", maxAge: 0 });
  return response;
}
