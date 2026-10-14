import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { NetlifyDB } from "@netlify/database-dev";
import { connect, useDatabase } from "../server/db.js";
import { findOrCreateAccount, getAccount } from "../server/accounts.js";
import { listActivity } from "../server/activity.js";
import { PACKS, packById } from "../server/packs.js";
import { useStripe } from "../server/stripe.js";
import { applyRefund, confirmPurchase, fulfill, startCheckout } from "../server/payments.js";

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
