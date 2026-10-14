# Admin Money Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin-only Money tab shows, for the current month and up to 12 saved months, money in (credit pack sales) against money out (Stripe fees, refunds, AI, fixed bills), plus AI cost per credit and free-versus-paid credit use.

**Architecture:** Credits gain a paid/free split (free used first). Every AI job writes a row to a new `ai_usage` table. `server/costs.js` holds typed-in fixed costs. `server/money.js` builds one month from four sources: Stripe balance transactions, `ai_usage` plus the credit ledger, Anthropic's cost report, and fixed costs. Finished months are saved once to `money_months`. The admin function serves it, and `AdminMoney.svelte` shows it.

**Tech Stack:** Node ESM, Netlify Functions, Postgres via `pg` (Neon; tests use `@netlify/database-dev`), Stripe Node SDK v23, raw `fetch` to Anthropic's Admin API, and Svelte 5 runes. Tests use `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-14-admin-money-design.md`

## Global Constraints

- Admins only: every money route calls `requireAdmin` (`server/roles.js`). Moderators get 403.
- Money is integer US cents everywhere. AI estimates stay in dollars (`NUMERIC(10,4)`) per job and are rounded to cents only in month totals. The per-credit figures keep 2 decimals.
- Months are UTC calendar months, keyed `"YYYY-MM"`. DATE columns are always read with `to_char(..., 'YYYY-MM')` and written as `'YYYY-MM-01'` strings, never as JS `Date` objects (pg turns DATE into local-time Dates).
- Free credits are spent first. Ledger rows from before this change count as free (`COALESCE(paid, false)`).
- Saving an `ai_usage` row must never break the user's job: catch the error, `console.error` it, carry on.
- Stripe and Anthropic calls time out (Stripe client already 15 s; Anthropic fetch 10 s). A failure marks the month incomplete, and incomplete months are never saved.
- Without `ANTHROPIC_ADMIN_KEY`, the "actual" line is `null` with status `"no_key"`, and the month still counts as complete.
- Only Macro Genie checkouts count as sales: balance transactions whose payment intent metadata has `accountId` and `credits` (the same test `fulfill` uses).
- Match the surrounding code: short "why" comments, no TypeScript, Svelte 5 runes, existing CSS class names where they fit.
- Commit after each task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

## Review Focus

1. **Month edges:** an AI job or sale at 23:59:59 UTC on the 31st belongs to that month, and one at 00:00:00 on the 1st belongs to the next. Task 4 pins this with explicit timestamps.
2. **Deleted accounts:** deleting an account cascades its ledger rows, and its `ai_usage.ledger_id` becomes null. Its AI cost must still count in the month total, as free. Task 4 tests this.
3. **Bad fixed-cost input** (an end before the start, `"2026-13"`, zero or negative or fractional cents, an empty name) is refused with a plain 400 message and not stored. Task 3 tests this.
4. **Other Stripe products:** balance transactions without our metadata are ignored, not counted as sales. Task 4 tests this.
5. **Empty months:** no credits spent or no paid credits sold gives `null` per-credit figures, never `NaN` or `Infinity`, and a month with no activity shows zeros. Task 4 tests this.

---

## File map

| File | Change |
|---|---|
| `db/migrations/20261014120000_money.sql` | new: `paid_credits`, `credit_ledger.paid`, `ai_usage`, `fixed_costs`, `money_months` |
| `server/accounts.js` | spend free first, return `{ credits, ledgerId, paid }`; `addCredits` gets `{ paid }`; `refundCredit` gets `paid` |
| `server/credits.js` | `withCredit` uses the new spend result; collects and saves AI usage |
| `server/payments.js` | purchases add paid credits; Stripe refunds remove them |
| `server/usage.js` | `collectUsage`, `saveUsage`; `logUsage` feeds the collector |
| `server/moderate.js` | saves its usage row |
| `server/costs.js` | new: fixed costs (validate, list, add, update, delete, `shareOf`) |
| `server/money.js` | new: months, Stripe/AI/Anthropic/fixed sources, `buildMonth`, `moneyOverview` |
| `netlify/functions/admin.js` | money routes |
| `src/lib/route.svelte.js` | `money` admin tab |
| `src/components/Admin.svelte` | Money tab, admins only |
| `src/components/AdminMoney.svelte` | new: month cards and the fixed-cost form |
| `src/style.css` | Money tab styles |
| `vite.config.js`, `README.md` | `ANTHROPIC_ADMIN_KEY` locally and in setup docs |
| `tests/accounts.test.js`, `tests/payments.test.js`, `tests/costs.test.js`, `tests/money.test.js`, `tests/route.test.js` | tests |

---

### Task 1: Paid and free credits

**Files:**
- Create: `db/migrations/20261014120000_money.sql`
- Modify: `server/accounts.js` (`spendCredit`, `refundCredit`, `addCredits`)
- Modify: `server/credits.js` (`withCredit`)
- Modify: `server/payments.js` (`fulfill`, `applyRefund`)
- Test: `tests/accounts.test.js`, `tests/payments.test.js`

**Interfaces:**
- Produces: `spendCredit(accountId, reason) → Promise<{ credits: number, ledgerId: number, paid: boolean } | null>`
- Produces: `addCredits(accountId, amount, reason, ref = null, { paid = false } = {}) → Promise<number | null>` (new balance, or null for a repeat `(reason, ref)`)
- Produces: `refundCredit(accountId, reason, paid = false) → Promise<number | null>`
- Produces: tables `ai_usage`, `fixed_costs`, `money_months`; columns `accounts.paid_credits`, `credit_ledger.paid`

- [ ] **Step 1: Write the migration** (`db/migrations/20261014120000_money.sql`)

```sql
-- Money tab. Paid credits are the part of a balance that was bought; free
-- credits (welcome, admin grants) are spent first.
ALTER TABLE accounts ADD COLUMN paid_credits INTEGER NOT NULL DEFAULT 0
  CHECK (paid_credits >= 0);
ALTER TABLE accounts ADD CONSTRAINT paid_within_credits
  CHECK (paid_credits <= credits);
-- On spends (and their failed-job refunds): did the credit come from paid ones.
ALTER TABLE credit_ledger ADD COLUMN paid BOOLEAN;

-- One row per AI job, with the app's own cost estimate.
CREATE TABLE ai_usage (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  step TEXT NOT NULL CHECK (step IN ('idea', 'recipe', 'moderation')),
  model TEXT NOT NULL,
  input INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10, 4) NOT NULL,
  ledger_id BIGINT REFERENCES credit_ledger (id) ON DELETE SET NULL,
  failed BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX ai_usage_created ON ai_usage (created_at);

-- Bills typed in on the Money tab. Months are stored as their first day.
CREATE TABLE fixed_costs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cents INTEGER NOT NULL CHECK (cents > 0),
  period TEXT NOT NULL CHECK (period IN ('monthly', 'yearly', 'once')),
  starts DATE NOT NULL,
  ends DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends IS NULL OR ends >= starts)
);

-- Finished months, saved once so they load fast and don't drift.
CREATE TABLE money_months (
  month DATE PRIMARY KEY,
  totals JSONB NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Write the failing tests** (append to `tests/accounts.test.js`; `db`, `findOrCreateAccount`, `spendCredit`, `addCredits` and `refundCredit` are already in scope there, so add `refundCredit` to the existing import from `../server/accounts.js` if it isn't)

```js
const paidOf = async (id) =>
  Number((await db.sql`SELECT paid_credits FROM accounts WHERE id = ${id}`)[0].paid_credits);

test("free credits are spent before paid ones", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-paid-1", displayName: "Fay" });
  assert.equal(await addCredits(id, 20, "purchase", "cs_paid_1", { paid: true }), 30);
  assert.equal(await paidOf(id), 20);
  for (let i = 0; i < 10; i++) {
    const spend = await spendCredit(id, "idea");
    assert.equal(spend.paid, false);
  }
  assert.equal(await paidOf(id), 20);
  const paidSpend = await spendCredit(id, "recipe");
  assert.deepEqual(
    { credits: paidSpend.credits, paid: paidSpend.paid },
    { credits: 19, paid: true },
  );
  assert.ok(Number.isInteger(paidSpend.ledgerId));
  assert.equal(await paidOf(id), 19);
  const [row] = await db.sql`SELECT change, paid FROM credit_ledger WHERE id = ${paidSpend.ledgerId}`;
  assert.deepEqual({ change: row.change, paid: row.paid }, { change: -1, paid: true });
});

