import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/api";
import { setSettings, DEFAULT_SETTINGS } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Extra keys the portal may save that are not part of DEFAULT_SETTINGS.
 *
 * These used to be dropped without a word: `Object.entries(values).filter(([key])
 * => key in DEFAULT_SETTINGS)` silently discarded every Instagram field, so
 * saving the Marketing screen looked successful and changed nothing. A rejected
 * field is now named in the response instead of disappearing.
 */
const EXTRA_KEYS = new Set([
  "instagram_account_id",
  "instagram_access_token",
  "instagram_app_secret",
  "instagram_verify_token",
  "instagram_enabled",
]);

export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager"]);
  if (!session)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  let body: { values?: Record<string, string> };
  try {
    body = (await request.json()) as { values?: Record<string, string> };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const values = body.values ?? {};
  const entries = Object.entries(values).filter(
    ([key]) => key in DEFAULT_SETTINGS || EXTRA_KEYS.has(key),
  );
  const rejected = Object.keys(values).filter(
    ([key]) => !(key in DEFAULT_SETTINGS) && !EXTRA_KEYS.has(key),
  );

  if (entries.length === 0) {
    return NextResponse.json(
      {
        error:
          rejected.length > 0
            ? `Unknown settings: ${rejected.join(", ")}`
            : "Nothing to update",
        rejected,
      },
      { status: 400 },
    );
  }

  await setSettings(
    Object.fromEntries(entries.map(([key, value]) => [key, String(value)])),
  );
  return NextResponse.json({
    ok: true,
    updated: entries.length,
    keys: entries.map(([key]) => key),
    ...(rejected.length > 0 ? { rejected } : {}),
  });
}
