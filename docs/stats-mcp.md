# The `stats` MCP server

One private MCP server per site, same name, same tool, same envelope, so a
single Claude session can ask every site "what happened yesterday?" and read
the answers the same way. Each site fills in its own numbers; the brief code
never needs to know which site it is talking to.

This file is the contract. Copy it to each site that implements it.

## Where it lives

- URL: `https://[site]/mcp/stats/[token]` (Streamable HTTP, POST).
- The token is the whole secret. It is a long random string set in the site's
  environment as `STATS_TOKEN`; generate one with `openssl rand -hex 24`.
- Anything but the exact token, or no `STATS_TOKEN` configured at all, is a
  plain `404 Not Found` with no hint that the server exists. Compare with a
  constant-time function on equal-length buffers.
- The public MCP server (if the site has one) never lists this tool.
- Add it to Claude as a connector named "[site name]: Morning Brief". Connector names tell
  sites apart; the server and tool names are the same everywhere.

Rotating the token means changing the env var and the connector URL.

## The server and the tool

- MCP server name `stats`, version `1.0.0`.
- Exactly one tool, **`get_stats`**, with no arguments, read-only.
- It returns one JSON document (as the tool's text content): the envelope below.
- It never throws. If the database is down, it says so in `attention` and
  returns what it can. If one part of the report fails, that part is `null`
  and `attention` names it ("Brief section inbox failed").

## The envelope

Every site returns these ten keys, in this order, and nothing else at the top level:

```json
{
  "site": "Macro Genie",
  "url": "https://macro-genie.com",
  "generatedAt": "2026-10-18T13:00:00.000Z",
  "period": { "since": "2026-10-17T13:00:00.000Z", "until": "2026-10-18T13:00:00.000Z", "days": 1 },
  "status": "attention",
  "attention": ["1 unread message", "1 item in the review queue"],
  "notable": ["3 contact messages yesterday, first in a week"],
  "summary": "12 new accounts, 31 ideas and 9 recipes written, 2 recipes posted, $6.00 in packs. Needs you: 1 unread message; 1 item in the review queue.",
  "metrics": { "...": "see below" },
  "details": { "...": "site-specific" }
}
```

| Key | Type | Meaning |
|---|---|---|
| `site` | string | Display name. |
| `url` | string | The site's home page. |
| `generatedAt` | ISO 8601 | When this document was built. |
| `period` | object | The window "yesterday" means: `since` and `until` (ISO), `days` (always 1 today). It is the 24 hours before `generatedAt`, not a calendar day, so it works at any hour. |
| `status` | `"ok"` or `"attention"` | `"attention"` exactly when `attention` is non-empty. |
| `attention` | string[] | Things that need a person today. Short, countable, plain: "2 unread messages". Order: health failures, failed report parts, problems, inbox, queues. Empty on a good day. |
| `notable` | string[] | Observations worth a sentence, computed by the site from its own 7-day history (rules below). Empty on a boring day, so the brief's section quietly shrinks. |
| `summary` | string | One or two sentences the site writes from its numbers. A brief can quote this and nothing else. |
| `metrics` | object or `null` | The numbers (below). `null` only when the database is unreachable. |
| `details` | object | Site-specific lists behind the numbers: inbox lines, queue items, log entries, health checks. A brief may ignore it. Parts that failed are `null`. |

### `metrics`

A flat object. Keys are the site's own, in camelCase. A site tracks as many
or as few as it has; an identity site might return two, Macro Genie returns
seventeen. Every value is one of two shapes:

- **Daily count** `{ "yesterday": 12, "avg7": 9.1 }`
  — the count in `period`, and the trailing seven days (including yesterday)
  divided by 7, one decimal. This is the shape that makes "847 visits" into
  "12 yesterday, usually 9".
- **Level** `{ "value": 231 }` — a reading right now (a total, a queue length).
  No history.

Either shape may add `"unit": "USD"` for money (then the numbers are dollars,
two decimals). Counts have no unit.

Suggested names where they apply, so briefs can line sites up: `visits`,
`newAccounts`, `signIns`, `messages`, `revenue`, `accountsTotal`,
`unreadMessages`. Don't force them; a site reports what it has.

### `notable`: the four rules

Each daily metric has seven buckets, index 0 = yesterday. Apply the rules in
this order and keep the first that fits, one line per metric, metrics in the
order they appear in `metrics`:

1. **First in a week** — yesterday > 0 and the six earlier days are all 0.
   "3 contact messages yesterday, first in a week"
2. **Well above the week's average** — yesterday ≥ 5 and ≥ 2 × avg7.
   "10 contact messages yesterday, well above the week's average of 3.1"
3. **The most in a week** — yesterday ≥ 3 and more than every earlier day.
   "5 sign-ins yesterday, the most in a week"
4. **None, after six days with some** — yesterday = 0 and the six earlier
   days are all > 0. "no sign-ins yesterday, after six days with some"

Each metric that can be notable has a label: `count(n)` ("3 contact
messages", "$6.00 in packs") and `none` ("no contact messages", "no pack
sales"). Metrics that duplicate others or already appear in `attention` don't
get a label and are never called out.

The thresholds (5, 3, 2×) keep tiny sites from calling out noise. On a brand
new site everything is "first in a week" for a day; that's correct.

### `attention` conventions

- Health first: "Database unreachable", "[Service] key not set".
- Then failed report parts: "Brief section inbox failed".
- Then problems: failures, errors, held or blocked things, open reports.
- Then what's waiting on a person: "2 unread messages", "1 item in the review queue".
- Never money, never routine counts.

## A minimal site

An identity site with two things to report:

```json
{
  "site": "Frosty Ventures",
  "url": "https://frosty-ventures-llc.com",
  "generatedAt": "2026-10-18T13:00:00.000Z",
  "period": { "since": "2026-10-17T13:00:00.000Z", "until": "2026-10-18T13:00:00.000Z", "days": 1 },
  "status": "ok",
  "attention": [],
  "notable": ["3 email reveals yesterday, first in a week"],
  "summary": "41 visits and 3 email reveals. Nothing needs you.",
  "metrics": {
    "visits": { "yesterday": 41, "avg7": 36.4 },
    "emailReveals": { "yesterday": 3, "avg7": 0.4 }
  },
  "details": {
    "health": { "database": { "ok": true, "ms": 12 } }
  }
}
```

## Macro Genie

Daily: `newAccounts`, `signIns`, `ideas`, `recipes`, `failedAiJobs`,
`creditsSpent`, `recipesPosted`, `comments`, `messages`, `packsSold`,
`revenue` (USD), `aiCost` (USD).
Levels: `accountsTotal`, `unreadMessages`, `reviewQueue`, `heldPosts`, `openReports`.
Details: `health` (database round-trip, Google sign-in, Stripe and Anthropic
keys present), `problems` (the day's problem log lines), `inbox` (unread
contact messages: topic, name, first line), `moderation` (review-queue
items), `log` (the day's activity log, up to 50 lines).

Code: `server/brief.js` (the numbers), `server/notable.js` (the four rules,
reusable as-is), `mcp/stats.js` (the server), `netlify/functions/mcp-stats.js`
(the token gate). Tests: `tests/brief.test.js`, `tests/notable.test.js`,
`tests/mcp-stats.test.js`.

## Adding it to another site

1. Pick the metrics: which daily counts, which levels, which have money units.
2. Build the seven daily buckets with one grouped query per source
   (`floor((until - created_at) / 1 day)` as the bucket index, 0–6).
3. Compute `metrics`, `attention`, `notable` (copy `server/notable.js` and
   write labels), `summary`, `details`. Catch every failure: the tool never throws.
4. Serve it as MCP server `stats`, tool `get_stats`, at `/mcp/stats/[token]`
   with the 404 rule above.
5. Set `STATS_TOKEN`, deploy, add the connector, ask Claude for the morning brief.
6. Check `/mcp/stats/wrong` is a bare 404.
7. Not all sites share the same information (ex. some don't have money)
8. All requests to the url must be POST

