import { database } from "./db.js";
import { listCosts, shareOf } from "./costs.js";
import { requireAdmin } from "./roles.js";
import { stripe } from "./stripe.js";

// The admin Money tab: what came in (credit packs) and what went out
// (Stripe fees, refunds, AI, fixed bills), per UTC calendar month. The
// current month is worked out live; finished months are saved once.

const SAVED_MONTHS = 12;
// Costs are tracked from launch; nothing earlier is ever saved.
const HISTORY_START = "2026-10";
const BACKFILL_PER_REQUEST = 3;
const DAY = 86_400_000;
const STEPS = ["idea", "recipe", "moderation"];

export const monthKey = (date) => date.toISOString().slice(0, 7);

export function monthBounds(key) {
  const [y, m] = key.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

export const previousMonth = (key) =>
  monthKey(new Date(monthBounds(key).start.getTime() - 1));

let fetcher = (...args) => fetch(...args);
export function useFetch(fn) {
  fetcher = fn;
}

const round2 = (n) => Math.round(n * 100) / 100;

// Netlify's credit prices (April 2026) and what a credit costs this site
// ($5 for 500 in the owner's top-up). Functions run with 1 GB.
const CREDITS_PER_GB_HOUR = 10;
const CREDITS_PER_10K_REQUESTS = 2;
const CENTS_PER_CREDIT = 1;

// Our credit pack charges and refunds in the month. Other things sold on
// the same Stripe account have no pack metadata and are skipped.
async function stripeMonth({ start, end }) {
  const out = { sales: { cents: 0, count: 0, packs: {} }, feeCents: 0, refundCents: 0 };
  const list = stripe().balanceTransactions.list({
    created: { gte: start.getTime() / 1000, lt: end.getTime() / 1000 },
    limit: 100,
    expand: ["data.source.payment_intent"],
  }, { timeout: 10_000, maxNetworkRetries: 0 }); // a stuck page must not hold the tab for ~45 s
  for await (const t of list) {
    const meta = t.source?.payment_intent?.metadata;
    if (!meta?.accountId || !meta?.credits) continue;
    if (t.type === "charge" || t.type === "payment") {
      out.sales.cents += t.amount;
      out.sales.count += 1;
      out.sales.packs[meta.pack] = (out.sales.packs[meta.pack] ?? 0) + 1;
    } else if (t.type === "refund" || t.type === "payment_refund") {
      out.refundCents += -t.amount;
    } else continue;
    out.feeCents += t.fee;
  }
  return out;
}

// Anthropic's own cost report (needs an Admin API key). Amounts are
// cents as decimal strings, in daily buckets.
async function anthropicMonth({ start, end }, now) {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) return { status: "no_key", cents: null };
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const until = end < tomorrow ? end : tomorrow;
  let cents = 0;
  let page = null;
  do {
    const url = new URL("https://api.anthropic.com/v1/organizations/cost_report");
    url.searchParams.set("starting_at", start.toISOString());
    url.searchParams.set("ending_at", until.toISOString());
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit", "31");
    if (page) url.searchParams.set("page", page);
    const res = await fetcher(url, {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`cost_report ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    for (const bucket of body.data ?? [])
      for (const r of bucket.results ?? []) cents += Number(r.amount) || 0;
    page = body.has_more ? body.next_page : null;
  } while (page);
  return { status: "ok", cents: Math.round(cents) };
}

// The app's own estimate from ai_usage, and credits spent by pool. Jobs
// whose ledger row is gone (deleted account) or predates paid credits
// count as free.
async function aiMonth({ start, end }) {
  const db = database();
  const jobs = await db.sql`
    SELECT u.step, COALESCE(l.paid, false) AS paid,
           count(*)::int AS jobs, COALESCE(sum(u.cost_usd), 0)::float AS usd
      FROM ai_usage u LEFT JOIN credit_ledger l ON l.id = u.ledger_id
     WHERE u.created_at >= ${start.toISOString()} AND u.created_at < ${end.toISOString()}
     GROUP BY 1, 2`;
  const spent = await db.sql`
    SELECT COALESCE(paid, false) AS paid, COALESCE(sum(-change), 0)::int AS credits
      FROM credit_ledger
     WHERE created_at >= ${start.toISOString()} AND created_at < ${end.toISOString()}
       AND created_at >= (SELECT min(created_at) FROM ai_usage)
       AND reason IN ('idea', 'recipe', 'refund:idea', 'refund:recipe')
     GROUP BY 1`;
  const sold = await db.sql`
    SELECT COALESCE(sum(change), 0)::int AS credits FROM credit_ledger
     WHERE created_at >= ${start.toISOString()} AND created_at < ${end.toISOString()}
       AND reason IN ('purchase', 'refund_purchase')`;
  const byStep = Object.fromEntries(STEPS.map((s) => [s, { jobs: 0, usd: 0 }]));
  const pool = { free: { credits: 0, usd: 0 }, paid: { credits: 0, usd: 0 } };
  for (const r of jobs) {
    byStep[r.step].jobs += r.jobs;
    byStep[r.step].usd += r.usd;
    if (r.step !== "moderation") pool[r.paid ? "paid" : "free"].usd += r.usd;
  }
  for (const r of spent) pool[r.paid ? "paid" : "free"].credits += r.credits;
  const usd = STEPS.reduce((sum, s) => sum + byStep[s].usd, 0);
  const creditUsd = pool.free.usd + pool.paid.usd;
  const creditsSpent = pool.free.credits + pool.paid.credits;
  const cents = (d) => Math.round(d * 100);
  return {
    estimateCents: cents(usd),
    byStep: Object.fromEntries(STEPS.map((s) => [s, { jobs: byStep[s].jobs, cents: cents(byStep[s].usd) }])),
    free: { credits: pool.free.credits, cents: cents(pool.free.usd) },
    paid: { credits: pool.paid.credits, cents: cents(pool.paid.usd) },
    aiCentsPerCredit: creditsSpent > 0 ? round2((creditUsd * 100) / creditsSpent) : null,
    paidCreditsSold: sold[0].credits,
  };
}

// What the server-built SEO pages cost, estimated from their count and run
// time. Shown for information: the real Netlify dollars are the plan and
// top-ups typed in as fixed costs.
async function netlifyMonth(key) {
  const rows = await database().sql`
    SELECT builds, ms FROM page_builds WHERE month = ${`${key}-01`}`;
  const builds = Number(rows[0]?.builds ?? 0);
  const ms = Number(rows[0]?.ms ?? 0);
  const credits = round2((ms / 3_600_000) * CREDITS_PER_GB_HOUR + (builds / 10_000) * CREDITS_PER_10K_REQUESTS);
  return { builds, credits, cents: round2(credits * CENTS_PER_CREDIT) };
}

export async function buildMonth(key, now = new Date()) {
  const bounds = monthBounds(key);
  const missing = [];
  const [money, anthropic, ai, costs, netlifyPages] = await Promise.all([
    stripeMonth(bounds).catch((error) => {
      console.error("money: stripe", error);
      missing.push("stripe");
      return null;
    }),
    anthropicMonth(bounds, now).catch((error) => {
      console.error("money: anthropic", error);
      missing.push("anthropic");
      return { status: "failed", cents: null };
    }),
    aiMonth(bounds),
    listCosts(),
    netlifyMonth(key),
  ]);
  const fixed = costs
    .map((c) => ({ name: c.name, cents: shareOf(c, key) }))
    .filter((c) => c.cents > 0);
  const fixedCents = fixed.reduce((sum, c) => sum + c.cents, 0);
  const salesCents = money?.sales.cents ?? 0;
  const feeCents = money?.feeCents ?? 0;
  const refundCents = money?.refundCents ?? 0;
  const { aiCentsPerCredit, paidCreditsSold, ...aiParts } = ai;
  // Anthropic's bill covers everything on the key, local testing included,
  // which is the site's real AI cost; the estimate stands in without it.
  const actual = anthropic.status === "ok";
  const aiCents = actual ? anthropic.cents : ai.estimateCents;
  return {
    month: key,
    complete: missing.length === 0,
    missing,
    sales: money?.sales ?? null,
    stripeFeeCents: money ? feeCents : null,
    refundCents: money ? refundCents : null,
    ai: aiParts,
    anthropic,
    fixed,
    fixedCents,
    aiCountedIn: actual ? "actual" : "estimate",
    netlifyPages,
    netCents: salesCents - feeCents - refundCents - aiCents - fixedCents,
    perCredit: {
      aiCents: aiCentsPerCredit,
      earnedCents:
        money && paidCreditsSold > 0
          ? round2((salesCents - feeCents - refundCents) / paidCreditsSold)
          : null,
    },
  };
}

// The first month with AI use or a purchase, never before HISTORY_START.
// Fixed costs don't count: a bill dated in the past mustn't freeze old
// months with only that bill in them.
async function firstMonth() {
  const rows = await database().sql`
    SELECT to_char(LEAST(
      (SELECT min(created_at) FROM ai_usage),
      (SELECT min(created_at) FROM credit_ledger WHERE reason = 'purchase')
    ) AT TIME ZONE 'UTC', 'YYYY-MM') AS month`;
  const month = rows[0]?.month;
  if (!month) return null;
  return month > HISTORY_START ? month : HISTORY_START;
}

// Saves finished months that aren't saved yet, oldest first, back to the
// first month with data (at most 12 back, 3 saved per call). Incomplete
// ones wait for next time.
async function saveFinishedMonths(current, now) {
  const first = await firstMonth();
  if (!first) return;
  const db = database();
  const saved = new Set(
    (await db.sql`SELECT to_char(month, 'YYYY-MM') AS month FROM money_months`).map((r) => r.month),
  );
  // Walk back at most 12 months (saved or not), oldest unsaved first, and
  // stop at the first incomplete one so an outage costs one attempt per open.
  // Anthropic's cost report lags, so a month waits 2 days after it ends.
  const months = [];
  let key = previousMonth(current);
  for (let i = 0; i < SAVED_MONTHS && key >= first; i++, key = previousMonth(key))
    if (!saved.has(key) && now.getTime() >= monthBounds(key).end.getTime() + 2 * DAY)
      months.unshift(key);
  for (const month of months.slice(0, BACKFILL_PER_REQUEST)) {
    const totals = await buildMonth(month, now);
    if (!totals.complete) break;
    await db.sql`
      INSERT INTO money_months (month, totals) VALUES (${`${month}-01`}, ${JSON.stringify(totals)})
      ON CONFLICT (month) DO NOTHING`;
  }
}

export async function moneyOverview(actorId, now = new Date()) {
  await requireAdmin(actorId);
  const current = monthKey(now);
  // The live month doesn't wait on the backfill.
  const [currentMonth] = await Promise.all([buildMonth(current, now), saveFinishedMonths(current, now)]);
  const saved = await database().sql`
    SELECT totals FROM money_months
     WHERE month < ${`${current}-01`}
     ORDER BY month DESC LIMIT ${SAVED_MONTHS}`;
  return {
    current: currentMonth,
    saved: saved.map((r) => r.totals),
    costs: await listCosts(),
  };
}
