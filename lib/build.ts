import { RELEASE_NOTES } from "./whats-new-notes";

/**
 * What is actually running.
 *
 * "I still can't see the new changes" cannot be answered without this. Until
 * now nothing on any screen said which build was serving the page, so a stale
 * tab, a failed deploy and a change that genuinely was not there all looked
 * identical — and the only way to tell them apart was the Vercel dashboard.
 *
 * `version` is the highest version among the release notes compiled into this
 * build, so it moves with the code and cannot be forgotten. `commit` and
 * `builtAt` are stamped by next.config.mjs at build time.
 */

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const versioned = RELEASE_NOTES.filter((entry) => entry.note.version).sort((a, b) =>
  compareVersions(a.note.version as string, b.note.version as string),
);
const newest = versioned[versioned.length - 1];

const commit = (process.env.KB_BUILD_SHA ?? "").trim();

export const BUILD = {
  /** e.g. "3.7.0" */
  version: newest?.note.version ?? "0.0.0",
  /** The pull request that produced this version. */
  pr: newest?.prNumber ?? null,
  title: newest?.note.title ?? "",
  /** Full git SHA, or "" when the build host did not provide one. */
  commit,
  shortCommit: commit ? commit.slice(0, 7) : "",
  /** ISO-8601 UTC. */
  builtAt: (process.env.KB_BUILD_TIME ?? "").trim(),
  notes: RELEASE_NOTES.length,
} as const;

/** "v3.7.0+abc1234" — what goes on a log line and a support ticket. */
export function buildLabel(): string {
  return `v${BUILD.version}${BUILD.shortCommit ? `+${BUILD.shortCommit}` : ""}`;
}

export { compareVersions };
