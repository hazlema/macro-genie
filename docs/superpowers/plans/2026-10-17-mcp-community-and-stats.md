# MCP Community Search and Stats Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `search_community` and `get_community_recipe` to the public MCP server, and a private `stats` MCP server at `/mcp/stats/<token>` whose one tool, `morning_brief`, reports the last 24 hours of health, problems, people, inbox and moderation in a standard envelope.

**Architecture:** `listPosts` gains a word filter; two tools in `mcp/server.js` wrap `listPosts`/`getPost`. The Netlify transport code moves to `mcp/http.js` so a second function (`mcp-stats.js`, token-gated) can reuse it. `server/brief.js` builds the brief envelope from its own SQL plus `reviewQueue()`; `mcp/stats.js` exposes it as the `morning_brief` tool.

**Tech Stack:** Node 22 ESM, `@modelcontextprotocol/sdk` (`McpServer`, `WebStandardStreamableHTTPServerTransport`), `zod`, Postgres via `server/db.js` (`database().sql` tagged template, `database().pool.query`), `node --test`, `@netlify/database-dev` for a throwaway test database.

**Spec:** `docs/superpowers/specs/2026-10-17-mcp-community-and-stats-design.md`

## Global Constraints

- No new dependencies.
- Public server name stays `macro-genie`; the private server is named exactly `stats`, version `1.0.0`, with exactly one tool named `morning_brief` that takes no arguments.
- Envelope fields, exact names and order: `site`, `url`, `generatedAt`, `since`, `status` (`"ok" | "attention"`), `attention` (array of short strings), `summary` (string), `sections` (object). `site` is `"Macro Genie"`, `url` is `"https://macro-genie.com"`.
- `attention` order: health failures, problems (failed AI jobs, payment problems, held/blocked posts, held/blocked comments, open reports), unread messages, review queue. Nothing else.
- Money never appears in the brief.
- The stats function returns a bare `404` when `STATS_TOKEN` is unset/empty or the token does not match; comparison uses `timingSafeEqual` on equal-length buffers.
- Community tools return live recipe posts only; forum threads never. Without a database they return `{ error: "Community search isn't available on this server." }` with `isError: true`.
- Community recipe `url` is `https://macro-genie.com/community/<id>`.
- Tool errors use the existing style: `{ content: [{ type: "text", text: JSON.stringify({ error }) }], isError: true }`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not push.
- Tests: `npm test` runs `node --test tests/*.test.js`. Database tests use the `NetlifyDB` harness exactly as `tests/community.test.js` does (`before`: start, `applyMigrations("./db/migrations")`, `connect`, `useDatabase`; `after`: `pool.end()`, `stop()`). Run a single file with `node --test tests/<file>.test.js`.

## Review Focus

