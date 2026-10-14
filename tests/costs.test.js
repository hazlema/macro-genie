import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
import { connect, useDatabase } from "../server/db.js";
import { findOrCreateAccount } from "../server/accounts.js";
import { addCost, deleteCost, listCosts, monthsBetween, shareOf, updateCost } from "../server/costs.js";

let server;
let db;
let admin;
let mod;

before(async () => {
  server = new NetlifyDB();
  const connectionString = await server.start();
  await server.applyMigrations("./db/migrations");
  db = connect(connectionString);
  useDatabase(db);
  admin = await findOrCreateAccount({ sub: "cost-admin", displayName: "Ada" });
  mod = await findOrCreateAccount({ sub: "cost-mod", displayName: "Mo" });
  await db.sql`UPDATE accounts SET is_admin = true WHERE id = ${admin.id}`;
  await db.sql`UPDATE accounts SET is_mod = true WHERE id = ${mod.id}`;
});
after(async () => {
  await db?.pool.end();
  await server?.stop();
});

const rejectsWith = (promise, status, pattern) =>
  assert.rejects(promise, (e) => e.status === status && (!pattern || pattern.test(e.message)));

test("months between", () => {
  assert.equal(monthsBetween("2026-10", "2026-10"), 0);
  assert.equal(monthsBetween("2026-10", "2027-01"), 3);
  assert.equal(monthsBetween("2026-10", "2026-09"), -1);
});

test("monthly costs count in full from start to end", () => {
  const c = { cents: 1900, period: "monthly", starts: "2026-10", ends: "2026-12" };
  assert.equal(shareOf(c, "2026-09"), 0);
  assert.equal(shareOf(c, "2026-10"), 1900);
  assert.equal(shareOf(c, "2026-12"), 1900);
  assert.equal(shareOf(c, "2027-01"), 0);
  assert.equal(shareOf({ ...c, ends: null }, "2030-05"), 1900);
});

test("yearly costs spread over twelve months and add up exactly", () => {
  const c = { cents: 1201, period: "yearly", starts: "2026-03", ends: null };
  const year = Array.from({ length: 12 }, (_, i) => {
    const m = 3 + i;
    const key = `${2026 + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, "0")}`;
    return shareOf(c, key);
  });
  assert.equal(year.reduce((a, b) => a + b, 0), 1201);
  assert.equal(year[0], 1201 - 100 * 11); // remainder lands in the start month
  assert.equal(shareOf(c, "2027-03"), 101); // and again each anniversary
  assert.equal(shareOf(c, "2026-02"), 0);
});

test("one-off costs count only in their month", () => {
  const c = { cents: 500, period: "once", starts: "2026-10", ends: null };
  assert.equal(shareOf(c, "2026-10"), 500);
  assert.equal(shareOf(c, "2026-11"), 0);
});

test("admins add, edit, end and delete costs; others can't", async () => {
  const added = await addCost(admin.id, { name: " Netlify Pro ", cents: 1900, period: "monthly", starts: "2026-10", ends: null });
  assert.deepEqual(
    { name: added.name, cents: added.cents, period: added.period, starts: added.starts, ends: added.ends },
    { name: "Netlify Pro", cents: 1900, period: "monthly", starts: "2026-10", ends: null },
  );
  const ended = await updateCost(admin.id, added.id, { ...added, ends: "2027-03" });
  assert.equal(ended.ends, "2027-03");
  assert.ok((await listCosts()).some((c) => c.id === added.id && c.ends === "2027-03"));
  await rejectsWith(addCost(mod.id, { name: "x", cents: 1, period: "once", starts: "2026-10" }), 403);
  await rejectsWith(deleteCost(mod.id, added.id), 403);
  assert.deepEqual(await deleteCost(admin.id, added.id), { deleted: true });
  assert.ok(!(await listCosts()).some((c) => c.id === added.id));
  await rejectsWith(updateCost(admin.id, added.id, added), 404);
});

test("bad cost input is refused with a plain message", async () => {
  const ok = { name: "Domain", cents: 1200, period: "yearly", starts: "2026-10", ends: null };
  await rejectsWith(addCost(admin.id, { ...ok, name: "  " }), 400, /name/i);
  await rejectsWith(addCost(admin.id, { ...ok, cents: 0 }), 400, /amount/i);
  await rejectsWith(addCost(admin.id, { ...ok, cents: -5 }), 400, /amount/i);
  await rejectsWith(addCost(admin.id, { ...ok, cents: 12.5 }), 400, /amount/i);
  await rejectsWith(addCost(admin.id, { ...ok, period: "weekly" }), 400, /monthly/i);
  await rejectsWith(addCost(admin.id, { ...ok, starts: "2026-13" }), 400, /month/i);
  await rejectsWith(addCost(admin.id, { ...ok, starts: "Oct 2026" }), 400, /month/i);
  await rejectsWith(addCost(admin.id, { ...ok, ends: "2026-09" }), 400, /end/i);
  assert.equal((await listCosts()).filter((c) => c.name === "Domain").length, 0);
});
