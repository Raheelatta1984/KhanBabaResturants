import { randomBytes } from "node:crypto";
import type { Db } from "./db";
import { getSettings, settingNumber, settingValue } from "./settings";
import { getTimeParts, isTimeWithin, minutesFromHHMM } from "./time";
import { parseYouTubeId } from "./youtube";

/**
 * The Lahore music system.
 *
 * A single shared player row (`music_player` id = 1) is the source of truth for
 * every screen: the counter and admin consoles control it, the customer website
 * and the in-restaurant display follow it. There is one room, so there is one
 * player — no per-device drift.
 *
 * Rules encoded here:
 *   · Collections are either `music` or `religious`. A religious collection
 *     (naat, hamd, tilawat, qawwali in a devotional set) is never interrupted by
 *     ambience or by the table-order encouragement cue.
 *   · A schedule plays a collection automatically by weekday and time of day.
 *     `mode = manual` means a staff member deliberately took over.
 *   · Volume defaults to 20% and is capped at a comfortable level. Customers can
 *     always mute on their own device without affecting the room.
 *   · A customer song request needs a URL, staff approval, and optionally a
 *     charge that staff may waive or adjust up or down.
 */

export type TrackRow = {
  id: number;
  title: string;
  artist: string | null;
  url: string;
  provider: "audio" | "youtube";
  kind: "music" | "religious";
  category: string | null;
  duration_seconds: number | null;
  active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type CollectionRow = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  kind: "music" | "religious";
  cover: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  track_count?: number;
  total_seconds?: number;
};

export type ScheduleRow = {
  id: number;
  collection_id: number;
  label: string | null;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  priority: number;
  active: boolean;
  collection_name?: string;
  collection_kind?: string;
};

export type PlayerRow = {
  id: number;
  collection_id: number | null;
  track_id: number | null;
  status: "playing" | "paused" | "stopped";
  position_seconds: number;
  volume: number;
  mode: "auto" | "manual";
  encouragement_pending: boolean;
  started_at: string | null;
  updated_at: string;
  updated_by: string | null;
};

export type MusicRequestRow = {
  id: number;
  token: string;
  customer_name: string;
  phone: string | null;
  email: string | null;
  order_id: number | null;
  table_code: string | null;
  title: string;
  url: string;
  provider: "audio" | "youtube";
  note: string | null;
  status: "pending" | "approved" | "rejected" | "played";
  charge_cents: number;
  charge_note: string | null;
  charge_posted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  track_id: number | null;
  created_at: string;
  order_code?: string | null;
};

export type NowPlaying = {
  enabled: boolean;
  status: "playing" | "paused" | "stopped";
  mode: "auto" | "manual";
  volume: number;
  collection: { id: number; name: string; kind: "music" | "religious" } | null;
  track: {
    id: number;
    title: string;
    artist: string | null;
    url: string;
    provider: "audio" | "youtube";
    kind: "music" | "religious";
    youtubeId: string | null;
  } | null;
  isReligious: boolean;
  /** False while a religious collection is on — ambience and requests stay silent. */
  ambienceAllowed: boolean;
  encouragement: { active: boolean; message: string } | null;
  note: string;
  updatedAt: string | null;
  updatedBy: string | null;
  requestsOpen: boolean;
};

/** A URL is mandatory for every request and every track. Audio files or YouTube. */
export function trackProvider(url: string): "audio" | "youtube" {
  return parseYouTubeId(url) ? "youtube" : "audio";
}

export function validTrackUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function requestToken(): string {
  return randomBytes(12).toString("base64url");
}

export async function ensurePlayer(db: Db): Promise<PlayerRow> {
  await db.query(
    `INSERT INTO music_player (id, status, volume, mode, updated_at)
     VALUES (1, 'stopped', 20, 'auto', now())
     ON CONFLICT (id) DO NOTHING`,
  );
  return (await db.maybeOne<PlayerRow>("SELECT * FROM music_player WHERE id = 1"))!;
}

/** Weekday + time matcher for a schedule row (windows may cross midnight). */
export function scheduleMatches(schedule: ScheduleRow, now = new Date()): boolean {
  const parts = getTimeParts(now);
  if (schedule.days?.trim()) {
    const days = schedule.days
      .split(",")
      .map((day) => Number(day.trim()))
      .filter((day) => Number.isInteger(day));
    if (days.length > 0 && !days.includes(parts.weekday)) return false;
  }
  return isTimeWithin(parts.hhmm, schedule.start_time, schedule.end_time);
}

