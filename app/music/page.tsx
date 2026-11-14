import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getNowPlaying, defaultRequestCharge } from "@/lib/music";
import { getSettings, settingValue } from "@/lib/settings";
import { money } from "@/lib/money";
import { MusicRequestForm } from "@/components/MusicRequestForm";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Music at Khan Baba",
  description:
    "Qawwali, ghazals and Punjabi folk at Khan Baba — what is playing, how the schedule works, and how to ask for a song.",
};

/**
 * The public music page: what is playing, why it is quiet, and how to ask for a
 * song. The library itself stays in the staff portals.
 */
export default async function MusicPage() {
  const db = await getDb();
  const [now, settings, suggested] = await Promise.all([
    getNowPlaying(db),
    getSettings(),
    defaultRequestCharge(db),
  ]);
  const collections = await db.query<{ id: number; name: string; kind: string; description: string | null; track_count: number }>(
    `SELECT c.id, c.name, c.kind, c.description,
       (SELECT COUNT(*) FROM music_collection_tracks ct WHERE ct.collection_id = c.id) AS track_count
     FROM music_collections c WHERE c.active ORDER BY c.kind DESC, c.name`,
  );
  const note = settingValue(settings, "music_now_playing_note", "");

  return (
    <section className="section" style={{ paddingTop: 40 }}>
      <div className="container">
        <div className="page-head" style={{ marginBottom: 26 }}>
          <div>
            <span className="eyebrow">Lahore in the room</span>
            <h1 style={{ marginTop: 12 }}>The sound of the adda</h1>
            <p style={{ maxWidth: 620 }}>
              A Lahore dhaba is never silent for long. Qawwali after the first karahi, a ghazal with
              the chai, a naat on a Friday evening. We keep it low so your table can still hear each
              other — and you can always turn it off on your own device.
            </p>
          </div>
        </div>

        <div className="music-hero">
          <div className="panel music-now">
            <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
              <span className="badge badge-amber">
                {now.isReligious ? "Recitation" : now.status === "playing" ? "Now playing" : now.status === "paused" ? "Paused" : "Quiet"}
              </span>
              <span className="tiny muted">{now.volume}% volume target</span>
            </div>
            <h2 style={{ fontSize: "2.1rem", margin: "16px 0 4px" }}>
              {now.track?.title ?? "The room is quiet"}
            </h2>
            <p className="small muted">
              {now.track?.artist ?? now.collection?.name ?? "No collection scheduled right now."}
            </p>
            {note ? <p className="tiny muted" style={{ marginTop: 12 }}>{note}</p> : null}
            {now.isReligious ? (
              <div className="notice" style={{ marginTop: 14 }}>
                A religious collection is playing. Out of respect the ambience and the table-order
                music stay silent until it finishes.
              </div>
            ) : null}
            <div className="row" style={{ gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <Link href="/menu" className="btn btn-primary btn-sm">
                Order something <Icon name="arrow" size={14} />
              </Link>
              <Link href="/table/T04" className="btn btn-outline btn-sm">
                <Icon name="table" size={14} /> Order at your table
              </Link>
            </div>
          </div>

          <MusicRequestForm open={now.requestsOpen} />
        </div>

        {(now.requestsOpen) ? (
          <div className="notice" style={{ marginTop: 16 }}>
            <span>
              On-demand songs are optional and reviewed by the counter. The usual charge is around{" "}
              <b>{money(suggested)}</b> at this hour — the counter can waive it or adjust it, and will
              confirm before anything plays.
            </span>
          </div>
        ) : null}

        <div className="section-tight" style={{ paddingBottom: 0 }}>
          <div className="page-head">
            <div>
              <h2 style={{ fontSize: "1.7rem" }}>The collections</h2>
              <p>What the schedule can put on, day by day.</p>
            </div>
          </div>
          <div className="grid grid-3">
            {collections.map((collection) => (
              <article className="card" key={collection.id} style={{ padding: 18 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <b className="small">{collection.name}</b>
                  <span className={`badge ${collection.kind === "religious" ? "badge-green" : "badge-amber"}`}>
                    {collection.kind === "religious" ? "Religious" : "Music"}
                  </span>
                </div>
                <p className="tiny muted" style={{ marginTop: 8 }}>
                  {collection.description ?? "A curated set for the room."}
                </p>
                <p className="tiny" style={{ marginTop: 8, color: "var(--muted-2)" }}>
                  {collection.track_count} track(s)
                </p>
              </article>
            ))}
            {collections.length === 0 ? (
              <p className="muted small">The library is being set up — the counter can help.</p>
            ) : null}
          </div>
        </div>

        <div className="notice" style={{ marginTop: 26 }}>
          <span>
            <strong>Sound is a choice.</strong> The website player starts silent and remembers your
            choice on this device. In the restaurant, ask any staff member to lower or stop it — the
            counter and admin both hold the controls, and the room is never louder than the tables.
          </span>
        </div>
      </div>
    </section>
  );
}
