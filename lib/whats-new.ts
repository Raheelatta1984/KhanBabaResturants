import type { Db } from "./db";
import { RELEASE_NOTES, type BundledReleaseNote } from "./whats-new-notes";

/**
 * Publish the release notes that ship with this build.
 *
 * A note lives next to the code it describes — `whats-new/pr-<n>.json` — and is
 * published on boot, so it reaches production through the same deploy.
 * `scripts/check-whats-new.mjs` fails CI when a note is malformed.
 *
 * How the notes get here matters, because it was the bug. They used to be read
 * at runtime with `readdir("whats-new")`. On Vercel that directory does not
 * exist inside the function (only files reached by an `import` are traced into
 * it), the read failed, the failure was swallowed, and nothing was published:
 * PR #24 deployed while the feed still said 3.5.0. CI never saw it, because CI
 * starts the server from the checkout where the directory is present.
 *
 * So the notes are now a generated module (`lib/whats-new-notes.ts`, built by
 * `scripts/generate-release-notes.mjs`) and this file does no file-system
 * access at all. Do not add any back: `scripts/test-pg.ts` asserts it.
 *
 * Publishing is idempotent: a note is matched on `pr_number` and only inserted
 * when absent, so a redeploy never duplicates an entry and never rewrites one
 * somebody has since edited in the admin console.
 */

export type ReleaseNote = BundledReleaseNote["note"];

const CATEGORIES = ["feature", "improvement", "fix", "portal", "ops"] as const;

/**
 * Serialises publishers. Every serverless function instance boots on its own,
 * and several cold-start in the same second after a deploy; without a lock two
 * of them can both see "PR 25 is missing" and both insert it. The lock is
 * transaction-scoped, so it works through Supabase's transaction pooler.
 */
const PUBLISH_LOCK = 742_025;

/** The notes compiled into this build, oldest PR first. */
export function bundledReleaseNotes(): BundledReleaseNote[] {
  return RELEASE_NOTES;
}

/** PR numbers that shipped in this build but are not in the feed. */
export async function unpublishedReleaseNotes(
  db: Db,
  notes: BundledReleaseNote[] = RELEASE_NOTES,
): Promise<number[]> {
  if (notes.length === 0) return [];
  const existing = await db.query<{ pr_number: number | null }>(
    "SELECT pr_number FROM whats_new WHERE pr_number IS NOT NULL",
  );
  const seen = new Set(existing.map((row) => Number(row.pr_number)));
  return notes.map((entry) => entry.prNumber).filter((pr) => !seen.has(pr));
}

/**
 * Insert any note whose PR is not already present.
 *
 * Returns how many were written, so the caller can log only when something
 * actually happened — a boot that prints nothing is a boot where nothing drifted.
 */
export async function publishReleaseNotes(
  db: Db,
  notes: BundledReleaseNote[] = RELEASE_NOTES,
): Promise<number> {
  if (notes.length === 0) return 0;
  // The common case — nothing to do — costs one read and takes no lock.
  if ((await unpublishedReleaseNotes(db, notes)).length === 0) return 0;

  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1::bigint)", [PUBLISH_LOCK]);
    // Re-read inside the lock: another instance may have published meanwhile.
    const missing = new Set(await unpublishedReleaseNotes(tx, notes));
    let written = 0;
    for (const { prNumber, note } of [...notes].sort((a, b) => a.prNumber - b.prNumber)) {
      if (!missing.has(prNumber)) continue;
      const category = CATEGORIES.includes(note.category as (typeof CATEGORIES)[number])
        ? note.category
        : "feature";
      await tx.query(
        `INSERT INTO whats_new (title, summary, body, category, version, pr_number, pr_url, pinned, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE, clock_timestamp())`,
        [
          note.title,
          note.summary,
          note.body ?? null,
          category,
          note.version ?? null,
          prNumber,
          `https://github.com/Raheelatta1984/KhanBabaResturants/pull/${prNumber}`,
        ],
      );
      written += 1;
    }
    return written;
  });
}
