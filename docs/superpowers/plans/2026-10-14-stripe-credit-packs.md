# Buying Credits with Stripe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in people buy credit packs (20/$3, 50/$6, 120/$12) through Stripe Checkout. Credits arrive exactly once, and refunds issued from the Stripe dashboard take credits back.

**Architecture:** `server/payments.js` holds all payment logic: start checkout, fulfil a paid session, apply a refund, handle a webhook. It talks to Stripe only through `server/stripe.js`, which tests replace with a fake. Two Netlify functions expose it: `credits.js` for the page's API (packs, checkout, confirm) and `stripe-webhook.js` for Stripe's calls, kept separate so the page API's rate limit doesn't apply to Stripe. A new `/credits` page in the Svelte app shows the packs and confirms the payment when Stripe sends the visitor back.

**Tech Stack:** Node 24 ESM, Netlify Functions v2, `pg` on Neon (`server/db.js`), `stripe` npm package v23 (API `2026-09-30.endive`), Svelte 5 runes, `node:test` with `@netlify/database-dev` for an ephemeral Postgres.

**Spec:** `docs/superpowers/specs/2026-10-14-stripe-credit-packs-design.md`

## Global Constraints

- Packs exactly: `small` 20 credits / 300¢, `medium` 50 credits / 600¢, `large` 120 credits / 1200¢, USD. Defined only in `server/packs.js`.
- One-time payments only: Checkout `mode: "payment"`. No subscriptions, no customer portal, no Customer objects.
- Never store the payer's email or card data. Ledger rows hold only the Checkout session id or PaymentIntent id plus amounts.
- Purchase ledger rows: reason `"purchase"`, ref = Checkout session id. Refund ledger rows: reason `"refund_purchase"`, ref = `<payment_intent>:<amount_refunded>`.
- Credits never go below 0 (DB `CHECK (credits >= 0)`; refunds clamp).
- Missing Stripe key or Stripe unreachable → `503 "Payments are unavailable right now. Try again in a few minutes."`
- Env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Local dev URL `http://localhost:5173` (`npm run dev`).
- Phones: whole-card tap targets, single column, no sideways scrolling at large text sizes.
- Netlify credits are scarce: commit locally after each task. **Do not push.** The owner OKs one push at the end.
- Commit message style: plain sentence describing the change. End with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Webhook and return page firing at the same moment.** Both call `fulfill` at once, and credits must be added exactly once. Pinned in Task 2 (`Promise.all` test).
2. **A junk or foreign `?session=` in the return URL**, from a bookmark or a link shared between accounts. Expect a 400 for junk (no Stripe call), a 403 for another account's session, and a 404 for one that doesn't exist, never credits. Pinned in Task 2.
3. **A refund that's larger than the remaining balance, or for a deleted account.** Expect a clamp to 0 and no crash. Pinned in Task 3.
4. **Stripe key missing or Stripe down while buying.** Expect a friendly 503, not a generic 502. Pinned in Task 1.
5. **Pressing Back from Stripe's checkout page.** The browser restores the page from its cache with the Buy buttons still saying "Opening checkout…" and disabled. Expect them to reset. Pinned in Task 6 (`pageshow` handler, browser checklist).

---

### Task 1: Packs, Stripe client, and starting checkout

**Files:**
- Create: `server/packs.js`, `server/stripe.js`, `server/payments.js`, `tests/payments.test.js`
- Modify: `package.json` (add `stripe`), `server/activity.js:6-12` (new kinds), `src/components/AdminLog.svelte:8` (problem kind)

**Interfaces:**
- Produces:
  - `PACKS: {id, credits, cents}[]`
  - `packById(id) → pack | null`
  - `stripe() → Stripe client` (throws `UserFacingError(UNAVAILABLE, 503)` if there's no key)
  - `useStripe(fake | null)`
  - `UNAVAILABLE: string`
  - `startCheckout(accountId: number | null, packId: string, origin: string) → Promise<{url}>`
  - `callStripe(work, {missing}?)` (internal to payments.js)
  - `dollars(cents) → "$6" | "$3.60"`
  - activity kinds `credits_refund` (credits chip) and `payment_problem` (problems chip)

- [ ] **Step 1: Install stripe**

Run: `npm install stripe@^23`
Expected: `package.json` dependencies gain `"stripe": "^23.…"`.

- [ ] **Step 2: Write the failing tests**

Create `tests/payments.test.js`:

```js
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { NetlifyDB } from "@netlify/database-dev";
import { connect, useDatabase } from "../server/db.js";
import { findOrCreateAccount } from "../server/accounts.js";
import { PACKS, packById } from "../server/packs.js";
import { useStripe } from "../server/stripe.js";
import { startCheckout } from "../server/payments.js";

const WEBHOOK_SECRET = "whsec_test_secret";
// The real library only signs and checks webhook payloads; nothing calls Stripe.
const real = new Stripe("sk_test_fake");
let server;
let db;
let fake;

// Records what we ask Stripe for and answers from in-memory maps.
function fakeStripe() {
  const created = [];
  const sessions = new Map();
  const intents = new Map();
  const missing = () =>
    Object.assign(new Error("No such object"), {
      type: "StripeInvalidRequestError",
      statusCode: 404,
    });
  return {
    created,
    sessions,
    intents,
    calls: 0,
    checkout: {
      sessions: {
        async create(params) {
          created.push(params);
          return {
            id: `cs_test_${created.length}`,
            url: `https://checkout.stripe.test/${created.length}`,
          };
        },
        async retrieve(id) {
          fake.calls++;
          if (!sessions.has(id)) throw missing();
          return sessions.get(id);
        },
      },
    },
    paymentIntents: {
      async retrieve(id) {
        if (!intents.has(id)) throw missing();
        return intents.get(id);
      },
    },
    webhooks: real.webhooks,
  };
}

before(async () => {
  server = new NetlifyDB();
  const connectionString = await server.start();
  await server.applyMigrations("./db/migrations");
  db = connect(connectionString);
  useDatabase(db);
  process.env.SESSION_SECRET = "x".repeat(40);
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});
beforeEach(() => {
  fake = fakeStripe();
  useStripe(fake);
});
after(async () => {
  await db?.pool.end();
  await server?.stop();
});