1. **Database down when `morning_brief` is called**: the tool must still answer (status `attention`, "Database unreachable" first in `attention`, database-backed sections `null`), never throw. Pinned by the no-database test in Task 5.
2. **A token of the wrong length, or a request with no token segment**: must be a plain 404, with no timing or message difference from a wrong token. Pinned by the `tokenMatches` tests in Task 5.
3. **Search words containing `%`, `_` or `\`**: treated as literal characters, not wildcards. Pinned by the `listPosts` test in Task 1.
4. **`get_community_recipe` for a held, blocked, removed or unknown id**: the same clean "isn't in the community" error, so a held post's existence does not leak. Pinned by the with-database test in Task 3.
5. **Method steps with `{n}` placeholders** (the site renders amounts in their place): the tool must substitute readable amounts, not hand the AI raw `{1}` tokens. Pinned by the `get_community_recipe` test in Task 3.

---

### Task 1: `listPosts` word filter

**Files:**
- Modify: `server/community.js` (the `listPosts` function, parameter list at line ~243 and the filter block after the meal filter at line ~278)
- Test: `tests/community.test.js` (append)

**Interfaces:**
- Produces: `listPosts({ query })` — `query` is an optional string; each whitespace-separated word (max 8) must appear, case-insensitively, in `posts.name` or `recipe->>'description'`. `export function queryWords(query)` → `string[]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/community.test.js` (it already imports `listPosts`, `createPost`, and defines `recipe`, `person`, `haiku`):

```js
test("listPosts finds recipes by words in the name or description", async () => {
  const ada = await person();
  const gratin = await createPost(
    ada.id,
    recipe({ name: "Zanzibar Gratin", description: "Custardy and kumquat-bright." }),
    { mealType: "dinner" },
    haiku("fine"),
  );
  const soup = await createPost(
    ada.id,
    recipe({ name: "Lentil quokka soup", description: "Hearty and smoky." }),
    { mealType: "lunch" },
    haiku("fine"),
  );
  const ids = async (query) => (await listPosts({ query })).posts.map((p) => p.id);
  assert.deepEqual(await ids("ZANZIBAR"), [gratin.id], "name, any case");
  assert.deepEqual(await ids("kumquat"), [gratin.id], "description");
  assert.deepEqual(await ids("quokka hearty"), [soup.id], "every word must match");
  assert.deepEqual(await ids("quokka kumquat"), [], "words spread over two posts don't match");
  assert.deepEqual(await ids("zanz%"), [], "% is a literal, not a wildcard");
  assert.deepEqual(await ids("quo_ka"), [], "_ is a literal, not a wildcard");
  const all = (await listPosts({})).posts.length;
  assert.equal((await listPosts({ query: "   " })).posts.length, all, "blank query = no filter");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/community.test.js 2>&1 | grep -E "^not ok|^ℹ (pass|fail)|actual|expected" | head`
Expected: the new test FAILS on the first `deepEqual` (unfiltered results include other posts); the earlier tests in the file still pass.

- [ ] **Step 3: Add the filter**

In `server/community.js`, add above `listPosts` (next to `COLUMNS`):

```js
// Search words: split on whitespace, lower-cased, at most 8. Used as
// literal substrings, so %, _ and \ are escaped for ILIKE.
export const queryWords = (query) =>
  String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
const likeLiteral = (word) => `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
```

Add `query = "",` to the `listPosts` parameter object (after `sort = "new",`). Then, directly after the meal-type filter block (the one ending `where.push(\`p.meal_type = $${params.length}\`);\n  }`), add:

```js
  for (const word of queryWords(query)) {
    params.push(likeLiteral(word));
    where.push(
      `(p.name ILIKE $${params.length} OR coalesce(p.recipe->>'description', '') ILIKE $${params.length})`,
    );
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/community.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add server/community.js tests/community.test.js
git commit -m "$(cat <<'EOF'
Community posts can be filtered by words in the name or description

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Shared MCP transport (`mcp/http.js`)

**Files:**
- Create: `mcp/http.js`
- Modify: `netlify/functions/mcp.js` (whole file)
- Test: `tests/mcp.test.js` (append)

**Interfaces:**
- Produces: `export async function serveMcp(request, createServer)` → `Response`. Handles OPTIONS (204), non-POST (405 with `Allow`), else serves one stateless MCP request on a fresh server from `createServer()` and closes it.

This is a refactor; the characterization test in Step 1 passes before and after (that is expected for a refactor and is the point: it pins behavior across the move).

- [ ] **Step 1: Write the characterization test**

Append to `tests/mcp.test.js`:

```js
test("the MCP function answers OPTIONS with 204 and non-POST with 405", async () => {
  const options = await handler(new Request("https://example.com/mcp", { method: "OPTIONS" }));
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");
  const get = await handler(new Request("https://example.com/mcp", { method: "GET" }));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST, OPTIONS");
});
```

- [ ] **Step 2: Run it to confirm it passes on the current code**

Run: `node --test tests/mcp.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 0` (3 tests pass).

- [ ] **Step 3: Move the transport into `mcp/http.js`**

Create `mcp/http.js`:

```js
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, MCP-Protocol-Version, Last-Event-ID",
  "Cache-Control": "no-store",
};

// Serves one MCP request over Streamable HTTP with a fresh server and
// transport: no session store or filesystem writes, so any function
// instance can answer any request.
export async function serveMcp(request, createServer) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== "POST")
    return new Response("Use MCP Streamable HTTP POST requests.", {
      status: 405,
      headers: { ...HEADERS, Allow: "POST, OPTIONS" },
    });
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const body = await response.text();
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(HEADERS)) headers.set(key, value);
    return new Response(body || null, { status: response.status, headers });
  } finally {
    await server.close();
  }
}
```

Replace the whole of `netlify/functions/mcp.js` with:

```js
import { createMcpServer } from "../../mcp/server.js";
import { serveMcp } from "../../mcp/http.js";

export const config = { path: "/mcp" };

export default (request) => serveMcp(request, createMcpServer);
```

- [ ] **Step 4: Run the MCP tests**

Run: `node --test tests/mcp.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 0` (the HTTP client test and the new 204/405 test both pass against the moved code).

- [ ] **Step 5: Commit**

```bash
git add mcp/http.js netlify/functions/mcp.js tests/mcp.test.js
git commit -m "$(cat <<'EOF'
MCP transport shared by functions (mcp/http.js)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Community tools on the public server

**Files:**
- Modify: `mcp/server.js` (imports at top; two `registerTool` calls before `return server;`)
- Test: `tests/mcp.test.js` (modify the expected tool list; append a no-database test)
- Create: `tests/mcp-community.test.js` (with the test database)

**Interfaces:**
- Consumes: `listPosts({ query, meal, ranges, sort, offset })` (Task 1) and `getPost(id)` from `server/community.js`; `MEAL_TYPES` from `server/moderate.js`.
- Produces: tools `search_community` and `get_community_recipe` on `createMcpServer()`.

