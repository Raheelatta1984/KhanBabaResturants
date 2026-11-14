"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

type Snapshot = {
  enabled: boolean;
  status: "playing" | "paused" | "stopped";
  volume: number;
  collection: { id: number; name: string; kind: "music" | "religious" } | null;
  track: {
    id: number;
    title: string;
    artist: string | null;
    url: string;
    provider: "audio" | "youtube";
    youtubeId: string | null;
    kind: "music" | "religious";
  } | null;
  isReligious: boolean;
  ambienceAllowed: boolean;
  encouragement: { active: boolean; message: string } | null;
  requestsOpen: boolean;
  theme?: string;
};

const PREF_KEY = "kb_lahore_sound";

/**
 * The room's music, on the customer's own device.
 *
 * It always starts silent: browsers block autoplay, and a restaurant site that
 * makes noise uninvited is a bad guest. One tap turns on the same low-volume
 * Lahore ambience that is playing in the restaurant, and the preference is
 * remembered for the next visit. The mute button is always one tap away.
 *
 * A religious collection (naat, hamd, tilawat) keeps this player silent by
 * design — the guest sees what is playing, but no music is layered over it.
 */
export function MusicPlayer() {
  const pathname = usePathname() ?? "/";
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [wanted, setWanted] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(20);
  const [blocked, setBlocked] = useState(false);
  const [open, setOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const hidden =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/counter") ||
    pathname.startsWith("/kitchen") ||
    pathname.startsWith("/delivery") ||
    pathname.startsWith("/staff") ||
    pathname.startsWith("/checkout");

  // Remember the guest's choice on this device.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PREF_KEY);
      if (saved === "on") {
        setMuted(false);
        setWanted(true);
      }
    } catch {
      /* private mode — silent by default */
    }
  }, []);

  // The Lahore theme is a preference, not a different site: the CSS variables
  // shift to deep green / marigold and the motifs appear, while every layout and
  // contrast rule stays the same.
  useEffect(() => {
    if (!snapshot?.theme) return;
    document.documentElement.dataset.theme = snapshot.theme;
  }, [snapshot?.theme]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const response = await fetch("/api/music/now", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as Snapshot;
        if (!alive) return;
        setSnapshot(data);
        if (!muted) setVolume(data.volume);
      } catch {
        /* offline — the site works without sound */
      }
    }
    load();
    const timer = window.setInterval(load, 20000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [muted]);

  const shouldSound =
    !hidden &&
    Boolean(snapshot?.enabled) &&
    snapshot?.status === "playing" &&
    snapshot?.ambienceAllowed !== false &&
    !muted &&
    wanted;

  // Audio element playback (mp3 / wav / ogg).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (snapshot?.track?.provider !== "audio") return;
    audio.volume = Math.max(0, Math.min(1, volume / 100));
    if (shouldSound && snapshot.track) {
      audio.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
    } else {
      audio.pause();
    }
  }, [shouldSound, snapshot?.track?.url, snapshot?.track?.provider, volume]);

  // YouTube embed playback (the room may run a qawwali from YouTube).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || snapshot?.track?.provider !== "youtube") return;
    const send = (func: string, args: unknown[] = []) =>
      frame.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func, args }),
        "https://www.youtube.com",
      );
    send("setVolume", [volume]);
    if (shouldSound) send("playVideo");
    else send("pauseVideo");
  }, [shouldSound, volume, snapshot?.track?.url, snapshot?.track?.provider]);

  if (hidden || !snapshot?.enabled || !snapshot.track) return null;

  const religious = snapshot.isReligious;
  const label = religious
    ? `Recitation · ${snapshot.track.title}`
    : snapshot.track.title + (snapshot.track.artist ? ` · ${snapshot.track.artist}` : "");

  return (
    <div className={`music-dock ${open ? "is-open" : ""}`} aria-live="polite">
      {snapshot.track.provider === "audio" && snapshot.track.url ? (
        <audio ref={audioRef} src={snapshot.track.url} loop preload="none" />
      ) : null}
      {snapshot.track.provider === "youtube" && snapshot.track.youtubeId && shouldSound ? (
        <iframe
          ref={frameRef}
          title={snapshot.track.title}
          src={`https://www.youtube-nocookie.com/embed/${snapshot.track.youtubeId}?enablejsapi=1&autoplay=1&controls=0&loop=1&playlist=${snapshot.track.youtubeId}&playsinline=1`}
          allow="autoplay; encrypted-media"
          style={{ width: 1, height: 1, border: 0, position: "absolute", opacity: 0, pointerEvents: "none" }}
          tabIndex={-1}
          aria-hidden="true"
        />
      ) : null}

      <div className="music-dock-bar">
        <span className={`music-dot ${shouldSound ? "is-live" : ""} ${religious ? "is-religious" : ""}`} aria-hidden="true" />
        <div className="music-meta">
          <span className="music-eyebrow">
            {religious ? "Lahore · recitation" : "Lahore in the room"}
          </span>
          <span className="music-title">{label}</span>
        </div>
        <button
          type="button"
          className="music-icon"
          aria-label={muted || !shouldSound ? "Turn on Lahore ambience" : "Mute the music"}
          title={muted || !shouldSound ? "Turn sound on" : "Mute"}
          onClick={() => {
            const next = muted || !shouldSound;
            setMuted(!next);
            setWanted(next);
            try {
              window.localStorage.setItem(PREF_KEY, next ? "on" : "off");
            } catch {
              /* ignore */
            }
          }}
        >
          <Icon name={muted || !shouldSound ? "play" : "minus"} size={14} />
        </button>
        <button
          type="button"
          className="music-icon"
          aria-label={open ? "Close music details" : "Music details"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name={open ? "close" : "gear"} size={14} />
        </button>
      </div>

      {snapshot.encouragement?.active ? (
        <p className="music-encourage">{snapshot.encouragement.message}</p>
      ) : null}

      {open ? (
        <div className="music-dock-panel">
          {religious ? (
            <p className="tiny" style={{ color: "var(--accent)" }}>
              A religious collection is playing. Music stays silent out of respect — the recitation is
              the sound of the room.
            </p>
          ) : (
            <>
              <label className="music-volume">
                <span className="tiny muted">Volume {volume}%</span>
                <input
                  type="range"
                  min={0}
                  max={60}
                  value={volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                  aria-label="Ambience volume"
                />
              </label>
              <p className="tiny muted" style={{ marginTop: 8 }}>
                Kept low on purpose. Off is always one tap away, on every device, online or at the
                table.
              </p>
            </>
          )}
          {snapshot.encouragement ? (
            <p className="tiny" style={{ color: "var(--green)", marginTop: 8 }}>
              {snapshot.encouragement.message}
            </p>
          ) : null}
          {blocked ? (
            <p className="tiny" style={{ color: "var(--red)", marginTop: 8 }}>
              Your browser blocked the sound. Tap the play button once more.
            </p>
          ) : null}
          <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            {snapshot.requestsOpen ? (
              <Link href="/music" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                Request a song
              </Link>
            ) : null}
            <Link href="/music" className="tiny muted" onClick={() => setOpen(false)}>
              What is playing
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
