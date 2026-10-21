import pg from "pg";
import { timed } from "./timing.js";

// Postgres on Neon, reached through DATABASE_URL. This deliberately avoids
// @netlify/database: with that package installed, Netlify provisions its own
// database on deploy and bills it in Netlify credits.

// `sql` is a tagged template: values become $1, $2 … parameters, never text,
// and it resolves to the result rows.
// pg treats sslmode=prefer/require/verify-ca as verify-full today, warns on
// every start, and will weaken them to libpq's meaning in pg 9. Saying
// verify-full keeps today's check of Neon's (publicly trusted) certificate.
export const strictSsl = (url) =>
  url?.replace(
    /([?&]sslmode=)(prefer|require|verify-ca)(?=&|$)/,
    "$1verify-full",
  );

// Every query reports its time to the request's Server-Timing header.
// Pooled connections are reused, so each is wrapped only once.
function timedQuery(target) {
  if (target.timed) return target;
  target.timed = true;
  const raw = target.query.bind(target);
  target.query = async (...args) => {
    const start = performance.now();
    try {
      return await raw(...args);
    } finally {
      timed("db", performance.now() - start);
    }
  };
  return target;
}

export function connect(connectionString) {
  const pool = timedQuery(
    new pg.Pool({
      connectionString: strictSsl(connectionString),
      max: 3,
    }),
  );
  const sql = async (strings, ...values) =>
    (
      await pool.query(
        strings.reduce((text, s, i) => `${text}$${i}${s}`),
        values,
      )
    ).rows;
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

// Errors that mean the database can't be reached at all, as opposed to a bad
// query: a rejected password (28P01/28000), a missing database (3D000), Neon
// shutting the connection (57P0x), or the host not answering.
const DOWN_CODES = new Set([
  "28P01",
  "28000",
  "3D000",
  "57P01",
  "57P02",
  "57P03",
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);
export const isDatabaseDown = (error) =>
  DOWN_CODES.has(error?.code) ||
  /endpoint .*(not found|disabled|deleted)|DATABASE_URL isn't set/i.test(
    String(error?.message),
  );

// One clear line in the server log instead of a stack trace.
export function reportDatabaseDown(error) {
  const why =
    error?.code === "28P01" || error?.code === "28000"
      ? "Probably a rotated password, or the Neon branch was deleted and recreated: copy a fresh connection string from Neon into DATABASE_URL."
      : "Check that the Neon project or branch still exists and DATABASE_URL points at it.";
  console.error(
    `Database not responding (${error?.code ?? "no code"}: ${error?.message}). ${why}`,
  );
}

export function useDatabase(client) {
  db = client;
}

// Runs `work(client)` inside a transaction on one pooled connection.
export async function transaction(work) {
  const client = timedQuery(await database().pool.connect());
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