let n = 0;
const newAccount = (name = "Pat") =>
  findOrCreateAccount({ sub: `pay-${++n}`, displayName: name });
const rejectsWith = (promise, status, pattern) =>
  assert.rejects(
    promise,
    (e) => e.status === status && (!pattern || pattern.test(e.message)),
  );

test("the three packs, and only those", () => {
  assert.deepEqual(PACKS, [
    { id: "small", credits: 20, cents: 300 },
    { id: "medium", credits: 50, cents: 600 },
    { id: "large", credits: 120, cents: 1200 },
  ]);
  assert.equal(packById("medium").credits, 50);
  assert.equal(packById("huge"), null);
  assert.equal(packById(undefined), null);
});

test("checkout asks Stripe for a one-time payment of the pack's price", async () => {
  const { id } = await newAccount();
  const { url } = await startCheckout(id, "medium", "https://macro-genie.com");
  assert.equal(url, "https://checkout.stripe.test/1");
  const [params] = fake.created;
  assert.equal(params.mode, "payment");
  assert.deepEqual(params.line_items, [
    {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: 600,
        product_data: { name: "50 Macro Genie credits" },
      },
    },
  ]);
  const metadata = { accountId: String(id), pack: "medium", credits: "50" };
  assert.equal(params.client_reference_id, String(id));
  assert.deepEqual(params.metadata, metadata);
  assert.deepEqual(params.payment_intent_data, { metadata });
  assert.equal(
    params.success_url,
    "https://macro-genie.com/credits?session={CHECKOUT_SESSION_ID}",
  );
  assert.equal(params.cancel_url, "https://macro-genie.com/credits?cancelled=1");
  assert.equal(params.customer, undefined);
});

test("checkout refuses unknown packs, signed-out visitors, and suspended accounts", async () => {
  const { id } = await newAccount();
  await rejectsWith(startCheckout(id, "huge", "https://x.test"), 400);
  await rejectsWith(startCheckout(null, "small", "https://x.test"), 401, /Sign in/);
  await db.sql`UPDATE accounts SET suspended_at = now() WHERE id = ${id}`;
  await rejectsWith(startCheckout(id, "small", "https://x.test"), 403, /suspended/);
  assert.equal(fake.created.length, 0);
});

test("no Stripe key, or Stripe down, gives a plain 'unavailable' message", async () => {
  const { id } = await newAccount();
  const key = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  useStripe(null);
  await rejectsWith(startCheckout(id, "small", "https://x.test"), 503, /unavailable/);
  if (key) process.env.STRIPE_SECRET_KEY = key;
  useStripe({
    ...fake,
    checkout: {
      sessions: {
        create: async () => {
          throw Object.assign(new Error("connect ETIMEDOUT"), {
            type: "StripeConnectionError",
          });
        },
      },
    },
  });
  await rejectsWith(startCheckout(id, "small", "https://x.test"), 503, /unavailable/);
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `node --test tests/payments.test.js`
Expected: FAIL with `Cannot find module '../server/packs.js'`.

- [ ] **Step 4: Write `server/packs.js`**

```js
// The credit packs for sale. Prices live only here; the page fetches them.
export const PACKS = [
  { id: "small", credits: 20, cents: 300 },
  { id: "medium", credits: 50, cents: 600 },
  { id: "large", credits: 120, cents: 1200 },
];

export const packById = (id) => PACKS.find((p) => p.id === id) ?? null;
```

- [ ] **Step 5: Write `server/stripe.js`**

```js
import Stripe from "stripe";
import { UserFacingError } from "./chef.js";

export const UNAVAILABLE =
  "Payments are unavailable right now. Try again in a few minutes.";

let client = null;

// The Stripe client, made on first use. Tests swap in a fake with useStripe.
export function stripe() {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("stripe: STRIPE_SECRET_KEY is not set");
    throw new UserFacingError(UNAVAILABLE, 503);
  }
  client = new Stripe(key, { maxNetworkRetries: 2, timeout: 15_000 });
  return client;
}

export function useStripe(fake) {
  client = fake;
}
```

- [ ] **Step 6: Write `server/payments.js` with `startCheckout`**

```js
import { UserFacingError } from "./chef.js";
import { packById } from "./packs.js";
import { requireActive } from "./roles.js";
import { UNAVAILABLE, stripe } from "./stripe.js";

// "$6", "$3.60"
export const dollars = (cents) =>
  `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

// Runs a Stripe call. A missing object becomes `missing` (when given) as a
// 404; anything else (network, bad key) becomes one plain 503.
async function callStripe(work, { missing = null } = {}) {
  try {
    return await work(stripe());
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    if (missing && error?.statusCode === 404)
      throw new UserFacingError(missing, 404);
    console.error("stripe:", error);
    throw new UserFacingError(UNAVAILABLE, 503);
  }
}

// Starts a Stripe Checkout for one pack and returns the page to send them to.
// No Stripe customer is created; Stripe asks for an email only for its receipt.
export async function startCheckout(accountId, packId, origin) {
  const pack = packById(packId);
  if (!pack) throw new UserFacingError("Pick one of the credit packs.", 400);
  if (!accountId) throw new UserFacingError("Sign in to buy credits.", 401);
  await requireActive(accountId);
  const metadata = {
    accountId: String(accountId),
    pack: pack.id,
    credits: String(pack.credits),
  };
  const session = await callStripe((s) =>
    s.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: pack.cents,
            product_data: { name: `${pack.credits} Macro Genie credits` },
          },
        },
      ],
      client_reference_id: String(accountId),
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}/credits?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/credits?cancelled=1`,
    }),
  );
  return { url: session.url };
}
```

- [ ] **Step 7: Add the activity kinds**

In `server/activity.js`, change `CHIPS` to:

```js
export const CHIPS = {
  posts: ["recipe_post"],
  signins: ["joined", "sign_in"],
  credits: ["credits_purchase", "credits_refund", "credits_adjust"],
  problems: ["held", "blocked", "report", "admin_action", "payment_problem"],
  messages: ["message"],
};
```