test("a failed job's credit goes back to the pool it came from", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-paid-2", displayName: "Gil" });
  await addCredits(id, 20, "purchase", "cs_paid_2", { paid: true });
  for (let i = 0; i < 10; i++) await spendCredit(id, "idea");
  const spend = await spendCredit(id, "idea");
  assert.equal(await paidOf(id), 19);
  await refundCredit(id, "idea", spend.paid);
  assert.equal(await paidOf(id), 20);
  const free = await findOrCreateAccount({ sub: "g-paid-3", displayName: "Hal" });
  const freeSpend = await spendCredit(free.id, "idea");
  await refundCredit(free.id, "idea", freeSpend.paid);
  assert.equal(await paidOf(free.id), 0);
});

test("admin removals take free credits first; grants are free", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-paid-4", displayName: "Ivy" });
  await addCredits(id, 20, "purchase", "cs_paid_4", { paid: true });
  assert.equal(await addCredits(id, -5, "admin:tidy"), 25);
  assert.equal(await paidOf(id), 20);
  assert.equal(await addCredits(id, -15, "admin:tidy"), 10);
  assert.equal(await paidOf(id), 10);
  assert.equal(await addCredits(id, 7, "admin:gift"), 17);
  assert.equal(await paidOf(id), 10);
});
```

Also change the existing overspend test's last line, which still holds (`null`), and add one check that the spend result is an object:

```js
  assert.equal(results.filter((r) => r !== null).length, 10);
  assert.equal(typeof results.find((r) => r !== null).credits, "number");
```

In `tests/payments.test.js`, in the existing test that fulfills a paid checkout and the existing refund test(s), add `paid_credits` assertions. Add the helper near `newAccount`:

```js
const paidOf = async (id) =>
  Number((await db.sql`SELECT paid_credits FROM accounts WHERE id = ${id}`)[0].paid_credits);
```

After a successful `fulfill` of a medium pack, assert `await paidOf(id) === 50`. After a full refund of that pack, assert `await paidOf(id) === 0`. After a half refund (if a partial-refund test exists), assert `await paidOf(id) === 25`. To find the right tests, run `grep -n "applyRefund\|fulfill(" tests/payments.test.js`.

- [ ] **Step 3: Run the tests to see them fail**

Run: `node --test tests/accounts.test.js tests/payments.test.js`
Expected: FAIL. `spend.paid` is undefined (spendCredit returns a number), and `paid_credits` stays 0.

- [ ] **Step 4: Implement**

`server/accounts.js`, replacing `spendCredit`, `refundCredit` and `addCredits`:

```js
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
```

`server/credits.js`, in `withCredit` (Task 2 adds usage saving here):

```js
  await requireActive(accountId);
  const spend = await spendCredit(accountId, reason);
  if (spend === null) {
    const account = await getAccount(accountId);
    if (!account)
      throw new UserFacingError(
        "Your account wasn't found. Sign in again.",
        401,
      );
    throw new UserFacingError("Not enough credits.", 402);
  }
  try {
    const result = await job();
    return { ...result, credits: spend.credits };
  } catch (error) {
    await refundCredit(accountId, reason, spend.paid);
    throw error;
  }
```

`server/payments.js`, in `fulfill`:

```js
  const after = await addCredits(accountId, credits, "purchase", session.id, { paid: true });
```

`server/payments.js`, in `applyRefund`: replace the ledger insert and the balance update inside the transaction:

```js
    const logged = await client.query(
      `INSERT INTO credit_ledger (account_id, change, reason, ref, paid)
       VALUES ($1, $2, 'refund_purchase', $3, true)
       ON CONFLICT (reason, ref) DO NOTHING RETURNING id`,
      [accountId, -removed, `${pi}:${charge.amount_refunded}`],
    );
    if (!logged.rows[0]) return null;
    await client.query(
      `UPDATE accounts
          SET credits = credits - $2,
              paid_credits = GREATEST(0, LEAST(paid_credits - $2, credits - $2))
        WHERE id = $1`,
      [accountId, removed],
    );
```

- [ ] **Step 5: Run the tests to see them pass, then the whole suite**

Run: `node --test tests/accounts.test.js tests/payments.test.js && npm test`
Expected: PASS, with no other test broken. `grep -rn "spendCredit(" server netlify tests` should show only `credits.js` and tests as callers.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/20261014120000_money.sql server/accounts.js server/credits.js server/payments.js tests/accounts.test.js tests/payments.test.js
git commit -m "Credits: track paid vs free (free spent first); money tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Save every AI job's usage

**Files:**
- Modify: `server/usage.js`
- Modify: `server/credits.js`
- Modify: `server/moderate.js` (the `finally` block at the end of `moderate`)
- Test: `tests/accounts.test.js`, `tests/community.test.js`

**Interfaces:**
- Consumes: `spendCredit → { credits, ledgerId, paid }` (Task 1); table `ai_usage` (Task 1)
- Produces: `collectUsage(lines: object[], work: () => Promise<T>) → Promise<T>`. While `work` runs, every `logUsage` line is pushed onto `lines`.
- Produces: `saveUsage(lines: object[], ledgerId: number | null = null) → Promise<void>`. It never throws.
- `logUsage(step, total, extra)` still returns the same line, now including `step` and possibly `failed`.

- [ ] **Step 1: Write the failing tests**

In `tests/accounts.test.js` (import `logUsage`, `emptyUsage` from `../server/usage.js`):

```js
const usageRows = (ledgerId) =>
  db.sql`SELECT step, model, input, output, cost_usd, failed FROM ai_usage WHERE ledger_id = ${ledgerId}`;
const lastSpend = async (id) =>
  Number((await db.sql`SELECT max(id) AS id FROM credit_ledger WHERE account_id = ${id} AND change = -1`)[0].id);

test("an AI job's usage is saved against the credit that paid for it", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-use-1", displayName: "Jo" });
  const signedIn = req("/api/idea", {
    headers: { cookie: sessionCookie(id, req("/")).split(";")[0] },
  });
  await withCredit(signedIn, "idea", async () => {
    const total = { ...emptyUsage("claude-opus-5-5"), calls: 1, input: 1000, output: 200 };
    logUsage("idea", total, { ms: 5 });
    return { name: "Dish" };
  });
  const rows = await usageRows(await lastSpend(id));
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { step: rows[0].step, input: rows[0].input, output: rows[0].output, failed: rows[0].failed },
    { step: "idea", input: 1000, output: 200, failed: false },
  );
  assert.equal(Number(rows[0].cost_usd), 0.008); // 1000×$4 + 200×$20 per million
});

test("a failed job's usage is saved as failed, and the credit comes back", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-use-2", displayName: "Kit" });
  const signedIn = req("/api/recipe", {
    headers: { cookie: sessionCookie(id, req("/")).split(";")[0] },
  });
  await assert.rejects(
    withCredit(signedIn, "recipe", async () => {
      logUsage("recipe", { ...emptyUsage("claude-opus-5-5"), calls: 1, input: 500 }, { failed: "no recipe" });
      throw new Error("no recipe");
    }),
  );
  const rows = await usageRows(await lastSpend(id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].failed, true);
  assert.equal((await getAccount(id)).credits, 10);
});