- [ ] **Step 1: Write the failing tests**

In `tests/mcp.test.js`, change the expected tool list in the first test to:

```js
    assert.deepEqual(listed.tools.map((t) => t.name).sort(), [
      "get_community_recipe",
      "get_food_details",
      "list_food_categories",
      "search_community",
      "search_foods",
      "size_recipe",
    ]);
```

and append:

```js
test("community tools say so plainly when there is no database", async () => {
  delete process.env.DATABASE_URL;
  const { useDatabase } = await import("../server/db.js");
  useDatabase(null);
  const server = createMcpServer();
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    for (const call of [
      { name: "search_community", arguments: { query: "soup" } },
      { name: "get_community_recipe", arguments: { id: 1 } },
    ]) {
      const result = await client.callTool(call);
      assert.equal(result.isError, true, call.name);
      assert.equal(
        JSON.parse(result.content[0].text).error,
        "Community search isn't available on this server.",
      );
    }
  } finally {
    await client.close();
    await server.close();
  }
});
```

Create `tests/mcp-community.test.js`:

```js
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { NetlifyDB } from "@netlify/database-dev";
import raw from "../foods.json" with { type: "json" };
import { findFoods, normalizeDataset } from "../src/lib/foods.js";
import { connect, useDatabase } from "../server/db.js";
import { findOrCreateAccount } from "../server/accounts.js";
import { createPost } from "../server/community.js";
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
  steps: ["Bake {1} pumpkin with {2} Gruyère."],
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
    assert.deepEqual(full.data.method, ["Bake 1 cup (230 g) pumpkin with 120 g Gruyère."]);
    assert.equal(full.data.url, `https://macro-genie.com/community/${live.id}`);

    for (const id of [held.id, 999999]) {
      const miss = await call(client, "get_community_recipe", { id });
      assert.equal(miss.isError, true);
      assert.equal(miss.data.error, "That recipe isn't in the community.");
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/mcp.test.js tests/mcp-community.test.js 2>&1 | grep -E "^not ok|^ℹ (pass|fail)" | head`
Expected: the tool-list assertion fails (4 tools, not 6); the no-database test fails ("Tool search_community not found" or similar); the community test fails the same way.

- [ ] **Step 3: Add the tools**

In `mcp/server.js`, add to the imports:

```js
import { getPost, listPosts } from "../server/community.js";
import { MEAL_TYPES } from "../server/moderate.js";
```

Add these helpers after `const metadata = ...` (before `export function createMcpServer`):

```js
const SITE = "https://macro-genie.com";
const COMMUNITY_NUTRIENTS = ["calories", "protein", "netCarbs", "fat", "sugar", "sodium"];
const communityRanges = z
  .object(
    Object.fromEntries(
      COMMUNITY_NUTRIENTS.map((key) => [
        key,
        range.optional().describe(`${units[key] ? `${key} in ${units[key]}` : key} per serving`),
      ]),
    ),
  )
  .strict()
  .optional();
const NO_COMMUNITY = "Community search isn't available on this server.";
const communityError = (error) => ({
  ...reply({ error: /DATABASE_URL/.test(error.message) ? NO_COMMUNITY : error.message }),
  isError: true,
});
const round1 = (n) => (typeof n === "number" ? Math.round(n * 10) / 10 : null);
// The post as an AI should see it: the recipe's description and per-serving
// numbers, plus where to find it on the site.
const summarizePost = (post) => ({
  id: post.id,
  name: post.name,
  meal: post.mealType,
  author: post.author,
  postedAt: post.createdAt,
  likes: post.likes,
  comments: post.comments,
  description: post.recipe?.description ?? "",
  perServing: Object.fromEntries(
    COMMUNITY_NUTRIENTS.map((key) => [key, round1(post.recipe?.perServing?.[key])]),
  ),
  url: `${SITE}/community/${post.id}`,
});
// "1 cup (230 g)" or "120 g": what the site shows in place of a step's {n}.
const amountText = (i) => (i.qty ? `${i.qty} ${i.unit} (${i.grams} g)` : `${i.grams} g`);
const fullPost = (post) => {
  const r = post.recipe ?? {};
  const ingredients = (r.ingredients ?? []).map((i) => ({
    name: i.label || i.name,
    food: i.name,
    grams: i.grams,
    qty: i.qty ?? null,
    unit: i.unit ?? "",
    prep: i.prep ?? "",
  }));
  return {
    ...summarizePost(post),
    servings: r.servings,
    ingredients,
    seasonings: r.seasonings ?? [],
    method: (r.steps ?? []).map((step) =>
      step.replace(/\{(\d+)\}/g, (match, n) => {
        const i = ingredients[Number(n) - 1];
        return i ? amountText(i) : match;
      }),
    ),
    tip: r.tip || "",
  };
};
```

Then, inside `createMcpServer`, before `return server;`:

```js
  server.registerTool(
    "search_community",
    {
      description:
        "Find recipes people have shared on Macro Genie's Community. Filter by words in the name or description, meal type, and per-serving nutrient ranges. Returns a page of live recipes with their per-serving nutrition and a link; use get_community_recipe for the full ingredients and method.",
      inputSchema: {
        query: z
          .string()
          .max(100)
          .optional()
          .describe("Words that must all appear in the recipe's name or description"),
        meal: z.enum(["all", ...MEAL_TYPES]).default("all"),
        ranges: communityRanges,
        sort: z.enum(["new", "liked"]).default("new"),
        limit: z.number().int().min(1).max(20).default(10),
        offset: z.number().int().nonnegative().default(0),
      },
      annotations,
    },
    async ({ query, meal, ranges, sort, limit, offset }) => {
      try {
        const { posts, more } = await listPosts({ query, meal, ranges: ranges ?? {}, sort, offset });
        return reply({
          basis: "per serving",
          units: Object.fromEntries(COMMUNITY_NUTRIENTS.map((key) => [key, units[key]])),
          total: null,
          offset,
          limit,
          more: more || posts.length > limit,
          recipes: posts.slice(0, limit).map(summarizePost),
        });
      } catch (error) {
        return communityError(error);
      }
    },
  );
  server.registerTool(
    "get_community_recipe",
    {
      description:
        "One Community recipe in full: servings, ingredients with gram amounts, method, seasonings, and per-serving nutrition. Use the id from search_community.",
      inputSchema: { id: z.number().int().positive() },
      annotations,
    },
    async ({ id }) => {
      try {
        return reply(fullPost(await getPost(id)));
      } catch (error) {
        return communityError(error);
      }
    },
  );
```

Note `units` (defined near the top of the file) has keys for every nutrient including `netCarbs`; `units.calories` is `"kcal"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/mcp.test.js tests/mcp-community.test.js 2>&1 | grep -E "^not ok|^ℹ (pass|fail)"`
Expected: `fail 0`. If the `method` assertion differs only in amount wording, fix `amountText` to produce exactly `1 cup (230 g)` and `120 g`.

- [ ] **Step 5: Commit**

```bash
git add mcp/server.js tests/mcp.test.js tests/mcp-community.test.js
git commit -m "$(cat <<'EOF'
MCP: search the Community and read a shared recipe in full

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `server/brief.js`

**Files:**
- Create: `server/brief.js`
- Test: `tests/brief.test.js`

**Interfaces:**
- Consumes: `database()` from `server/db.js`; `CHIPS` from `server/activity.js`; `reviewQueue()` from `server/admin.js`.
- Produces: `export async function buildBrief(now = new Date())` → the envelope; `export const SITE = { name: "Macro Genie", url: "https://macro-genie.com" }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/brief.test.js`:

```js
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
import raw from "../foods.json" with { type: "json" };
import { findFoods, normalizeDataset } from "../src/lib/foods.js";
import { connect, useDatabase } from "../server/db.js";
import { findOrCreateAccount, refundCredit, spendCredit } from "../server/accounts.js";
import { logActivity } from "../server/activity.js";
import { saveMessage } from "../server/messages.js";
import { createPost } from "../server/community.js";
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

test("an empty site reports ok with nothing to do", async () => {
  const brief = await buildBrief(new Date("2026-10-18T13:00:00Z"));
  assert.deepEqual(Object.keys(brief), ["site", "url", "generatedAt", "since", "status", "attention", "summary", "sections"]);
  assert.equal(brief.site, "Macro Genie");
  assert.equal(brief.url, "https://macro-genie.com");
  assert.equal(brief.generatedAt, "2026-10-18T13:00:00.000Z");
  assert.equal(brief.since, "2026-10-17T13:00:00.000Z");
  assert.equal(brief.status, "ok");
  assert.deepEqual(brief.attention, []);
  assert.match(brief.summary, /Nothing needs you\./);
  assert.equal(brief.sections.health.database.ok, true);
  assert.ok(brief.sections.health.database.ms >= 0);
  assert.deepEqual(brief.sections.people, {
    newAccounts: 0, signIns: 0, ideas: 0, recipes: 0, creditsSpent: 0, recipesPosted: 0, comments: 0, accountsTotal: 0,
  });
  assert.deepEqual(brief.sections.inbox, { unread: 0, messages: [] });
  assert.deepEqual(brief.sections.moderation, { queue: 0, items: [] });
  assert.deepEqual(brief.sections.log, []);
});

test("a busy day is counted and everything that needs a person is listed in order", async () => {
  const ada = await findOrCreateAccount({ sub: "brief-ada", displayName: "Ada" });
  await logActivity({ kind: "joined", accountId: ada.id, actorName: "Ada", text: "joined" });
  await logActivity({ kind: "sign_in", accountId: ada.id, actorName: "Ada", text: "signed in" });
  await spendCredit(ada.id, "idea");
  await spendCredit(ada.id, "idea");
  await spendCredit(ada.id, "recipe");
  await refundCredit(ada.id, "idea");
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
  const p = brief.sections.people;
  assert.equal(p.newAccounts, 1);
  assert.equal(p.signIns, 1);
  assert.equal(p.ideas, 2);
  assert.equal(p.recipes, 1);
  assert.equal(p.creditsSpent, 3);
  assert.equal(p.recipesPosted, 2);
  assert.equal(p.accountsTotal, 1);
  const q = brief.sections.problems;
  assert.equal(q.failedAiJobs, 1);
  assert.equal(q.paymentProblems, 1);
  assert.equal(q.heldPosts, 1);
  assert.equal(q.blockedPosts, 0);
  assert.equal(q.openReports, 0);
  assert.ok(q.lines.some((l) => l.kind === "payment_problem" && l.text === "a payment failed"));
  assert.equal(brief.sections.inbox.unread, 1);
  assert.deepEqual(brief.sections.inbox.messages.map((m) => [m.topic, m.name, m.firstLine]), [["Bug", "Ada", "The lamp is cold."]]);
  assert.equal(brief.sections.moderation.queue, 1);
  assert.deepEqual(brief.sections.moderation.items.map((i) => [i.kind, i.status, i.name, i.note]), [["recipe", "held", "Miracle gratin", "Health claim"]]);
  assert.ok(brief.sections.log.length >= 4);
  assert.ok(brief.sections.log.every((l) => typeof l.at === "string" && l.kind && typeof l.text === "string"));
  assert.match(brief.summary, /1 new account/);
  assert.match(brief.summary, /Needs you: 1 AI job failed; /);
  assert.ok(!JSON.stringify(brief).includes("cents"), "no money in the brief");
});

test("with the database unreachable the brief still answers and says so first", async () => {
  const broken = connect("postgres://nobody:nope@127.0.0.1:1/none");
  useDatabase(broken);
  try {
    const brief = await buildBrief();
    assert.equal(brief.status, "attention");
    assert.equal(brief.attention[0], "Database unreachable");
    assert.equal(brief.sections.health.database.ok, false);
    assert.equal(brief.sections.people, null);
    assert.equal(brief.sections.inbox, null);
    assert.match(brief.summary, /database is unreachable/i);
  } finally {
    await broken.pool.end().catch(() => {});
    useDatabase(db);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/brief.test.js 2>&1 | grep -E "ERR_MODULE|^ℹ (pass|fail)" | head -3`
Expected: `ERR_MODULE_NOT_FOUND` for `../server/brief.js`.

- [ ] **Step 3: Write `server/brief.js`**

```js
import { database } from "./db.js";
import { CHIPS } from "./activity.js";
import { reviewQueue } from "./admin.js";

// The morning brief: what happened in the last 24 hours and what needs a
// person. The top-level shape (site, url, generatedAt, since, status,
// attention, summary, sections) is the same on every one of Frosty's
// sites; only `sections` is particular to this one. No money here.
export const SITE = { name: "Macro Genie", url: "https://macro-genie.com" };
const DAY = 86_400_000;
const LOG_LINES = 50;
const LIST = 20;

const n = (rows) => Number(rows[0]?.n ?? 0);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const entry = (r) => ({
  at: new Date(r.created_at).toISOString(),
  kind: r.kind,
  name: r.actor_name,
  text: r.text,
});

export async function buildBrief(now = new Date()) {
  const since = new Date(now.getTime() - DAY);
  const health = await checkHealth();
  const sections = { health, problems: null, people: null, inbox: null, moderation: null, log: null };
  if (health.database.ok) {
    const db = database();
    const [problems, people, inbox, moderation, log] = await Promise.all([
      problemsSince(db, since),
      peopleSince(db, since),
      inboxNow(db),
      moderationNow(),
      logSince(db, since),
    ]);
    Object.assign(sections, { problems, people, inbox, moderation, log });
  }
  const attention = attentionLines(sections);
  return {
    site: SITE.name,
    url: SITE.url,
    generatedAt: now.toISOString(),
    since: since.toISOString(),
    status: attention.length ? "attention" : "ok",
    attention,
    summary: summarize(sections, attention),
    sections,
  };
}

async function checkHealth() {
  let db = { ok: false, ms: null };
  const start = performance.now();
  try {
    await database().sql`SELECT 1`;
    db = { ok: true, ms: Math.round(performance.now() - start) };
  } catch {
    // Reported as unreachable; the rest of the brief still goes out.
  }
  return {
    database: db,
    googleSignIn: !!process.env.GOOGLE_CLIENT_ID,
    stripe: !!process.env.STRIPE_SECRET_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
  };
}

async function problemsSince(db, since) {
  const [failed, payments, posts, comments, reports, lines] = await Promise.all([
    db.sql`SELECT count(*)::int AS n FROM credit_ledger WHERE reason LIKE 'refund:%' AND created_at >= ${since}`,
    db.sql`SELECT count(*)::int AS n FROM activity_log WHERE kind = 'payment_problem' AND created_at >= ${since}`,
    db.sql`SELECT status, count(*)::int AS n FROM posts WHERE status IN ('held', 'blocked') GROUP BY status`,
    db.sql`SELECT status, count(*)::int AS n FROM comments WHERE status IN ('held', 'blocked') GROUP BY status`,
    db.sql`
      SELECT count(*)::int AS n FROM reports r
       WHERE (r.target_type = 'post' AND EXISTS (SELECT 1 FROM posts p WHERE p.id = r.target_id AND p.status = 'live'))
          OR (r.target_type = 'comment' AND EXISTS (SELECT 1 FROM comments c WHERE c.id = r.target_id AND c.status = 'live'))`,
    db.sql`
      SELECT created_at, kind, actor_name, text FROM activity_log
       WHERE kind = ANY(${CHIPS.problems}::text[]) AND created_at >= ${since}
       ORDER BY id DESC LIMIT ${LOG_LINES}`,
  ]);
  const by = (rows, status) => rows.find((r) => r.status === status)?.n ?? 0;
  return {
    failedAiJobs: n(failed),
    paymentProblems: n(payments),
    heldPosts: by(posts, "held"),
    blockedPosts: by(posts, "blocked"),
    heldComments: by(comments, "held"),
    blockedComments: by(comments, "blocked"),
    openReports: n(reports),
    lines: lines.map(entry),
  };
}

// Ideas and recipes are counted from credit spends (one per job); ai_usage
// can hold several lines per job, so it isn't used for counting.
async function peopleSince(db, since) {
  const [activity, spends, posted, commented, total] = await Promise.all([
    db.sql`SELECT kind, count(*)::int AS n FROM activity_log WHERE kind IN ('joined', 'sign_in') AND created_at >= ${since} GROUP BY kind`,
    db.sql`SELECT reason, count(*)::int AS n, coalesce(-sum(change), 0)::int AS credits FROM credit_ledger WHERE change < 0 AND created_at >= ${since} GROUP BY reason`,
    db.sql`SELECT count(*)::int AS n FROM posts WHERE kind = 'recipe' AND created_at >= ${since}`,
    db.sql`SELECT count(*)::int AS n FROM comments WHERE created_at >= ${since}`,
    db.sql`SELECT count(*)::int AS n FROM accounts`,
  ]);
  const kind = (k) => activity.find((r) => r.kind === k)?.n ?? 0;
  const spend = (reason) => spends.find((r) => r.reason === reason)?.n ?? 0;
  return {
    newAccounts: kind("joined"),
    signIns: kind("sign_in"),
    ideas: spend("idea"),
    recipes: spend("recipe"),
    creditsSpent: spends.reduce((sum, r) => sum + Number(r.credits), 0),
    recipesPosted: n(posted),
    comments: n(commented),
    accountsTotal: n(total),
  };
}

async function inboxNow(db) {
  const [count, rows] = await Promise.all([
    db.sql`SELECT count(*)::int AS n FROM messages WHERE status = 'new'`,
    db.sql`SELECT id, created_at, topic, name, body FROM messages WHERE status = 'new' ORDER BY id DESC LIMIT ${LIST}`,
  ]);
  return {
    unread: n(count),
    messages: rows.map((r) => ({
      id: Number(r.id),
      at: new Date(r.created_at).toISOString(),
      topic: r.topic,
      name: r.name,
      firstLine: String(r.body).split("\n")[0].trim().slice(0, 120),
    })),
  };
}

async function moderationNow() {
  const items = await reviewQueue();
  return {
    queue: items.length,
    items: items.slice(0, LIST).map((i) => ({
      id: i.id,
      kind: i.type === "post" ? i.kind ?? "recipe" : "comment",
      status: i.status,
      name: i.type === "post" ? i.name : i.postName,
      author: i.author,
      reports: i.reports,
      note: i.reason,
    })),
  };
}

async function logSince(db, since) {
  const rows = await db.sql`
    SELECT created_at, kind, actor_name, text FROM activity_log
     WHERE created_at >= ${since} ORDER BY id DESC LIMIT ${LOG_LINES}`;
  return rows.map(entry);
}

// Short, countable facts, in a fixed order: health, problems, inbox, queue.
function attentionLines({ health, problems, inbox, moderation }) {
  const lines = [];
  if (!health.database.ok) lines.push("Database unreachable");
  if (!health.googleSignIn) lines.push("Google sign-in not configured");
  if (!health.stripe) lines.push("Stripe key not set");
  if (!health.anthropic) lines.push("Anthropic key not set");
  if (problems) {
    if (problems.failedAiJobs) lines.push(`${plural(problems.failedAiJobs, "AI job")} failed`);
    if (problems.paymentProblems) lines.push(plural(problems.paymentProblems, "payment problem"));
    const posts = problems.heldPosts + problems.blockedPosts;
    if (posts) lines.push(`${plural(posts, "post")} held for review`);
    const comments = problems.heldComments + problems.blockedComments;
    if (comments) lines.push(`${plural(comments, "comment")} held for review`);
    if (problems.openReports) lines.push(plural(problems.openReports, "open report"));
  }
  if (inbox?.unread) lines.push(plural(inbox.unread, "unread message"));
  if (moderation?.queue) lines.push(`${plural(moderation.queue, "item")} in the review queue`);
  return lines;
}

function summarize({ people }, attention) {
  const activity = people
    ? `${plural(people.newAccounts, "new account")}, ${plural(people.ideas, "idea")} and ${plural(people.recipes, "recipe")} written, ${plural(people.recipesPosted, "recipe")} posted.`
    : "Activity unknown: the database is unreachable.";
  const needs = attention.length ? `Needs you: ${attention.join("; ")}.` : "Nothing needs you.";
  return `${activity} ${needs}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/brief.test.js 2>&1 | grep -E "^not ok|^ℹ (pass|fail)|actual|expected" | head -12`
Expected: `fail 0`. If the broken-connection test hangs, `connect()` in `server/db.js` has no connect timeout; add `connectionTimeoutMillis: 3000` to the test's connection via `connect("postgres://nobody:nope@127.0.0.1:1/none?connect_timeout=3")` (port 1 refuses immediately on Linux, so this is unlikely).

- [ ] **Step 5: Commit**

```bash
git add server/brief.js tests/brief.test.js
git commit -m "$(cat <<'EOF'
Morning brief: health, problems, people, inbox, moderation, log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The `stats` server and its token-gated function

**Files:**
- Create: `mcp/stats.js`
- Create: `netlify/functions/mcp-stats.js`
- Test: `tests/mcp-stats.test.js`

**Interfaces:**
- Consumes: `buildBrief()` (Task 4); `serveMcp(request, createServer)` (Task 2).
- Produces: `createStatsServer()`; `tokenMatches(pathname, expected = process.env.STATS_TOKEN)` → boolean; default export `handler(request)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/mcp-stats.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createStatsServer } from "../mcp/stats.js";
import handler, { tokenMatches } from "../netlify/functions/mcp-stats.js";
import { useDatabase } from "../server/db.js";

const TOKEN = "a".repeat(48);

test("tokenMatches accepts only the exact configured token", () => {
  assert.equal(tokenMatches(`/mcp/stats/${TOKEN}`, TOKEN), true);
  assert.equal(tokenMatches(`/mcp/stats/${TOKEN}/`, TOKEN), true, "trailing slash");
  assert.equal(tokenMatches(`/mcp/stats/${"b".repeat(48)}`, TOKEN), false, "wrong token");
  assert.equal(tokenMatches(`/mcp/stats/${TOKEN.slice(1)}`, TOKEN), false, "wrong length");
  assert.equal(tokenMatches("/mcp/stats/", TOKEN), false, "no token segment");
  assert.equal(tokenMatches("/mcp/stats", TOKEN), false, "no token segment, no slash");
  assert.equal(tokenMatches(`/mcp/stats/${TOKEN}/extra`, TOKEN), false, "extra segment");
  assert.equal(tokenMatches(`/mcp/stats/${TOKEN}`, ""), false, "no token configured");
  assert.equal(tokenMatches(`/mcp/stats/${TOKEN}`, undefined), false, "no token configured");
});

test("the stats function is a plain 404 without the right token", async () => {
  delete process.env.STATS_TOKEN;
  for (const path of [`/mcp/stats/${TOKEN}`, "/mcp/stats/", "/mcp/stats/anything"]) {
    const res = await handler(new Request(`https://example.com${path}`, { method: "POST" }));
    assert.equal(res.status, 404, `${path} with no STATS_TOKEN`);
  }
  process.env.STATS_TOKEN = TOKEN;
  const wrong = await handler(new Request("https://example.com/mcp/stats/nope", { method: "POST" }));
  assert.equal(wrong.status, 404);
  const options = await handler(new Request(`https://example.com/mcp/stats/${TOKEN}`, { method: "OPTIONS" }));
  assert.equal(options.status, 204);
  const get = await handler(new Request(`https://example.com/mcp/stats/${TOKEN}`, { method: "GET" }));
  assert.equal(get.status, 405);
});

