import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
import { connect, useDatabase } from "../server/db.js";
import { addCredits, findOrCreateAccount, spendCredit } from "../server/accounts.js";
import { useStripe } from "../server/stripe.js";
import { addCost } from "../server/costs.js";
import { buildMonth, monthBounds, monthKey, moneyOverview, previousMonth, useFetch } from "../server/money.js";
import adminFn from "../netlify/functions/admin.js";
import { sessionCookie } from "../server/session.js";

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
  process.env.SESSION_SECRET = "x".repeat(40);
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

test("net counts Anthropic's actual bill when there is one, else the estimate", async () => {
  await usage("idea", 0.05, "2026-08-10T00:00:00Z");
  let m = await buildMonth("2026-08", new Date("2026-10-14T12:00:00Z"));
  assert.equal(m.aiCountedIn, "estimate");
  assert.equal(m.netCents, -5);
  process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
  anthropicCents = 195;
  m = await buildMonth("2026-08", new Date("2026-10-14T12:00:00Z"));
  assert.equal(m.aiCountedIn, "actual");
  assert.equal(m.netCents, -195);
  anthropicFails = true;
  const quiet = console.error;
  console.error = () => {};
  try {
    m = await buildMonth("2026-08", new Date("2026-10-14T12:00:00Z"));
  } finally {
    console.error = quiet;
  }
  assert.equal(m.aiCountedIn, "estimate");
  assert.equal(m.netCents, -5);
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
  await addCost(admin.id, { name: "Netlify Pro", cents: 1900, period: "monthly", starts: "2026-10" });
  await usage("idea", 0.04, "2026-10-05T00:00:00Z");
  const now = new Date("2027-01-14T12:00:00Z");
  const first = await moneyOverview(admin.id, now);
  assert.equal(first.current.month, "2027-01");
  assert.deepEqual(first.saved.map((m) => m.month), ["2026-12", "2026-11", "2026-10"]);
  await db.sql`UPDATE fixed_costs SET cents = 5000`;
  const again = await moneyOverview(admin.id, now);
  assert.equal(again.saved[0].fixedCents, 1900);
  assert.equal(again.current.fixedCents, 5000);
});

test("an incomplete month isn't saved until it loads fully", async () => {
  await usage("idea", 0.04, "2026-12-05T00:00:00Z");
  const now = new Date("2027-01-14T12:00:00Z");
  const quiet = console.error;
  console.error = () => {};
  try {
    stripeFails = true;
    assert.deepEqual((await moneyOverview(admin.id, now)).saved, []);
  } finally {
    console.error = quiet;
  }
  stripeFails = false;
  assert.deepEqual((await moneyOverview(admin.id, now)).saved.map((m) => m.month), ["2026-12"]);
});

test("history starts at the first AI use or purchase, never before 2026-10", async () => {
  const now = new Date("2027-01-14T12:00:00Z");
  await addCost(admin.id, { name: "Old bill", cents: 1900, period: "monthly", starts: "2026-01" });
  assert.deepEqual((await moneyOverview(admin.id, now)).saved, []); // a back-dated bill saves nothing
  await usage("idea", 0.04, "2026-09-20T00:00:00Z");
  const o = await moneyOverview(admin.id, now);
  assert.deepEqual(o.saved.map((m) => m.month), ["2026-12", "2026-11", "2026-10"]);
});

test("a month is saved only 2 days after it ends (Anthropic's report lags)", async () => {
  await usage("idea", 0.04, "2026-10-05T00:00:00Z");
  assert.deepEqual((await moneyOverview(admin.id, new Date("2026-11-01T12:00:00Z"))).saved, []);
  assert.deepEqual(
    (await moneyOverview(admin.id, new Date("2026-11-03T00:00:00Z"))).saved.map((m) => m.month),
    ["2026-10"],
  );
});

test("at most 3 past months are saved per request, oldest first", async () => {
  await usage("idea", 0.04, "2026-10-05T00:00:00Z");
  const now = new Date("2027-03-14T12:00:00Z"); // 2026-10 .. 2027-02 to save
  assert.deepEqual((await moneyOverview(admin.id, now)).saved.map((m) => m.month), ["2026-12", "2026-11", "2026-10"]);
  assert.deepEqual(
    (await moneyOverview(admin.id, now)).saved.map((m) => m.month),
    ["2027-02", "2027-01", "2026-12", "2026-11", "2026-10"],
  );
});

test("credits spent count only from the first AI usage row on", async () => {
  const { id } = await findOrCreateAccount({ sub: "money-user-4", displayName: "Ed" });
  await addCredits(id, 10, "purchase", "cs_money_4", { paid: true });
  await spendCredit(id, "idea"); // before AI cost was recorded
  await db.sql`UPDATE credit_ledger SET created_at = '2026-10-02T00:00:00Z' WHERE account_id = ${id}`;
  assert.equal((await buildMonth("2026-10")).perCredit.aiCents, null); // no usage rows: nothing spent
  const s = await spendCredit(id, "idea");
  await db.sql`UPDATE credit_ledger SET created_at = '2026-10-10T00:00:00Z' WHERE id = ${s.ledgerId}`;
  await usage("idea", 0.04, "2026-10-10T00:00:00Z", s.ledgerId);
  const m = await buildMonth("2026-10");
  assert.equal(m.ai.free.credits + m.ai.paid.credits, 1);
  assert.equal(m.perCredit.aiCents, 4);
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
  await usage("idea", 0.04, "2026-10-05T00:00:00Z");
  const quiet = console.error;
  console.error = () => {};
  try {
    stripeFails = true;
    const o = await moneyOverview(admin.id, new Date("2027-01-14T12:00:00Z"));
    assert.equal(listCalls.length, 2); // first unsaved past month, then the current one
    assert.deepEqual(o.saved, []);
  } finally {
    console.error = quiet;
  }
});