test("a usage row that can't be saved doesn't break the job", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-use-3", displayName: "Lu" });
  const signedIn = req("/api/idea", {
    headers: { cookie: sessionCookie(id, req("/")).split(";")[0] },
  });
  const quiet = console.error;
  console.error = () => {};
  try {
    const result = await withCredit(signedIn, "idea", async () => {
      logUsage("not-a-step", emptyUsage("claude-opus-5-5")); // fails the CHECK
      return { name: "Still fine" };
    });
    assert.equal(result.name, "Still fine");
  } finally {
    console.error = quiet;
  }
});
```

In `tests/community.test.js`, next to the existing `moderate` tests (it already has `db` and the `haiku` fake):

```js
test("each moderation check saves a usage row without a credit", async () => {
  const before = Number((await db.sql`SELECT count(*) AS n FROM ai_usage WHERE step = 'moderation'`)[0].n);
  await moderate("comment", "hi", haiku("fine"));
  await moderate("comment", "hi", haiku("throw"));
  const rows = await db.sql`SELECT ledger_id FROM ai_usage WHERE step = 'moderation' ORDER BY id DESC LIMIT 2`;
  const after = Number((await db.sql`SELECT count(*) AS n FROM ai_usage WHERE step = 'moderation'`)[0].n);
  assert.equal(after - before, 2);
  assert.ok(rows.every((r) => r.ledger_id === null));
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/accounts.test.js tests/community.test.js`
Expected: FAIL. `logUsage` is imported but no rows appear in `ai_usage`.

- [ ] **Step 3: Implement**

`server/usage.js`: add at the top, change `logUsage`, and add `collectUsage` and `saveUsage`:

```js
import { AsyncLocalStorage } from "node:async_hooks";
import { database } from "./db.js";

// The usage lines logged while a credit-paid job runs, so withCredit can
// save them against the credit that paid.
const collecting = new AsyncLocalStorage();
```

```js
// One JSON line per job in the Netlify function logs; search for "ai_usage".
export function logUsage(step, total, extra = {}) {
  const line = {
    event: "ai_usage",
    step,
    ...total,
    costUsd: costOf(total),
    ...extra,
  };
  console.log(JSON.stringify(line));
  collecting.getStore()?.push(line);
  return line;
}

export const collectUsage = (lines, work) => collecting.run(lines, work);

// Saves usage lines for the Money tab. Never throws: a lost row only
// makes the estimate a little low, while a thrown error would fail the job.
export async function saveUsage(lines, ledgerId = null) {
  for (const line of lines) {
    try {
      await database().sql`
        INSERT INTO ai_usage (step, model, input, output, cache_read, cache_write, cost_usd, ledger_id, failed)
        VALUES (${line.step}, ${line.model}, ${line.input}, ${line.output},
                ${line.cacheRead}, ${line.cacheWrite}, ${line.costUsd},
                ${ledgerId}, ${Boolean(line.failed)})`;
    } catch (error) {
      console.error("ai_usage:", error.message);
    }
  }
}
```

`server/credits.js`: import `collectUsage, saveUsage` from `./usage.js` and wrap the job:

```js
  const lines = [];
  try {
    const result = await collectUsage(lines, job);
    return { ...result, credits: spend.credits };
  } catch (error) {
    await refundCredit(accountId, reason, spend.paid);
    throw error;
  } finally {
    await saveUsage(lines, spend.ledgerId);
  }
```

`server/moderate.js`: import `saveUsage` and change the final `finally`. Moderation never runs inside `withCredit`, so it saves its own line:

```js
  } finally {
    await saveUsage([logUsage("moderation", usage, { kind })]);
  }
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

Run: `node --test tests/accounts.test.js tests/community.test.js && npm test`
Expected: PASS. `tests/chef.test.js` and `tests/mcp.test.js` still pass, because `logUsage` outside a collector behaves as before.

- [ ] **Step 5: Commit**

```bash
git add server/usage.js server/credits.js server/moderate.js tests/accounts.test.js tests/community.test.js
git commit -m "Save each AI job's usage and estimated cost, linked to the credit that paid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Fixed costs

**Files:**
- Create: `server/costs.js`
- Test: `tests/costs.test.js`

**Interfaces:**
- Consumes: table `fixed_costs` (Task 1), `requireAdmin` (`server/roles.js`), `UserFacingError` (`server/chef.js`)
- Produces: `shareOf(cost: { cents, period, starts: "YYYY-MM", ends: "YYYY-MM"|null }, month: "YYYY-MM") → number` (cents)
- Produces: `listCosts() → Promise<Array<{ id, name, cents, period, starts, ends }>>`
- Produces: `addCost(actorId, body) → Promise<cost>`, `updateCost(actorId, id, body) → Promise<cost>`, `deleteCost(actorId, id) → Promise<{ deleted: true }>`. `body` is `{ name, cents, period, starts, ends }`.
- Produces: `monthsBetween(a: "YYYY-MM", b: "YYYY-MM") → number` (b − a in months)

- [ ] **Step 1: Write the failing tests** (`tests/costs.test.js`)

```js
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
import { connect, useDatabase } from "../server/db.js";
import { findOrCreateAccount } from "../server/accounts.js";
import { addCost, deleteCost, listCosts, monthsBetween, shareOf, updateCost } from "../server/costs.js";

let server;
let db;
let admin;
let mod;

before(async () => {
  server = new NetlifyDB();
  const connectionString = await server.start();
  await server.applyMigrations("./db/migrations");
  db = connect(connectionString);
  useDatabase(db);
  admin = await findOrCreateAccount({ sub: "cost-admin", displayName: "Ada" });
  mod = await findOrCreateAccount({ sub: "cost-mod", displayName: "Mo" });
  await db.sql`UPDATE accounts SET is_admin = true WHERE id = ${admin.id}`;
  await db.sql`UPDATE accounts SET is_mod = true WHERE id = ${mod.id}`;
});
after(async () => {
  await db?.pool.end();
  await server?.stop();
});

const rejectsWith = (promise, status, pattern) =>
  assert.rejects(promise, (e) => e.status === status && (!pattern || pattern.test(e.message)));

test("months between", () => {
  assert.equal(monthsBetween("2026-10", "2026-10"), 0);
  assert.equal(monthsBetween("2026-10", "2027-01"), 3);
  assert.equal(monthsBetween("2026-10", "2026-09"), -1);
});

test("monthly costs count in full from start to end", () => {
  const c = { cents: 1900, period: "monthly", starts: "2026-10", ends: "2026-12" };
  assert.equal(shareOf(c, "2026-09"), 0);
  assert.equal(shareOf(c, "2026-10"), 1900);
  assert.equal(shareOf(c, "2026-12"), 1900);
  assert.equal(shareOf(c, "2027-01"), 0);
  assert.equal(shareOf({ ...c, ends: null }, "2030-05"), 1900);
});

test("yearly costs spread over twelve months and add up exactly", () => {
  const c = { cents: 1201, period: "yearly", starts: "2026-03", ends: null };
  const year = Array.from({ length: 12 }, (_, i) => {
    const m = 3 + i;
    const key = `${2026 + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, "0")}`;
    return shareOf(c, key);
  });
  assert.equal(year.reduce((a, b) => a + b, 0), 1201);
  assert.equal(year[0], 1201 - 100 * 11); // remainder lands in the start month
  assert.equal(shareOf(c, "2027-03"), 101); // and again each anniversary
  assert.equal(shareOf(c, "2026-02"), 0);
});

test("one-off costs count only in their month", () => {
  const c = { cents: 500, period: "once", starts: "2026-10", ends: null };
  assert.equal(shareOf(c, "2026-10"), 500);
  assert.equal(shareOf(c, "2026-11"), 0);
});

test("admins add, edit, end and delete costs; others can't", async () => {
  const added = await addCost(admin.id, { name: " Netlify Pro ", cents: 1900, period: "monthly", starts: "2026-10", ends: null });
  assert.deepEqual(
    { name: added.name, cents: added.cents, period: added.period, starts: added.starts, ends: added.ends },
    { name: "Netlify Pro", cents: 1900, period: "monthly", starts: "2026-10", ends: null },
  );
  const ended = await updateCost(admin.id, added.id, { ...added, ends: "2027-03" });
  assert.equal(ended.ends, "2027-03");
  assert.ok((await listCosts()).some((c) => c.id === added.id && c.ends === "2027-03"));
  await rejectsWith(addCost(mod.id, { name: "x", cents: 1, period: "once", starts: "2026-10" }), 403);
  await rejectsWith(deleteCost(mod.id, added.id), 403);
  assert.deepEqual(await deleteCost(admin.id, added.id), { deleted: true });
  assert.ok(!(await listCosts()).some((c) => c.id === added.id));
  await rejectsWith(updateCost(admin.id, added.id, added), 404);
});

test("bad cost input is refused with a plain message", async () => {
  const ok = { name: "Domain", cents: 1200, period: "yearly", starts: "2026-10", ends: null };
  await rejectsWith(addCost(admin.id, { ...ok, name: "  " }), 400, /name/i);
  await rejectsWith(addCost(admin.id, { ...ok, cents: 0 }), 400, /amount/i);
  await rejectsWith(addCost(admin.id, { ...ok, cents: -5 }), 400, /amount/i);
  await rejectsWith(addCost(admin.id, { ...ok, cents: 12.5 }), 400, /amount/i);
  await rejectsWith(addCost(admin.id, { ...ok, period: "weekly" }), 400, /monthly/i);
  await rejectsWith(addCost(admin.id, { ...ok, starts: "2026-13" }), 400, /month/i);
  await rejectsWith(addCost(admin.id, { ...ok, starts: "Oct 2026" }), 400, /month/i);
  await rejectsWith(addCost(admin.id, { ...ok, ends: "2026-09" }), 400, /end/i);
  assert.equal((await listCosts()).filter((c) => c.name === "Domain").length, 0);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/costs.test.js`
Expected: FAIL with `Cannot find module '../server/costs.js'`.

- [ ] **Step 3: Implement** (`server/costs.js`)

```js
import { UserFacingError } from "./chef.js";
import { database } from "./db.js";
import { requireAdmin } from "./roles.js";

// Bills typed in on the Money tab: hosting, the domain, anything not
// metered. Months are "YYYY-MM" (UTC); the database keeps their first day.

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const PERIODS = ["monthly", "yearly", "once"];

export function monthsBetween(a, b) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

// This cost's cents in one month. A yearly cost is spread evenly; the
// remainder goes to its start month (and each anniversary) so a year adds
// up exactly.
export function shareOf(cost, month) {
  if (month < cost.starts || (cost.ends && month > cost.ends)) return 0;
  if (cost.period === "monthly") return cost.cents;
  if (cost.period === "once") return month === cost.starts ? cost.cents : 0;
  const base = Math.floor(cost.cents / 12);
  return monthsBetween(cost.starts, month) % 12 === 0
    ? cost.cents - base * 11
    : base;
}

function checked(body) {
  const name = String(body?.name ?? "").trim().slice(0, 80);
  if (!name) throw new UserFacingError("Give the cost a name, like Netlify Pro.");
  const cents = Number(body?.cents);
  if (!Number.isInteger(cents) || cents < 1 || cents > 10_000_000)
    throw new UserFacingError("Enter an amount above $0, like 19.00.");
  if (!PERIODS.includes(body?.period))
    throw new UserFacingError("Pick monthly, yearly or one-off.");
  const starts = String(body?.starts ?? "");
  if (!MONTH.test(starts))
    throw new UserFacingError("Pick the month it starts.");
  const ends = body?.ends ? String(body.ends) : null;
  if (ends !== null && !MONTH.test(ends))
    throw new UserFacingError("Pick the month it ends, or leave it empty.");
  if (ends !== null && ends < starts)
    throw new UserFacingError("The end month can't be before the start month.");
  return { name, cents, period: body.period, starts, ends };
}

const SELECT = `SELECT id, name, cents, period,
  to_char(starts, 'YYYY-MM') AS starts, to_char(ends, 'YYYY-MM') AS ends
  FROM fixed_costs`;

const shape = (r) => ({
  id: Number(r.id),
  name: r.name,
  cents: Number(r.cents),
  period: r.period,
  starts: r.starts,
  ends: r.ends ?? null,
});

const day = (month) => (month ? `${month}-01` : null);

export async function listCosts() {
  const { rows } = await database().pool.query(`${SELECT} ORDER BY starts, id`);
  return rows.map(shape);
}

export async function addCost(actorId, body) {
  await requireAdmin(actorId);
  const c = checked(body);
  const rows = await database().sql`
    INSERT INTO fixed_costs (name, cents, period, starts, ends)
    VALUES (${c.name}, ${c.cents}, ${c.period}, ${day(c.starts)}, ${day(c.ends)})
    RETURNING id`;
  return { id: Number(rows[0].id), ...c };
}

export async function updateCost(actorId, id, body) {
  await requireAdmin(actorId);
  const c = checked(body);
  const rows = await database().sql`
    UPDATE fixed_costs
       SET name = ${c.name}, cents = ${c.cents}, period = ${c.period},
           starts = ${day(c.starts)}, ends = ${day(c.ends)}
     WHERE id = ${id} RETURNING id`;
  if (!rows[0]) throw new UserFacingError("That cost wasn't found.", 404);
  return { id: Number(id), ...c };
}

export async function deleteCost(actorId, id) {
  await requireAdmin(actorId);
  const rows = await database().sql`DELETE FROM fixed_costs WHERE id = ${id} RETURNING id`;
  if (!rows[0]) throw new UserFacingError("That cost wasn't found.", 404);
  return { deleted: true };
}
```

Check before relying on it: `UserFacingError(message)` with no status must default to 400. Run `grep -n "class UserFacingError" -A6 server/chef.js`. If the default is different, pass `400` explicitly in `checked`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test tests/costs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/costs.js tests/costs.test.js
git commit -m "Fixed costs for the Money tab: monthly, yearly (spread), one-off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Building a month, and saving finished ones

**Files:**
- Create: `server/money.js`
- Modify: `vite.config.js` (pass `ANTHROPIC_ADMIN_KEY` to functions locally)
- Modify: `README.md` (setup note)
- Test: `tests/money.test.js`

**Interfaces:**
- Consumes: `stripe()` / `useStripe(fake)` (`server/stripe.js`); `listCosts`, `shareOf` (Task 3); `ai_usage`, `credit_ledger.paid`, `money_months` (Tasks 1–2); `requireAdmin`
- Produces: `monthKey(date: Date) → "YYYY-MM"`; `monthBounds(key) → { start: Date, end: Date }`; `previousMonth(key) → key`
- Produces: `useFetch(fn)`, so tests can swap the fetch used for Anthropic
- Produces: `buildMonth(key: string, now?: Date) → Promise<MonthTotals>`
- Produces: `moneyOverview(actorId, now = new Date()) → Promise<{ current: MonthTotals, saved: MonthTotals[], costs: Cost[] }>`
- `MonthTotals` (also the JSON saved in `money_months.totals`):

```js
{
  month: "2026-10",
  complete: true,                 // false when Stripe or Anthropic failed
  missing: [],                    // e.g. ["stripe"]
  sales: { cents: 900, count: 2, packs: { small: 1, medium: 1 } } | null,
  stripeFeeCents: 81 | null,
  refundCents: 300 | null,
  ai: {
    estimateCents: 13,            // all steps, rounded
    byStep: { idea: { jobs, cents }, recipe: { jobs, cents }, moderation: { jobs, cents } },
    free: { credits: 12, cents: 8 },  // idea+recipe only
    paid: { credits: 4, cents: 3 },
  },
  anthropic: { status: "ok" | "no_key" | "failed", cents: 1402 | null },
  fixed: [{ name: "Netlify Pro", cents: 1900 }],
  fixedCents: 1900,
  netCents: 600,                  // sales − fees − refunds − AI estimate − fixed (missing parts count as 0)
  perCredit: { aiCents: 3.12 | null, earnedCents: 12.4 | null },
}
```

- [ ] **Step 1: Write the failing tests** (`tests/money.test.js`)

```js
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
import { connect, useDatabase } from "../server/db.js";
import { addCredits, findOrCreateAccount, spendCredit } from "../server/accounts.js";
import { useStripe } from "../server/stripe.js";
import { addCost } from "../server/costs.js";
import { buildMonth, monthBounds, monthKey, moneyOverview, previousMonth, useFetch } from "../server/money.js";

let server;
let db;
let admin;
let txns;
let stripeFails;
let anthropicCents;
let anthropicFails;
let fetched;

const unix = (iso) => Math.floor(Date.parse(iso) / 1000);
const pi = (meta) => ({ object: "payment_intent", metadata: meta });
const ours = (pack, credits, cents) => pi({ accountId: "1", pack, credits: String(credits), cents: String(cents) });

function fakeStripe() {
  return {
    balanceTransactions: {
      list(params) {
        const data = txns.filter((t) => t.created >= params.created.gte && t.created < params.created.lt);
        return {
          async *[Symbol.asyncIterator]() {
            if (stripeFails) throw new Error("stripe down");
            yield* data;
          },
        };
      },
    },
  };
}

const fakeFetch = async (url) => {
  fetched.push(String(url));
  if (anthropicFails) return new Response("nope", { status: 500 });
  return Response.json({
    data: [{ results: [{ currency: "USD", amount: String(anthropicCents) }] }],
    has_more: false,
    next_page: null,
  });
};

before(async () => {
  server = new NetlifyDB();
  const connectionString = await server.start();
  await server.applyMigrations("./db/migrations");
  db = connect(connectionString);
  useDatabase(db);
  admin = await findOrCreateAccount({ sub: "money-admin", displayName: "Ada" });
  await db.sql`UPDATE accounts SET is_admin = true WHERE id = ${admin.id}`;
});
beforeEach(async () => {
  txns = [];
  stripeFails = false;
  anthropicCents = 0;
  anthropicFails = false;
  fetched = [];
  useStripe(fakeStripe());
  useFetch(fakeFetch);
  delete process.env.ANTHROPIC_ADMIN_KEY;
  // Each test sets up its own month; ledger rows from earlier tests would
  // otherwise count as this month's purchases and spends.
  await db.sql`DELETE FROM ai_usage`;
  await db.sql`DELETE FROM credit_ledger`;
  await db.sql`DELETE FROM fixed_costs`;
  await db.sql`DELETE FROM money_months`;
});
after(async () => {
  await db?.pool.end();
  await server?.stop();
});

const usage = (step, usd, at, ledgerId = null, failed = false) =>
  db.sql`INSERT INTO ai_usage (step, model, cost_usd, created_at, ledger_id, failed)
         VALUES (${step}, 'claude-opus-5-5', ${usd}, ${at}, ${ledgerId}, ${failed})`;

test("month keys and bounds are UTC calendar months", () => {
  assert.equal(monthKey(new Date("2026-10-31T23:59:59Z")), "2026-10");
  assert.equal(monthKey(new Date("2026-11-01T00:00:00Z")), "2026-11");
  const { start, end } = monthBounds("2026-12");
  assert.equal(start.toISOString(), "2026-12-01T00:00:00.000Z");
  assert.equal(end.toISOString(), "2027-01-01T00:00:00.000Z");
  assert.equal(previousMonth("2026-01"), "2025-12");
});

test("an empty month is all zeros, with no per-credit figures", async () => {
  const m = await buildMonth("2026-05");
  assert.equal(m.complete, true);
  assert.deepEqual(m.sales, { cents: 0, count: 0, packs: {} });
  assert.equal(m.ai.estimateCents, 0);
  assert.equal(m.netCents, 0);
  assert.deepEqual(m.perCredit, { aiCents: null, earnedCents: null });
  assert.deepEqual(m.anthropic, { status: "no_key", cents: null });
});

test("sales, fees and refunds come from Stripe, ours only, inside the month", async () => {
  txns = [
    { type: "charge", amount: 300, fee: 39, created: unix("2026-10-31T23:59:59Z"), source: { payment_intent: ours("small", 20, 300) } },
    { type: "charge", amount: 600, fee: 47, created: unix("2026-10-02T10:00:00Z"), source: { payment_intent: ours("medium", 50, 600) } },
    { type: "refund", amount: -300, fee: 0, created: unix("2026-10-05T10:00:00Z"), source: { payment_intent: ours("small", 20, 300) } },
    { type: "charge", amount: 5000, fee: 175, created: unix("2026-10-03T10:00:00Z"), source: { payment_intent: pi({}) } },
    { type: "charge", amount: 1200, fee: 65, created: unix("2026-11-01T00:00:00Z"), source: { payment_intent: ours("large", 120, 1200) } },
    { type: "payout", amount: -800, fee: 0, created: unix("2026-10-20T00:00:00Z"), source: { object: "payout" } },
  ];
  const m = await buildMonth("2026-10");
  assert.deepEqual(m.sales, { cents: 900, count: 2, packs: { small: 1, medium: 1 } });
  assert.equal(m.stripeFeeCents, 86);
  assert.equal(m.refundCents, 300);
  assert.equal(m.netCents, 900 - 86 - 300);
});

test("AI estimate by step and by free/paid credits, month edges respected", async () => {
  const { id } = await findOrCreateAccount({ sub: "money-user-1", displayName: "Bo" });
  await addCredits(id, 20, "purchase", "cs_money_1", { paid: true });
  await db.sql`UPDATE credit_ledger SET created_at = '2026-10-01T00:00:00Z' WHERE ref = 'cs_money_1'`;
  const spends = [];
  for (let i = 0; i < 11; i++) spends.push(await spendCredit(id, i < 6 ? "idea" : "recipe"));
  await db.sql`UPDATE credit_ledger SET created_at = '2026-10-10T00:00:00Z' WHERE account_id = ${id} AND change = -1`;
  for (const [i, s] of spends.entries())
    await usage(i < 6 ? "idea" : "recipe", 0.04, "2026-10-10T00:00:00Z", s.ledgerId);
  await usage("moderation", 0.0002, "2026-10-31T23:59:59Z");
  await usage("idea", 0.05, "2026-11-01T00:00:00Z"); // next month
  const m = await buildMonth("2026-10");
  assert.equal(m.ai.byStep.idea.jobs, 6);
  assert.equal(m.ai.byStep.recipe.jobs, 5);
  assert.equal(m.ai.byStep.moderation.jobs, 1);
  assert.equal(m.ai.estimateCents, 44); // 11 × 4¢ + 0.02¢
  assert.deepEqual(m.ai.free, { credits: 10, cents: 40 });
  assert.deepEqual(m.ai.paid, { credits: 1, cents: 4 });
  assert.equal(m.perCredit.aiCents, 4);
});

test("a deleted account's AI cost still counts, as free", async () => {
  const { id } = await findOrCreateAccount({ sub: "money-user-2", displayName: "Cy" });
  const s = await spendCredit(id, "idea");
  await usage("idea", 0.03, "2026-09-15T00:00:00Z", s.ledgerId);
  await db.sql`DELETE FROM accounts WHERE id = ${id}`;
  const m = await buildMonth("2026-09");
  assert.equal(m.ai.estimateCents, 3);
  assert.equal(m.ai.free.cents, 3);
});

test("fixed costs and earned per paid credit", async () => {
  await addCost(admin.id, { name: "Netlify Pro", cents: 1900, period: "monthly", starts: "2026-10" });
  await addCost(admin.id, { name: "Domain", cents: 1200, period: "yearly", starts: "2026-10" });
  txns = [
    { type: "charge", amount: 600, fee: 47, created: unix("2026-10-02T10:00:00Z"), source: { payment_intent: ours("medium", 50, 600) } },
  ];
  const { id } = await findOrCreateAccount({ sub: "money-user-3", displayName: "Di" });
  await addCredits(id, 50, "purchase", "cs_money_3", { paid: true });
  await db.sql`UPDATE credit_ledger SET created_at = '2026-10-02T10:00:00Z' WHERE ref = 'cs_money_3'`;
  const m = await buildMonth("2026-10");
  assert.deepEqual(m.fixed, [{ name: "Netlify Pro", cents: 1900 }, { name: "Domain", cents: 100 }]);
  assert.equal(m.fixedCents, 2000);
  assert.equal(m.perCredit.earnedCents, 11.06); // (600 − 47) / 50
  assert.equal(m.netCents, 600 - 47 - 2000);
});

test("Anthropic's actual cost, when there's an admin key", async () => {
  process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
  anthropicCents = 1402.5;
  const m = await buildMonth("2026-08", new Date("2026-10-14T12:00:00Z"));
  assert.deepEqual(m.anthropic, { status: "ok", cents: 1403 });
  const url = new URL(fetched[0]);
  assert.equal(url.pathname, "/v1/organizations/cost_report");
  assert.equal(url.searchParams.get("starting_at"), "2026-08-01T00:00:00.000Z");
  assert.equal(url.searchParams.get("ending_at"), "2026-09-01T00:00:00.000Z");
});

test("a failed source marks the month incomplete", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    stripeFails = true;
    let m = await buildMonth("2026-10");
    assert.equal(m.complete, false);
    assert.deepEqual(m.missing, ["stripe"]);
    assert.equal(m.sales, null);
    stripeFails = false;
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    anthropicFails = true;
    m = await buildMonth("2026-10");
    assert.equal(m.complete, false);
    assert.deepEqual(m.anthropic, { status: "failed", cents: null });
  } finally {
    console.error = quiet;
  }
});

test("finished months are saved once and don't change later", async () => {
  await addCost(admin.id, { name: "Netlify Pro", cents: 1900, period: "monthly", starts: "2026-08" });
  const now = new Date("2026-10-14T12:00:00Z");
  const first = await moneyOverview(admin.id, now);
  assert.equal(first.current.month, "2026-10");
  assert.deepEqual(first.saved.map((m) => m.month), ["2026-09", "2026-08"]);
  await db.sql`UPDATE fixed_costs SET cents = 5000`;
  const again = await moneyOverview(admin.id, now);
  assert.equal(again.saved[0].fixedCents, 1900);
  assert.equal(again.current.fixedCents, 5000);
});

test("an incomplete month isn't saved until it loads fully", async () => {
  await addCost(admin.id, { name: "Netlify Pro", cents: 1900, period: "monthly", starts: "2026-09" });
  const now = new Date("2026-10-14T12:00:00Z");
  const quiet = console.error;
  console.error = () => {};
  try {
    stripeFails = true;
    assert.deepEqual((await moneyOverview(admin.id, now)).saved, []);
  } finally {
    console.error = quiet;
  }
  stripeFails = false;
  assert.deepEqual((await moneyOverview(admin.id, now)).saved.map((m) => m.month), ["2026-09"]);
});

test("only admins see money", async () => {
  const mod = await findOrCreateAccount({ sub: "money-mod", displayName: "Mo" });
  await db.sql`UPDATE accounts SET is_mod = true WHERE id = ${mod.id}`;
  await assert.rejects(moneyOverview(mod.id), (e) => e.status === 403);
  await assert.rejects(moneyOverview(null), (e) => e.status === 403);
});
```

`moneyOverview(null)` must reject with 403. `requireAdmin(null)` uses `roleOf(null)`, which returns NOBODY (`admin: false`), so it throws "Only admins can do that." with 403. The function layer already turns a missing sign-in into 401 before this runs.

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/money.test.js`
Expected: FAIL with `Cannot find module '../server/money.js'`.

- [ ] **Step 3: Implement** (`server/money.js`)

```js
import { database } from "./db.js";
import { listCosts, shareOf } from "./costs.js";
import { requireAdmin } from "./roles.js";
import { stripe } from "./stripe.js";

// The admin Money tab: what came in (credit packs) and what went out
// (Stripe fees, refunds, AI, fixed bills), per UTC calendar month. The
// current month is worked out live; finished months are saved once.

const SAVED_MONTHS = 12;
const STEPS = ["idea", "recipe", "moderation"];

export const monthKey = (date) => date.toISOString().slice(0, 7);

export function monthBounds(key) {
  const [y, m] = key.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

export const previousMonth = (key) =>
  monthKey(new Date(monthBounds(key).start.getTime() - 1));

let fetcher = (...args) => fetch(...args);
export function useFetch(fn) {
  fetcher = fn;
}

const round2 = (n) => Math.round(n * 100) / 100;

// Our credit pack charges and refunds in the month. Other things sold on
// the same Stripe account have no pack metadata and are skipped.
async function stripeMonth({ start, end }) {
  const out = { sales: { cents: 0, count: 0, packs: {} }, feeCents: 0, refundCents: 0 };
  const list = stripe().balanceTransactions.list({
    created: { gte: start.getTime() / 1000, lt: end.getTime() / 1000 },
    limit: 100,
    expand: ["data.source.payment_intent"],
  });
  for await (const t of list) {
    const meta = t.source?.payment_intent?.metadata;
    if (!meta?.accountId || !meta?.credits) continue;
    if (t.type === "charge" || t.type === "payment") {
      out.sales.cents += t.amount;
      out.sales.count += 1;
      out.sales.packs[meta.pack] = (out.sales.packs[meta.pack] ?? 0) + 1;
    } else if (t.type === "refund" || t.type === "payment_refund") {
      out.refundCents += -t.amount;
    } else continue;
    out.feeCents += t.fee;
  }
  return out;
}

// Anthropic's own cost report (needs an Admin API key). Amounts are
// cents as decimal strings, in daily buckets.
async function anthropicMonth({ start, end }, now) {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) return { status: "no_key", cents: null };
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const until = end < tomorrow ? end : tomorrow;
  let cents = 0;
  let page = null;
  do {
    const url = new URL("https://api.anthropic.com/v1/organizations/cost_report");
    url.searchParams.set("starting_at", start.toISOString());
    url.searchParams.set("ending_at", until.toISOString());
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit", "31");
    if (page) url.searchParams.set("page", page);
    const res = await fetcher(url, {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`cost_report ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    for (const bucket of body.data ?? [])
      for (const r of bucket.results ?? []) cents += Number(r.amount) || 0;
    page = body.has_more ? body.next_page : null;
  } while (page);
  return { status: "ok", cents: Math.round(cents) };
}