/** The collection the schedule wants right now, or null outside every window. */
export async function scheduledCollection(
  db: Db,
  now = new Date(),
): Promise<{ schedule: ScheduleRow; collection: CollectionRow } | null> {
  const rows = await db.query<ScheduleRow & { collection_name: string; collection_kind: string }>(
    `SELECT s.*, c.name AS collection_name, c.kind AS collection_kind
       FROM music_schedules s
       JOIN music_collections c ON c.id = s.collection_id
      WHERE s.active AND c.active
      ORDER BY s.priority DESC, s.id`,
  );
  const match = rows.find((row) => scheduleMatches(row, now));
  if (!match) return null;
  const collection = await db.maybeOne<CollectionRow>(
    "SELECT * FROM music_collections WHERE id = $1",
    [match.collection_id],
  );
  return collection ? { schedule: match, collection } : null;
}

async function firstTrack(db: Db, collectionId: number): Promise<TrackRow | null> {
  return db.maybeOne<TrackRow>(
    `SELECT t.* FROM music_collection_tracks ct
       JOIN music_tracks t ON t.id = ct.track_id
      WHERE ct.collection_id = $1 AND t.active
      ORDER BY ct.position, ct.id LIMIT 1`,
    [collectionId],
  );
}

async function nextTrack(
  db: Db,
  collectionId: number,
  currentTrackId: number | null,
): Promise<TrackRow | null> {
  const tracks = await db.query<TrackRow>(
    `SELECT t.* FROM music_collection_tracks ct
       JOIN music_tracks t ON t.id = ct.track_id
      WHERE ct.collection_id = $1 AND t.active
      ORDER BY ct.position, ct.id`,
    [collectionId],
  );
  if (tracks.length === 0) return null;
  if (!currentTrackId) return tracks[0];
  const index = tracks.findIndex((track) => track.id === currentTrackId);
  return tracks[(index + 1) % tracks.length];
}

/**
 * The shared now-playing snapshot. In `auto` mode a schedule change is applied
 * lazily on read — a page load (or the 15-second poll) is what advances the
 * room to the next scheduled collection, so no cron is needed.
 */
export async function getNowPlaying(db: Db): Promise<NowPlaying> {
  const settings = await getSettings();
  const enabled = settingValue(settings, "music_enabled", "1") !== "0";
  const pauseDuringReligious = settingValue(settings, "music_pause_during_religious", "1") !== "0";
  const note = settingValue(settings, "music_now_playing_note", "");

  let player = await ensurePlayer(db);
  let collection: CollectionRow | null = player.collection_id
    ? await db.maybeOne<CollectionRow>("SELECT * FROM music_collections WHERE id = $1", [
        player.collection_id,
      ])
    : null;
  let track: TrackRow | null = player.track_id
    ? await db.maybeOne<TrackRow>("SELECT * FROM music_tracks WHERE id = $1", [player.track_id])
    : null;

  // Auto mode: follow the schedule, but never override a deliberate pause/stop.
  if (player.mode === "auto" && player.status !== "stopped") {
    const scheduled = await scheduledCollection(db);
    if (scheduled && scheduled.collection.id !== player.collection_id) {
      const first = await firstTrack(db, scheduled.collection.id);
      const nextStatus = player.status === "playing" ? "playing" : "playing";
      await db.query(
        `UPDATE music_player SET collection_id = $1, track_id = $2, status = $3,
           mode = 'auto', started_at = now(), updated_at = now(), updated_by = 'schedule'
         WHERE id = 1`,
        [scheduled.collection.id, first?.id ?? null, nextStatus],
      );
      player = (await ensurePlayer(db));
      collection = scheduled.collection;
      track = first;
    } else if (!scheduled && player.collection_id && collection) {
      // Outside every window: close the room quietly.
      await db.query(
        "UPDATE music_player SET status = 'stopped', collection_id = NULL, track_id = NULL, updated_at = now(), updated_by = 'schedule' WHERE id = 1",
      );
      player = await ensurePlayer(db);
      collection = null;
      track = null;
    }
  }

  if (collection && !track && player.status === "playing") {
    track = await firstTrack(db, collection.id);
    if (track) {
      await db.query("UPDATE music_player SET track_id = $1, updated_at = now() WHERE id = 1", [
        track.id,
      ]);
    }
  }

  const isReligious =
    collection?.kind === "religious" || track?.kind === "religious";
  const encouragementPending = Boolean(player.encouragement_pending);
  const encouragementActive =
    encouragementPending &&
    player.status === "playing" &&
    !isReligious &&
    settingValue(settings, "music_encouragement_enabled", "1") !== "0";

  return {
    enabled,
    status: player.status,
    mode: player.mode,
    volume: Math.max(0, Math.min(60, Number(player.volume) || 0)),
    collection: collection
      ? { id: collection.id, name: collection.name, kind: collection.kind }
      : null,
    track: track
      ? {
          id: track.id,
          title: track.title,
          artist: track.artist,
          url: track.url,
          provider: track.provider,
          kind: track.kind,
          youtubeId: track.provider === "youtube" ? parseYouTubeId(track.url) : null,
        }
      : null,
    isReligious,
    ambienceAllowed: enabled && !(pauseDuringReligious && isReligious),
    encouragement: encouragementActive
      ? {
          active: true,
          message:
            "Shukriya for ordering at the table — here's a little Lahore for your meal.",
        }
      : encouragementPending && isReligious
        ? {
            active: false,
            message:
              "Shukriya for ordering at the table. A recitation is playing, so the music stays silent out of respect.",
          }
        : null,
    note,
    updatedAt: player.updated_at,
    updatedBy: player.updated_by,
    requestsOpen: settingValue(settings, "music_request_enabled", "1") !== "0",
  };
}

