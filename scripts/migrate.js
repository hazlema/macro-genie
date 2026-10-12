// Applies db/migrations/*.sql to DATABASE_URL, in name order, once each.
//   npm run db:migrate            (reads DATABASE_URL from the shell or .env)
// In a Netlify build it runs only for production deploys, so deploy previews
// never change the live database. Each file runs in its own transaction.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import pg from "pg";
import { strictSsl } from "../server/db.js";

const DIR = new URL("../db/migrations/", import.meta.url);

if (process.env.CONTEXT && process.env.CONTEXT !== "production") {
  console.log(`migrate: skipped for the ${process.env.CONTEXT} build`);
  process.exit(0);
}
if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.DATABASE_URL) {
  console.error("migrate: DATABASE_URL isn't set");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: strictSsl(process.env.DATABASE_URL),
});
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const { rows } = await client.query("SELECT name FROM schema_migrations");
  const done = new Set(rows.map((r) => r.name));
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    await client.query("BEGIN");
    try {
      await client.query(readFileSync(new URL(file, DIR), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`migrate: ${file} failed: ${error.message}`);
      process.exit(1);
    }
    console.log(`migrate: applied ${file}`);
    applied += 1;
  }
  console.log(`migrate: ${applied ? `${applied} applied` : "up to date"}, ${files.length} in total`);
} finally {
  await client.end();
}