// The app's own estimate from ai_usage, and credits spent by pool. Jobs
// whose ledger row is gone (deleted account) or predates paid credits
// count as free.
async function aiMonth({ start, end }) {
  const db = database();
  const jobs = await db.sql`
    SELECT u.step, COALESCE(l.paid, false) AS paid,
           count(*)::int AS jobs, COALESCE(sum(u.cost_usd), 0)::float AS usd
      FROM ai_usage u LEFT JOIN credit_ledger l ON l.id = u.ledger_id
     WHERE u.created_at >= ${start.toISOString()} AND u.created_at < ${end.toISOString()}
     GROUP BY 1, 2`;
  const spent = await db.sql`
    SELECT COALESCE(paid, false) AS paid, COALESCE(sum(-change), 0)::int AS credits
      FROM credit_ledger
     WHERE created_at >= ${start.toISOString()} AND created_at < ${end.toISOString()}
       AND reason IN ('idea', 'recipe', 'refund:idea', 'refund:recipe')
     GROUP BY 1`;
  const sold = await db.sql`
    SELECT COALESCE(sum(change), 0)::int AS credits FROM credit_ledger
     WHERE created_at >= ${start.toISOString()} AND created_at < ${end.toISOString()}
       AND reason IN ('purchase', 'refund_purchase')`;
  const byStep = Object.fromEntries(STEPS.map((s) => [s, { jobs: 0, usd: 0 }]));
  const pool = { free: { credits: 0, usd: 0 }, paid: { credits: 0, usd: 0 } };
  for (const r of jobs) {
    byStep[r.step].jobs += r.jobs;
    byStep[r.step].usd += r.usd;
    if (r.step !== "moderation") pool[r.paid ? "paid" : "free"].usd += r.usd;
  }
  for (const r of spent) pool[r.paid ? "paid" : "free"].credits += r.credits;
  const usd = STEPS.reduce((sum, s) => sum + byStep[s].usd, 0);
  const creditUsd = pool.free.usd + pool.paid.usd;
  const creditsSpent = pool.free.credits + pool.paid.credits;
  const cents = (d) => Math.round(d * 100);
  return {
    estimateCents: cents(usd),
    byStep: Object.fromEntries(STEPS.map((s) => [s, { jobs: byStep[s].jobs, cents: cents(byStep[s].usd) }])),
    free: { credits: pool.free.credits, cents: cents(pool.free.usd) },
    paid: { credits: pool.paid.credits, cents: cents(pool.paid.usd) },
    aiCentsPerCredit: creditsSpent > 0 ? round2((creditUsd * 100) / creditsSpent) : null,
    paidCreditsSold: sold[0].credits,
  };
}

