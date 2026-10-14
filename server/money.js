import { database } from "./db.js";
import { listCosts, shareOf } from "./costs.js";
import { requireAdmin } from "./roles.js";
import { stripe } from "./stripe.js";

// The admin Money tab: what came in (credit packs) and what went out
// (Stripe fees, refunds, AI, fixed bills), per UTC calendar month. The
// current month is worked out live; finished months are saved once.

const SAVED_MONTHS = 12;
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

export async function buildMonth(key, now = new Date()) {
  const bounds = monthBounds(key);
  const missing = [];
  const [money, anthropic, ai, costs] = await Promise.all([
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
  ]);
  const fixed = costs
    .map((c) => ({ name: c.name, cents: shareOf(c, key) }))
    .filter((c) => c.cents > 0);
  const fixedCents = fixed.reduce((sum, c) => sum + c.cents, 0);
  const salesCents = money?.sales.cents ?? 0;
  const feeCents = money?.feeCents ?? 0;
  const refundCents = money?.refundCents ?? 0;
  const { aiCentsPerCredit, paidCreditsSold, ...aiParts } = ai;
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
    netCents: salesCents - feeCents - refundCents - ai.estimateCents - fixedCents,
    perCredit: {
      aiCents: aiCentsPerCredit,
      earnedCents:
        money && paidCreditsSold > 0
          ? round2((salesCents - feeCents - refundCents) / paidCreditsSold)
          : null,
    },
  };
}

// The first month anything happened: AI use, a purchase, or a fixed cost.
async function firstMonth() {
  const rows = await database().sql`
    SELECT to_char(LEAST(
      (SELECT min(created_at) FROM ai_usage),
      (SELECT min(created_at) FROM credit_ledger WHERE reason = 'purchase'),
      (SELECT min(starts)::timestamptz FROM fixed_costs)
    ) AT TIME ZONE 'UTC', 'YYYY-MM') AS month`;
  return rows[0]?.month ?? null;
}

// Saves finished months that aren't saved yet, oldest first, back to the
// first month with data (at most 12). Incomplete ones wait for next time.
async function saveFinishedMonths(current, now) {
  const first = await firstMonth();
  if (!first) return;
  const db = database();
  const saved = new Set(
    (await db.sql`SELECT to_char(month, 'YYYY-MM') AS month FROM money_months`).map((r) => r.month),
  );
  // Walk back at most 12 months (saved or not), oldest unsaved first, and
  // stop at the first incomplete one so an outage costs one attempt per open.
  const months = [];
  let key = previousMonth(current);
  for (let i = 0; i < SAVED_MONTHS && key >= first; i++, key = previousMonth(key))
    if (!saved.has(key)) months.unshift(key);
  for (const month of months) {
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
  await saveFinishedMonths(current, now);
  const saved = await database().sql`
    SELECT totals FROM money_months
     WHERE month < ${`${current}-01`}
     ORDER BY month DESC LIMIT ${SAVED_MONTHS}`;
  return {
    current: await buildMonth(current, now),
    saved: saved.map((r) => r.totals),
    costs: await listCosts(),
  };
}
