import { database } from "./db.js";
import { CHIPS } from "./activity.js";
import { reviewQueue } from "./admin.js";
import { PACKS } from "./packs.js";
import { notableLines, plural } from "./notable.js";

// The site's stats for the morning brief: yesterday against the trailing
// week, what's notable, and what needs a person. The envelope (site, url,
// generatedAt, period, status, attention, notable, summary, metrics,
// details) is the same on every one of Frosty's sites, documented in
// docs/stats-mcp.md; the metric names and `details` are this site's own.
export const SITE = { name: "Macro Genie", url: "https://macro-genie.com" };
const DAY = 86_400_000;
const WEEK = 7;
const LOG_LINES = 50;
const LIST = 20;

// Daily counts (yesterday + trailing 7-day average) and levels (a reading
// right now), in the order they appear in `metrics`.
const DAILY = [
  "newAccounts", "signIns", "ideas", "recipes", "failedAiJobs", "creditsSpent",
  "recipesPosted", "comments", "messages", "packsSold", "revenue", "aiCost",
];
const MONEY = new Set(["revenue", "aiCost"]);
const money = (n) => `$${n.toFixed(2)}`;
// Labels for the notable lines. Metrics without one aren't called out:
// credits spent repeats ideas and recipes, failed jobs go in `attention`.
const LABELS = {
  newAccounts: { count: (n) => plural(n, "new account"), none: "no new accounts" },
  signIns: { count: (n) => plural(n, "sign-in"), none: "no sign-ins" },
  ideas: { count: (n) => plural(n, "idea"), none: "no ideas" },
  recipes: { count: (n) => plural(n, "recipe written", "recipes written"), none: "no recipes written" },
  recipesPosted: { count: (n) => plural(n, "recipe posted", "recipes posted"), none: "no recipes posted" },
  comments: { count: (n) => plural(n, "comment"), none: "no comments" },
  messages: { count: (n) => plural(n, "contact message"), none: "no contact messages" },
  packsSold: { count: (n) => plural(n, "pack sold", "packs sold"), none: "no packs sold" },
  revenue: { count: (n) => `${money(n)} in packs`, none: "no pack sales" },
  aiCost: { count: (n) => `${money(n)} of AI spend`, none: "no AI spend" },
};

const n = (rows) => Number(rows[0]?.n ?? 0);
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;
const entry = (r) => ({
  at: new Date(r.created_at).toISOString(),
  kind: r.kind,
  name: r.actor_name,
  text: r.text,
});

export async function buildBrief(now = new Date()) {
  const until = now;
  const since = new Date(now.getTime() - DAY);
  const weekAgo = new Date(now.getTime() - WEEK * DAY);
  const health = await checkHealth();
  const parts = { counts: null, levels: null, problems: null, inbox: null, moderation: null, log: null };
  // A part that fails is reported and left out; the rest still goes out.
  const failed = [];
  if (health.database.ok) {
    const db = database();
    const work = {
      counts: dailyCounts(db, weekAgo, until),
      levels: levelsNow(db),
      problems: problemLines(db, since),
      inbox: inboxNow(db),
      moderation: moderationNow(),
      log: logSince(db, since),
    };
    const names = Object.keys(work);
    const results = await Promise.allSettled(Object.values(work));
    results.forEach((result, i) => {
      if (result.status === "fulfilled") parts[names[i]] = result.value;
      else failed.push(names[i]);
    });
  }
  const metrics = health.database.ok ? metricsFrom(parts) : null;
  const attention = attentionLines(health, parts, failed);
  const notable = parts.counts ? notableLines(parts.counts, LABELS) : [];
  return {
    site: SITE.name,
    url: SITE.url,
    generatedAt: now.toISOString(),
    period: { since: since.toISOString(), until: until.toISOString(), days: 1 },
    status: attention.length ? "attention" : "ok",
    attention,
    notable,
    summary: summarize(health, parts, attention),
    metrics,
    details: {
      health,
      problems: parts.problems,
      inbox: parts.inbox,
      moderation: parts.moderation?.items ?? null,
      log: parts.log,
    },
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
    // The same rule as server/chef.js: under npm run dev the local key is used.
    anthropic: !!(process.env.MACRO_GENIE_LOCAL
      ? process.env.MACRO_GENIE_LOCAL_KEY
      : process.env.ANTHROPIC_API_KEY),
  };
}