export async function buildMonth(key, now = new Date()) {
  const bounds = monthBounds(key);
  const missing = [];
  const [money, anthropic, ai, costs] = await Promise.all([
    stripeMonth(bounds).catch((error) => {
      console.error("money: stripe", error);
      missing.push("stripe");
      return null;
    }),
    anthropicMonth(bounds, now).catch((error) => {
      console.error("money: anthropic", error);
      missing.push("anthropic");
      return { status: "failed", cents: null };
    }),
    aiMonth(bounds),
    listCosts(),
  ]);
  const fixed = costs
    .map((c) => ({ name: c.name, cents: shareOf(c, key) }))
    .filter((c) => c.cents > 0);
  const fixedCents = fixed.reduce((sum, c) => sum + c.cents, 0);
  const salesCents = money?.sales.cents ?? 0;
  const feeCents = money?.feeCents ?? 0;
  const refundCents = money?.refundCents ?? 0;
  const { aiCentsPerCredit, paidCreditsSold, ...aiParts } = ai;
  return {
    month: key,
    complete: missing.length === 0,
    missing,
    sales: money?.sales ?? null,
    stripeFeeCents: money ? feeCents : null,
    refundCents: money ? refundCents : null,
    ai: aiParts,
    anthropic,
    fixed,
    fixedCents,
    netCents: salesCents - feeCents - refundCents - ai.estimateCents - fixedCents,
    perCredit: {
      aiCents: aiCentsPerCredit,
      earnedCents:
        money && paidCreditsSold > 0
          ? round2((salesCents - feeCents - refundCents) / paidCreditsSold)
          : null,
    },
  };
}

