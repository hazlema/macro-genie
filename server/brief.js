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
