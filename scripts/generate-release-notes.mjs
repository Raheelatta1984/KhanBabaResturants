#!/usr/bin/env node
/**
 * Embeds whats-new/pr-<n>.json into lib/whats-new-notes.ts so the release notes
 * ship inside the server bundle.
 *
 * Why this exists. The notes used to be read at runtime with
 * `readdir("whats-new")`. That works in CI and on a laptop, where the server
 * runs from the checkout, and silently does nothing on Vercel: a serverless
 * function only contains the files Next.js traced from `import` statements, and
 * a directory named in a string is not one of them. The read failed, the error
 * was swallowed, and the app published nothing — so PR #24 deployed and the
 * "What's new" page went on saying the latest release was 3.5.0.
 *
 * An imported module cannot go missing that way. This is the same approach as
 * scripts/generate-schema.mjs, for the same reason.
 *
 *   npm run notes:build     regenerate
 *   CI fails when the generated file is out of date with whats-new/.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "whats-new");
const target = path.join(root, "lib", "whats-new-notes.ts");
const CATEGORIES = ["feature", "improvement", "fix", "portal", "ops"];

const problems = [];
const notes = [];

for (const file of fs.existsSync(sourceDir) ? fs.readdirSync(sourceDir).sort() : []) {
  if (!file.endsWith(".json")) continue;
  const match = file.match(/^pr-(\d+)\.json$/);
  if (!match) {
    problems.push(`${file}: filename must be pr-<number>.json`);
    continue;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(sourceDir, file), "utf8"));
  } catch (error) {
    problems.push(`${file}: not valid JSON (${error.message})`);
    continue;
  }
  if (typeof parsed.title !== "string" || !parsed.title.trim()) problems.push(`${file}: "title" is required`);
  if (typeof parsed.summary !== "string" || !parsed.summary.trim()) problems.push(`${file}: "summary" is required`);
  if (parsed.category && !CATEGORIES.includes(parsed.category)) {
    problems.push(`${file}: "category" must be one of ${CATEGORIES.join(", ")}`);
  }
  if (parsed.version && !/^\d+\.\d+\.\d+$/.test(parsed.version)) {
    problems.push(`${file}: "version" must look like 3.7.0`);
  }
  // Only the fields the app publishes. An unknown key in a note must not be
  // able to change the bundle silently.
  const note = { title: parsed.title, summary: parsed.summary };
  if (parsed.body) note.body = parsed.body;
  if (parsed.category) note.category = parsed.category;
  if (parsed.version) note.version = parsed.version;
  notes.push({ prNumber: Number(match[1]), note });
}

if (problems.length > 0) {
  console.error("Release note problems:\n" + problems.map((line) => ` - ${line}`).join("\n"));
  process.exit(1);
}

notes.sort((a, b) => a.prNumber - b.prNumber);

const banner = `// AUTO-GENERATED from whats-new/pr-<n>.json — do not edit by hand.
// Regenerate with: npm run notes:build
//
// These notes are imported, not read from disk, so they are part of the server
// bundle on every host. See scripts/generate-release-notes.mjs for why.
`;
const body = `${banner}
export type BundledReleaseNote = {
  prNumber: number;
  note: {
    title: string;
    summary: string;
    body?: string;
    category?: "feature" | "improvement" | "fix" | "portal" | "ops";
    version?: string;
  };
};

export const RELEASE_NOTES: BundledReleaseNote[] = ${JSON.stringify(notes, null, 2)};
`;

fs.writeFileSync(target, body);
console.log(
  `Wrote ${path.relative(root, target)} (${notes.length} release note${notes.length === 1 ? "" : "s"}: ${notes
    .map((entry) => `#${entry.prNumber}`)
    .join(", ")})`,
);