// The first month anything happened: AI use, a purchase, or a fixed cost.
async function firstMonth() {
  const rows = await database().sql`
    SELECT to_char(LEAST(
      (SELECT min(created_at) FROM ai_usage),
      (SELECT min(created_at) FROM credit_ledger WHERE reason = 'purchase'),
      (SELECT min(starts)::timestamptz FROM fixed_costs)
    ) AT TIME ZONE 'UTC', 'YYYY-MM') AS month`;
  return rows[0]?.month ?? null;
}

// Saves finished months that aren't saved yet, oldest first, back to the
// first month with data (at most 12). Incomplete ones wait for next time.
async function saveFinishedMonths(current, now) {
  const first = await firstMonth();
  if (!first) return;
  const db = database();
  const saved = new Set(
    (await db.sql`SELECT to_char(month, 'YYYY-MM') AS month FROM money_months`).map((r) => r.month),
  );
  const months = [];
  for (let key = previousMonth(current); months.length < SAVED_MONTHS && key >= first; key = previousMonth(key))
    if (!saved.has(key)) months.unshift(key);
  for (const key of months) {
    const totals = await buildMonth(key, now);
    if (!totals.complete) continue;
    await db.sql`
      INSERT INTO money_months (month, totals) VALUES (${`${key}-01`}, ${JSON.stringify(totals)})
      ON CONFLICT (month) DO NOTHING`;
  }
}

