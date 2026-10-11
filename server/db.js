import { getDatabase } from "@netlify/database";

// One database client per function instance. Tests hand in their own.
let db = null;

export function database() {
  db ??= getDatabase();
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