async function record(
  db: Db,
  actor: string,
  action: string,
  detail: string,
): Promise<void> {
  await db.query(
    "INSERT INTO music_player (id, updated_at, updated_by) VALUES (1, now(), $1) ON CONFLICT (id) DO UPDATE SET updated_at = now(), updated_by = EXCLUDED.updated_by",
    [actor],
  );
  console.log(`[music] ${action} by ${actor}: ${detail}`);
}

/** Staff starts a collection (or a single track). Manual mode takes over. */
export async function playCollection(
  db: Db,
  actor: string,
  input: { collectionId?: number; trackId?: number; mode?: "auto" | "manual" },
): Promise<PlayerRow> {
  await ensurePlayer(db);
  let collectionId = input.collectionId ?? null;
  let track: TrackRow | null = null;

  if (input.trackId) {
    track = await db.maybeOne<TrackRow>("SELECT * FROM music_tracks WHERE id = $1", [input.trackId]);
    if (!track) throw new Error("Track not found");
    if (!collectionId) {
      const link = await db.maybeOne<{ collection_id: number }>(
        "SELECT collection_id FROM music_collection_tracks WHERE track_id = $1 ORDER BY collection_id LIMIT 1",
        [track.id],
      );
      collectionId = link?.collection_id ?? null;
    }
  }

  if (collectionId) {
    const collection = await db.maybeOne<CollectionRow>(
      "SELECT * FROM music_collections WHERE id = $1",
      [collectionId],
    );
    if (!collection) throw new Error("Collection not found");
    if (!track) track = await firstTrack(db, collectionId);
  }

  await db.query(
    `UPDATE music_player SET collection_id = $1, track_id = $2, status = 'playing',
       mode = $3, position_seconds = 0, encouragement_pending = FALSE,
       started_at = now(), updated_at = now(), updated_by = $4
     WHERE id = 1`,
    [collectionId, track?.id ?? null, input.mode ?? "manual", actor],
  );
  await record(
    db,
    actor,
    "play",
    `${collectionId ? `collection ${collectionId}` : "track"} · ${track?.title ?? "silence"}`,
  );
  return ensurePlayer(db);
}

export async function pauseMusic(db: Db, actor: string): Promise<PlayerRow> {
  await ensurePlayer(db);
  await db.query(
    "UPDATE music_player SET status = 'paused', mode = 'manual', updated_at = now(), updated_by = $1 WHERE id = 1",
    [actor],
  );
  await record(db, actor, "pause", "room paused");
  return ensurePlayer(db);
}