export async function moneyOverview(actorId, now = new Date()) {
  await requireAdmin(actorId);
  const current = monthKey(now);
  await saveFinishedMonths(current, now);
  const saved = await database().sql`
    SELECT totals FROM money_months
     WHERE month < ${`${current}-01`}
     ORDER BY month DESC LIMIT ${SAVED_MONTHS}`;
  return {
    current: await buildMonth(current, now),
    saved: saved.map((r) => r.totals),
    costs: await listCosts(),
  };
}
```

Notes for the implementer:
- `pg` returns JSONB as parsed objects, so `r.totals` is already the object.
- If `count(*)::int` or `::float` casts come back as strings with this driver, wrap them in `Number(...)`. The tests compare numbers.
- `for await` over `balanceTransactions.list(...)` is the Stripe SDK's auto-pagination. The fake implements `Symbol.asyncIterator`.

`vite.config.js`: next to `process.env.MACRO_GENIE_LOCAL_KEY = ...`, add the line below. `local` already loads every `ANTHROPIC_` key from `.env`. Only the admin key goes into `process.env`; the API key stays out on purpose.

```js
    // Lets the Money tab compare against Anthropic's real bill locally.
    if (local.ANTHROPIC_ADMIN_KEY) process.env.ANTHROPIC_ADMIN_KEY ??= local.ANTHROPIC_ADMIN_KEY;
```

`README.md`: after the Stripe setup paragraph, add:

```markdown
The admin **Money** tab compares the app's AI cost estimate with Anthropic's actual bill when `ANTHROPIC_ADMIN_KEY` (an `sk-ant-admin…` Admin API key from the Claude Console; it needs an organization, not an individual account) is in `.env` locally or in the Netlify environment in production. Without it, the tab shows the estimate only.
```

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

Run: `node --test tests/money.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/money.js tests/money.test.js vite.config.js README.md
git commit -m "Money: monthly totals from Stripe, AI usage, Anthropic's cost report and fixed costs; finished months saved once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Money routes and the admin tab route

**Files:**
- Modify: `netlify/functions/admin.js` (imports and four `case`s)
- Modify: `src/lib/route.svelte.js:26` (`ADMIN_TABS`) and the path comment at line 8
- Test: `tests/route.test.js`, `tests/money.test.js`

**Interfaces:**
- Consumes: `moneyOverview` (Task 4); `addCost`, `updateCost`, `deleteCost` (Task 3)
- Produces: `GET /api/admin/money` → `{ current, saved, costs }`; `POST /api/admin/money/costs` → cost; `PATCH /api/admin/money/costs/:id` → cost; `DELETE /api/admin/money/costs/:id` → `{ deleted: true }`
- Produces: route `/admin/money` → `{ tab: "admin", adminTab: "money" }`

- [ ] **Step 1: Write the failing tests**

In `tests/route.test.js`, next to the `/admin/inbox` assertion:

```js
    assert.equal(parse("/admin/money").adminTab, "money");
```

If `route.test.js` has a round-trip test for paths (look for `pathFor` or similar near line 52), add `"/admin/money"` to its list the same way `"/admin/inbox"` appears.

In `tests/money.test.js`, add (import `admin as adminFn` from `../netlify/functions/admin.js` and `sessionCookie` from `../server/session.js`, and set `process.env.SESSION_SECRET = "x".repeat(40)` in `before`):

