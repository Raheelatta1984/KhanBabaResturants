#!/usr/bin/env node
/**
 * Embeds lib/db/schema.sql into lib/db/schema.ts so the schema ships inside the
 * server bundle. Serverless platforms (Vercel, Lambda) do not reliably copy
 * loose data files next to the function, and process.cwd() is read-only there.
 *
 * Run with: npm run schema:build
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "lib", "db", "schema.sql");
const target = path.join(root, "lib", "db", "schema.ts");

const sql = fs.readFileSync(source, "utf8");
const banner = `// AUTO-GENERATED from lib/db/schema.sql — do not edit by hand.
// Regenerate with: npm run schema:build
`;
const contents = `${banner}export const SCHEMA_SQL = ${JSON.stringify(sql)};\n`;

fs.writeFileSync(target, contents);

const existing = fs.existsSync(target) ? contents : null;
console.log(
  `Wrote ${path.relative(root, target)} (${sql.split("\n").length} lines${existing ? "" : ", new file"})`,
);