In `src/components/AdminLog.svelte:8`:

```js
  const PROBLEMS = ['held', 'blocked', 'report', 'admin_action', 'payment_problem'];
```

- [ ] **Step 8: Run the tests**

Run: `node --test tests/payments.test.js`
Expected: 4 tests PASS.

Run: `npm test`
Expected: all PASS (admin tests that list chips still pass, since only new kinds were added).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json server/packs.js server/stripe.js server/payments.js server/activity.js src/components/AdminLog.svelte tests/payments.test.js
git commit -m "Payments: credit packs, Stripe client, and starting a checkout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Fulfilling a paid checkout (once) and confirming it from the return page

**Files:**
- Modify: `server/payments.js`, `tests/payments.test.js`

**Interfaces:**
- Consumes:
  - `addCredits(accountId, amount, reason, ref) → Promise<number | null>` (null = already applied), from `server/accounts.js`
  - `getAccount(id) → Promise<{id, displayName, credits} | null>`
  - `logActivity({kind, accountId, actorName, text})` (never throws)
  - `listActivity({chip}) → {entries: [{kind, name, text}]}`
- Produces:
  - `fulfill(sessionOrId: string | CheckoutSession) → Promise<{paid: boolean, purchased: number, credits: number}>`. `purchased` is the pack's credits for a valid paid session even when an earlier call already added them, so the page can always say "Added 50 credits".
  - `confirmPurchase(accountId, sessionId) → same shape`

- [ ] **Step 1: Write the failing tests**

In `tests/payments.test.js`, extend the imports:

```js
import { findOrCreateAccount, getAccount } from "../server/accounts.js";
import { listActivity } from "../server/activity.js";
import { confirmPurchase, fulfill, startCheckout } from "../server/payments.js";
```

Append:

```js
// A Checkout session as Stripe returns it once paid.
const paidSession = (id, accountId, packId = "medium", over = {}) => {
  const pack = packById(packId);
  return {
    id,
    payment_status: "paid",
    amount_total: pack.cents,
    currency: "usd",
    metadata: {
      accountId: String(accountId),
      pack: pack.id,
      credits: String(pack.credits),
    },
    ...over,
  };
};
const ledger = (ref) =>
  db.sql`SELECT change, reason FROM credit_ledger WHERE ref = ${ref}`;

test("a paid checkout adds its credits once, however many times it's fulfilled", async () => {
  const { id } = await newAccount("Quinn");
  fake.sessions.set("cs_test_a", paidSession("cs_test_a", id));
  assert.deepEqual(await fulfill("cs_test_a"), { paid: true, purchased: 50, credits: 60 });
  assert.deepEqual(await fulfill("cs_test_a"), { paid: true, purchased: 50, credits: 60 });
  assert.equal((await getAccount(id)).credits, 60);
  assert.deepEqual(await ledger("cs_test_a"), [{ change: 50, reason: "purchase" }]);
  const log = await listActivity({ chip: "credits" });
  assert.equal(log.entries.filter((e) => e.text === "bought 50 credits ($6)").length, 1);
  assert.equal(log.entries[0].name, "Quinn");
});

test("the webhook and the return page arriving together still add credits once", async () => {
  const { id } = await newAccount();
  fake.sessions.set("cs_test_race", paidSession("cs_test_race", id, "large"));
  await Promise.all([
    fulfill("cs_test_race"),
    fulfill("cs_test_race"),
    confirmPurchase(id, "cs_test_race"),
  ]);
  assert.equal((await getAccount(id)).credits, 130);
});

test("an unpaid checkout adds nothing", async () => {
  const { id } = await newAccount();
  fake.sessions.set(
    "cs_test_unpaid",
    paidSession("cs_test_unpaid", id, "small", { payment_status: "unpaid" }),
  );
  assert.deepEqual(await fulfill("cs_test_unpaid"), { paid: false, purchased: 0, credits: 10 });
  assert.equal((await ledger("cs_test_unpaid")).length, 0);
});

test("a paid amount that doesn't match its pack adds nothing and is logged as a problem", async () => {
  const { id } = await newAccount();
  fake.sessions.set(
    "cs_test_odd",
    paidSession("cs_test_odd", id, "large", { amount_total: 300 }),
  );
  assert.deepEqual(await fulfill("cs_test_odd"), { paid: true, purchased: 0, credits: 10 });
  const problems = await listActivity({ chip: "problems" });
  assert.equal(problems.entries[0].kind, "payment_problem");
  assert.match(problems.entries[0].text, /cs_test_odd/);
});

test("a payment for an account that was deleted is logged, not added", async () => {
  const { id } = await newAccount();
  fake.sessions.set("cs_test_gone", paidSession("cs_test_gone", id));
  await db.sql`DELETE FROM accounts WHERE id = ${id}`;
  assert.deepEqual(await fulfill("cs_test_gone"), { paid: true, purchased: 0, credits: 0 });
  assert.match((await listActivity({ chip: "problems" })).entries[0].text, /no longer exists/);
});

test("the return page only confirms the signed-in account's own, real checkout", async () => {
  const owner = await newAccount();
  const other = await newAccount();
  fake.sessions.set("cs_test_mine", paidSession("cs_test_mine", owner.id, "small"));
  await rejectsWith(confirmPurchase(null, "cs_test_mine"), 401);
  await rejectsWith(confirmPurchase(other.id, "cs_test_mine"), 403);
  await rejectsWith(confirmPurchase(owner.id, "cs_test_nope"), 404, /wasn't found/);
  const before = fake.calls;
  await rejectsWith(confirmPurchase(owner.id, "../../etc"), 400);
  await rejectsWith(confirmPurchase(owner.id, undefined), 400);
  assert.equal(fake.calls, before, "junk ids never reach Stripe");
  assert.deepEqual(await confirmPurchase(owner.id, "cs_test_mine"), {
    paid: true,
    purchased: 20,
    credits: 30,
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/payments.test.js`
Expected: FAIL, `fulfill` is not exported.

- [ ] **Step 3: Implement**

In `server/payments.js`, extend the imports:

```js
import { addCredits, getAccount } from "./accounts.js";
import { logActivity } from "./activity.js";
```