// Seven daily buckets per metric, index 0 = the 24 hours before `until`.
// Ideas and recipes are counted from credit spends (one per job); ai_usage
// can hold several lines per job, so it's only used for cost.
async function dailyCounts(db, weekAgo, until) {
  const series = Object.fromEntries([...DAILY, "paymentProblems"].map((k) => [k, Array(WEEK).fill(0)]));
  const add = (name, day, amount) => {
    if (day >= 0 && day < WEEK) series[name][day] += amount;
  };
  const [activity, ledger, posts, comments, usage] = await Promise.all([
    db.sql`
      SELECT kind, floor(extract(epoch from (${until}::timestamptz - created_at)) / 86400)::int AS day, count(*)::int AS n
        FROM activity_log
       WHERE kind IN ('joined', 'sign_in', 'message', 'payment_problem') AND created_at >= ${weekAgo} AND created_at < ${until}
       GROUP BY kind, day`,
    db.sql`
      SELECT reason, change, floor(extract(epoch from (${until}::timestamptz - created_at)) / 86400)::int AS day, count(*)::int AS n
        FROM credit_ledger
       WHERE created_at >= ${weekAgo} AND created_at < ${until}
       GROUP BY reason, change, day`,
    db.sql`
      SELECT floor(extract(epoch from (${until}::timestamptz - created_at)) / 86400)::int AS day, count(*)::int AS n
        FROM posts WHERE kind = 'recipe' AND created_at >= ${weekAgo} AND created_at < ${until} GROUP BY day`,
    db.sql`
      SELECT floor(extract(epoch from (${until}::timestamptz - created_at)) / 86400)::int AS day, count(*)::int AS n
        FROM comments WHERE created_at >= ${weekAgo} AND created_at < ${until} GROUP BY day`,
    db.sql`
      SELECT floor(extract(epoch from (${until}::timestamptz - created_at)) / 86400)::int AS day, sum(cost_usd)::float AS n
        FROM ai_usage WHERE created_at >= ${weekAgo} AND created_at < ${until} GROUP BY day`,
  ]);
  const KIND = { joined: "newAccounts", sign_in: "signIns", message: "messages", payment_problem: "paymentProblems" };
  for (const r of activity) add(KIND[r.kind], r.day, r.n);
  for (const r of ledger) {
    const change = Number(r.change);
    if (r.reason === "idea" && change < 0) add("ideas", r.day, r.n);
    if (r.reason === "recipe" && change < 0) add("recipes", r.day, r.n);
    if (r.reason.startsWith("refund:")) add("failedAiJobs", r.day, r.n);
    if (change < 0) add("creditsSpent", r.day, -change * r.n);
    if (r.reason === "purchase") {
      add("packsSold", r.day, r.n);
      const pack = PACKS.find((p) => p.credits === change);
      if (pack) add("revenue", r.day, (pack.cents / 100) * r.n);
    }
  }
  for (const r of posts) add("recipesPosted", r.day, r.n);
  for (const r of comments) add("comments", r.day, r.n);
  for (const r of usage) add("aiCost", r.day, Number(r.n));
  return series;
}

async function levelsNow(db) {
  const [accounts, unread, posts, comments, reports] = await Promise.all([
    db.sql`SELECT count(*)::int AS n FROM accounts`,
    db.sql`SELECT count(*)::int AS n FROM messages WHERE status = 'new'`,
    db.sql`SELECT count(*)::int AS n FROM posts WHERE status IN ('held', 'blocked')`,
    db.sql`SELECT count(*)::int AS n FROM comments WHERE status IN ('held', 'blocked')`,
    db.sql`
      SELECT count(*)::int AS n FROM reports r
       WHERE (r.target_type = 'post' AND EXISTS (SELECT 1 FROM posts p WHERE p.id = r.target_id AND p.status = 'live'))
          OR (r.target_type = 'comment' AND EXISTS (SELECT 1 FROM comments c WHERE c.id = r.target_id AND c.status = 'live'))`,
  ]);
  return {
    accountsTotal: n(accounts),
    unreadMessages: n(unread),
    heldPosts: n(posts),
    heldComments: n(comments),
    openReports: n(reports),
  };
}