test("with the token, the stats server lists exactly morning_brief over HTTP", async () => {
  process.env.STATS_TOKEN = TOKEN;
  const client = new Client({ name: "stats-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`https://example.com/mcp/stats/${TOKEN}`), {
    fetch: (url, options) => handler(new Request(url, options)),
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((t) => t.name), ["morning_brief"]);
  } finally {
    await client.close();
  }
});

test("morning_brief answers even with no database, and says so first", async () => {
  delete process.env.DATABASE_URL;
  useDatabase(null);
  const server = createStatsServer();
  const client = new Client({ name: "stats-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const result = await client.callTool({ name: "morning_brief", arguments: {} });
    assert.ok(!result.isError);
    const brief = JSON.parse(result.content[0].text);
    assert.equal(brief.site, "Macro Genie");
    assert.equal(brief.status, "attention");
    assert.equal(brief.attention[0], "Database unreachable");
    assert.equal(brief.sections.people, null);
  } finally {
    await client.close();
    await server.close();
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/mcp-stats.test.js 2>&1 | grep -E "ERR_MODULE|^ℹ (pass|fail)" | head -3`
Expected: `ERR_MODULE_NOT_FOUND` for `../mcp/stats.js`.

- [ ] **Step 3: Write the server and the function**

Create `mcp/stats.js`:

```js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildBrief } from "../server/brief.js";

// The private "stats" server: one tool, the morning brief. Every one of
// Frosty's sites exposes a server with this name and tool so one Claude
// session can read them all the same way. Served only at a secret URL.
export function createStatsServer() {
  const server = new McpServer({ name: "stats", version: "1.0.0" });
  server.registerTool(
    "morning_brief",
    {
      description:
        "What happened on this site in the last 24 hours and anything that needs a person: health, problems, people and usage, inbox, moderation queue, and the activity log. Call it once for the morning brief.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(await buildBrief()) }],
    }),
  );
  return server;
}
```

Create `netlify/functions/mcp-stats.js`:

```js
import { timingSafeEqual } from "node:crypto";
import { createStatsServer } from "../../mcp/stats.js";
import { serveMcp } from "../../mcp/http.js";

export const config = { path: "/mcp/stats/*" };

// The secret is the last path segment: /mcp/stats/<token>. Anything else,
// or no STATS_TOKEN configured, is a plain 404 that gives nothing away.
export function tokenMatches(pathname, expected = process.env.STATS_TOKEN) {
  if (!expected) return false;
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "mcp" || parts[1] !== "stats") return false;
  const given = Buffer.from(parts[2]);
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

export default function handler(request) {
  if (!tokenMatches(new URL(request.url).pathname))
    return new Response("Not Found", { status: 404 });
  return serveMcp(request, createStatsServer);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/mcp-stats.test.js 2>&1 | grep -E "^not ok|^ℹ (pass|fail)|actual|expected" | head -8`
Expected: `fail 0`, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add mcp/stats.js netlify/functions/mcp-stats.js tests/mcp-stats.test.js
git commit -m "$(cat <<'EOF'
Private stats MCP server at /mcp/stats/<token> with the morning brief

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Help copy, env note, full suite

**Files:**
- Modify: `src/help/mcp.js` (the `intro` string and the `outro` string)
- Modify: `.env.example` if it exists (add `STATS_TOKEN=`); otherwise skip
- Test: `tests/help.test.js` (existing; must stay green), full `npm test`

- [ ] **Step 1: Update the help copy**

In `src/help/mcp.js`, change the `intro` sentence "Your AI can search 8,490 USDA foods, look up any food in detail, and size recipes to your targets." to:

"Your AI can search 8,490 USDA foods, look up any food in detail, size recipes to your targets, and find and read recipes people have shared in the Community."

Change the `outro` to:

```js
  outro:
    "The six tools your AI gets: **search foods** by nutrition ranges and name, **food details** for one food, **food categories**, **size a recipe**, **search the Community** by words, meal and macros, and **read a Community recipe** in full.",
```

- [ ] **Step 2: Add the env var note**

Run: `ls .env.example 2>/dev/null`. If it exists, append:

```
# Private stats MCP server: /mcp/stats/<STATS_TOKEN>. Leave unset to disable.
STATS_TOKEN=
```

- [ ] **Step 3: Full suite and build**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"; npm run build 2>&1 | grep -iE "error|built in"`
Expected: `fail 0`; `✓ built in …`.

- [ ] **Step 4: Commit**

```bash
git add src/help/mcp.js
[ -f .env.example ] && git add .env.example
git commit -m "$(cat <<'EOF'
Help: the MCP guide mentions Community search

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

## For Frosty after deploy

1. `openssl rand -hex 24` → set `STATS_TOKEN` to that value in Netlify's environment variables, then redeploy (functions read env at start).
2. Add a connector named "Macro Genie stats" with the URL `https://macro-genie.com/mcp/stats/<token>`. Ask Claude for the morning brief; it should call `morning_brief` and read back `attention` and `summary`.
3. Check `https://macro-genie.com/mcp/stats/wrong` returns 404.
4. In a Claude chat with the public connector, ask for "a high-protein community dessert" and confirm it uses `search_community` then `get_community_recipe`.
