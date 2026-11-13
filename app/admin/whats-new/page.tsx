import { getDb } from "@/lib/db";
import { WhatsNewManager } from "@/components/portal/AdminForms";

export const dynamic = "force-dynamic";

export default async function AdminWhatsNewPage() {
  const db = await getDb();
  const entries = await db.query<
    Parameters<typeof WhatsNewManager>[0]["entries"][number]
  >("SELECT * FROM whats_new ORDER BY pinned DESC, published_at DESC, id DESC");

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

      <WhatsNewManager entries={entries} />

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h3>Automate it from git</h3>
        </div>
        <p className="small muted">
          Draft entries from your merge history, then review them here before
          publishing:
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
