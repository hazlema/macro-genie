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
