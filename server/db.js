import pg from "pg";

// Postgres on Neon, reached through DATABASE_URL. This deliberately avoids
// @netlify/database: with that package installed, Netlify provisions its own
// database on deploy and bills it in Netlify credits.

// `sql` is a tagged template: values become $1, $2 … parameters, never text,
// and it resolves to the result rows.
export function connect(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 3 });
  const sql = async (strings, ...values) =>
    (await pool.query(strings.reduce((text, s, i) => `${text}$${i}${s}`), values))
      .rows;
  return { sql, pool };
}

// One database client per function instance. Tests hand in their own.
let db = null;

export function database() {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL isn't set.");
    db = connect(url);
  }
  return db;
}

export function useDatabase(client) {
  db = client;
}

// Runs `work(client)` inside a transaction on one pooled connection.
export async function transaction(work) {
  const client = await database().pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
