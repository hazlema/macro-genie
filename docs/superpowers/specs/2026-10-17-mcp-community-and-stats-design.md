# MCP community search and the stats server — design

Date: 2026-10-17

## Goal

Two additions to Macro Genie's MCP surface:

1. **Community search** on the existing public server (`macro-genie`): AI assistants can find community recipes by words, meal and per-serving macros, and fetch one in full.
2. A private **stats** server at a secret URL with one tool, **`morning_brief`**, that reports the site's health and problems, people and usage, inbox and moderation queue for the last 24 hours. The server name, tool name and envelope are a standard Frosty will reuse on every site, so one Claude session can call `morning_brief` on each connector and read them all the same way.

Money (sales, AI spend, margins) is deliberately not in the brief.

## Part 1: community search (public server)

Two new tools in `mcp/server.js`, alongside the four food tools. Same `reply`/`annotations` helpers, same error style (`{ error }` with `isError: true`).

### `search_community`

Input:
- `query` — string ≤ 100, optional. Space-separated words; every word must appear (case-insensitive, substring) in the recipe's name or description.
- `meal` — `"all" | "breakfast" | "lunch" | "dinner" | "snack" | "dessert"` (the `MEAL_TYPES` list from `server/moderate.js`), default `"all"`.
- `ranges` — per-serving `{ calories | protein | netCarbs | fat | sugar | sodium: { min?, max? } }`, the keys `COLUMNS` in `server/community.js` accepts. Same `rangesInput` shape as `search_foods`, limited to those six.
- `sort` — `"new" | "liked"`, default `"new"`.
- `limit` — integer 1–20, default 10. `offset` — integer ≥ 0, default 0.

Output: `{ basis: "per serving", units, total: null, offset, limit, more, recipes: [...] }` where each recipe is `{ id, name, meal, author, postedAt, likes, comments, description, perServing: { calories, protein, netCarbs, fat, sugar, sodium }, url }` and `url` is `https://macro-genie.com/community/<id>`. Only `live` recipe posts; forum threads are never returned. `total` is null because `listPosts` pages with a "more" flag rather than counting.

### `get_community_recipe`

Input: `id` — positive integer.

Output: `{ id, name, meal, author, postedAt, likes, comments, description, servings, ingredients: [{ name, grams, note? }], method: [steps], seasonings, perServing, url }` — the recipe JSON the site stores on the post (`p.recipe`, as `normalizeRecipe` shapes it), plus the post fields. Live posts only; a held, blocked, removed or unknown id returns `{ error: "That recipe isn't in the community." }` with `isError: true`.

### `listPosts` change

