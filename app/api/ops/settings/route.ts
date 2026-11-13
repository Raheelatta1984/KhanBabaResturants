import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/api";
import { setSettings, DEFAULT_SETTINGS } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  let body: { values?: Record<string, string> };
  try {
    body = (await request.json()) as { values?: Record<string, string> };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const values = body.values ?? {};
  const entries = Object.entries(values).filter(([key]) => key in DEFAULT_SETTINGS);
  if (entries.length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  setSettings(Object.fromEntries(entries.map(([key, value]) => [key, String(value)])));
  return NextResponse.json({ ok: true, updated: entries.length });
}
