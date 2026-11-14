import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/time";
import { Icon } from "@/components/Icon";
import { Reveal } from "@/components/Reveal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "What's new",
  description:
    "Every new portal, menu change and fix shipped to the Khan Baba platform, documented release by release.",
};

type Entry = {
  id: number;
  title: string;
  summary: string;
  body: string | null;
  category: string;
  version: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pinned: boolean;
  published_at: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  feature: "New feature",
  improvement: "Improvement",
  fix: "Fix",
  portal: "Staff portal",
  ops: "Operations",
};

const CATEGORY_BADGE: Record<string, string> = {
  feature: "badge-amber",
  improvement: "badge-blue",
  fix: "badge-green",
  portal: "badge-blue",
  ops: "badge-muted",
};

export default async function WhatsNewPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const db = await getDb();
  const all = await db.query<Entry>(
    "SELECT * FROM whats_new ORDER BY pinned DESC, published_at DESC, id DESC",
  );
  const entries =
    category && category !== "all"
      ? all.filter((entry) => entry.category === category)
      : all;

  // `all` leads with the pinned entry, so it is not the newest one. Work the
  // summary figures out from the publish dates instead — otherwise a pinned
  // note silently freezes "Latest release" and "Last change" on the date it
  // was written.
  const newestFirst = [...all].sort(
    (a, b) =>
      new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
  );
  const latest = newestFirst[0] ?? null;
  const latestVersion =
    newestFirst.find((entry) => entry.version)?.version ?? "1.0.0";

  return (
    <>
      <section className="whatsnew-hero">
        <div className="container">
          <span className="eyebrow">Release feed</span>
          <h1
            style={{
              margin: "14px 0 12px",
              fontSize: "clamp(2.2rem, 5vw, 3.6rem)",
            }}
          >
            What&apos;s new at Khan Baba.
          </h1>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            We ship the restaurant and the software together. Every portal, menu
            change and fix is logged here — the same notes our team reads on
            Monday morning.
          </p>
          <div
            style={{
              display: "flex",
              gap: 20,
              marginTop: 24,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                className="tiny"
                style={{
                  color: "var(--muted-2)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Latest release
              </div>
              <div className="strong">{latestVersion}</div>
            </div>
            <div>
              <div
                className="tiny"
                style={{
                  color: "var(--muted-2)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Updates published
              </div>
              <div className="strong">{all.length}</div>
            </div>
            <div>
              <div
                className="tiny"
                style={{
                  color: "var(--muted-2)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Last change
              </div>
              <div className="strong">
                {latest ? formatDate(latest.published_at.slice(0, 10)) : "—"}
              </div>
            </div>
          </div>

          <div className="wn-tabs">
            <Link
              href="/whats-new"
              className="chip"
              data-active={!category || category === "all" ? "true" : "false"}
            >
              Everything
            </Link>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <Link
                key={key}
                href={`/whats-new?category=${key}`}
                className="chip"
                data-active={category === key ? "true" : "false"}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section-tight" style={{ paddingTop: 10 }}>
        <div className="container-narrow">
          {entries.length === 0 ? (
            <div className="empty">No updates in this category yet.</div>
          ) : (
            <div className="wn-feed">
              {entries.map((entry, index) => (
                <Reveal key={entry.id} delay={Math.min(index * 50, 200)}>
                  <article className="wn-card">
                    <div>
                      <div className="when">
                        {formatDateTime(entry.published_at)}
                      </div>
                      {entry.version ? (
                        <div className="badge" style={{ marginTop: 8 }}>
                          v{entry.version}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        <span
                          className={`badge ${CATEGORY_BADGE[entry.category] ?? "badge-muted"}`}
                        >
                          {CATEGORY_LABELS[entry.category] ?? entry.category}
                        </span>
                        {entry.pinned ? (
                          <span className="badge badge-amber">Pinned</span>
                        ) : null}
                      </div>
                      <h3 style={{ marginTop: 12 }}>{entry.title}</h3>
                      <p>{entry.summary}</p>
                      {entry.body ? <p className="body">{entry.body}</p> : null}
                      {entry.pr_url ? (
                        <a
                          href={entry.pr_url}
                          target="_blank"
                          rel="noreferrer"
                          className="tiny"
                          style={{
                            color: "var(--accent)",
                            display: "inline-flex",
                            gap: 6,
                            alignItems: "center",
                            marginTop: 12,
                          }}
                        >
                          <Icon name="arrow" size={12} /> Pull request #
                          {entry.pr_number}
                        </a>
                      ) : null}
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          )}

          <div className="notice" style={{ marginTop: 26 }}>
            <Icon name="sparkle" size={15} />
            <span>
              Shipping a change? Add a release note from{" "}
              <Link
                href="/admin/whats-new"
                style={{ color: "var(--accent)", textDecoration: "underline" }}
              >
                Admin → What&apos;s new
              </Link>{" "}
              or run{" "}
              <code style={{ color: "var(--text)" }}>
                scripts/whats-new.mjs
              </code>{" "}
              against your git history.
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
