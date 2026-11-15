#!/usr/bin/env tsx
/**
 * Generate marketing/content_calendar.md from the live menu.
 *
 * The calendar is a view over the menu, not a document. This script exists so
 * that regenerating it after a menu change is one command rather than a
 * careful manual edit — and so the file can be committed and read on a phone
 * without the portal.
 *
 *   npm run marketing:calendar
 *   npm run marketing:calendar -- --start 2026-11-16
 *   npm run marketing:calendar -- --out /tmp/calendar.md
 *   npm run marketing:calendar -- --check     (exit 1 if the file is stale)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getDb } from "../lib/db";
import { getSettings } from "../lib/settings";
import { calendarMarkdown, contentCalendar } from "../lib/marketing/calendar";
import { publicBaseUrl } from "../lib/url";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function main() {
  const out = resolve(arg("out") ?? "marketing/content_calendar.md");
  const checkOnly = process.argv.includes("--check");
  const startArg = arg("start");

  let start: Date | undefined;
  if (startArg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startArg)) {
      console.error(`--start must be YYYY-MM-DD, got "${startArg}"`);
      process.exit(1);
    }
    start = new Date(`${startArg}T00:00:00Z`);
  }

  const db = await getDb();
  const settings = await getSettings();
  const calendar = await contentCalendar(db, publicBaseUrl(), start);
  const markdown = calendarMarkdown(calendar, settings);

  if (checkOnly) {
    const existing = await readFile(out, "utf8").catch(() => "");
    if (existing !== markdown) {
      console.error(
        `${out} is out of date. Run \`npm run marketing:calendar\` to regenerate it.`,
      );
      process.exit(1);
    }
    console.log(`${out} is up to date.`);
    return;
  }

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, markdown, "utf8");
  console.log(
    `Wrote ${out}\n  ${calendar.days.length} days from ${calendar.generatedFor}\n  ${calendar.totalDishes} dishes · delivery ${calendar.deliveryArea}`,
  );
}

main().catch((error) => {
  console.error("Could not generate the calendar:", error);
  process.exit(1);
});