export async function resumeMusic(db: Db, actor: string): Promise<PlayerRow> {
  const player = await ensurePlayer(db);
  const track = player.track_id
    ? await db.maybeOne<TrackRow>("SELECT * FROM music_tracks WHERE id = $1", [player.track_id])
    : player.collection_id
      ? await firstTrack(db, player.collection_id)
      : null;
  if (!track && !player.collection_id)
    throw new Error("Nothing queued — start a collection first");
  await db.query(
    `UPDATE music_player SET status = 'playing', track_id = COALESCE(track_id, $1),
       started_at = COALESCE(started_at, now()), updated_at = now(), updated_by = $2
     WHERE id = 1`,
    [track?.id ?? null, actor],
  );
  await record(db, actor, "resume", track?.title ?? "resumed");
  return ensurePlayer(db);
}

export async function stopMusic(db: Db, actor: string): Promise<PlayerRow> {
  await ensurePlayer(db);
  await db.query(
    `UPDATE music_player SET status = 'stopped', mode = 'manual', position_seconds = 0,
       started_at = NULL, updated_at = now(), updated_by = $1 WHERE id = 1`,
    [actor],
  );
  await record(db, actor, "stop", "room stopped");
  return ensurePlayer(db);
}

/** Restart the current track from zero (the counter's “replay”). */
export async function replayMusic(db: Db, actor: string): Promise<PlayerRow> {
  const player = await ensurePlayer(db);
  if (!player.track_id && !player.collection_id)
    throw new Error("Nothing to replay");
  await db.query(
    `UPDATE music_player SET status = 'playing', position_seconds = 0,
       started_at = now(), updated_at = now(), updated_by = $1 WHERE id = 1`,
    [actor],
  );
  await record(db, actor, "replay", `track ${player.track_id ?? "first"}`);
  return ensurePlayer(db);
}

export async function nextMusic(db: Db, actor: string): Promise<PlayerRow> {
  const player = await ensurePlayer(db);
  if (!player.collection_id) throw new Error("No collection is playing");
  const upcoming = await nextTrack(db, player.collection_id, player.track_id);
  if (!upcoming) throw new Error("That collection has no tracks yet");
  await db.query(
    `UPDATE music_player SET track_id = $1, status = 'playing', position_seconds = 0,
       started_at = now(), updated_at = now(), updated_by = $2 WHERE id = 1`,
    [upcoming.id, actor],
  );
  await record(db, actor, "next", upcoming.title);
  return ensurePlayer(db);
}

export async function setMusicVolume(
  db: Db,
  actor: string,
  volume: number,
): Promise<PlayerRow> {
  const clamped = Math.max(0, Math.min(60, Math.round(Number(volume) || 0)));
  await ensurePlayer(db);
  await db.query(
    "UPDATE music_player SET volume = $1, updated_at = now(), updated_by = $2 WHERE id = 1",
    [clamped, actor],
  );
  return ensurePlayer(db);
}

/** Follow the schedule again after a manual override. */
export async function returnToSchedule(db: Db, actor: string): Promise<PlayerRow> {
  await ensurePlayer(db);
  const scheduled = await scheduledCollection(db);
  if (!scheduled) {
    await db.query(
      "UPDATE music_player SET mode = 'auto', status = 'stopped', collection_id = NULL, track_id = NULL, updated_at = now(), updated_by = $1 WHERE id = 1",
      [actor],
    );
    return ensurePlayer(db);
  }
  const first = await firstTrack(db, scheduled.collection.id);
  await db.query(
    `UPDATE music_player SET mode = 'auto', collection_id = $1, track_id = $2,
       status = 'playing', position_seconds = 0, started_at = now(), updated_at = now(),
       updated_by = $3 WHERE id = 1`,
    [scheduled.collection.id, first?.id ?? null, actor],
  );
  return ensurePlayer(db);
}

