import { UserFacingError } from "./chef.js";
import { database } from "./db.js";
import { requireAdmin } from "./roles.js";

// Bills typed in on the Money tab: hosting, the domain, anything not
// metered. Months are "YYYY-MM" (UTC); the database keeps their first day.

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const PERIODS = ["monthly", "yearly", "once"];

export function monthsBetween(a, b) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

// This cost's cents in one month. A yearly cost is spread evenly; the
// remainder goes to its start month (and each anniversary) so a year adds
// up exactly.
export function shareOf(cost, month) {
  if (month < cost.starts || (cost.ends && month > cost.ends)) return 0;
  if (cost.period === "monthly") return cost.cents;
  if (cost.period === "once") return month === cost.starts ? cost.cents : 0;
  const base = Math.floor(cost.cents / 12);
  return monthsBetween(cost.starts, month) % 12 === 0
    ? cost.cents - base * 11
    : base;
}

function checked(body) {
  const name = String(body?.name ?? "").trim().slice(0, 80);
  if (!name) throw new UserFacingError("Give the cost a name, like Netlify Pro.");
  const cents = Number(body?.cents);
  if (!Number.isInteger(cents) || cents < 1 || cents > 10_000_000)
    throw new UserFacingError("Enter an amount above $0, like 19.00.");
  if (!PERIODS.includes(body?.period))
    throw new UserFacingError("Pick monthly, yearly or one-off.");
  const starts = String(body?.starts ?? "");
  if (!MONTH.test(starts))
    throw new UserFacingError("Pick the month it starts.");
  // A one-off has no end month.
  const ends = body?.period !== "once" && body?.ends ? String(body.ends) : null;
  if (ends !== null && !MONTH.test(ends))
    throw new UserFacingError("Pick the month it ends, or leave it empty.");
  if (ends !== null && ends < starts)
    throw new UserFacingError("The end month can't be before the start month.");
  return { name, cents, period: body.period, starts, ends };
}

const SELECT = `SELECT id, name, cents, period,
  to_char(starts, 'YYYY-MM') AS starts, to_char(ends, 'YYYY-MM') AS ends
  FROM fixed_costs`;

const shape = (r) => ({
  id: Number(r.id),
  name: r.name,
  cents: Number(r.cents),
  period: r.period,
  starts: r.starts,
  ends: r.ends ?? null,
});

const day = (month) => (month ? `${month}-01` : null);

export async function listCosts() {
  const { rows } = await database().pool.query(`${SELECT} ORDER BY starts, id`);
  return rows.map(shape);
}

export async function addCost(actorId, body) {
  await requireAdmin(actorId);
  const c = checked(body);
  const rows = await database().sql`
    INSERT INTO fixed_costs (name, cents, period, starts, ends)
    VALUES (${c.name}, ${c.cents}, ${c.period}, ${day(c.starts)}, ${day(c.ends)})
    RETURNING id`;
  return { id: Number(rows[0].id), ...c };
}

export async function updateCost(actorId, id, body) {
  await requireAdmin(actorId);
  const c = checked(body);
  const rows = await database().sql`
    UPDATE fixed_costs
       SET name = ${c.name}, cents = ${c.cents}, period = ${c.period},
           starts = ${day(c.starts)}, ends = ${day(c.ends)}
     WHERE id = ${id} RETURNING id`;
  if (!rows[0]) throw new UserFacingError("That cost wasn't found.", 404);
  return { id: Number(id), ...c };
}

export async function deleteCost(actorId, id) {
  await requireAdmin(actorId);
  const rows = await database().sql`DELETE FROM fixed_costs WHERE id = ${id} RETURNING id`;
  if (!rows[0]) throw new UserFacingError("That cost wasn't found.", 404);
  return { deleted: true };
}
