#!/usr/bin/env node
/**
 * Fail a PR that ships without a release note.
 *
 * The bug this prevents, observed for real: PRs 20, 21 and 22 all merged, the
 * code deployed, and the "What's new" feed on the site still ended at PR #19.
 * Nothing was broken — nothing had ever checked. The feature list is the one
 * page a customer reads to see what changed, so it going quietly stale is a
 * silent regression in its own right.
 *
 * A release note lives in `whats-new/` as one small JSON file per PR:
 *
 *   whats-new/pr-23.json
 *   {
 *     "title": "…",
 *     "summary": "…",
 *     "body": "…",
 *     "category": "feature" | "improvement" | "fix" | "portal" | "ops",
 *     "version": "3.6.0"
 *   }
 *
 * The app publishes them on boot (see lib/whats-new.ts), so the note reaches
 * production through the same deploy as the code it describes — no manual step,
 * no chance of the two drifting apart.
 *
 * The server does not read this folder at runtime: it is not packaged with the
 * functions on Vercel. `scripts/generate-release-notes.mjs` compiles it into
 * `lib/whats-new-notes.ts` before every build; after adding a note, run
 * `npm run notes:build` and commit that file too.
 *
 * Usage:
 *   node scripts/check-whats-new.mjs --pr 23     exit 1 if that note is missing
 *   node scripts/check-whats-new.mjs --all       validate every file in the dir
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = "whats-new";
const CATEGORIES = ["feature", "improvement", "fix", "portal", "ops"];

const args = process.argv.slice(2);
function flag(name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

async function loadAll() {
  const files = (await readdir(DIR).catch(() => [])).filter((name) => name.endsWith(".json"));
  const entries = [];
  const problems = [];
  for (const file of files) {
    const path = join(DIR, file);
    let parsed;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      problems.push(`${path}: not valid JSON (${error.message})`);
      continue;
    }
    const match = file.match(/^pr-(\d+)\.json$/);
    if (!match) {
      problems.push(`${path}: filename must be pr-<number>.json`);
      continue;
    }
    const prNumber = Number(match[1]);
    if (!parsed.title || typeof parsed.title !== "string") {
      problems.push(`${path}: "title" is required`);
    }
    if (!parsed.summary || typeof parsed.summary !== "string") {
      problems.push(`${path}: "summary" is required`);
    }
    if (parsed.summary && parsed.summary.length > 320) {
      problems.push(`${path}: "summary" is ${parsed.summary.length} chars, keep it under 320`);
    }
    if (parsed.category && !CATEGORIES.includes(parsed.category)) {
      problems.push(`${path}: "category" must be one of ${CATEGORIES.join(", ")}`);
    }
    if (parsed.version && !/^\d+\.\d+\.\d+$/.test(parsed.version)) {
      problems.push(`${path}: "version" must look like 3.6.0`);
    }
    entries.push({ file, path, prNumber, ...parsed });
  }
  return { entries, problems };
}

const { entries, problems } = await loadAll();

if (problems.length > 0) {
  console.error("Release note problems:\n" + problems.map((p) => ` - ${p}`).join("\n"));
  process.exit(1);
}

const prFlag = flag("pr");
if (prFlag && prFlag !== true) {
  const prNumber = Number(prFlag);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    console.error(`--pr must be a pull request number, got "${prFlag}"`);
    process.exit(1);
  }
  const found = entries.find((entry) => entry.prNumber === prNumber);
  if (!found) {
    console.error(
      `No release note for PR #${prNumber}.\n` +
        `Add ${DIR}/pr-${prNumber}.json so the "What's new" page records this release:\n\n` +
        JSON.stringify(
          {
            title: "One line a customer would recognise",
            summary: "One or two sentences: what changed for them.",
            body: "The detail, if it needs any.",
            category: "feature",
            version: "3.6.0",
          },
          null,
          2,
        ),
    );
    process.exit(1);
  }
  console.log(`pr-${prNumber}.json: ${found.title}`);
  process.exit(0);
}

if (flag("all") || entries.length === 0) {
  console.log(`${entries.length} release note${entries.length === 1 ? "" : "s"} in ${DIR}/`);
  for (const entry of entries.sort((a, b) => a.prNumber - b.prNumber)) {
    console.log(`  PR #${entry.prNumber}  ${entry.version ?? "—"}  ${entry.title}`);
  }
}