// ---------------------------------------------------------------- catalogue
export async function createTrack(
  db: Db,
  actor: string,
  input: {
    title: string;
    url: string;
    artist?: string;
    kind?: "music" | "religious";
    category?: string;
    durationSeconds?: number;
    notes?: string;
  },
): Promise<TrackRow> {
  const title = input.title.trim().slice(0, 160);
  const url = input.url.trim();
  if (!title) throw new Error("Give the track a title");
  if (!validTrackUrl(url)) throw new Error("A valid audio or YouTube URL is required");
  const id = await db.insert(
    `INSERT INTO music_tracks (title, artist, url, provider, kind, category,
        duration_seconds, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      title,
      input.artist?.trim().slice(0, 120) || null,
      url.slice(0, 1000),
      trackProvider(url),
      input.kind === "religious" ? "religious" : "music",
      input.category?.trim().slice(0, 40) || null,
      input.durationSeconds && input.durationSeconds > 0 ? Math.round(input.durationSeconds) : null,
      input.notes?.slice(0, 400) || null,
      actor,
    ],
  );
  return (await db.maybeOne<TrackRow>("SELECT * FROM music_tracks WHERE id = $1", [id]))!;
}

export async function updateTrack(
  db: Db,
  actor: string,
  id: number,
  input: Record<string, unknown>,
): Promise<TrackRow> {
  const track = await db.maybeOne<TrackRow>("SELECT * FROM music_tracks WHERE id = $1", [id]);
  if (!track) throw new Error("Track not found");
  const url = typeof input.url === "string" && input.url.trim() ? input.url.trim() : track.url;
  if (!validTrackUrl(url)) throw new Error("A valid audio or YouTube URL is required");
  await db.query(
    `UPDATE music_tracks SET title = $1, artist = $2, url = $3, provider = $4,
       kind = $5, category = $6, active = $7, notes = $8 WHERE id = $9`,
    [
      typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 160) : track.title,
      typeof input.artist === "string" ? input.artist.trim().slice(0, 120) || null : track.artist,
      url.slice(0, 1000),
      trackProvider(url),
      input.kind === "religious" || input.kind === "music" ? input.kind : track.kind,
      typeof input.category === "string" ? input.category.trim().slice(0, 40) || null : track.category,
      typeof input.active === "boolean" ? input.active : track.active,
      typeof input.notes === "string" ? input.notes.slice(0, 400) : track.notes,
      id,
    ],
  );
  console.log(`[music] track ${id} updated by ${actor}`);
  return (await db.maybeOne<TrackRow>("SELECT * FROM music_tracks WHERE id = $1", [id]))!;
}

export async function deleteTrack(db: Db, actor: string, id: number): Promise<void> {
  const track = await db.maybeOne<TrackRow>("SELECT * FROM music_tracks WHERE id = $1", [id]);
  if (!track) throw new Error("Track not found");
  await db.query("DELETE FROM music_tracks WHERE id = $1", [id]);
  await db.query(
    "UPDATE music_player SET track_id = NULL, updated_at = now(), updated_by = $1 WHERE track_id = $2",
    [actor, id],
  );
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `collection-${Date.now().toString(36)}`;
}

export async function createCollection(
  db: Db,
  actor: string,
  input: { name: string; description?: string; kind?: "music" | "religious"; cover?: string },
): Promise<CollectionRow> {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Give the collection a name");
  let slug = slugify(name);
  const clash = await db.maybeOne<{ id: number }>(
    "SELECT id FROM music_collections WHERE slug = $1",
    [slug],
  );
  if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const id = await db.insert(
    `INSERT INTO music_collections (slug, name, description, kind, cover, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      slug,
      name,
      input.description?.slice(0, 400) || null,
      input.kind === "religious" ? "religious" : "music",
      input.cover?.slice(0, 500) || null,
      actor,
    ],
  );
  return (await db.maybeOne<CollectionRow>("SELECT * FROM music_collections WHERE id = $1", [id]))!;
}

export async function addTrackToCollection(
  db: Db,
  actor: string,
  collectionId: number,
  trackId: number,
): Promise<void> {
  const collection = await db.maybeOne<CollectionRow>(
    "SELECT * FROM music_collections WHERE id = $1",
    [collectionId],
  );
  if (!collection) throw new Error("Collection not found");
  const track = await db.maybeOne<TrackRow>("SELECT * FROM music_tracks WHERE id = $1", [trackId]);
  if (!track) throw new Error("Track not found");
  const position = await db.one<{ next: number }>(
    "SELECT COALESCE(MAX(position), 0) + 1 AS next FROM music_collection_tracks WHERE collection_id = $1",
    [collectionId],
  );
  await db.query(
    `INSERT INTO music_collection_tracks (collection_id, track_id, position)
     VALUES ($1,$2,$3) ON CONFLICT (collection_id, track_id) DO NOTHING`,
    [collectionId, trackId, Number(position.next)],
  );
  console.log(`[music] ${track.title} added to ${collection.name} by ${actor}`);
}