Append:

```js
const balanceOf = async (accountId) =>
  accountId ? ((await getAccount(accountId))?.credits ?? 0) : 0;

// Adds a paid checkout's credits. The webhook and the return page both call
// this; the ledger's unique (reason, ref) means only the first one counts.
// Only Stripe's own copy of the session is trusted, never the browser.
export async function fulfill(sessionOrId) {
  const session =
    typeof sessionOrId === "string"
      ? await callStripe((s) => s.checkout.sessions.retrieve(sessionOrId))
      : sessionOrId;
  const accountId = Number(session.metadata?.accountId) || null;
  if (session.payment_status !== "paid")
    return { paid: false, purchased: 0, credits: await balanceOf(accountId) };
  const pack = packById(session.metadata?.pack);
  const problem = (text) =>
    logActivity({ kind: "payment_problem", accountId, actorName: "Stripe", text });
  if (
    !accountId ||
    !pack ||
    pack.credits !== Number(session.metadata?.credits) ||
    pack.cents !== session.amount_total ||
    session.currency !== "usd"
  ) {
    await problem(
      `paid checkout ${session.id} (${session.amount_total} ${session.currency}) doesn't match a pack; no credits added`,
    );
    return { paid: true, purchased: 0, credits: await balanceOf(accountId) };
  }
  const account = await getAccount(accountId);
  if (!account) {
    await problem(
      `paid checkout ${session.id} is for account ${accountId}, which no longer exists; refund it in Stripe`,
    );
    return { paid: true, purchased: 0, credits: 0 };
  }
  const after = await addCredits(accountId, pack.credits, "purchase", session.id);
  if (after !== null)
    await logActivity({
      kind: "credits_purchase",
      accountId,
      actorName: account.displayName,
      text: `bought ${pack.credits} credits (${dollars(pack.cents)})`,
    });
  return {
    paid: true,
    purchased: pack.credits,
    credits: after ?? (await balanceOf(accountId)),
  };
}

