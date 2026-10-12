import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
import { connect, useDatabase } from "../server/db.js";
import { findOrCreateAccount } from "../server/accounts.js";
import {
  requireActive,
  requireAdmin,
  requireMod,
  roleOf,
} from "../server/roles.js";

let server;
let db;

before(async () => {
  server = new NetlifyDB();
  const connectionString = await server.start();
  await server.applyMigrations("./db/migrations");
  db = connect(connectionString);
  useDatabase(db);
  process.env.SESSION_SECRET = "z".repeat(40);
});
after(async () => {
  await db?.pool.end();
  await server?.stop();
});

let n = 0;
const person = (displayName = "Ada", sub = `adm-${++n}`) =>
  findOrCreateAccount({ sub, displayName });
const pick = ({ owner, admin, mod, suspended }) => ({
  owner,
  admin,
  mod,
  suspended,
});

test("roles: owners come from ADMIN_SUBS, admins and mods from the database", async () => {
  const owner = await person("Owner", "owner-sub");
  const admin = await person("Ann");
  const mod = await person("Mo");
  const plain = await person("Pat");
  await db.sql`UPDATE accounts SET is_admin = true WHERE id = ${admin.id}`;
  await db.sql`UPDATE accounts SET is_mod = true WHERE id = ${mod.id}`;
  process.env.ADMIN_SUBS = "someone-else, owner-sub";
  try {
    assert.deepEqual(pick(await roleOf(owner.id)), {
      owner: true,
      admin: true,
      mod: true,
      suspended: false,
    });
    assert.deepEqual(pick(await roleOf(admin.id)), {
      owner: false,
      admin: true,
      mod: true,
      suspended: false,
    });
    assert.deepEqual(pick(await roleOf(mod.id)), {
      owner: false,
      admin: false,
      mod: true,
      suspended: false,
    });
    assert.deepEqual(pick(await roleOf(plain.id)), {
      owner: false,
      admin: false,
      mod: false,
      suspended: false,
    });
    assert.equal((await roleOf(admin.id)).displayName, "Ann");
    assert.equal((await roleOf(null)).exists, false);
    assert.equal((await roleOf(999999)).exists, false);
    await assert.rejects(requireMod(plain.id), /Only moderators/);
    await assert.rejects(requireAdmin(mod.id), /Only admins/);
    assert.equal((await requireMod(mod.id)).mod, true);
    assert.equal((await requireAdmin(admin.id)).admin, true);
  } finally {
    delete process.env.ADMIN_SUBS;
  }
  assert.equal((await roleOf(owner.id)).admin, false, "no longer listed");
});

test("a suspended account can't act, unless it's an owner", async () => {
  const sue = await person("Sue");
  await db.sql`UPDATE accounts SET suspended_at = now() WHERE id = ${sue.id}`;
  await assert.rejects(
    requireActive(sue.id),
    (e) => e.status === 403 && e.message === "Your account is suspended.",
  );
  await assert.rejects(requireActive(424242), (e) => e.status === 401);
  const oz = await person("Oz", "owner-oz");
  await db.sql`UPDATE accounts SET suspended_at = now() WHERE id = ${oz.id}`;
  process.env.ADMIN_SUBS = "owner-oz";
  try {
    assert.equal((await requireActive(oz.id)).suspended, false);
  } finally {
    delete process.env.ADMIN_SUBS;
  }
});
