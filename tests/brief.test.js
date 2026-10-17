import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
import raw from "../foods.json" with { type: "json" };
import { findFoods, normalizeDataset } from "../src/lib/foods.js";
import { connect, useDatabase } from "../server/db.js";
import { addCredits, findOrCreateAccount, refundCredit, spendCredit } from "../server/accounts.js";
import { logActivity } from "../server/activity.js";
import { saveMessage } from "../server/messages.js";
import { createPost } from "../server/community.js";
import { saveUsage } from "../server/usage.js";
import { buildBrief } from "../server/brief.js";

const { foods } = normalizeDataset(raw);
const pumpkin = findFoods(foods, "pumpkin canned without salt")[0];
const gruyere = findFoods(foods, "cheese gruyere")[0];
let server;
let db;

before(async () => {
  server = new NetlifyDB();
  const connectionString = await server.start();
  await server.applyMigrations("./db/migrations");
  db = connect(connectionString);
  useDatabase(db);
  process.env.SESSION_SECRET = "y".repeat(40);
  process.env.GOOGLE_CLIENT_ID = "g";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.ANTHROPIC_API_KEY = "a";
});
after(async () => {
  await db?.pool.end();
  await server?.stop();
});

function haiku(verdict, { mealType = "dinner", reason = "Looks fine." } = {}) {
  return {
    messages: {
      create: async () => ({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "submit_review", input: { verdict, reason, meal_type: mealType } }],
      }),
    },
  };
}
const recipe = (overrides = {}) => ({
  version: 2,
  name: "Pumpkin Gruyère Gratin",
  description: "Custardy and savory.",
  servings: 4,
  perServing: { calories: 1, protein: 999 },
  ingredients: [
    { id: pumpkin.id, grams: 230, label: "canned pumpkin", qty: 1, unit: "cup", prep: "" },
    { id: gruyere.id, grams: 120, label: "Gruyère", qty: null, unit: "", prep: "grated" },
  ],
  seasonings: ["nutmeg"],
  steps: ["Bake {1} pumpkin with {2} Gruyère."],
  tip: "",
  ...overrides,
});

const ENVELOPE = ["site", "url", "generatedAt", "period", "status", "attention", "notable", "summary", "metrics", "details"];
const DAILY = ["newAccounts", "signIns", "ideas", "recipes", "failedAiJobs", "creditsSpent", "recipesPosted", "comments", "messages", "packsSold", "revenue", "aiCost"];
const LEVELS = ["accountsTotal", "unreadMessages", "reviewQueue", "heldPosts", "openReports"];

test("an empty site reports ok with nothing to do", async () => {
  const brief = await buildBrief(new Date("2026-10-18T13:00:00Z"));
  assert.deepEqual(Object.keys(brief), ENVELOPE);
  assert.equal(brief.site, "Macro Genie");
  assert.equal(brief.url, "https://macro-genie.com");
  assert.equal(brief.generatedAt, "2026-10-18T13:00:00.000Z");
  assert.deepEqual(brief.period, { since: "2026-10-17T13:00:00.000Z", until: "2026-10-18T13:00:00.000Z", days: 1 });
  assert.equal(brief.status, "ok");
  assert.deepEqual(brief.attention, []);
  assert.deepEqual(brief.notable, []);
  assert.match(brief.summary, /Nothing needs you\./);
  assert.deepEqual(Object.keys(brief.metrics), [...DAILY, ...LEVELS]);
  for (const name of DAILY) {
    const m = brief.metrics[name];
    assert.equal(m.yesterday, 0, name);
    assert.equal(m.avg7, 0, name);
  }
  for (const name of LEVELS) assert.deepEqual(brief.metrics[name], { value: 0 }, name);
  assert.equal(brief.metrics.revenue.unit, "USD");
  assert.equal(brief.metrics.aiCost.unit, "USD");
  assert.equal(brief.metrics.newAccounts.unit, undefined);
  assert.equal(brief.details.health.database.ok, true);
  assert.ok(brief.details.health.database.ms >= 0);
  assert.deepEqual(brief.details.problems, []);
  assert.deepEqual(brief.details.inbox, []);
  assert.deepEqual(brief.details.moderation, []);
  assert.deepEqual(brief.details.log, []);
});