export async function removeTrackFromCollection(
  db: Db,
  collectionId: number,
  trackId: number,
): Promise<void> {
  await db.query(
    "DELETE FROM music_collection_tracks WHERE collection_id = $1 AND track_id = $2",
    [collectionId, trackId],
  );
}

export async function deleteCollection(db: Db, id: number): Promise<void> {
  await db.query("DELETE FROM music_collections WHERE id = $1", [id]);
  await db.query(
    "UPDATE music_player SET collection_id = NULL, track_id = NULL, status = 'stopped', updated_at = now() WHERE collection_id = $1",
    [id],
  );
}

export async function createSchedule(
  db: Db,
  actor: string,
  input: {
    collectionId: number;
    label?: string;
    days?: string;
    startTime?: string;
    endTime?: string;
    priority?: number;
  },
): Promise<void> {
  const collection = await db.maybeOne<{ id: number }>(
    "SELECT id FROM music_collections WHERE id = $1",
    [input.collectionId],
  );
  if (!collection) throw new Error("Collection not found");
  const normalise = (value?: string) => {
    if (!value?.trim()) return null;
    if (!/^\d{2}:\d{2}$/.test(value.trim())) throw new Error("Times must be HH:MM");
    return value.trim();
  };
  await db.query(
    `INSERT INTO music_schedules (collection_id, label, days, start_time, end_time,
        priority, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.collectionId,
      input.label?.slice(0, 120) || null,
      input.days?.trim() || null,
      normalise(input.startTime),
      normalise(input.endTime),
      Number(input.priority) || 0,
      actor,
    ],
  );
  console.log(`[music] schedule created by ${actor}`);
}

export async function toggleSchedule(db: Db, id: number, active: boolean): Promise<void> {
  await db.query("UPDATE music_schedules SET active = $1 WHERE id = $2", [active, id]);
}

export async function deleteSchedule(db: Db, id: number): Promise<void> {
  await db.query("DELETE FROM music_schedules WHERE id = $1", [id]);
}

// ------------------------------------------------------------------ requests
/** The pre-ruled charge right now: peak amount inside the peak window, else base. */
export async function defaultRequestCharge(db: Db): Promise<number> {
  const settings = await getSettings();
  const base = settingNumber(settings, "music_request_base_charge_cents", 500);
  const peak = settingNumber(settings, "music_request_peak_charge_cents", base);
  const start = settingValue(settings, "music_request_peak_start", "18:00");
  const end = settingValue(settings, "music_request_peak_end", "21:30");
  const now = getTimeParts();
  const peakNow =
    minutesFromHHMM(now.hhmm) >= minutesFromHHMM(start) &&
    minutesFromHHMM(now.hhmm) < minutesFromHHMM(end);
  return Math.max(0, peakNow ? peak : base);
}

export async function submitMusicRequest(
  db: Db,
  input: {
    customerName: string;
    title: string;
    url: string;
    phone?: string;
    email?: string;
    tableCode?: string;
    orderId?: number | null;
    note?: string;
  },
): Promise<MusicRequestRow> {
  const settings = await getSettings();
  if (settingValue(settings, "music_request_enabled", "1") === "0")
    throw new Error("Song requests are closed right now");
  const name = input.customerName.trim().slice(0, 80);
  const title = input.title.trim().slice(0, 160);
  const url = input.url.trim();
  if (name.length < 2) throw new Error("Please tell us your name");
  if (!title) throw new Error("What song would you like?");
  if (!validTrackUrl(url)) throw new Error("A link to the song is required (YouTube or audio file)");

  const requiresApproval = settingValue(settings, "music_request_requires_approval", "1") !== "0";
  const charge = requiresApproval ? 0 : await defaultRequestCharge(db);
  const token = requestToken();
  const id = await db.insert(
    `INSERT INTO music_requests (token, customer_name, phone, email, order_id, table_code,
        title, url, provider, note, status, charge_cents, reviewed_by, reviewed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      token,
      name,
      input.phone?.slice(0, 30) || null,
      input.email?.slice(0, 120) || null,
      input.orderId ?? null,
      input.tableCode?.toUpperCase().slice(0, 20) || null,
      title,
      url.slice(0, 1000),
      trackProvider(url),
      input.note?.slice(0, 300) || null,
      requiresApproval ? "pending" : "approved",
      charge,
      requiresApproval ? null : "auto",
      requiresApproval ? null : new Date().toISOString(),
    ],
  );
  return (await db.maybeOne<MusicRequestRow>("SELECT * FROM music_requests WHERE id = $1", [id]))!;
}

