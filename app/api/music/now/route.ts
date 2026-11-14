import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getNowPlaying } from "@/lib/music";
import { getSettings, settingValue } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * The single read the customer website, table screens and in-restaurant displays
 * poll. Public on purpose: it exposes only what is audible in the room — the
 * collection name, the track, its URL and the volume — never the library.
 */
export async function GET() {
  const db = await getDb();
  const [now, settings] = await Promise.all([getNowPlaying(db), getSettings()]);
  return NextResponse.json(
    {
      ...now,
      theme: settingValue(settings, "theme_lahore", "1") !== "0" ? "lahore" : "default",
      requestsNote: settingValue(settings, "music_request_enabled", "1") === "0" ? null : "Requests are reviewed by the counter before they play.",
      serverTime: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