`server/community.js` `listPosts` gains `query` (string, optional). It is split on whitespace, each word trimmed and lower-cased, empty words dropped, at most 8 words; for each word a `WHERE` clause `(p.name ILIKE $n OR coalesce(p.recipe->>'description','') ILIKE $n)` with `%word%` (with `%`, `_` and `\` escaped). No change to the site's own calls.

### Database availability

The public server's food tools stay database-free. The two community tools call `database()`; when `DATABASE_URL` is missing (the local stdio server, `mcp/stdio.js`) they return `{ error: "Community search isn't available on this server." }` with `isError: true` instead of throwing.

### Help

`src/help/mcp.js` intro and the tool list mention community search ("find and read recipes people have shared"). The stats server is not documented anywhere public.

## Part 2: the stats server

### URL and gate

- Netlify function `netlify/functions/mcp-stats.js` with `config.path = "/mcp/stats/*"`.
- The last path segment is the token. It must equal the `STATS_TOKEN` environment variable, compared with `crypto.timingSafeEqual` on equal-length buffers. If `STATS_TOKEN` is unset or empty, or the token does not match, the response is `404 Not Found` with no body hint about the server's existence. OPTIONS gets 204, non-POST gets 405, exactly like `/mcp`.
- The transport code now in `netlify/functions/mcp.js` (CORS headers, fresh server + `WebStandardStreamableHTTPServerTransport` per request, header merging, `server.close()` in `finally`) moves to `mcp/http.js` as `serveMcp(request, createServer)`; both functions call it.
- Frosty generates the token once (`openssl rand -hex 24`), sets `STATS_TOKEN` in Netlify, and adds `https://macro-genie.com/mcp/stats/<token>` as a connector named "Macro Genie stats". Rotating the token means changing the env var and the connector URL.

### The server

`mcp/stats.js` exports `createStatsServer()`: `new McpServer({ name: "stats", version: "1.0.0" })` with one tool, **`morning_brief`**, no input, read-only annotations. Description: "What happened on this site in the last 24 hours and anything that needs a person: health, problems, people and usage, inbox, moderation queue, and the activity log. Call it once for the morning brief." It returns `reply(await buildBrief())`.

### The envelope (the cross-site standard)

> Superseded on the same day: the envelope became `{ site, url, generatedAt, period, status, attention, notable, summary, metrics, details }` with daily counts as `{ yesterday, avg7 }`, levels as `{ value }`, server-computed `notable` lines, money included, and the tool renamed `get_stats`. The living contract is `docs/stats-mcp.md`.

```json
{
  "site": "Macro Genie",
  "url": "https://macro-genie.com",
  "generatedAt": "2026-10-18T13:02:11.000Z",
  "since": "2026-10-17T13:02:11.000Z",
  "status": "ok" | "attention",
  "attention": ["2 unread messages", "1 post held for review", "3 AI jobs failed"],
  "summary": "Quiet day: 4 new accounts, 31 ideas and 9 recipes. 2 contact messages are waiting and 1 post needs review.",
  "sections": { ... }
}
```

- `status` is `"attention"` when `attention` is non-empty, else `"ok"`.
- `attention` lines are short, plain, countable facts, in this order: health failures, problems (failed AI jobs, payment problems, held/blocked posts or comments, open reports), unread messages, review queue. Nothing else goes in.
- `summary` is one or two sentences built from the numbers (no AI call): activity first, then what needs a person, or "Nothing needs you." when `attention` is empty.
- `sections` is site-specific. Other sites keep `site`, `url`, `generatedAt`, `since`, `status`, `attention`, `summary` identical in shape.

### Macro Genie's sections

All counts are for `[since, generatedAt)` where `since` is exactly 24 hours before `generatedAt`, except where noted.

- **health**: `{ database: { ok, ms }, googleSignIn: boolean, stripe: boolean, anthropic: boolean }`. `database` runs `SELECT 1` and times it; the others are whether `GOOGLE_CLIENT_ID`, `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY` are set. Any `false`/`ok: false` adds an attention line ("Database unreachable", "Stripe key not set", …).
- **problems**: `{ failedAiJobs, paymentProblems, heldPosts, blockedPosts, heldComments, blockedComments, openReports, lines: [...] }`. `failedAiJobs` counts `credit_ledger` rows with `reason LIKE 'refund:%'` in the window. `paymentProblems` counts `activity_log` rows of kind `payment_problem` in the window. The post/comment counts are current status counts (not windowed). `openReports` counts `reports` rows whose target is still live. `lines` are the `activity_log` entries of the `problems` chip in the window, as `{ at, kind, name, text }`.
- **people**: `{ newAccounts, signIns, ideas, recipes, creditsSpent, recipesPosted, comments, accountsTotal }`. `newAccounts`/`signIns` from `activity_log` kinds `joined`/`sign_in`; `ideas`/`recipes` from `ai_usage` rows with `step` `idea`/`recipe`; `creditsSpent` is the sum of negative `credit_ledger.change` in the window, as a positive number; `recipesPosted` and `comments` count `posts` (kind `recipe`) and `comments` created in the window regardless of status; `accountsTotal` is `count(*)` of `accounts`.
- **inbox**: `{ unread, messages: [{ id, at, topic, name, firstLine }] }` — `messages` with `status = 'new'`, newest first, at most 20; `firstLine` is the body's first line trimmed to 120 characters.
- **moderation**: `{ queue, items: [{ id, kind, status, name, author, reports, note }] }` from `reviewQueue()` in `server/admin.js` (which takes no actor), at most 20 items.
- **log**: the `activity_log` entries of all kinds in the window, newest first, at most 50, as `{ at, kind, name, text }`.

### `server/brief.js`

`export async function buildBrief(now = new Date())` returns the envelope. It uses `database()` from `server/db.js`, `listActivity`/`CHIPS` from `server/activity.js` where they fit (window filtering is done in `brief.js` on the returned entries, which is enough at the 50-entry cap; the problems count uses its own `count(*)` query so it is exact), `reviewQueue` from `server/admin.js`, and `process.env` for the key checks. If the database check fails, the other database-backed sections are skipped and reported as `null`, `health.database.ok` is false, and the brief still returns (status `attention`); the tool never throws.

## Testing

- `tests/community.test.js` (existing NetlifyDB harness): `listPosts({ query })` matches on name and description, needs every word, is case-insensitive, ignores a query of only spaces, and escapes `%`.
- `tests/mcp.test.js`: the tool list now includes `search_community` and `get_community_recipe`; without a database both return `isError` with the availability message; with the test database, a seeded live recipe is found by word and macro range and returned in full by id, and a held post is neither listed nor fetchable.
- `tests/brief.test.js`: with the test database seeded (one new account, one failed-job refund, one unread message, one held post), `buildBrief` reports those counts, `status: "attention"` and the matching `attention` lines in order; with nothing seeded, `status: "ok"`, `attention: []`, `summary` says nothing needs you; with `useDatabase` pointed at a broken connection, `health.database.ok` is false and the call still resolves.
- `tests/mcp-stats.test.js`: `createStatsServer` lists exactly `morning_brief`; the HTTP handler returns 404 for a wrong token, for a missing token segment, and for any token when `STATS_TOKEN` is unset; with the right token an `initialize`/`tools/list` round-trip through `StreamableHTTPClientTransport` lists `morning_brief` (same technique `mcp.test.js` uses for `/mcp`).

## Out of scope

Money and costs; Netlify deploy or function-error feeds; write tools; per-site customisation of the envelope beyond `sections`; a plain JSON endpoint (easy later: it is one function call).
