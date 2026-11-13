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
 * With --publish it writes straight into the local SQLite database.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

function publish(entries) {
  const dir = process.env.KB_DATA_DIR || path.join(process.cwd(), "data");
  const file = path.join(dir, "khanbaba.db");
  if (!fs.existsSync(file)) {
    console.error(`No database at ${file}. Run the app or "npm run seed" first.`);
    process.exit(1);
  }
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(file);
  db.exec(`CREATE TABLE IF NOT EXISTS whats_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT,
    category TEXT NOT NULL DEFAULT 'feature', version TEXT, pr_number INTEGER, pr_url TEXT,
    pinned INTEGER NOT NULL DEFAULT 0, published_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const insert = db.prepare(
    `INSERT INTO whats_new (title, summary, body, category, version, pr_number, pr_url, pinned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let count = 0;
  for (const entry of entries) {
    insert.run(
      entry.title,
      entry.summary,
      entry.body ?? null,
      CATEGORIES.includes(entry.category) ? entry.category : "feature",
      entry.version ?? null,
      entry.pr_number ?? null,
      entry.pr_url ?? null,
      0,
    );
    count += 1;
  }
  db.close();
  console.log(`Published ${count} entr${count === 1 ? "y" : "ies"} to ${file}`);
}

if (flag("list")) {
  const dir = process.env.KB_DATA_DIR || path.join(process.cwd(), "data");
  const file = path.join(dir, "khanbaba.db");
  if (!fs.existsSync(file)) {
    console.error("No local database yet.");
    process.exit(1);
  }
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(file, { readonly: true });
  const rows = db.prepare("SELECT id, title, category, version, pr_number, published_at FROM whats_new ORDER BY id DESC").all();
  console.table(rows);
  db.close();
  process.exit(0);
}

if (flag("from-git")) {
  const limit = Number(flag("limit", 10));
  const text = execSync(`git log -n ${limit} --pretty=format:"%h%x09%s"`, { encoding: "utf8" });
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
      const title = rawTitle.replace(/^Merge pull request #\d+ from \S+/, "Merged contribution").trim();
      return {
        title: title.charAt(0).toUpperCase() + title.slice(1),
        summary: bodyParts.join(":").trim() || `${clean} (${hash})`,
        body: clean,
        category: /fix/i.test(clean) ? "fix" : /portal/i.test(clean) ? "portal" : "feature",
        version: flag("version", "1.1.0"),
        pr_number: prNumber,
        pr_url: prNumber ? `https://github.com/Raheelatta1984/KhanBabaResturants/pull/${prNumber}` : null,
      };
    });
  if (flag("publish")) publish(entries);
  else print(entries);
  process.exit(0);
}

const title = flag("title");
const summary = flag("summary");
if (!title || !summary) {
  console.error("Usage: node scripts/whats-new.mjs --title \"…\" --summary \"…\" [--pr 12] [--publish]");
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
    pr_url: prNumber ? `https://github.com/Raheelatta1984/KhanBabaResturants/pull/${prNumber}` : null,
  },
];

if (flag("publish")) publish(entries);
else print(entries);
