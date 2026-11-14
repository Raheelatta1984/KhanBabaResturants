"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";

type Now = {
  enabled: boolean;
  status: "playing" | "paused" | "stopped";
  mode: "auto" | "manual";
  volume: number;
  collection: { id: number; name: string; kind: "music" | "religious" } | null;
  track: { id: number; title: string; artist: string | null; url: string; provider: string } | null;
  isReligious: boolean;
  ambienceAllowed: boolean;
  encouragement: { active: boolean; message: string } | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

type Option = { id: number; name: string; kind: string };

/**
 * The counter's live controls. Every press writes to the shared player row, so
 * the admin console, the customer site and the in-room screen all change
 * together. This component also previews the sound on the staff device — muted
 * until the staff member opts in, because a till does not need to make noise.
 */
export function MusicControls({ initial, collections }: { initial: Now; collections: Option[] }) {
  const [now, setNow] = useState<Now>(initial);
  const [volume, setVolume] = useState(initial.volume);
  const [collectionId, setCollectionId] = useState(String(initial.collection?.id ?? collections[0]?.id ?? ""));
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<number | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/music/now", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as Now;
      setNow(data);
    } catch {
      /* keep the last known state */
    }
  }

  useEffect(() => {
    const poll = window.setInterval(load, 15000);
    return () => window.clearInterval(poll);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, volume / 100));
    if (preview && now.status === "playing" && now.track?.provider === "audio") {
      audio.play().catch(() => setPreview(false));
    } else {
      audio.pause();
    }
  }, [preview, now.status, now.track?.url, now.track?.provider, volume]);

  async function run(action: string, payload: Record<string, unknown> = {}, label = "") {
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/ops/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = (await response.json()) as { error?: string; message?: string; now?: Now };
      if (!response.ok) throw new Error(data.error || "Action failed");
      if (data.now) setNow(data.now);
      setMessage(data.message ?? label ?? "Done");
      window.setTimeout(() => setMessage(""), 3000);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  function commitVolume(value: number) {
    setVolume(value);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => run("volume", { volume: value }, `Volume ${value}%`), 450);
  }

  const playing = now.status === "playing";

  return (
    <section className="panel music-console">
      {now.track?.provider === "audio" && now.track.url ? (
        <audio ref={audioRef} src={now.track.url} loop preload="none" />
      ) : null}

      <div className="panel-head">
        <h3>Live player</h3>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className={`badge ${playing ? "badge-green" : now.status === "paused" ? "badge-amber" : "badge-muted"}`}>
            {now.status}
          </span>
          <span className={`badge ${now.mode === "auto" ? "badge-blue" : "badge-amber"}`}>
            {now.mode === "auto" ? "Following schedule" : "Manual override"}
          </span>
          {now.isReligious ? <span className="badge badge-green">Religious set</span> : null}
        </div>
      </div>

      <div className="music-live">
        <div>
          <div className="tiny muted">{now.collection?.name ?? "Nothing selected"}</div>
          <b style={{ fontSize: "1.15rem" }}>{now.track?.title ?? "The room is quiet"}</b>
          <div className="tiny muted">{now.track?.artist ?? "—"}</div>
        </div>
        <div className="music-live-meta tiny muted">
          <div>Updated {now.updatedAt ? new Date(now.updatedAt).toLocaleTimeString("en-AU") : "—"}</div>
          <div>By {now.updatedBy ?? "—"}</div>
        </div>
      </div>

      <div className="music-buttons">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={Boolean(busy) || playing}
          onClick={() => run("resume", {}, "Resumed")}
        >
          <Icon name="play" size={13} /> Resume
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={Boolean(busy) || !playing}
          onClick={() => run("pause", {}, "Paused")}
        >
          Pause
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={Boolean(busy)}
          onClick={() => run("replay", {}, "Replaying")}
        >
          Replay
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={Boolean(busy)}
          onClick={() => run("next", {}, "Next track")}
        >
          Next
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={Boolean(busy)}
          onClick={() => run("stop", {}, "Stopped")}
        >
          Stop
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={Boolean(busy) || now.mode === "auto"}
          onClick={() => run("auto", {}, "Following the schedule")}
        >
          <Icon name="clock" size={13} /> Follow schedule
        </button>
        <button
          type="button"
          className={`btn btn-ghost btn-sm ${preview ? "is-on" : ""}`}
          onClick={() => setPreview((value) => !value)}
          title="Hear it on this device only"
        >
          {preview ? "Preview on" : "Preview on this device"}
        </button>
      </div>

      <div className="music-row">
        <label className="music-volume">
          <span className="tiny muted">Room volume · {volume}%</span>
          <input
            type="range"
            min={0}
            max={60}
            value={volume}
            onChange={(event) => commitVolume(Number(event.target.value))}
            aria-label="Room volume"
          />
        </label>
        <div className="music-pick">
          <select
            className="select"
            value={collectionId}
            onChange={(event) => setCollectionId(event.target.value)}
            aria-label="Collection"
          >
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name} ({collection.kind})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={Boolean(busy) || !collectionId}
            onClick={() => run("play", { collectionId: Number(collectionId) }, "Playing")}
          >
            Play collection
          </button>
        </div>
      </div>

      {now.encouragement ? (
        <div className={`notice ${now.encouragement.active ? "notice-green" : ""}`} style={{ marginTop: 12 }}>
          <span>{now.encouragement.message}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: "auto" }}
            onClick={() => run("clear-encouragement", {}, "Cleared")}
          >
            Clear
          </button>
        </div>
      ) : null}

      {now.isReligious ? (
        <p className="tiny muted" style={{ marginTop: 10 }}>
          A religious collection is live — ambience and table-order music stay silent by design.
        </p>
      ) : null}
      {error ? <div className="notice notice-red" style={{ marginTop: 10 }}>{error}</div> : null}
      {message ? <p className="tiny" style={{ color: "var(--green)", marginTop: 10 }}>✓ {message}</p> : null}
    </section>
  );
}