```js
const call = (path, { method = "GET", body, as } = {}) => {
  const base = new Request(`https://example.com${path}`);
  return adminFn(
    new Request(`https://example.com${path}`, {
      method,
      headers: {
        ...(as ? { cookie: sessionCookie(as, base).split(";")[0] } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
};

test("the money API: admins only, costs editable", async () => {
  const mod = await findOrCreateAccount({ sub: "money-mod-2", displayName: "Mae" });
  await db.sql`UPDATE accounts SET is_mod = true WHERE id = ${mod.id}`;
  assert.equal((await call("/api/admin/money")).status, 401);
  assert.equal((await call("/api/admin/money", { as: mod.id })).status, 403);
  const res = await call("/api/admin/money", { as: admin.id });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(body.current.month, monthKey(new Date()));
  const made = await call("/api/admin/money/costs", {
    method: "POST",
    as: admin.id,
    body: { name: "Netlify Pro", cents: 1900, period: "monthly", starts: "2026-10" },
  });
  assert.equal(made.status, 200);
  const cost = await made.json();
  const edited = await call(`/api/admin/money/costs/${cost.id}`, {
    method: "PATCH",
    as: admin.id,
    body: { ...cost, ends: "2026-12" },
  });
  assert.equal((await edited.json()).ends, "2026-12");
  assert.equal((await call(`/api/admin/money/costs/${cost.id}`, { method: "DELETE", as: mod.id })).status, 403);
  assert.equal((await call(`/api/admin/money/costs/${cost.id}`, { method: "DELETE", as: admin.id })).status, 200);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/route.test.js tests/money.test.js`
Expected: FAIL. The route resolves to `"reviews"` and the API answers 404 for `GET money`.

- [ ] **Step 3: Implement**

`src/lib/route.svelte.js`:

```js
const ADMIN_TABS = ["reviews", "users", "log", "inbox", "money"];
```

Update the path comment at line 8 so it lists `/admin/money` too.

`netlify/functions/admin.js`: add the imports:

```js
import { addCost, deleteCost, updateCost } from "../../server/costs.js";
import { moneyOverview } from "../../server/money.js";
```

and add these cases before `default:`:

```js
      case "GET money":
        return Response.json(await moneyOverview(actor), noStore);
      case "POST money/costs":
        return Response.json(await addCost(actor, await json(request)));
      case "PATCH money/costs/:id":
        return Response.json(
          await updateCost(actor, idFrom(id), await json(request)),
        );
      case "DELETE money/costs/:id":
        return Response.json(await deleteCost(actor, idFrom(id)));
```

Check: the function's `config.path` is `/api/admin/*` with no `method` restriction, so PATCH and DELETE reach it. Confirm with `grep -n "method" netlify/functions/admin.js`. If a method list exists, add `PATCH` and `DELETE`.

- [ ] **Step 4: Run the tests to see them pass, then the whole suite**

Run: `node --test tests/route.test.js tests/money.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/admin.js src/lib/route.svelte.js tests/route.test.js tests/money.test.js
git commit -m "Money API routes (admins only) and the /admin/money tab route

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Money tab

**Files:**
- Create: `src/components/AdminMoney.svelte`
- Modify: `src/components/Admin.svelte` (tabs list and switch)
- Modify: `src/style.css` (append a `/* Admin → Money */` block)

**Interfaces:**
- Consumes: `GET /api/admin/money`, `POST/PATCH/DELETE /api/admin/money/costs[/:id]` (Task 5); `api()` from `../lib/account.svelte.js`, which returns `{ ok, body, error }`; `account.isAdmin`

- [ ] **Step 1: Show the tab to admins only** (`src/components/Admin.svelte`)

```svelte
  import AdminMoney from './AdminMoney.svelte';
```

```js
  const TABS = [['reviews', 'Reviews'], ['users', 'Users'], ['log', 'Log'], ['inbox', 'Inbox'], ['money', 'Money']];
  const tabs = $derived(TABS.filter(([id]) => id !== 'money' || account.isAdmin));
```

Change `{#each TABS as [id, label] (id)}` to `{#each tabs as [id, label] (id)}`, and add a branch before `{:else}`:

```svelte
    {:else if adminTab === 'money' && account.isAdmin}
      <AdminMoney />
```

A moderator who opens `/admin/money` directly falls through to the Reviews queue, and the server refuses the data anyway.

- [ ] **Step 2: Write the component** (`src/components/AdminMoney.svelte`)

```svelte
<script>
  import { api } from '../lib/account.svelte.js';

  // Admin → Money: is the site paying for itself? The current month is live;
  // past months were saved when they ended. Amounts are cents from the server.
  let data = $state(null);
  let error = $state('');
  let busy = $state(false);
  let editing = $state(null); // a cost being edited, or a blank one being added

  const usd = (cents) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
  const signed = (cents) => `${cents >= 0 ? '+' : '−'}$${(Math.abs(cents) / 100).toFixed(2)}`;
  const cents = (n) => (n === null ? '—' : `${n.toFixed(1)}¢`);
  const label = (key) => new Date(`${key}-01T00:00:00Z`).toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const PERIOD = { monthly: 'monthly', yearly: 'yearly (spread over 12 months)', once: 'one-off' };
  const thisMonth = () => new Date().toISOString().slice(0, 7);

  async function load() {
    const res = await api('/api/admin/money');
    if (res.ok) { data = res.body; error = ''; }
    else error = res.error;
  }
  load();

  function edit(cost) {
    editing = cost
      ? { ...cost, dollars: (cost.cents / 100).toFixed(2), ends: cost.ends ?? '' }
      : { id: null, name: '', dollars: '', period: 'monthly', starts: thisMonth(), ends: '' };
  }

  async function save(e) {
    e.preventDefault();
    busy = true;
    const body = {
      name: editing.name,
      cents: Math.round(Number(editing.dollars) * 100),
      period: editing.period,
      starts: editing.starts,
      ends: editing.ends || null,
    };
    const res = editing.id
      ? await api(`/api/admin/money/costs/${editing.id}`, { method: 'PATCH', body })
      : await api('/api/admin/money/costs', { method: 'POST', body });
    busy = false;
    if (!res.ok) { error = res.error; return; }
    editing = null;
    await load();
  }

  async function remove(cost) {
    if (!confirm(`Delete “${cost.name}”? Saved months keep their numbers.`)) return;
    const res = await api(`/api/admin/money/costs/${cost.id}`, { method: 'DELETE' });
    if (!res.ok) { error = res.error; return; }
    await load();
  }
</script>

{#snippet month(m, live)}
  <details class="money-month" open={live}>
    <summary>
      <span class="money-month-name">{label(m.month)}{live ? ' (so far)' : ''}</span>
      <span class="money-net" class:loss={m.netCents < 0}>{signed(m.netCents)}{m.complete ? '' : ' · incomplete'}</span>
    </summary>
    <table class="money-lines">
      <tbody>
        {#if m.sales}
          <tr><th scope="row">Credit sales <span class="money-note">{m.sales.count} packs{#each Object.entries(m.sales.packs) as [pack, n] (pack)} · {n} {pack}{/each}</span></th><td>{usd(m.sales.cents)}</td></tr>
          <tr><th scope="row">Stripe fees</th><td>{usd(-m.stripeFeeCents)}</td></tr>
          <tr><th scope="row">Refunds</th><td>{usd(-m.refundCents)}</td></tr>
        {:else}
          <tr><th scope="row" colspan="2" class="method-error">Couldn’t reach Stripe; try again.</th></tr>
        {/if}
        <tr>
          <th scope="row">AI (estimate) <span class="money-note">{m.ai.byStep.idea.jobs} ideas · {m.ai.byStep.recipe.jobs} recipes · {m.ai.byStep.moderation.jobs} checks</span></th>
          <td>{usd(-m.ai.estimateCents)}</td>
        </tr>
        <tr class="money-compare">
          <th scope="row">Anthropic actual</th>
          <td>
            {#if m.anthropic.status === 'ok'}{usd(-m.anthropic.cents)}
            {:else if m.anthropic.status === 'no_key'}<span class="money-note">Add ANTHROPIC_ADMIN_KEY to compare</span>
            {:else}<span class="method-error">Couldn’t reach Anthropic</span>{/if}
          </td>
        </tr>
        {#each m.fixed as f (f.name)}
          <tr><th scope="row">{f.name}</th><td>{usd(-f.cents)}</td></tr>
        {/each}
        <tr class="money-total"><th scope="row">Net</th><td>{signed(m.netCents)}</td></tr>
      </tbody>
    </table>
    <p class="money-stats">
      AI per credit spent: <strong>{cents(m.perCredit.aiCents)}</strong> ·
      earned per paid credit: <strong>{cents(m.perCredit.earnedCents)}</strong>
    </p>
    <p class="money-stats">
      Credits spent: {m.ai.free.credits} free ({usd(m.ai.free.cents)} AI) ·
      {m.ai.paid.credits} paid ({usd(m.ai.paid.cents)} AI)
    </p>
  </details>
{/snippet}

<section class="admin-money">
  {#if error}<p class="method-error" role="alert">{error}</p>{/if}
  {#if data === null}
    <p class="comments-empty">{error ? '' : 'Loading…'}</p>
  {:else}
    {@render month(data.current, true)}
    {#each data.saved as m (m.month)}
      {@render month(m, false)}
    {/each}

    <h2>Fixed costs</h2>
    {#if data.costs.length}
      <ul class="money-costs">
        {#each data.costs as c (c.id)}
          <li>
            <span><strong>{c.name}</strong> {usd(c.cents)} {PERIOD[c.period]}, from {label(c.starts)}{c.ends ? ` to ${label(c.ends)}` : ''}</span>
            <span class="money-cost-actions">
              <button class="outline-button" onclick={() => edit(c)}>Edit</button>
              <button class="outline-button" onclick={() => remove(c)}>Delete</button>
            </span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="comments-empty">No fixed costs yet. Add hosting, the domain, and any other bills.</p>
    {/if}

    {#if editing}
      <form class="money-cost-form" onsubmit={save}>
        <label>Name <input bind:value={editing.name} maxlength="80" required placeholder="Netlify Pro" /></label>
        <label>Amount ($) <input bind:value={editing.dollars} inputmode="decimal" required placeholder="19.00" /></label>
        <label>How often
          <select bind:value={editing.period}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="once">One-off</option>
          </select>
        </label>
        <label>Starts <input type="month" bind:value={editing.starts} required /></label>
        {#if editing.period !== 'once'}
          <label>Ends (optional) <input type="month" bind:value={editing.ends} /></label>
        {/if}
        <div class="money-cost-actions">
          <button class="primary-button" disabled={busy}>{editing.id ? 'Save' : 'Add cost'}</button>
          <button type="button" class="outline-button" onclick={() => (editing = null)}>Cancel</button>
        </div>
      </form>
    {:else}
      <button class="outline-button" onclick={() => edit(null)}>Add a cost</button>
    {/if}
  {/if}
</section>
```

Check the button class names before using them: run `grep -n "primary-button\|outline-button" src/style.css | head`. If `primary-button` doesn't exist, use whatever class the Credits page or the AdminUsers credit form uses for a main action.

- [ ] **Step 3: Styles** (append to `src/style.css`; follow the variables the admin styles already use, found with `grep -n "\.admin-inbox\|\.inbox-item" -A6 src/style.css`)

```css
/* Admin → Money */
.admin-money { display: grid; gap: 0.75rem; }
.money-month { border: 1px solid var(--border, #333); border-radius: 12px; padding: 0.25rem 1rem; }
.money-month summary { display: flex; justify-content: space-between; gap: 1rem; padding: 0.75rem 0; cursor: pointer; font-weight: 600; }
.money-net { font-variant-numeric: tabular-nums; }
.money-net.loss { color: var(--danger, #e66); }
.money-lines { width: 100%; border-collapse: collapse; }
.money-lines th { text-align: left; font-weight: normal; padding: 0.3rem 0; }
.money-lines td { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; padding-left: 1rem; }
.money-note { display: block; font-size: 0.85em; opacity: 0.7; }
.money-compare th, .money-compare td { opacity: 0.8; font-style: italic; }
.money-total th, .money-total td { border-top: 1px solid var(--border, #333); font-weight: 600; padding-top: 0.5rem; }
.money-stats { margin: 0.4rem 0; font-size: 0.95em; }
.money-costs { list-style: none; padding: 0; display: grid; gap: 0.5rem; }
.money-costs li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem; }
.money-cost-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.money-cost-form { display: grid; gap: 0.6rem; max-width: 28rem; }
.money-cost-form label { display: grid; gap: 0.25rem; }
```

Replace the fallback colors with the project's real variables if `grep -n "^\s*--" src/style.css | head -30` shows different names. Nothing may scroll sideways on a narrow phone with large text: the table cells wrap their labels, and amounts stay on one line.

- [ ] **Step 4: Check types and build**

Run: `npm run check && npm test`
Expected: no new svelte-check errors, and all tests pass.

- [ ] **Step 5: Manual check on `npm run dev`** (short steps; ask the user to look, or use one short Playwright snapshot per step)

1. Sign in as the owner and open `/admin/money`. The current month card is open. If the dev database still has the sandbox purchase and refund, "Credit sales" shows 1 pack, $3.00, fees −$0.39 and refunds −$3.00. AI shows only jobs made after Task 2.
2. Add "Netlify Pro", 19.00, monthly, starting this month. The card's Net drops by $19.00.
3. Edit it to end next month, then delete it.
4. As a moderator account, if one exists, the Money tab isn't listed.
5. Narrow the window to phone width, with large text if possible. Nothing should scroll sideways.

- [ ] **Step 6: Commit**

```bash
git add src/components/AdminMoney.svelte src/components/Admin.svelte src/style.css
git commit -m "Admin Money tab: month cards with in/out, AI estimate vs actual, per-credit figures, fixed costs form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