/**
 * Approve a request: it becomes a real track in the “On demand” collection, and
 * an optional charge is posted to the table's bill. `chargeCents` may be 0
 * (waived) or adjusted up or down by the staff member.
 */
export async function approveMusicRequest(
  db: Db,
  actor: string,
  id: number,
  input: { chargeCents?: number; chargeNote?: string; playNow?: boolean },
): Promise<{ request: MusicRequestRow; trackId: number }> {
  const request = await db.maybeOne<MusicRequestRow>(
    `SELECT r.*, o.code AS order_code FROM music_requests r
       LEFT JOIN orders o ON o.id = r.order_id WHERE r.id = $1`,
    [id],
  );
  if (!request) throw new Error("Request not found");
  if (request.status !== "pending") throw new Error("That request has already been reviewed");

  const settings = await getSettings();
  const freeAllowed = settingValue(settings, "music_request_free_allowed", "1") !== "0";
  const suggested = await defaultRequestCharge(db);
  let charge = input.chargeCents === undefined ? suggested : Math.round(Number(input.chargeCents));
  if (!Number.isFinite(charge) || charge < 0) throw new Error("Charge must be zero or more");
  if (charge > 0 && charge > 50000) throw new Error("That charge looks too high");
  if (charge === 0 && !freeAllowed) throw new Error("Waiving the charge is disabled in settings");

  const track = await createTrack(db, actor, {
    title: request.title,
    url: request.url,
    kind: "music",
    category: "on-demand",
    notes: `Requested by ${request.customer_name}${request.table_code ? ` · table ${request.table_code}` : ""}`,
  });

  let collection = await db.maybeOne<CollectionRow>(
    "SELECT * FROM music_collections WHERE slug = 'on-demand'",
  );
  if (!collection) {
    collection = await createCollection(db, actor, {
      name: "On demand",
      description: "Guest requests approved by the counter — plays next, then returns to the schedule.",
      kind: "music",
    });
  }
  await addTrackToCollection(db, actor, collection.id, track.id);

  await db.query(
    `UPDATE music_requests SET status = 'approved', charge_cents = $1, charge_note = $2,
       reviewed_by = $3, reviewed_at = now(), track_id = $4 WHERE id = $5`,
    [charge, input.chargeNote?.slice(0, 200) || null, actor, track.id, id],
  );

  if (charge > 0 && request.order_id) {
    await postMusicChargeToOrder(db, request.order_id, charge, `On-demand song: ${request.title}`, actor);
    await db.query("UPDATE music_requests SET charge_posted_at = now() WHERE id = $1", [id]);
  }

  if (input.playNow) {
    await playCollection(db, actor, { collectionId: collection.id, trackId: track.id });
  }

  return {
    request: (await db.maybeOne<MusicRequestRow>("SELECT * FROM music_requests WHERE id = $1", [id]))!,
    trackId: track.id,
  };
}

export async function rejectMusicRequest(
  db: Db,
  actor: string,
  id: number,
  reason?: string,
): Promise<void> {
  await db.query(
    `UPDATE music_requests SET status = 'rejected', reviewed_by = $1, reviewed_at = now(),
       charge_note = COALESCE($2, charge_note) WHERE id = $3 AND status = 'pending'`,
    [actor, reason?.slice(0, 200) || null, id],
  );
}

/**
 * Add a music charge to an existing bill. It is a normal order line, so the
 * counter, the receipt and the totals all agree; surcharges are not recomputed
 * (a song request must not change a weekend surcharge that was already quoted).
 */