// The page Stripe sends people back to asks for its credits right away, so
// they don't wait on the webhook. Only the buyer may confirm their checkout.
export async function confirmPurchase(accountId, sessionId) {
  if (!accountId) throw new UserFacingError("Sign in to see your purchase.", 401);
  const id = String(sessionId ?? "");
  if (!/^cs_[A-Za-z0-9_]{1,200}$/.test(id))
    throw new UserFacingError("That payment link isn't valid.", 400);
  const session = await callStripe((s) => s.checkout.sessions.retrieve(id), {
    missing: "That payment wasn't found.",
  });
  if (Number(session.metadata?.accountId) !== accountId)
    throw new UserFacingError("That payment belongs to another account.", 403);
  return fulfill(session);
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/payments.test.js`
Expected: all PASS. If the race test shows 180 credits, `addCredits` isn't inserting the ledger row first. It does today (`server/accounts.js:69`), so look for a changed import.

- [ ] **Step 5: Commit**

```bash
git add server/payments.js tests/payments.test.js
git commit -m "Payments: add a paid checkout's credits exactly once, from the webhook or the return page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Refunds take credits back

**Files:**
- Modify: `server/payments.js`, `tests/payments.test.js`

**Interfaces:**
- Consumes: `transaction(work: (client) => Promise) → Promise` from `server/db.js` (client has `.query(text, params)`).
- Produces: `applyRefund(charge: {payment_intent: string | {id}, amount: number, amount_refunded: number}) → Promise<{removed: number}>`

- [ ] **Step 1: Write the failing tests**

Extend the import from payments.js with `applyRefund`, then append:

```js
// A pack bought by `accountId`, as its PaymentIntent and a charge refunded so far.
async function bought(accountId, packId, pi) {
  const pack = packById(packId);
  fake.intents.set(pi, {
    id: pi,
    metadata: { accountId: String(accountId), pack: pack.id, credits: String(pack.credits) },
  });
  fake.sessions.set(`cs_${pi}`, paidSession(`cs_${pi}`, accountId, packId));
  await fulfill(`cs_${pi}`);
  return (refunded) => ({ payment_intent: pi, amount: pack.cents, amount_refunded: refunded });
}

test("a full refund takes the pack's credits back", async () => {
  const { id } = await newAccount("Rae");
  const charge = await bought(id, "medium", "pi_full");
  assert.deepEqual(await applyRefund(charge(600)), { removed: 50 });
  assert.equal((await getAccount(id)).credits, 10);
  const log = await listActivity({ chip: "credits" });
  assert.equal(log.entries[0].kind, "credits_refund");
  assert.equal(log.entries[0].text, "refunded $6, removed 50 credits");
});

test("partial refunds take back credits in proportion, and replays do nothing", async () => {
  const { id } = await newAccount();
  const charge = await bought(id, "medium", "pi_part");
  assert.deepEqual(await applyRefund(charge(360)), { removed: 30 });
  assert.deepEqual(await applyRefund(charge(360)), { removed: 0 });
  assert.deepEqual(await applyRefund(charge(600)), { removed: 20 });
  assert.equal((await getAccount(id)).credits, 10);
});

test("a refund never takes the balance below zero", async () => {
  const { id } = await newAccount();
  const charge = await bought(id, "small", "pi_spent");
  await db.sql`UPDATE accounts SET credits = 5 WHERE id = ${id}`;
  assert.deepEqual(await applyRefund(charge(300)), { removed: 5 });
  assert.equal((await getAccount(id)).credits, 0);
  assert.match(
    (await listActivity({ chip: "credits" })).entries[0].text,
    /removed 5 of 20; balance was 5/,
  );
});

test("refunds for deleted accounts or payments that aren't ours are ignored", async () => {
  const { id } = await newAccount();
  const charge = await bought(id, "small", "pi_gone");
  await db.sql`DELETE FROM accounts WHERE id = ${id}`;
  assert.deepEqual(await applyRefund(charge(300)), { removed: 0 });
  fake.intents.set("pi_other", { id: "pi_other", metadata: {} });
  assert.deepEqual(
    await applyRefund({ payment_intent: "pi_other", amount: 500, amount_refunded: 500 }),
    { removed: 0 },
  );
  assert.deepEqual(
    await applyRefund({ payment_intent: null, amount: 500, amount_refunded: 500 }),
    { removed: 0 },
  );
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/payments.test.js`
Expected: FAIL, `applyRefund` is not exported.

- [ ] **Step 3: Implement**

In `server/payments.js`, add `import { transaction } from "./db.js";` and append:

```js
// A refund from the Stripe dashboard takes back credits in proportion to the
// money returned. Stripe reports the total refunded so far, so each event
// tops up to that total. Never below zero: credits already spent stay spent.
export async function applyRefund(charge) {
  const pi =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!pi || !charge.amount) return { removed: 0 };
  const intent = await callStripe((s) => s.paymentIntents.retrieve(pi));
  const accountId = Number(intent.metadata?.accountId) || null;
  const pack = packById(intent.metadata?.pack);
  if (!accountId || !pack) return { removed: 0 };
  const target = Math.min(
    pack.credits,
    Math.round((pack.credits * charge.amount_refunded) / charge.amount),
  );
  const result = await transaction(async (client) => {
    const held = await client.query(
      `SELECT credits, display_name FROM accounts WHERE id = $1 FOR UPDATE`,
      [accountId],
    );
    const account = held.rows[0];
    if (!account) return null;
    const taken = await client.query(
      `SELECT COALESCE(-SUM(change), 0) AS taken FROM credit_ledger
        WHERE reason = 'refund_purchase' AND split_part(ref, ':', 1) = $1`,
      [pi],
    );
    const wanted = target - Number(taken.rows[0].taken);
    if (wanted <= 0) return null;
    const balance = Number(account.credits);
    const removed = Math.min(wanted, balance);
    const logged = await client.query(
      `INSERT INTO credit_ledger (account_id, change, reason, ref)
       VALUES ($1, $2, 'refund_purchase', $3)
       ON CONFLICT (reason, ref) DO NOTHING RETURNING id`,
      [accountId, -removed, `${pi}:${charge.amount_refunded}`],
    );
    if (!logged.rows[0]) return null;
    await client.query(
      `UPDATE accounts SET credits = credits - $2 WHERE id = $1`,
      [accountId, removed],
    );
    return { removed, wanted, balance, name: account.display_name };
  });
  if (!result) return { removed: 0 };
  await logActivity({
    kind: "credits_refund",
    accountId,
    actorName: result.name,
    text:
      result.removed === result.wanted
        ? `refunded ${dollars(charge.amount_refunded)}, removed ${result.removed} credits`
        : `refunded ${dollars(charge.amount_refunded)}, removed ${result.removed} of ${result.wanted}; balance was ${result.balance}`,
  });
  return { removed: result.removed };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/payments.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/payments.js tests/payments.test.js
git commit -m "Payments: refunds from the Stripe dashboard take back credits in proportion, never below zero

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The webhook and the page API

**Files:**
- Modify: `server/payments.js`, `tests/payments.test.js`
- Create: `netlify/functions/credits.js`, `netlify/functions/stripe-webhook.js`

**Interfaces:**
- Consumes:
  - `readSession(request) → number | null` and `sessionCookie(accountId, request) → "mg_session=…; …"` from `server/session.js`
  - `fail(error) → Response` from `server/http.js`
  - `withTiming(handler)` from `server/timing.js`
- Produces:
  - `handleWebhook(rawBody: string, signature: string | null) → Promise<{received: true}>`
  - `GET /api/credits/packs → {packs}`
  - `POST /api/credits/checkout {pack} → {url}`
  - `POST /api/credits/confirm {sessionId} → {paid, purchased, credits}`
  - `POST /api/stripe/webhook`

- [ ] **Step 1: Write the failing tests**

Extend the imports:

```js
import { sessionCookie } from "../server/session.js";
import { applyRefund, confirmPurchase, fulfill, handleWebhook, startCheckout } from "../server/payments.js";
import credits from "../netlify/functions/credits.js";
import webhook from "../netlify/functions/stripe-webhook.js";
```

Append:

```js
const signed = (event) => {
  const payload = JSON.stringify(event);
  return {
    payload,
    signature: real.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }),
  };
};
const post = (path, body, init = {}) =>
  new Request(`https://example.com${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
const asAccount = (accountId) => ({
  headers: {
    cookie: sessionCookie(accountId, new Request("https://example.com/")).split(";")[0],
  },
});

test("webhooks with a bad or missing signature are refused", async () => {
  const { payload } = signed({ id: "evt_1", type: "ping", data: { object: {} } });
  await rejectsWith(handleWebhook(payload, "t=1,v1=bad"), 400);
  await rejectsWith(handleWebhook(payload, null), 400);
  const res = await webhook(post("/api/stripe/webhook", payload, { headers: { "stripe-signature": "nope" } }));
  assert.equal(res.status, 400);
});

test("a completed-checkout webhook adds the credits; other events are acknowledged", async () => {
  const { id } = await newAccount();
  fake.sessions.set("cs_test_hook", paidSession("cs_test_hook", id, "small"));
  for (const type of ["checkout.session.completed", "checkout.session.async_payment_succeeded"]) {
    const { payload, signature } = signed({
      id: `evt_${type}`,
      type,
      data: { object: { id: "cs_test_hook" } },
    });
    const res = await webhook(post("/api/stripe/webhook", payload, { headers: { "stripe-signature": signature } }));
    assert.equal(res.status, 200);
  }
  assert.equal((await getAccount(id)).credits, 30);
  const other = signed({ id: "evt_x", type: "customer.created", data: { object: {} } });
  assert.deepEqual(await handleWebhook(other.payload, other.signature), { received: true });
});

test("a charge.refunded webhook takes credits back", async () => {
  const { id } = await newAccount();
  const charge = await bought(id, "large", "pi_hook");
  const { payload, signature } = signed({
    id: "evt_refund",
    type: "charge.refunded",
    data: { object: { id: "ch_1", ...charge(1200) } },
  });
  await handleWebhook(payload, signature);
  assert.equal((await getAccount(id)).credits, 10);
});

test("the page API: packs, checkout, and confirm", async () => {
  const packs = await credits(new Request("https://example.com/api/credits/packs"));
  assert.deepEqual((await packs.json()).packs, PACKS);

  const signedOut = await credits(post("/api/credits/checkout", { pack: "small" }));
  assert.equal(signedOut.status, 401);

  const { id } = await newAccount();
  const started = await credits(post("/api/credits/checkout", { pack: "small" }, asAccount(id)));
  assert.equal(started.status, 200);
  assert.match((await started.json()).url, /^https:\/\/checkout\.stripe\.test\//);
  assert.equal(fake.created[0].success_url, "https://example.com/credits?session={CHECKOUT_SESSION_ID}");

  fake.sessions.set("cs_test_api", paidSession("cs_test_api", id, "small"));
  const confirmed = await credits(post("/api/credits/confirm", { sessionId: "cs_test_api" }, asAccount(id)));
  assert.deepEqual(await confirmed.json(), { paid: true, purchased: 20, credits: 30 });

  const getCheckout = await credits(new Request("https://example.com/api/credits/checkout"));
  assert.equal(getCheckout.status, 405);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/payments.test.js`
Expected: FAIL, `Cannot find module '../netlify/functions/credits.js'`.

- [ ] **Step 3: Add `handleWebhook` to `server/payments.js`**

```js
// Stripe's calls to /api/stripe/webhook. The signature proves Stripe sent it.
export async function handleWebhook(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("stripe: STRIPE_WEBHOOK_SECRET is not set");
    throw new UserFacingError(UNAVAILABLE, 503);
  }
  let event;
  try {
    event = stripe().webhooks.constructEvent(rawBody, signature ?? "", secret);
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError("Invalid signature.", 400);
  }
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await fulfill(event.data.object.id);
      break;
    case "charge.refunded":
      await applyRefund(event.data.object);
      break;
  }
  return { received: true };
}
```

- [ ] **Step 4: Create `netlify/functions/credits.js`**

```js
import { UserFacingError } from "../../server/chef.js";
import { fail } from "../../server/http.js";
import { PACKS } from "../../server/packs.js";
import { confirmPurchase, startCheckout } from "../../server/payments.js";
import { readSession } from "../../server/session.js";
import { withTiming } from "../../server/timing.js";

// /api/credits/packs: the packs for sale.
// /api/credits/checkout: start a Stripe Checkout for one pack.
// /api/credits/confirm: the return page asks for its credits.
export const config = {
  path: ["/api/credits/packs", "/api/credits/checkout", "/api/credits/confirm"],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

async function handler(request) {
  const { pathname, origin } = new URL(request.url);
  try {
    if (pathname === "/api/credits/packs")
      return Response.json({ packs: PACKS });
    if (request.method !== "POST")
      return new Response("Use POST.", { status: 405, headers: { Allow: "POST" } });
    const body = await request.json().catch(() => {
      throw new UserFacingError("Send the request as JSON.");
    });
    const accountId = process.env.SESSION_SECRET ? readSession(request) : null;
    if (pathname === "/api/credits/checkout")
      return Response.json(await startCheckout(accountId, body?.pack, origin));
    return Response.json(await confirmPurchase(accountId, body?.sessionId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}

// Server-Timing header and a "timing" log line for every response.
export default withTiming(handler);
```

- [ ] **Step 5: Create `netlify/functions/stripe-webhook.js`**

```js
import { fail } from "../../server/http.js";
import { handleWebhook } from "../../server/payments.js";
import { withTiming } from "../../server/timing.js";

// Stripe tells us about paid checkouts and refunds here. No rate limit: Stripe
// retries anything that isn't a 2xx, so a refused call would only come back.
export const config = { path: "/api/stripe/webhook", method: "POST" };

async function handler(request) {
  try {
    const raw = await request.text();
    return Response.json(
      await handleWebhook(raw, request.headers.get("stripe-signature")),
    );
  } catch (error) {
    return fail(error);
  }
}

export default withTiming(handler);
```

- [ ] **Step 6: Run the tests**

Run: `node --test tests/payments.test.js && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add server/payments.js netlify/functions/credits.js netlify/functions/stripe-webhook.js tests/payments.test.js
git commit -m "Payments: /api/credits (packs, checkout, confirm) and the Stripe webhook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The /credits address, in-site links, and redirects that stop the 404s

**Files:**
- Modify: `src/lib/route.svelte.js`, `tests/route.test.js`, `src/components/HelpGuide.svelte:24-31`, `src/components/PolicyPage.svelte:10-17`, `netlify.toml:28-53`
- Create: `tests/redirects.test.js`

**Interfaces:**
- Produces:
  - `parse("/credits") → {tab: "credits", postId: null, recipeId: null}`
  - `pathFor({tab: "credits"}) → "/credits"`
  - in-site Markdown links go through `navigate(parse(href))`

- [ ] **Step 1: Write the failing tests**

In `tests/route.test.js`, inside the existing test just before its closing `},`, add:

```js
    assert.deepEqual(parse("/credits"), {
      tab: "credits",
      postId: null,
      recipeId: null,
    });
    assert.equal(pathFor({ tab: "credits" }), "/credits");
