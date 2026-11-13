/**
 * Seed the Postgres database with the Khan Baba menu, staff accounts, pricing
 * rules, materials/recipes and demo orders.
 *
 *   npm run seed              # schema + seed if the database is empty
 *   npm run seed -- --reset   # delete every row first, then seed
 *
 * The app also self-seeds on its first request, so this script is only needed
 * when you want to prepare the Supabase database ahead of a deploy.
 */
import { getDb } from "../lib/db";
import { seedDatabase } from "../lib/db/seed";
import { SCHEMA_SQL } from "../lib/db/schema";

const args = process.argv.slice(2);

async function main() {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.error(
      "DATABASE_URL is not set.\n" +
        "Locally: copy .env.example to .env.local and paste your Supabase pooler connection string.\n" +
        "CI: `npm run test:pg` runs the whole suite against PGlite with no database at all.",
    );
    process.exit(1);
  }

  const db = await getDb();

  if (args.includes("--reset")) {
    // Demo data only — order matters (children first) because of the FKs.
    const tables = [
      "cost_postings",
      "recipe_lines",
      "production_batches",
      "recipes",
      "materials",
      "order_events",
      "order_items",
      "payments",
      "delivery_jobs",
      "orders",
      "reviews",
      "item_variants",
      "menu_items",
      "categories",
      "pricing_rules",
      "holidays",
      "dining_tables",
      "staff",
      "settings",
      "whats_new",
    ];
    for (const table of tables) {
      await db.query(`DELETE FROM ${table}`);
    }
    await db.exec(SCHEMA_SQL);
    console.log("Cleared every table");
  }

  const result = await seedDatabase(db);
  const count = async (table: string) =>
    Number(
      (await db.one<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)).c,
    );

  const counts = {
    categories: await count("categories"),
    menuItems: await count("menu_items"),
    variants: await count("item_variants"),
    staff: await count("staff"),
    tables: await count("dining_tables"),
    materials: await count("materials"),
    recipes: await count("recipes"),
    batches: await count("production_batches"),
    costPostings: await count("cost_postings"),
    orders: await count("orders"),
    whatsNew: await count("whats_new"),
  };
  console.log(
    `${result.seeded ? "Seed complete" : "Database already seeded"}:\n` +
      JSON.stringify(counts, null, 2),
  );
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
