#!/usr/bin/env node
/**
 * What's New helper.
 *
 *   node scripts/whats-new.mjs --list
 *   node scripts/whats-new.mjs --pr 12 --title "Peak hour priority" --summary "Priority now priced by rule."
 *   node scripts/whats-new.mjs --from-git --limit 10
 *   node scripts/whats-new.mjs --pr 12 --title "…" --summary "…" --publish
 *
 * Without --publish it prints ready-to-paste entries for the admin console.
 * With --publish it writes straight into the Postgres database in DATABASE_URL.
 * Every PR should ship with one of these notes.
 */
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
function flag(name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

const CATEGORIES = ["feature", "improvement", "fix", "portal", "ops"];

function print(entries) {
  console.log(JSON.stringify(entries, null, 2));
  console.log(
    `\n${entries.length} entr${entries.length === 1 ? "y" : "ies"} generated. Paste into Admin → What's new, or re-run with --publish.`,
  );
}

async function connect() {
  const url = (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    ""
  ).trim();
  if (!url) {
    console.error(
      "DATABASE_URL is not set. Add your Supabase pooler connection string to .env.local " +
        "(or your shell) before using --publish/--list.",
    );
    process.exit(1);
  }
  // Reuse the app's own driver so `--publish` also works against PGlite (handy
  // for trying a note locally) and shares the schema/placeholder handling.
  const { createPostgresDb, createPgliteDb, isPgliteUrl } =
    await import("../lib/db/driver");
  return isPgliteUrl(url) ? createPgliteDb(url) : createPostgresDb(url);
}

async function publish(entries) {
  const sql = await connect();
  const { SCHEMA_SQL } = await import("../lib/db/schema");
  const { splitStatements } = await import("../lib/db/driver");
  await sql.exec(SCHEMA_SQL);
  let count = 0;
  for (const entry of entries) {
    await sql.query(
      `INSERT INTO whats_new (title, summary, body, category, version, pr_number, pr_url, pinned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)`,
      [
        entry.title,
        entry.summary,
        entry.body ?? null,
        CATEGORIES.includes(entry.category) ? entry.category : "feature",
        entry.version ?? null,
        entry.pr_number ?? null,
        entry.pr_url ?? null,
      ],
    );
    count += 1;
  }
  console.log(
    `Published ${count} entr${count === 1 ? "y" : "ies"} to Postgres`,
  );
}

if (flag("list")) {
  const sql = await connect();
  const { SCHEMA_SQL } = await import("../lib/db/schema");
  await sql.exec(SCHEMA_SQL);
  const rows = await sql.query(
    "SELECT id, title, category, version, pr_number, published_at FROM whats_new ORDER BY id DESC",
  );
  console.table(rows);
  process.exit(0);
}

if (flag("from-git")) {
  const limit = Number(flag("limit", 10));
  const text = execSync(`git log -n ${limit} --pretty=format:"%h%x09%s"`, {
    encoding: "utf8",
  });
  const entries = text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, ...rest] = line.split("\t");
      const subject = rest.join(" ");
      const prMatch = subject.match(/#(\d+)/);
      const prNumber = prMatch ? Number(prMatch[1]) : null;
      const clean = subject.replace(/\(#\d+\)/, "").trim();
      const [rawTitle, ...bodyParts] = clean.split(":");
      const title = rawTitle
        .replace(/^Merge pull request #\d+ from \S+/, "Merged contribution")
        .trim();
      return {
        title: title.charAt(0).toUpperCase() + title.slice(1),
        summary: bodyParts.join(":").trim() || `${clean} (${hash})`,
        body: clean,
        category: /fix/i.test(clean)
          ? "fix"
          : /portal/i.test(clean)
            ? "portal"
            : "feature",
        version: flag("version", "1.1.0"),
        pr_number: prNumber,
        pr_url: prNumber
          ? `https://github.com/Raheelatta1984/KhanBabaResturants/pull/${prNumber}`
          : null,
      };
    });
  if (flag("publish")) await publish(entries);
  else print(entries);
  process.exit(0);
}

const title = flag("title");
const summary = flag("summary");
if (!title || !summary) {
  console.error(
    'Usage: node scripts/whats-new.mjs --title "…" --summary "…" [--pr 12] [--publish]',
  );
  process.exit(1);
}

const prNumber = flag("pr") ? Number(flag("pr")) : null;
const entries = [
  {
    title,
    summary,
    body: flag("body", null),
    category: flag("category", "feature"),
    version: flag("version", "1.1.0"),
    pr_number: prNumber,
    pr_url: prNumber
      ? `https://github.com/Raheelatta1984/KhanBabaResturants/pull/${prNumber}`
      : null,
  },
];

if (flag("publish")) await publish(entries);
else print(entries);
