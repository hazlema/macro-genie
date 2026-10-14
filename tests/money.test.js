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
let listCalls;

const unix = (iso) => Math.floor(Date.parse(iso) / 1000);
const pi = (meta) => ({ object: "payment_intent", metadata: meta });
const ours = (pack, credits, cents) => pi({ accountId: "1", pack, credits: String(credits), cents: String(cents) });

function fakeStripe() {
  return {
    balanceTransactions: {
      list(params, options) {
        listCalls.push(options);
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
  listCalls = [];
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

test("Stripe month fetches time out at 10 s without retries", async () => {
  await buildMonth("2026-10");
  assert.deepEqual(listCalls, [{ timeout: 10_000, maxNetworkRetries: 0 }]);
});

test("with Stripe down, past months stop at the first incomplete one", async () => {
  await addCost(admin.id, { name: "Netlify Pro", cents: 1900, period: "monthly", starts: "2026-07" });
  const quiet = console.error;
  console.error = () => {};
  try {
    stripeFails = true;
    const o = await moneyOverview(admin.id, new Date("2026-10-14T12:00:00Z"));
    assert.equal(listCalls.length, 2); // first unsaved past month, then the current one
    assert.deepEqual(o.saved, []);
  } finally {
    console.error = quiet;
  }
});
