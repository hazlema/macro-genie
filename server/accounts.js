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
// Free credits go first; `paid` says whether this one had been bought.
export async function spendCredit(accountId, reason) {
  return transaction(async (client) => {
    const spent = await client.query(
      `WITH old AS (
         SELECT credits - paid_credits AS free FROM accounts
          WHERE id = $1 AND credits >= 1 FOR UPDATE
       )
       UPDATE accounts a
          SET credits = a.credits - 1,
              paid_credits = a.paid_credits - CASE WHEN old.free > 0 THEN 0 ELSE 1 END
         FROM old
        WHERE a.id = $1
       RETURNING a.credits, old.free = 0 AS paid`,
      [accountId],
    );
    if (!spent.rows[0]) return null;
    const { credits, paid } = spent.rows[0];
    const logged = await client.query(
      `INSERT INTO credit_ledger (account_id, change, reason, paid)
       VALUES ($1, -1, $2, $3) RETURNING id`,
      [accountId, reason, paid],
    );
    return { credits: Number(credits), ledgerId: Number(logged.rows[0].id), paid };
  });
}

// Gives back a credit for a job that failed, to the pool it came from.
export async function refundCredit(accountId, reason, paid = false) {
  return addCredits(accountId, 1, `refund:${reason}`, null, { paid });
}

// Adds credits (or removes them, with a negative amount). With a ref (e.g. a
// Stripe session id), the same (reason, ref) is only ever applied once; a
// repeat returns null and changes nothing. `paid` marks bought credits.
// Removals take free credits first: paid ones only go when they'd exceed
// the new balance.
export async function addCredits(accountId, amount, reason, ref = null, { paid = false } = {}) {
  return transaction(async (client) => {
    const logged = await client.query(
      `INSERT INTO credit_ledger (account_id, change, reason, ref, paid)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (reason, ref) DO NOTHING
       RETURNING id`,
      [accountId, amount, reason, ref, paid],
    );
    if (!logged.rows[0]) return null;
    const updated = await client.query(
      `UPDATE accounts
          SET credits = credits + $2,
              paid_credits = LEAST(paid_credits + $3, credits + $2)
        WHERE id = $1 RETURNING credits`,
      [accountId, amount, paid ? amount : 0],
    );
    return Number(updated.rows[0].credits);
  });
}

// A Google account that was deleted and banned from the admin page.
export async function isBannedSub(sub) {
  const rows = await database()
    .sql`SELECT 1 FROM banned_subs WHERE google_sub = ${sub}`;
  return rows.length > 0;
}
