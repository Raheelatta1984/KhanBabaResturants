import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { submitFeedback } from "@/lib/feedback";

export const dynamic = "force-dynamic";

/**
 * Guest feedback from the one-time link. The order, party size and dishes are
 * resolved from the token, never from the browser, so a submission can only ever
 * describe the order it was issued for.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  let body: {
    rating?: number;
    comment?: string;
    highlights?: string[];
    partySize?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = await getDb();
  try {
    const result = await submitFeedback(db, token, {
      rating: Number(body.rating),
      comment: body.comment,
      highlights: body.highlights,
      partySize: body.partySize === undefined ? undefined : Number(body.partySize),
    });
    return NextResponse.json({
      ok: true,
      draftId: result.draftId,
      message: "Thank you — your feedback is with the team.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save your feedback" },
      { status: 400 },
    );
  }
}
