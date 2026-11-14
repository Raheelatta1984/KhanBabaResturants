import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApiSession } from "@/lib/auth/api";
import {
  addTrackToCollection,
  approveMusicRequest,
  createCollection,
  createSchedule,
  createTrack,
  deleteCollection,
  deleteSchedule,
  deleteTrack,
  nextMusic,
  pauseMusic,
  playCollection,
  rejectMusicRequest,
  removeTrackFromCollection,
  replayMusic,
  resumeMusic,
  returnToSchedule,
  setMusicVolume,
  stopMusic,
  toggleSchedule,
  updateTrack,
  clearEncouragement,
  ensurePlayer,
  getNowPlaying,
} from "@/lib/music";

export const dynamic = "force-dynamic";

type Body = Record<string, unknown> & { action?: string };

/**
 * Music controls + library maintenance for the counter and admin.
 * Every action is available to counter staff: the brief asks them to be able to
 * stop, resume, replay and load songs, not just the administrator.
 */
export async function POST(request: Request) {
  const session = await getApiSession(["admin", "manager", "counter"]);
  if (!session) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = await getDb();
  const actor = session.name;
  const num = (value: unknown) => Number(value);
  const str = (value: unknown) => (typeof value === "string" ? value : undefined);
  const bool = (value: unknown) => (typeof value === "boolean" ? value : undefined);

  try {
    switch (body.action) {
      case "play": {
        await playCollection(db, actor, {
          collectionId: body.collectionId ? num(body.collectionId) : undefined,
          trackId: body.trackId ? num(body.trackId) : undefined,
          mode: "manual",
        });
        return NextResponse.json({ ok: true, now: await getNowPlaying(db), message: "Playing" });
      }
      case "pause": {
        await pauseMusic(db, actor);
        return NextResponse.json({ ok: true, now: await getNowPlaying(db), message: "Paused" });
      }
      case "resume": {
        await resumeMusic(db, actor);
        return NextResponse.json({ ok: true, now: await getNowPlaying(db), message: "Resumed" });
      }
      case "stop": {
        await stopMusic(db, actor);
        return NextResponse.json({ ok: true, now: await getNowPlaying(db), message: "Stopped" });
      }
      case "replay": {
        await replayMusic(db, actor);
        return NextResponse.json({ ok: true, now: await getNowPlaying(db), message: "Replaying" });
      }
      case "next": {
        await nextMusic(db, actor);
        return NextResponse.json({ ok: true, now: await getNowPlaying(db), message: "Next track" });
      }
      case "volume": {
        await setMusicVolume(db, actor, num(body.volume));
        return NextResponse.json({ ok: true, now: await getNowPlaying(db), message: `Volume ${num(body.volume)}%` });
      }
      case "auto": {
        await returnToSchedule(db, actor);
        return NextResponse.json({ ok: true, now: await getNowPlaying(db), message: "Following the schedule" });
      }
      case "create-track": {
        const track = await createTrack(db, actor, {
          title: String(body.title ?? ""),
          url: String(body.url ?? ""),
          artist: str(body.artist),
          kind: body.kind === "religious" ? "religious" : "music",
          category: str(body.category),
          durationSeconds: body.durationSeconds ? num(body.durationSeconds) : undefined,
          notes: str(body.notes),
        });
        return NextResponse.json({ ok: true, track, message: `${track.title} added to the library` });
      }
      case "update-track": {
        if (!body.trackId) throw new Error("Track is required");
        const track = await updateTrack(db, actor, num(body.trackId), body);
        return NextResponse.json({ ok: true, track, message: `${track.title} updated` });
      }
      case "delete-track": {
        if (!body.trackId) throw new Error("Track is required");
        await deleteTrack(db, actor, num(body.trackId));
        return NextResponse.json({ ok: true, message: "Track deleted" });
      }
      case "create-collection": {
        const collection = await createCollection(db, actor, {
          name: String(body.name ?? ""),
          description: str(body.description),
          kind: body.kind === "religious" ? "religious" : "music",
          cover: str(body.cover),
        });
        return NextResponse.json({ ok: true, collection, message: `${collection.name} created` });
      }
      case "delete-collection": {
        if (!body.collectionId) throw new Error("Collection is required");
        await deleteCollection(db, num(body.collectionId));
        return NextResponse.json({ ok: true, message: "Collection deleted" });
      }
      case "add-track": {
        if (!body.collectionId || !body.trackId) throw new Error("Collection and track are required");
        await addTrackToCollection(db, actor, num(body.collectionId), num(body.trackId));
        return NextResponse.json({ ok: true, message: "Track added to the collection" });
      }
      case "remove-track": {
        if (!body.collectionId || !body.trackId) throw new Error("Collection and track are required");
        await removeTrackFromCollection(db, num(body.collectionId), num(body.trackId));
        return NextResponse.json({ ok: true, message: "Track removed" });
      }
      case "create-schedule": {
        if (!body.collectionId) throw new Error("Collection is required");
        await createSchedule(db, actor, {
          collectionId: num(body.collectionId),
          label: str(body.label),
          days: str(body.days),
          startTime: str(body.startTime),
          endTime: str(body.endTime),
          priority: body.priority ? num(body.priority) : 0,
        });
        return NextResponse.json({ ok: true, message: "Schedule saved" });
      }
      case "toggle-schedule": {
        if (!body.scheduleId) throw new Error("Schedule is required");
        await toggleSchedule(db, num(body.scheduleId), Boolean(body.active));
        return NextResponse.json({ ok: true, message: "Schedule updated" });
      }
      case "delete-schedule": {
        if (!body.scheduleId) throw new Error("Schedule is required");
        await deleteSchedule(db, num(body.scheduleId));
        return NextResponse.json({ ok: true, message: "Schedule deleted" });
      }
      case "approve-request": {
        if (!body.requestId) throw new Error("Request is required");
        const result = await approveMusicRequest(db, actor, num(body.requestId), {
          chargeCents: body.chargeCents === undefined ? undefined : num(body.chargeCents),
          chargeNote: str(body.chargeNote),
          playNow: bool(body.playNow) ?? true,
        });
        return NextResponse.json({
          ok: true,
          ...result,
          now: await getNowPlaying(db),
          message:
            result.request.charge_cents > 0
              ? `Approved · $${(result.request.charge_cents / 100).toFixed(2)} added to the bill`
              : "Approved · no charge",
        });
      }
      case "reject-request": {
        if (!body.requestId) throw new Error("Request is required");
        await rejectMusicRequest(db, actor, num(body.requestId), str(body.reason));
        return NextResponse.json({ ok: true, message: "Request declined" });
      }
      case "clear-encouragement": {
        await clearEncouragement(db);
        return NextResponse.json({ ok: true, message: "Cleared" });
      }
      case "player": {
        await ensurePlayer(db);
        return NextResponse.json({ ok: true, now: await getNowPlaying(db) });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("music action failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Music action failed" },
      { status: 400 },
    );
  }
}
