/**
 * Seed the local database with the Khan Baba menu, staff accounts, pricing rules,
 * materials/recipes and demo orders. Safe to run repeatedly — it only seeds an
 * empty database.
 *
 *   npm run seed          # seed if empty
 *   npm run seed -- --reset   # wipe the database file first
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args.includes("--reset")) {
  const dir = process.env.KB_DATA_DIR || path.join(process.cwd(), "data");
  for (const file of ["khanbaba.db", "khanbaba.db-wal", "khanbaba.db-shm"]) {
    const target = path.join(dir, file);
    if (fs.existsSync(target)) fs.rmSync(target);
  }
  console.log("Removed existing database", dir);
}

import { getDb } from "../lib/db";

const db = getDb();
const counts = {
  categories: (db.prepare("SELECT COUNT(*) c FROM categories").get() as { c: number }).c,
  menuItems: (db.prepare("SELECT COUNT(*) c FROM menu_items").get() as { c: number }).c,
  variants: (db.prepare("SELECT COUNT(*) c FROM item_variants").get() as { c: number }).c,
  staff: (db.prepare("SELECT COUNT(*) c FROM staff").get() as { c: number }).c,
  tables: (db.prepare("SELECT COUNT(*) c FROM dining_tables").get() as { c: number }).c,
  materials: (db.prepare("SELECT COUNT(*) c FROM materials").get() as { c: number }).c,
  recipes: (db.prepare("SELECT COUNT(*) c FROM recipes").get() as { c: number }).c,
  batches: (db.prepare("SELECT COUNT(*) c FROM production_batches").get() as { c: number }).c,
  costPostings: (db.prepare("SELECT COUNT(*) c FROM cost_postings").get() as { c: number }).c,
  orders: (db.prepare("SELECT COUNT(*) c FROM orders").get() as { c: number }).c,
  whatsNew: (db.prepare("SELECT COUNT(*) c FROM whats_new").get() as { c: number }).c,
};
console.log("Seed complete:\n" + JSON.stringify(counts, null, 2));
