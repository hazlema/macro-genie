import { database, transaction } from "./db.js";

export const WELCOME_CREDITS = 10;

const shape = (row) =>
  row && {
    id: Number(row.id),
    displayName: row.display_name,
    credits: Number(row.credits),
  };

// The account for a Google user, created with welcome credits the first time.
export async function findOrCreateAccount({ sub, displayName }) {
  return transaction(async (client) => {
    const created = await client.query(
      `INSERT INTO accounts (google_sub, display_name, credits)
       VALUES ($1, $2, $3)
       ON CONFLICT (google_sub) DO NOTHING
       RETURNING id, display_name, credits`,
      [sub, displayName, WELCOME_CREDITS],
    );
    if (created.rows[0]) {
      await client.query(
        `INSERT INTO credit_ledger (account_id, change, reason) VALUES ($1, $2, 'welcome')`,
        [created.rows[0].id, WELCOME_CREDITS],
      );
      return { ...shape(created.rows[0]), isNew: true };
    }
    const existing = await client.query(
      `SELECT id, display_name, credits FROM accounts WHERE google_sub = $1`,
      [sub],
    );
    return { ...shape(existing.rows[0]), isNew: false };
  });
}

export async function getAccount(id) {
  const rows = await database()
    .sql`SELECT id, display_name, credits FROM accounts WHERE id = ${id}`;
  return shape(rows[0]) ?? null;
}

// Takes one credit, or returns null when there isn't one to take. The check
// and the spend are one statement, so parallel requests can't overspend.
export async function spendCredit(accountId, reason) {
  return transaction(async (client) => {
    const spent = await client.query(
      `UPDATE accounts SET credits = credits - 1
       WHERE id = $1 AND credits >= 1
       RETURNING credits`,
      [accountId],
    );
    if (!spent.rows[0]) return null;
    await client.query(
      `INSERT INTO credit_ledger (account_id, change, reason) VALUES ($1, -1, $2)`,
      [accountId, reason],
    );
    return Number(spent.rows[0].credits);
  });
}

// Gives back a credit for a job that failed.
export async function refundCredit(accountId, reason) {
  return addCredits(accountId, 1, `refund:${reason}`);
}

// Adds credits. With a ref (e.g. a Stripe event id), the same (reason, ref)
// is only ever applied once; a repeat returns null and changes nothing.
export async function addCredits(accountId, amount, reason, ref = null) {
  return transaction(async (client) => {
    const logged = await client.query(
      `INSERT INTO credit_ledger (account_id, change, reason, ref)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (reason, ref) DO NOTHING
       RETURNING id`,
      [accountId, amount, reason, ref],
    );
    if (!logged.rows[0]) return null;
    const updated = await client.query(
      `UPDATE accounts SET credits = credits + $2 WHERE id = $1 RETURNING credits`,
      [accountId, amount],
    );
    return Number(updated.rows[0].credits);
  });
}
