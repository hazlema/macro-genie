import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { NetlifyDB } from "@netlify/database-dev";
import raw from "../foods.json" with { type: "json" };
import { findFoods, normalizeDataset } from "../src/lib/foods.js";
import { connect, useDatabase } from "../server/db.js";
import { findOrCreateAccount } from "../server/accounts.js";
import { createPost, createThread } from "../server/community.js";
import { createMcpServer } from "../mcp/server.js";

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
});
after(async () => {
  await db?.pool.end();
  await server?.stop();
});

// A stand-in for Haiku that gives each review the verdict asked for.
function haiku(verdict, { mealType = "dinner", reason = "Looks fine." } = {}) {
  return {
    messages: {
      create: async () => ({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            name: "submit_review",
            input: { verdict, reason, meal_type: mealType },
          },
        ],
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
  steps: ["Bake {1} pumpkin with {2} Gruyère.", "Heat {2:1/2} Gruyère and {1:1/4} pumpkin, then the rest."],
  tip: "",
  ...overrides,
});

async function withClient(work) {
  const mcp = createMcpServer();
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await mcp.connect(a);
    await client.connect(b);
    return await work(client);
  } finally {
    await client.close();
    await mcp.close();
  }
}
const call = (client, name, args) =>
  client.callTool({ name, arguments: args }).then((r) => ({ isError: !!r.isError, data: JSON.parse(r.content[0].text) }));

test("search_community finds live recipes by words and macros, and get_community_recipe returns one in full", async () => {
  const ada = await findOrCreateAccount({ sub: "mcp-ada", displayName: "Ada" });
  const live = await createPost(ada.id, recipe(), { mealType: "dinner" }, haiku("fine"));
  const held = await createPost(
    ada.id,
    recipe({ name: "Miracle gratin" }),
    { mealType: "dinner" },
    haiku("unsure", { reason: "Health claim" }),
  );
  await withClient(async (client) => {
    const found = await call(client, "search_community", { query: "gruyère gratin", limit: 5 });
    assert.equal(found.isError, false);
    assert.equal(found.data.basis, "per serving");
    assert.deepEqual(found.data.recipes.map((r) => r.id), [live.id], "the held post is not listed");
    const [hit] = found.data.recipes;
    assert.equal(hit.name, "Pumpkin Gruyère Gratin");
    assert.equal(hit.meal, "dinner");
    assert.equal(hit.author, "Ada");
    assert.equal(hit.description, "Custardy and savory.");
    assert.equal(hit.url, `https://macro-genie.com/community/${live.id}`);
    assert.ok(hit.perServing.protein > 5 && hit.perServing.protein < 20, `protein ${hit.perServing.protein}`);
    assert.deepEqual(Object.keys(hit.perServing), ["calories", "protein", "netCarbs", "fat", "sugar", "sodium"]);

    const tooMuch = await call(client, "search_community", { ranges: { protein: { min: 500 } } });
    assert.deepEqual(tooMuch.data.recipes, []);
    const byMeal = await call(client, "search_community", { meal: "lunch" });
    assert.ok(!byMeal.data.recipes.some((r) => r.id === live.id));

    const full = await call(client, "get_community_recipe", { id: live.id });
    assert.equal(full.isError, false);
    assert.equal(full.data.servings, 4);
    assert.deepEqual(full.data.ingredients.map((i) => i.name), ["canned pumpkin", "Gruyère"]);
    assert.equal(full.data.ingredients[0].grams, 230);
    assert.deepEqual(full.data.seasonings, ["nutmeg"]);
    assert.deepEqual(full.data.method, [
      "Bake 1 cup pumpkin with 120 g Gruyère.",
      "Heat 60 g Gruyère and ¼ cup pumpkin, then the rest.",
    ], "steps read as the site shows them, parts included");
    assert.equal(full.data.ingredients[0].text, "1 cup canned pumpkin");
    assert.equal(full.data.url, `https://macro-genie.com/community/${live.id}`);

    for (const id of [held.id, 999999]) {
      const miss = await call(client, "get_community_recipe", { id });
      assert.equal(miss.isError, true);
      assert.equal(miss.data.error, "That recipe isn't in the community.");
    }
  });
});

test("forum threads are never recipes, and real errors don't leak their text", async () => {
  const bob = await findOrCreateAccount({ sub: "mcp-bob", displayName: "Bob" });
  const thread = await createThread(bob.id, { board: "general", title: "Hello all", body: "First post." }, haiku("fine"));
  assert.equal(thread.status, "live");
  await withClient(async (client) => {
    const miss = await call(client, "get_community_recipe", { id: thread.id });
    assert.equal(miss.isError, true);
    assert.equal(miss.data.error, "That recipe isn't in the community.");
    const listed = await call(client, "search_community", { query: "hello" });
    assert.deepEqual(listed.data.recipes, []);
  });
  const broken = connect("postgres://nobody:nope@127.0.0.1:1/none");
  useDatabase(broken);
  try {
    await withClient(async (client) => {
      const down = await call(client, "search_community", { query: "soup" });
      assert.equal(down.isError, true);
      assert.equal(down.data.error, "Community search isn't available on this server.");
    });
  } finally {
    await broken.pool.end().catch(() => {});
    useDatabase(db);
  }
});
