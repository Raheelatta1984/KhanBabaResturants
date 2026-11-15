import { getDb } from "@/lib/db";
import { WhatsNewManager } from "@/components/portal/AdminForms";
import { BUILD, buildLabel } from "@/lib/build";
import { bundledReleaseNotes, unpublishedReleaseNotes } from "@/lib/whats-new";
import { formatDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function AdminWhatsNewPage() {
  const db = await getDb();
  const entries = await db.query<
    Parameters<typeof WhatsNewManager>[0]["entries"][number]
  >("SELECT * FROM whats_new ORDER BY pinned DESC, published_at DESC, id DESC");
  const missing = new Set(await unpublishedReleaseNotes(db));
  const bundled = [...bundledReleaseNotes()].sort((a, b) => b.prNumber - a.prNumber);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>What&apos;s new</h1>
          <p>
            Publish release notes for every PR — customers see them on the
            public release feed.
          </p>
        </div>
      </div>

      <div className="panel anchor" id="this-build" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <h3>The build that is running</h3>
          <span className="badge badge-green mono-text">{buildLabel()}</span>
        </div>
        <dl className="log-kv">
          <dt>version</dt>
          <dd>
            {BUILD.version}
            {BUILD.pr ? ` (PR #${BUILD.pr})` : ""}
          </dd>
          <dt>commit</dt>
          <dd>{BUILD.commit || "not stamped (local build)"}</dd>
          <dt>built</dt>
          <dd>{BUILD.builtAt ? `${formatDateTime(BUILD.builtAt)} · ${BUILD.builtAt}` : "—"}</dd>
          <dt>release notes</dt>
          <dd>
            {bundled.length} shipped with this build · {bundled.length - missing.size} published
            {missing.size > 0 ? ` · ${missing.size} missing` : ""}
          </dd>
        </dl>
        {missing.size > 0 ? (
          <div className="notice notice-red" style={{ marginTop: 14 }}>
            <span>
              <strong>
                {[...missing].map((pr) => `PR #${pr}`).join(", ")} shipped in this build but{" "}
                {missing.size === 1 ? "is" : "are"} not in the feed.
              </strong>{" "}
              Notes publish when the application starts. If this is still here after a reload, the operational log
              has the course of action.
            </span>
          </div>
        ) : null}
        <div className="table-scroll">
          <table className="table tiny" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>PR</th>
                <th>Version</th>
                <th>Release note</th>
                <th>In the feed</th>
              </tr>
            </thead>
            <tbody>
              {bundled.map((entry) => (
                <tr key={entry.prNumber}>
                  <td className="mono-text">#{entry.prNumber}</td>
                  <td className="mono-text">{entry.note.version ?? "—"}</td>
                  <td>{entry.note.title}</td>
                  <td>
                    <span className={`badge ${missing.has(entry.prNumber) ? "badge-red" : "badge-green"}`}>
                      {missing.has(entry.prNumber) ? "missing" : "published"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tiny muted" style={{ marginTop: 10 }}>
          The same version is printed in the footer of the public site, under every staff screen&apos;s menu, and at{" "}
          <a href="/api/health" style={{ color: "var(--accent)" }}>
            /api/health
          </a>
          . If the number has not moved after a change, the change has not deployed.
        </p>
      </div>

      <WhatsNewManager entries={entries} />

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h3>Automate it from git</h3>
        </div>
        <p className="small muted">
          Every pull request carries its own note in <code>whats-new/pr-&lt;number&gt;.json</code>. It is compiled
          into the build and published automatically when that build starts — nothing to do here. To draft a note
          from the merge history instead:
        </p>
        <pre
          style={{
            background: "var(--bg)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: 14,
            overflowX: "auto",
            fontSize: "0.78rem",
            marginTop: 12,
            color: "var(--muted)",
          }}
        >{`npm run whatsnew -- --pr 12 --title "Peak hour priority pricing" --summary "Priority is now priced by rule."
# or read the last 10 merge commits
node scripts/whats-new.mjs --from-git --limit 10`}</pre>
        <p className="tiny muted" style={{ marginTop: 10 }}>
          The script prints ready-to-paste entries (or inserts with{" "}
          <code>--publish</code> when the database is local).
        </p>
      </div>
    </>
  );
}