```

Create `tests/redirects.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Every address the app answers must load the page on a direct visit or a
// refresh, or Netlify shows its 404 (as /help and /refunds did until 2026-10-14).
test("netlify.toml sends every app address to the page", () => {
  const toml = readFileSync("netlify.toml", "utf8");
  const froms = [...toml.matchAll(/from = "([^"]+)"\s+to = "\/index\.html"\s+status = 200/g)].map((m) => m[1]);
  for (const path of [
    "/foods", "/builder", "/community", "/community/*", "/recipes", "/recipes/*",
    "/help", "/help/*", "/admin", "/admin/*",
    "/terms", "/refunds", "/privacy", "/contact", "/credits",
  ])
    assert.ok(froms.includes(path), `missing redirect for ${path}`);
  assert.ok(!froms.some((f) => f.startsWith("/api") || f === "/*"), "no catch-all, /api untouched");
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/route.test.js tests/redirects.test.js`
Expected: route test FAIL (`/credits` parses as community) and redirects FAIL (`missing redirect for /help`). If route.test reports "skipped: needs the Svelte compiler", that test can't run here, so rely on the redirects test and the browser check in Task 6.

- [ ] **Step 3: Route `/credits`**

In `src/lib/route.svelte.js`, update the header comment block with the line `//   /credits           Get more credits (Stripe Checkout returns here)`, then:

```js
const TABS = {
  foods: "foods",
  builder: "recipes",
  community: "community",
  recipes: "saved",
  credits: "credits",
};
const PATHS = {
  foods: "/foods",
  recipes: "/builder",
  community: "/community",
  saved: "/recipes",
  credits: "/credits",
};
```

(`parse` already maps a known section through `TABS`, and `pathFor` falls through to `PATHS[tab]`.)

- [ ] **Step 4: In-site Markdown links open any app page**

In `src/components/HelpGuide.svelte`:
- change the route import to `import { navigate, parse } from '../lib/route.svelte.js';`
- replace the two lines in `internal(e)` that split the href and call `navigate(...)` with:

```js
    navigate(parse(a.getAttribute('href')));
```

Make the same change in `src/components/PolicyPage.svelte` (`import { navigate, parse } …`, and in `internal`, `navigate(parse(a.getAttribute('href')));`). Before, `/credits` would have opened an empty policy page.

- [ ] **Step 5: Redirects**

In `netlify.toml`, after the `/recipes/*` block, add one `[[redirects]]` block (`to = "/index.html"`, `status = 200`) for each of: `/help`, `/help/*`, `/admin`, `/admin/*`, `/terms`, `/refunds`, `/privacy`, `/contact`, `/credits`. For example:

```toml
[[redirects]]
  from = "/help"
  to = "/index.html"
  status = 200
[[redirects]]
  from = "/help/*"
  to = "/index.html"
  status = 200
```

Keep the formatting of the existing blocks (two-space indent, `from`/`to`/`status` order) so the test's regex matches.

- [ ] **Step 6: Run the tests**

Run: `node --test tests/route.test.js tests/redirects.test.js && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/route.svelte.js tests/route.test.js tests/redirects.test.js src/components/HelpGuide.svelte src/components/PolicyPage.svelte netlify.toml
git commit -m "Routes: /credits; help and policy pages, admin, and contact load on refresh (were 404 on Netlify); in-site links open any page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Get more credits page and the ways to reach it

**Files:**
- Create: `src/components/Credits.svelte`
- Modify: `src/App.svelte` (import, account area links, route branch), `src/components/Recipes.svelte:13,269,~414` (link when short), `src/help/credits.js` (last step), `src/style.css` (append the `.credits-page` block)

**Interfaces:**
- Consumes:
  - `api(path, {method, body}) → {ok, status, body, error}`, `refreshAccount()` and `account` from `src/lib/account.svelte.js`
  - `navigate(to)` from `src/lib/route.svelte.js`
  - the endpoints from Task 4

- [ ] **Step 1: Create `src/components/Credits.svelte`**

```svelte
<script>
  import { onMount } from 'svelte';
  import { account, api, refreshAccount } from '../lib/account.svelte.js';
  import { navigate } from '../lib/route.svelte.js';

  // Get more credits. Buying goes to Stripe's checkout page, which sends people
  // back here with ?session=… (paid) or ?cancelled=1.
  let packs = $state([]);
  let buying = $state('');
  let confirming = $state(false);
  let notice = $state('');
  let error = $state('');

  const price = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
  const each = (p) => `${Math.round(p.cents / p.credits)}¢ per credit`;

  onMount(async () => {
    const query = new URLSearchParams(location.search);
    const session = query.get('session');
    if (session || query.has('cancelled')) history.replaceState({}, '', '/credits');
    if (query.has('cancelled')) notice = 'Checkout cancelled. You weren’t charged.';
    const list = await api('/api/credits/packs');
    if (list.ok) packs = list.body.packs;
    else error = list.error;
    if (session) await confirm(session);
  });

  async function confirm(sessionId) {
    confirming = true;
    const res = await api('/api/credits/confirm', { method: 'POST', body: { sessionId } });
    confirming = false;
    if (!res.ok) { error = res.error; return; }
    await refreshAccount();
    notice = res.body.paid
      ? `Added ${res.body.purchased} credits. You now have ${account.credits}.`
      : 'Your payment is processing. Credits appear as soon as Stripe confirms it.';
  }

  async function buy(pack) {
    if (!account.signedIn) { account.loginOpen = true; return; }
    buying = pack.id; error = ''; notice = '';
    const res = await api('/api/credits/checkout', { method: 'POST', body: { pack: pack.id } });
    if (!res.ok) { buying = ''; error = res.error; return; }
    location.assign(res.body.url);
  }

  function go(e, to) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    navigate(to);
    scrollTo(0, 0);
  }
</script>

<!-- Back from Stripe restores this page from the browser's cache; reset the buttons. -->
<svelte:window onpageshow={() => (buying = '')} />

<main id="results" tabindex="-1" class="help credits-page">
  <h1>Get more credits</h1>
  {#if account.signedIn}
    <p class="help-lede">You have <strong>{account.credits}</strong> {account.credits === 1 ? 'credit' : 'credits'}.</p>
  {:else}
    <p class="help-lede">Credits pay for recipe ideas and written recipes. Sign in to buy them.</p>
  {/if}
  {#if confirming}<p class="post-note" role="status">Confirming your payment…</p>{/if}
  {#if notice}<p class="post-note" role="status">{notice}</p>{/if}
  {#if error}<p class="method-error" role="alert">{error}</p>{/if}
  {#if account.suspended}<p class="method-error">Your account is suspended, so you can’t buy credits.</p>{/if}
  <ul class="pack-list">
    {#each packs as pack (pack.id)}
      <li>
        <button class="pack-card" onclick={() => buy(pack)} disabled={!!buying || account.suspended}>
          <strong>{pack.credits} credits</strong>
          <span class="pack-price">{price(pack.cents)}</span>
          <span class="pack-each">{each(pack)}</span>
          <span class="pack-action">{buying === pack.id ? 'Opening checkout…' : account.signedIn ? 'Buy' : 'Sign in to buy'}</span>
        </button>
      </li>
    {/each}
  </ul>
  <p class="credits-note">1 credit = 1 recipe idea or 1 written recipe. Credits don’t expire. Unused credits from a pack can be refunded within 30 days: see <a href="/refunds" onclick={(e) => go(e, { tab: 'page', page: 'refunds' })}>Refunds</a> and <a href="/terms" onclick={(e) => go(e, { tab: 'page', page: 'terms' })}>Terms</a>. Payment is by card through Stripe; we never see your card.</p>
</main>
```

- [ ] **Step 2: Styles**

Append to `src/style.css`:

```css
/* Get more credits */
.pack-list {
  list-style: none;
  margin: 0 0 24px;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 16px;
}
.pack-card {
  display: grid;
  gap: 6px;
  width: 100%;
  padding: 20px;
  text-align: left;
  font: inherit;
  color: inherit;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  cursor: pointer;
}
.pack-card:hover:not(:disabled) {
  border-color: #4a5356;
}
.pack-card:disabled {
  cursor: default;
  opacity: 0.6;
}
.pack-card strong {
  font-size: 1.3em;
}
.pack-price {
  font-size: 1.6em;
  font-weight: 700;
}
.pack-each,
.credits-note {
  color: var(--muted);
  font-size: 14px;
}
.pack-action {
  margin-top: 8px;
  font-weight: 600;
}
```

- [ ] **Step 3: Show the page and link to it from the header**

In `src/App.svelte`:
- add `import Credits from './components/Credits.svelte';` after the `ContactPage` import;
- in the routing chain, add `{:else if tab === 'credits'}\n  <Credits />` right after the `{:else if tab === 'admin'}` branch;
- in the signed-in desktop account area, after the `credit-pill` span:

```svelte
      <button class="text-button account-wide" onclick={() => navigate({ tab: 'credits' })}>Get credits</button>
```

- in the phone `account-pop`, before the Help button:

```svelte
            <button class="outline-button" onclick={() => { accountMenu = false; navigate({ tab: 'credits' }); }}>Get more credits</button>
```

- [ ] **Step 4: The Recipe Builder links to it when credits run short**

In `src/components/Recipes.svelte`, add `import { navigate } from '../lib/route.svelte.js';` after the account import (line 13), unless it's already imported. Add to the script:

```js
  function getCredits(e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    navigate({ tab: 'credits' });
    scrollTo(0, 0);
  }
```

Replace line 269's `<span class="credit-short">…</span>` with:

```svelte
            <span class="credit-short">Not enough credits: you have {account.credits}. {#if account.credits}Try fewer ideas, or <a href="/credits" onclick={getCredits}>get more credits</a>.{:else}<a href="/credits" onclick={getCredits}>Get more credits</a>.{/if}</span>
```

In the `write-recipe` block (around line 414), after the `Write the recipe · 1 credit` button, inside the `{#if account.signedIn}` branch:

```svelte
                  {#if account.credits < 1}<span class="credit-short">Out of credits. <a href="/credits" onclick={getCredits}>Get more credits</a></span>{/if}
```

- [ ] **Step 5: Help text**

In `src/help/credits.js`, replace the last step with:

```js
    {
      title: "Getting more",
      text: "Buy more on the [Get more credits](/credits) page: 20 credits for $3, 50 for $6, or 120 for $12. You pay by card through Stripe. Credits don't expire, and unused credits from a pack can be refunded within 30 days. See [Refunds](/refunds).",
    },
```

- [ ] **Step 6: Checks**

Run: `npm test && npm run check && npm run build`
Expected: tests PASS, svelte-check reports 0 errors, the build succeeds. If `tests/help.test.js` asserts on the old "coming soon" sentence, update that assertion to the new text.

- [ ] **Step 7: Browser check, with real test-mode Stripe if the owner's keys are in `.env`**

Start `npm run dev` in the background. Use short, separate Playwright steps (not one long script) and narrate each one.

At 1280px, then at 390px with the system font size raised:
- Open `http://localhost:5173/credits` signed out. Expect three cards (20 / $3 / 15¢ per credit, 50 / $6 / 12¢, 120 / $12 / 10¢) saying "Sign in to buy", with no horizontal scrollbar.
- Open `/credits?cancelled=1`. Expect the cancelled note, and the address changes to `/credits`.
- Open `/help/credits`. Click "Get more credits" and expect `/credits` to open in place.

If `STRIPE_SECRET_KEY` isn't set yet, leave purchase testing to the owner checklist in Task 7.

- [ ] **Step 8: Commit**

```bash
git add src/components/Credits.svelte src/App.svelte src/components/Recipes.svelte src/help/credits.js src/style.css tests/help.test.js
git commit -m "Get more credits page: packs, Stripe checkout, confirming on return; links from the header, account menu, Builder, and help

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, owner checklist, and the final check

**Files:**
- Modify: `README.md` (Accounts and credits section, ~line 34-44; env var list)
- Owner-facing: the Project TODO doc (Claude Docs) and the chat checklist

- [ ] **Step 1: README**

In `README.md`'s "Accounts and credits" section:
- replace "and later a Stripe customer id" with "(no Stripe customer id: purchases are one-time Checkout payments)";
- add a "Buying credits" bullet: the packs; that Stripe Checkout is hosted; that `/api/stripe/webhook` adds credits once per Checkout session and handles `charge.refunded`; and the env vars `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.

Add to "Run locally": `stripe listen --forward-to localhost:5173/api/stripe/webhook` and the test card `4242 4242 4242 4242`.

- [ ] **Step 2: Full verification**

Run: `npm test && npm run check && npm run build`
Expected: all green. Paste the summary lines into the hand-off message.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "README: buying credits with Stripe, local webhook testing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Update the Project TODO doc** (macro-genie section). Mark Stripe built and tested locally, and add the remaining owner steps: test keys, a local end-to-end run, live activation, the live webhook endpoint, Netlify secrets, the push, and one real $3 purchase followed by a refund.

- [ ] **Step 5: Hand the owner the end-to-end checklist** (from the spec's "Owner setup checklist" and "Local end-to-end"). Ask before pushing.