export async function postMusicChargeToOrder(
  db: Db,
  orderId: number,
  cents: number,
  label: string,
  actor: string,
): Promise<void> {
  const amount = Math.max(0, Math.round(cents));
  if (amount === 0) return;
  const order = await db.maybeOne<{ id: number; code: string }>(
    "SELECT id, code FROM orders WHERE id = $1",
    [orderId],
  );
  if (!order) throw new Error("Order not found");
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO order_items (order_id, item_id, variant_id, name, variant_label, qty,
          unit_price_cents, line_total_cents, prep_state)
       VALUES ($1, NULL, NULL, $2, 'On demand', 1, $3, $3, 'ready')`,
      [orderId, label.slice(0, 120), amount],
    );
    await tx.query(
      `UPDATE orders SET subtotal_cents = subtotal_cents + $1, total_cents = total_cents + $1,
         music_charge_cents = music_charge_cents + $1, updated_at = now() WHERE id = $2`,
      [amount, orderId],
    );
    await tx.query(
      "INSERT INTO order_events (order_id, type, message, actor) VALUES ($1,'music_charge',$2,$3)",
      [orderId, `${label} — $${(amount / 100).toFixed(2)} added to the bill`, actor],
    );
  });
}

/**
 * Encourage table ordering: the in-room player acknowledges the ticket. The
 * flag is only honoured while a music collection is live — during a religious
 * collection the room stays silent and the guest simply sees the thank-you.
 */
export async function triggerTableEncouragement(
  db: Db,
  orderId: number,
  actor = "system",
): Promise<void> {
  const settings = await getSettings();
  if (settingValue(settings, "music_encouragement_enabled", "1") === "0") return;
  const order = await db.maybeOne<{ id: number; channel: string; table_id: number | null }>(
    "SELECT id, channel, table_id FROM orders WHERE id = $1",
    [orderId],
  );
  if (!order || (order.channel !== "table" && order.channel !== "dine_in")) return;
  const player = await ensurePlayer(db);
  if (player.status !== "playing") return;
  const collection = player.collection_id
    ? await db.maybeOne<{ kind: string }>("SELECT kind FROM music_collections WHERE id = $1", [
        player.collection_id,
      ])
    : null;
  if (collection?.kind === "religious") return;
  await db.query(
    "UPDATE music_player SET encouragement_pending = TRUE, updated_at = now(), updated_by = $1 WHERE id = 1",
    [actor],
  );
  await db.query(
    "INSERT INTO order_events (order_id, type, message, actor) VALUES ($1,'music',$2,$3)",
    [
      orderId,
      "Table order acknowledged — the Lahore ambience stays low for the room",
      actor,
    ],
  );
}

export async function clearEncouragement(db: Db): Promise<void> {
  await db.query("UPDATE music_player SET encouragement_pending = FALSE WHERE id = 1");
}

// ------------------------------------------------------------------- console
export async function musicConsoleData(db: Db) {
  const [tracks, collections, schedules, requests, player, now, recentCharges] =
    await Promise.all([
      db.query<TrackRow>(
        `SELECT * FROM music_tracks ORDER BY kind DESC, title LIMIT 400`,
      ),
      db.query<CollectionRow>(
        `SELECT c.*, (SELECT COUNT(*) FROM music_collection_tracks ct WHERE ct.collection_id = c.id) AS track_count,
           (SELECT COALESCE(SUM(t.duration_seconds), 0) FROM music_collection_tracks ct
              JOIN music_tracks t ON t.id = ct.track_id WHERE ct.collection_id = c.id) AS total_seconds
         FROM music_collections c ORDER BY c.kind DESC, c.name`,
      ),
      db.query<ScheduleRow>(
        `SELECT s.*, c.name AS collection_name, c.kind AS collection_kind
           FROM music_schedules s JOIN music_collections c ON c.id = s.collection_id
          ORDER BY s.priority DESC, s.id`,
      ),
      db.query<MusicRequestRow>(
        `SELECT r.*, o.code AS order_code FROM music_requests r
           LEFT JOIN orders o ON o.id = r.order_id
          ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 40`,
      ),
      ensurePlayer(db),
      getNowPlaying(db),
      db.query<{ id: number; name: string; variant_label: string | null; total_cents: number }>(
        `SELECT oi.id, oi.name, oi.variant_label, oi.line_total_cents AS total_cents
           FROM order_items oi WHERE oi.item_id IS NULL AND oi.variant_label = 'On demand'
          ORDER BY oi.id DESC LIMIT 10`,
      ),
    ]);
  return { tracks, collections, schedules, requests, player, now, recentCharges };
}
