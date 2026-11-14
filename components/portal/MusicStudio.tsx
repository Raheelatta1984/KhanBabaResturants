import { getDb } from "@/lib/db";
import {
  defaultRequestCharge,
  musicConsoleData,
  scheduleMatches,
} from "@/lib/music";
import { getSettings, settingValue } from "@/lib/settings";
import { money } from "@/lib/money";
import { ActionForm } from "./ActionForm";
import { MusicControls } from "./MusicControls";
import { MusicRequests } from "./MusicRequests";
import { OpsButton } from "./OpsButton";
import { Icon } from "../Icon";

/**
 * The shared music studio, rendered for both the counter and the admin.
 *
 * The brief asks counter staff — not only the administrator — to be able to load
 * songs, build collections, schedule them, and stop/resume/replay the room, so
 * this is one component behind two doors rather than an admin-only toy.
 */
export async function MusicStudio({ showLibrary = true }: { showLibrary?: boolean }) {
  const db = await getDb();
  const [data, settings, suggested] = await Promise.all([
    musicConsoleData(db),
    getSettings(),
    defaultRequestCharge(db),
  ]);
  const collectionTracks = await db.query<{
    collection_id: number;
    position: number;
    id: number;
    title: string;
    artist: string | null;
    kind: string;
    provider: string;
    url: string;
  }>(
    `SELECT ct.collection_id, ct.position, t.id, t.title, t.artist, t.kind, t.provider, t.url
       FROM music_collection_tracks ct JOIN music_tracks t ON t.id = ct.track_id
      ORDER BY ct.collection_id, ct.position, ct.id`,
  );
  const tracksByCollection = new Map<number, typeof collectionTracks>();
  for (const row of collectionTracks) {
    const list = tracksByCollection.get(row.collection_id) ?? [];
    list.push(row);
    tracksByCollection.set(row.collection_id, list);
  }

  const freeAllowed = settingValue(settings, "music_request_free_allowed", "1") !== "0";
  const religious = data.tracks.filter((track) => track.kind === "religious");
  const music = data.tracks.filter((track) => track.kind === "music");
  const now = data.now;

  return (
    <>
      <div className="stat-grid">
        <div className="stat-card">
          <span>Now</span>
          <b style={{ fontSize: "1.05rem" }}>{now.track?.title ?? "Quiet"}</b>
          <small>{now.collection?.name ?? "No collection"} · {now.status}</small>
        </div>
        <div className="stat-card">
          <span>Tracks</span>
          <b>{data.tracks.length}</b>
          <small>{music.length} music · {religious.length} religious</small>
        </div>
        <div className="stat-card">
          <span>Collections</span>
          <b>{data.collections.length}</b>
          <small>{data.schedules.filter((schedule) => schedule.active).length} active schedule(s)</small>
        </div>
        <div className="stat-card">
          <span>Requests</span>
          <b style={{ color: data.requests.some((request) => request.status === "pending") ? "var(--accent)" : undefined }}>
            {data.requests.filter((request) => request.status === "pending").length}
          </b>
          <small>{money(suggested)} suggested charge now</small>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 18, alignItems: "start" }}>
        <MusicControls
          initial={{
            enabled: now.enabled,
            status: now.status,
            mode: now.mode,
            volume: now.volume,
            collection: now.collection,
            track: now.track
              ? {
                  id: now.track.id,
                  title: now.track.title,
                  artist: now.track.artist,
                  url: now.track.url,
                  provider: now.track.provider,
                }
              : null,
            isReligious: now.isReligious,
            ambienceAllowed: now.ambienceAllowed,
            encouragement: now.encouragement,
            updatedAt: now.updatedAt,
            updatedBy: now.updatedBy,
          }}
          collections={data.collections.map((collection) => ({
            id: collection.id,
            name: collection.name,
            kind: collection.kind,
          }))}
        />

        <section className="panel">
          <div className="panel-head">
            <h3>Guest requests</h3>
            <span className="tiny muted">URL mandatory · staff approval</span>
          </div>
          <MusicRequests
            requests={data.requests
              .filter((request) => request.status === "pending" || request.status === "approved")
              .slice(0, 8)}
            suggested={suggested}
            freeAllowed={freeAllowed}
          />
        </section>
      </div>

      {showLibrary ? (
        <>
          <section className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <h3>Library</h3>
              <span className="tiny muted">
                Audio files or YouTube links · religious sets never interrupted by ambience
              </span>
            </div>

            <div className="grid grid-2">
              <div>
                <h4 style={{ fontSize: "1rem", marginBottom: 10 }}>Add a track</h4>
                <ActionForm
                  endpoint="/api/ops/music"
                  action="create-track"
                  submitLabel="Add track"
                  fields={[
                    { name: "title", label: "Title", placeholder: "Mast Qalandar", full: true },
                    { name: "url", label: "URL (audio or YouTube)", placeholder: "https://…", full: true },
                    { name: "artist", label: "Artist / reciter" },
                    {
                      name: "kind",
                      label: "Kind",
                      type: "select",
                      options: [
                        { value: "music", label: "Music / cultural" },
                        { value: "religious", label: "Religious (naat, hamd, tilawat)" },
                      ],
                    },
                    {
                      name: "category",
                      label: "Category",
                      type: "select",
                      options: [
                        { value: "qawwali", label: "Qawwali" },
                        { value: "ghazal", label: "Ghazal" },
                        { value: "punjabi", label: "Punjabi folk" },
                        { value: "instrumental", label: "Instrumental" },
                        { value: "naat", label: "Naat" },
                        { value: "hamd", label: "Hamd" },
                        { value: "recitation", label: "Recitation" },
                        { value: "other", label: "Other" },
                      ],
                    },
                    { name: "durationSeconds", label: "Duration", type: "number", suffix: "seconds" },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                  ]}
                />
              </div>
              <div>
                <h4 style={{ fontSize: "1rem", marginBottom: 10 }}>Create a collection</h4>
                <ActionForm
                  endpoint="/api/ops/music"
                  action="create-collection"
                  submitLabel="Create collection"
                  fields={[
                    { name: "name", label: "Collection name", placeholder: "Friday evening naat", full: true },
                    {
                      name: "kind",
                      label: "Kind",
                      type: "select",
                      options: [
                        { value: "music", label: "Music" },
                        { value: "religious", label: "Religious" },
                      ],
                    },
                    { name: "description", label: "Description", type: "textarea", full: true },
                  ]}
                />
                <h4 style={{ fontSize: "1rem", margin: "16px 0 10px" }}>Add a track to a collection</h4>
                <ActionForm
                  endpoint="/api/ops/music"
                  action="add-track"
                  submitLabel="Add to collection"
                  fields={[
                    {
                      name: "collectionId",
                      label: "Collection",
                      type: "select",
                      options: data.collections.map((collection) => ({
                        value: String(collection.id),
                        label: collection.name,
                      })),
                    },
                    {
                      name: "trackId",
                      label: "Track",
                      type: "select",
                      options: data.tracks.map((track) => ({
                        value: String(track.id),
                        label: `${track.title}${track.artist ? ` — ${track.artist}` : ""}`,
                      })),
                    },
                  ]}
                />
              </div>
            </div>

            <div className="table-wrap" style={{ marginTop: 18 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Track</th>
                    <th>Kind</th>
                    <th>Category</th>
                    <th>Source</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.tracks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        The library is empty. Add a track above, or load a collection from the seed data.
                      </td>
                    </tr>
                  ) : null}
                  {data.tracks.map((track) => (
                    <tr key={track.id}>
                      <td>
                        <b className="small">{track.title}</b>
                        <div className="tiny muted">{track.artist ?? "—"}</div>
                      </td>
                      <td>
                        <span className={`badge ${track.kind === "religious" ? "badge-green" : "badge-amber"}`}>
                          {track.kind}
                        </span>
                      </td>
                      <td className="tiny">{track.category ?? "—"}</td>
                      <td className="tiny">
                        <a href={track.url} target="_blank" rel="noreferrer noopener" style={{ color: "var(--blue)" }}>
                          {track.provider}
                        </a>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <OpsButton
                          endpoint="/api/ops/music"
                          payload={{ action: "play", trackId: track.id }}
                          className="btn btn-ghost btn-sm"
                          successMessage="Playing"
                        >
                          <Icon name="play" size={12} />
                        </OpsButton>
                        <OpsButton
                          endpoint="/api/ops/music"
                          payload={{ action: "delete-track", trackId: track.id }}
                          className="btn btn-ghost btn-sm"
                          confirmMessage={`Delete “${track.title}” from the library?`}
                          successMessage="Deleted"
                        >
                          <Icon name="close" size={12} />
                        </OpsButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid grid-2" style={{ marginTop: 18, alignItems: "start" }}>
            <section className="panel">
              <div className="panel-head">
                <h3>Collections</h3>
                <span className="tiny muted">{data.collections.length} set(s)</span>
              </div>
              {data.collections.length === 0 ? (
                <p className="small muted">No collections yet — create one on the left.</p>
              ) : null}
              {data.collections.map((collection) => {
                const tracks = tracksByCollection.get(collection.id) ?? [];
                return (
                  <details key={collection.id} className="collection-card">
                    <summary>
                      <span className="collection-name">
                        <b>{collection.name}</b>
                        <span className="tiny muted">
                          {collection.track_count ?? tracks.length} track(s) · {collection.kind}
                        </span>
                      </span>
                      <span className="row" style={{ gap: 6 }}>
                        <OpsButton
                          endpoint="/api/ops/music"
                          payload={{ action: "play", collectionId: collection.id }}
                          className="btn btn-ghost btn-sm"
                          successMessage={`Playing ${collection.name}`}
                        >
                          <Icon name="play" size={12} />
                        </OpsButton>
                        <OpsButton
                          endpoint="/api/ops/music"
                          payload={{ action: "delete-collection", collectionId: collection.id }}
                          className="btn btn-ghost btn-sm"
                          confirmMessage={`Delete the collection “${collection.name}”? Tracks stay in the library.`}
                          successMessage="Collection deleted"
                        >
                          <Icon name="close" size={12} />
                        </OpsButton>
                      </span>
                    </summary>
                    <ul className="collection-tracks">
                      {tracks.length === 0 ? <li className="tiny muted">No tracks yet.</li> : null}
                      {tracks.map((track) => (
                        <li key={track.id}>
                          <span>{track.title}</span>
                          <span className="tiny muted">{track.artist ?? track.provider}</span>
                          <OpsButton
                            endpoint="/api/ops/music"
                            payload={{ action: "remove-track", collectionId: collection.id, trackId: track.id }}
                            className="btn btn-ghost btn-sm"
                            successMessage="Removed"
                          >
                            <Icon name="minus" size={12} />
                          </OpsButton>
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </section>

            <section className="panel">
              <div className="panel-head">
                <h3>Schedules</h3>
                <span className="tiny muted">Auto-play by day and time</span>
              </div>
              <ActionForm
                endpoint="/api/ops/music"
                action="create-schedule"
                submitLabel="Add schedule"
                fields={[
                  {
                    name: "collectionId",
                    label: "Collection",
                    type: "select",
                    options: data.collections.map((collection) => ({
                      value: String(collection.id),
                      label: collection.name,
                    })),
                  },
                  { name: "label", label: "Label", placeholder: "Lunch service" },
                  {
                    name: "days",
                    label: "Days",
                    placeholder: "1,2,3,4,5",
                    help: "0=Sun … 6=Sat. Leave blank for every day.",
                  },
                  { name: "startTime", label: "Start", placeholder: "11:30" },
                  { name: "endTime", label: "End", placeholder: "15:00" },
                  { name: "priority", label: "Priority", type: "number", defaultValue: 0 },
                ]}
              />

              <div className="table-wrap" style={{ marginTop: 14 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Collection</th>
                      <th>Live</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.schedules.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="muted">
                          No schedule yet. Add one above and the room follows it automatically.
                        </td>
                      </tr>
                    ) : null}
                    {data.schedules.map((schedule) => (
                      <tr key={schedule.id}>
                        <td className="tiny">
                          {schedule.label ? <div>{schedule.label}</div> : null}
                          <span className="muted">
                            {schedule.days
                              ? schedule.days
                                  .split(",")
                                  .map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][Number(day)] ?? day)
                                  .join(" ")
                              : "Every day"}{" "}
                            · {schedule.start_time ?? "00:00"}–{schedule.end_time ?? "24:00"}
                          </span>
                          {scheduleMatches(schedule) ? <span className="badge badge-green" style={{ marginLeft: 6 }}>nowish</span> : null}
                        </td>
                        <td className="tiny">
                          {schedule.collection_name}
                          <div className="muted">{schedule.collection_kind}</div>
                        </td>
                        <td>
                          <OpsButton
                            endpoint="/api/ops/music"
                            payload={{ action: "toggle-schedule", scheduleId: schedule.id, active: !schedule.active }}
                            className={`btn ${schedule.active ? "btn-outline" : "btn-ghost"} btn-sm`}
                            successMessage={schedule.active ? "Paused" : "Enabled"}
                          >
                            {schedule.active ? "On" : "Off"}
                          </OpsButton>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <OpsButton
                            endpoint="/api/ops/music"
                            payload={{ action: "delete-schedule", scheduleId: schedule.id }}
                            className="btn btn-ghost btn-sm"
                            confirmMessage="Delete this schedule?"
                            successMessage="Deleted"
                          >
                            <Icon name="close" size={12} />
                          </OpsButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {data.recentCharges.length > 0 ? (
            <section className="panel" style={{ marginTop: 18 }}>
              <div className="panel-head">
                <h3>On-demand charges posted</h3>
                <span className="tiny muted">Added straight to the guest’s bill</span>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentCharges.map((charge) => (
                      <tr key={charge.id}>
                        <td className="small">{charge.name}</td>
                        <td>{money(charge.total_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
