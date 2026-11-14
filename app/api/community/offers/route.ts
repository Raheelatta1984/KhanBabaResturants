import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { publicOffers } from "@/lib/community";

export const dynamic = "force-dynamic";

/** Public list of community meals (never exposes pickup codes). */
export async function GET() {
  const db = await getDb();
  return NextResponse.json({ offers: await publicOffers(db) });
}
