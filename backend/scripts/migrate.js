/**
 * Applies db/schema.sql to whatever DATABASE_URL points at.
 *
 * Run locally against RDS with:
 *   DATABASE_URL="postgres://..." PGSSL=true npm run migrate
 *
 * schema.sql uses CREATE TABLE IF NOT EXISTS throughout, so this is safe to
 * run repeatedly — it will not drop or overwrite existing data.
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pool = require("../db/pool");

(async () => {
  const schemaPath = path.join(__dirname, "..", "db", "schema.sql");

  if (!fs.existsSync(schemaPath)) {
    console.error(`Could not find schema at ${schemaPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, "utf8");
  const target = (process.env.DATABASE_URL || "").replace(/:[^:@/]*@/, ":****@");
  console.log(`Applying schema to ${target || "(DATABASE_URL not set)"}`);

  try {
    await pool.query(sql);
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`
    );
    console.log("Schema applied. Tables now present:");
    rows.forEach((r) => console.log(`  - ${r.table_name}`));
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