async function problemLines(db, since) {
  const rows = await db.sql`
    SELECT created_at, kind, actor_name, text FROM activity_log
     WHERE kind = ANY(${CHIPS.problems}::text[]) AND created_at >= ${since}
     ORDER BY id DESC LIMIT ${LOG_LINES}`;
  return rows.map(entry);
}

async function inboxNow(db) {
  const rows = await db.sql`
    SELECT id, created_at, topic, name, body FROM messages
     WHERE status = 'new' ORDER BY id DESC LIMIT ${LIST}`;
  return rows.map((r) => ({
    id: Number(r.id),
    at: new Date(r.created_at).toISOString(),
    topic: r.topic,
    name: r.name,
    firstLine: String(r.body).split("\n")[0].trim().slice(0, 120),
  }));
}

async function moderationNow() {
  const items = await reviewQueue();
  return {
    queue: items.length,
    items: items.slice(0, LIST).map((i) => ({
      id: i.id,
      kind: i.type === "post" ? (i.kind ?? "recipe") : "comment",
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

// Daily metrics as { yesterday, avg7 [, unit] }, levels as { value }.
function metricsFrom({ counts, levels, moderation }) {
  const metrics = {};
  if (counts)
    for (const name of DAILY) {
      const days = counts[name];
      const total = days.reduce((a, b) => a + b, 0);
      metrics[name] = { yesterday: round2(days[0]), avg7: round1(total / WEEK) };
      if (MONEY.has(name)) metrics[name].unit = "USD";
    }
  if (levels) {
    metrics.accountsTotal = { value: levels.accountsTotal };
    metrics.unreadMessages = { value: levels.unreadMessages };
  }
  if (moderation) metrics.reviewQueue = { value: moderation.queue };
  if (levels) {
    metrics.heldPosts = { value: levels.heldPosts };
    metrics.openReports = { value: levels.openReports };
  }
  return metrics;
}

// Short, countable facts, in a fixed order: health, failed parts, problems,
// inbox, queue.
function attentionLines(health, { counts, levels, moderation }, failed) {
  const lines = [];
  if (!health.database.ok) lines.push("Database unreachable");
  if (!health.googleSignIn) lines.push("Google sign-in not configured");
  if (!health.stripe) lines.push("Stripe key not set");
  if (!health.anthropic) lines.push("Anthropic key not set");
  for (const name of failed) lines.push(`Brief section ${name} failed`);
  if (counts) {
    if (counts.failedAiJobs[0]) lines.push(`${plural(counts.failedAiJobs[0], "AI job")} failed`);
    if (counts.paymentProblems[0]) lines.push(plural(counts.paymentProblems[0], "payment problem"));
  }
  if (levels) {
    if (levels.heldPosts) lines.push(`${plural(levels.heldPosts, "post")} held for review`);
    if (levels.heldComments) lines.push(`${plural(levels.heldComments, "comment")} held for review`);
    if (levels.openReports) lines.push(plural(levels.openReports, "open report"));
    if (levels.unreadMessages) lines.push(plural(levels.unreadMessages, "unread message"));
  }
  if (moderation?.queue) lines.push(`${plural(moderation.queue, "item")} in the review queue`);
  return lines;
}

function summarize(health, { counts }, attention) {
  const activity = !health.database.ok
    ? "Activity unknown: the database is unreachable."
    : !counts
      ? "Activity counts unavailable."
      : `${plural(counts.newAccounts[0], "new account")}, ${plural(counts.ideas[0], "idea")} and ${plural(counts.recipes[0], "recipe")} written, ${plural(counts.recipesPosted[0], "recipe")} posted, ${money(counts.revenue[0])} in packs.`;
  const needs = attention.length ? `Needs you: ${attention.join("; ")}.` : "Nothing needs you.";
  return `${activity} ${needs}`;
}
