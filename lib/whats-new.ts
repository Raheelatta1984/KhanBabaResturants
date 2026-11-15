import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "./db";

/**
 * Publish release notes that live in the repository.
 *
 * The problem this solves, observed for real: PRs 20, 21 and 22 merged and
 * deployed, but the "What's new" feed still ended at PR #19, because writing a
 * note was a manual step that nobody had automated or checked. A release feed
 * that only updates when someone remembers is a feed that goes stale in silence.
 *
 * So the note lives next to the code it describes — `whats-new/pr-<n>.json` —
 * and is published on boot. It reaches production through the same deploy, and
 * `scripts/check-whats-new.mjs` fails CI when a PR has no note.
 *
 * Publishing is idempotent: the note is matched on `pr_number` and only inserted
 * when absent, so a redeploy never duplicates an entry and never rewrites one
 * somebody has since edited in the admin console.
 */

export type ReleaseNote = {
  title: string;
  summary: string;
  body?: string;
  category?: "feature" | "improvement" | "fix" | "portal" | "ops";
  version?: string;
};

const CATEGORIES = ["feature", "improvement", "fix", "portal", "ops"] as const;

/** Read every note from disk. Missing directory is not an error. */
export async function releaseNotesFromDisk(dir = "whats-new"): Promise<
  { prNumber: number; note: ReleaseNote }[]
> {
  const files = (await readdir(dir).catch(() => [] as string[])).filter((name) =>
    name.endsWith(".json"),
  );
  const notes: { prNumber: number; note: ReleaseNote }[] = [];
  for (const file of files) {
    const match = file.match(/^pr-(\d+)\.json$/);
    if (!match) continue;
    try {
      const note = JSON.parse(await readFile(join(dir, file), "utf8")) as ReleaseNote;
      if (!note.title || !note.summary) continue;
      notes.push({ prNumber: Number(match[1]), note });
    } catch {
      // A malformed note must never stop the app booting; CI is where it fails.
    }
  }
  return notes.sort((a, b) => a.prNumber - b.prNumber);
}

/**
 * Insert any note whose PR is not already present.
 *
 * Returns how many were written, so the caller can log only when something
 * actually happened — a boot that prints nothing is a boot where nothing drifted.
 */
export async function publishReleaseNotes(db: Db, dir = "whats-new"): Promise<number> {
  const notes = await releaseNotesFromDisk(dir);
  if (notes.length === 0) return 0;

  const existing = await db.query<{ pr_number: number | null }>(
    "SELECT pr_number FROM whats_new WHERE pr_number IS NOT NULL",
  );
  const seen = new Set(existing.map((row) => Number(row.pr_number)));

  let written = 0;
  for (const { prNumber, note } of notes) {
    if (seen.has(prNumber)) continue;
    const category = CATEGORIES.includes(note.category as (typeof CATEGORIES)[number])
      ? note.category
      : "feature";
    await db.query(
      `INSERT INTO whats_new (title, summary, body, category, version, pr_number, pr_url, pinned)
       VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE)`,
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
}