test("a busy day is counted, averaged, called out, and everything that needs a person is listed in order", async () => {
  const ada = await findOrCreateAccount({ sub: "brief-ada", displayName: "Ada" });
  await logActivity({ kind: "joined", accountId: ada.id, actorName: "Ada", text: "joined" });
  await logActivity({ kind: "sign_in", accountId: ada.id, actorName: "Ada", text: "signed in" });
  await spendCredit(ada.id, "idea");
  await spendCredit(ada.id, "idea");
  await spendCredit(ada.id, "recipe");
  await refundCredit(ada.id, "idea");
  await addCredits(ada.id, 20, "purchase", "cs_test_1", { paid: true });
  await saveUsage([{ step: "idea", model: "claude-haiku", input: 10, output: 5, cacheRead: 0, cacheWrite: 0, costUsd: 0.42 }]);
  await logActivity({ kind: "payment_problem", accountId: ada.id, actorName: "Ada", text: "a payment failed" });
  await saveMessage({ accountId: ada.id, name: "Ada", topic: "Bug", body: "The lamp is cold.\nSecond line." });
  await createPost(ada.id, recipe(), { mealType: "dinner" }, haiku("fine"));
  await createPost(ada.id, recipe({ name: "Miracle gratin" }), { mealType: "lunch" }, haiku("unsure", { reason: "Health claim" }));

  const brief = await buildBrief();
  assert.equal(brief.status, "attention");
  assert.deepEqual(brief.attention, [
    "1 AI job failed",
    "1 payment problem",
    "1 post held for review",
    "1 unread message",
    "1 item in the review queue",
  ]);
  const m = brief.metrics;
  assert.deepEqual(m.newAccounts, { yesterday: 1, avg7: 0.1 });
  assert.deepEqual(m.signIns, { yesterday: 1, avg7: 0.1 });
  assert.deepEqual(m.ideas, { yesterday: 2, avg7: 0.3 });
  assert.deepEqual(m.recipes, { yesterday: 1, avg7: 0.1 });
  assert.deepEqual(m.failedAiJobs, { yesterday: 1, avg7: 0.1 });
  assert.deepEqual(m.creditsSpent, { yesterday: 3, avg7: 0.4 });
  assert.deepEqual(m.recipesPosted, { yesterday: 2, avg7: 0.3 });
  assert.deepEqual(m.comments, { yesterday: 0, avg7: 0 });
  assert.deepEqual(m.messages, { yesterday: 1, avg7: 0.1 });
  assert.deepEqual(m.packsSold, { yesterday: 1, avg7: 0.1 });
  assert.deepEqual(m.revenue, { yesterday: 3, avg7: 0.4, unit: "USD" });
  assert.deepEqual(m.aiCost, { yesterday: 0.42, avg7: 0.1, unit: "USD" });
  assert.deepEqual(m.accountsTotal, { value: 1 });
  assert.deepEqual(m.unreadMessages, { value: 1 });
  assert.deepEqual(m.reviewQueue, { value: 1 });
  assert.deepEqual(m.heldPosts, { value: 1 });
  assert.deepEqual(m.openReports, { value: 0 });
  assert.ok(brief.notable.includes("1 new account yesterday, first in a week"), brief.notable.join(" | "));
  assert.ok(brief.notable.includes("$3.00 in packs yesterday, first in a week"), brief.notable.join(" | "));
  assert.ok(brief.details.problems.some((l) => l.kind === "payment_problem" && l.text === "a payment failed"));
  assert.deepEqual(brief.details.inbox.map((x) => [x.topic, x.name, x.firstLine]), [["Bug", "Ada", "The lamp is cold."]]);
  assert.deepEqual(brief.details.moderation.map((i) => [i.kind, i.status, i.name, i.note]), [["recipe", "held", "Miracle gratin", "Health claim"]]);
  assert.ok(brief.details.log.length >= 4);
  assert.ok(brief.details.log.every((l) => typeof l.at === "string" && l.kind && typeof l.text === "string"));
  assert.match(brief.summary, /1 new account/);
  assert.match(brief.summary, /\$3\.00 in packs/);
  assert.match(brief.summary, /Needs you: 1 AI job failed; /);
});

test("with the database unreachable the brief still answers and says so first", async () => {
  const broken = connect("postgres://nobody:nope@127.0.0.1:1/none");
  useDatabase(broken);
  try {
    const brief = await buildBrief();
    assert.equal(brief.status, "attention");
    assert.equal(brief.attention[0], "Database unreachable");
    assert.equal(brief.details.health.database.ok, false);
    assert.equal(brief.metrics, null);
    assert.deepEqual(brief.notable, []);
    assert.equal(brief.details.inbox, null);
    assert.match(brief.summary, /database is unreachable/i);
  } finally {
    await broken.pool.end().catch(() => {});
    useDatabase(db);
  }
});

test("one failing section is reported, not fatal", async () => {
  useDatabase({
    pool: db.pool,
    sql: (strings, ...values) =>
      strings.join("?").includes("FROM messages") && strings.join("?").includes("ORDER BY id DESC")
        ? Promise.reject(new Error("boom"))
        : db.sql(strings, ...values),
  });
  try {
    const brief = await buildBrief();
    assert.equal(brief.status, "attention");
    assert.ok(brief.attention.includes("Brief section inbox failed"), brief.attention.join(" | "));
    assert.equal(brief.details.inbox, null);
    assert.ok(brief.metrics.newAccounts, "the metrics are still there");
    assert.ok(brief.details.moderation);
  } finally {
    useDatabase(db);
  }
});

test("the Anthropic check follows the same key rule as the chef: local key under npm run dev", async () => {
  const saved = { ...process.env };
  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.MACRO_GENIE_LOCAL = "1";
    process.env.MACRO_GENIE_LOCAL_KEY = "local-key";
    assert.equal((await buildBrief()).details.health.anthropic, true, "local dev with a local key");
    process.env.MACRO_GENIE_LOCAL_KEY = "";
    assert.equal((await buildBrief()).details.health.anthropic, false, "local dev without a key");
    delete process.env.MACRO_GENIE_LOCAL;
    assert.equal((await buildBrief()).details.health.anthropic, false, "production without a key");
    process.env.ANTHROPIC_API_KEY = "a";
    assert.equal((await buildBrief()).details.health.anthropic, true, "production with a key");
  } finally {
    for (const k of ["ANTHROPIC_API_KEY", "MACRO_GENIE_LOCAL", "MACRO_GENIE_LOCAL_KEY"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
