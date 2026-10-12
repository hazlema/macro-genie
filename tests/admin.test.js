import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
import { connect, useDatabase } from "../server/db.js";
import { findOrCreateAccount } from "../server/accounts.js";
import {
  heldText,
  listActivity,
  logActivity,
  pruneActivity,
} from "../server/activity.js";
import { getAccount } from "../server/accounts.js";
import { addComment, createThread, toggleLike } from "../server/community.js";
import {
  adjustCredits,
  deleteAndBan,
  listUsers,
  removeCommunityContent,
  setRoles,
  setSuspended,
} from "../server/users.js";
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
// Haiku stand-in: every review comes back "fine".
const fine = {
  messages: {
    create: async () => ({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          name: "submit_review",
          input: { verdict: "fine", reason: "Fine.", meal_type: "dinner" },
        },
      ],
    }),
  },
};
const staff = async () => {
  const admin = await person("Adele");
  const mod = await person("Moe");
  await db.sql`UPDATE accounts SET is_admin = true WHERE id = ${admin.id}`;
  await db.sql`UPDATE accounts SET is_mod = true WHERE id = ${mod.id}`;
  return { admin, mod };
};

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

test("the log lists entries newest first, filtered by chip, paged by id", async () => {
  await db.sql`DELETE FROM activity_log`;
  for (const name of ["S0", "S1", "S2"])
    await logActivity({ kind: "sign_in", actorName: name, text: "signed in" });
  await logActivity({
    kind: "recipe_post",
    actorName: "Ada",
    text: 'posted a recipe to the community: "Gratin"',
    link: "/community/5",
  });
  await logActivity({
    kind: "held",
    actorName: "Bo",
    text: heldText("posted in General", "held", "Might be an ad."),
    link: "/community/6",
  });
  const all = await listActivity();
  assert.deepEqual(
    all.entries.map((e) => e.name),
    ["Bo", "Ada", "S2", "S1", "S0"],
  );
  assert.equal(all.more, false);
  assert.equal(all.entries[1].link, "/community/5");
  assert.equal(
    all.entries[0].text,
    "posted in General but it was held for review: Might be an ad.",
  );
  assert.ok(!Number.isNaN(Date.parse(all.entries[0].at)));
  assert.deepEqual(
    (await listActivity({ chip: "problems" })).entries.map((e) => e.name),
    ["Bo"],
  );
  assert.equal((await listActivity({ chip: "signins" })).entries.length, 3);

  const page1 = await listActivity({ limit: 2 });
  assert.deepEqual(
    page1.entries.map((e) => e.name),
    ["Bo", "Ada"],
  );
  assert.equal(page1.more, true);
  // Something new arrives between pages; the next page still continues.
  await logActivity({ kind: "sign_in", actorName: "New", text: "signed in" });
  const page2 = await listActivity({ limit: 2, before: page1.entries[1].id });
  assert.deepEqual(
    page2.entries.map((e) => e.name),
    ["S2", "S1"],
  );
  await assert.rejects(listActivity({ chip: "nope" }), /Unknown filter/);
});

test("logging never throws, and entries older than 90 days are pruned", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    await logActivity({ kind: "not-a-kind", actorName: "X", text: "x" });
  } finally {
    console.error = quiet;
  }
  await db.sql`INSERT INTO activity_log (created_at, kind, actor_name, text)
    VALUES (now() - interval '91 days', 'sign_in', 'Old', 'signed in')`;
  await pruneActivity();
  const names = (
    await listActivity({ chip: "signins", limit: 200 })
  ).entries.map((e) => e.name);
  assert.ok(!names.includes("Old"));
  assert.equal(
    heldText("commented", "blocked", ""),
    "commented but it was blocked",
  );
});

test("user search: newest first, by name, with % and _ matched literally", async () => {
  const { mod } = await staff();
  await person("Percent%Pat");
  await person("Under_Ursula");
  await person("Plainly");
  const named = (r) => r.users.map((u) => u.displayName);
  assert.deepEqual(named(await listUsers(mod.id, { query: "%" })), [
    "Percent%Pat",
  ]);
  assert.deepEqual(named(await listUsers(mod.id, { query: "_" })), [
    "Under_Ursula",
  ]);
  assert.equal((await listUsers(mod.id)).users[0].displayName, "Plainly");
  const pat = await person("Pat Plain");
  await assert.rejects(listUsers(pat.id), /Only moderators/);
});

test("mods suspend and remove posts, but not other staff, themselves, or the owner", async () => {
  const { admin, mod } = await staff();
  const kid = await person("Kid");
  const suspended = await setSuspended(mod.id, kid.id, true);
  assert.equal(suspended.suspended, true);
  assert.equal((await setSuspended(mod.id, kid.id, false)).suspended, false);
  await assert.rejects(
    setSuspended(mod.id, admin.id, true),
    /Only admins can do that to a moderator/,
  );
  await assert.rejects(setSuspended(mod.id, mod.id, true), /your own account/);
  const own = await person("Own", "owner-x");
  process.env.ADMIN_SUBS = "owner-x";
  try {
    await assert.rejects(setSuspended(admin.id, own.id, true), /site owner/);
  } finally {
    delete process.env.ADMIN_SUBS;
  }
  const log = (await listActivity({ chip: "problems", limit: 200 })).entries;
  assert.ok(log.some((e) => e.name === "Moe" && e.text === "suspended Kid"));
  assert.ok(log.some((e) => e.name === "Moe" && e.text === "unsuspended Kid"));
});

test("removing someone's community content keeps other posts' comment counts right", async () => {
  const { mod } = await staff();
  const host = await person("Host");
  const troll = await person("Troll");
  const thread = await createThread(
    host.id,
    { board: "general", title: "Hello there", body: "Hi" },
    fine,
  );
  await addComment(troll.id, thread.id, "first", fine);
  await addComment(troll.id, thread.id, "second", fine);
  await createThread(
    troll.id,
    { board: "general", title: "Troll post", body: "x" },
    fine,
  );
  const before =
    await db.sql`SELECT comment_count FROM posts WHERE id = ${thread.id}`;
  assert.equal(before[0].comment_count, 2);
  assert.deepEqual(await removeCommunityContent(mod.id, troll.id), {
    posts: 1,
    comments: 2,
  });
  const after =
    await db.sql`SELECT comment_count FROM posts WHERE id = ${thread.id}`;
  assert.equal(after[0].comment_count, 0);
  const left =
    await db.sql`SELECT count(*)::int AS n FROM posts WHERE account_id = ${troll.id} AND status <> 'removed'`;
  assert.equal(left[0].n, 0);
});

test("credits: admins only, a reason is required, and never below zero", async () => {
  const { admin, mod } = await staff();
  const cy = await person("Cy");
  await assert.rejects(
    adjustCredits(mod.id, cy.id, 5, "thanks"),
    /Only admins/,
  );
  await assert.rejects(adjustCredits(admin.id, cy.id, 5, "  "), /Add a reason/);
  await assert.rejects(
    adjustCredits(admin.id, cy.id, 1.5, "x"),
    /whole number/,
  );
  assert.deepEqual(
    await adjustCredits(admin.id, cy.id, 50, "beta tester thanks"),
    { credits: 60 },
  );
  await assert.rejects(
    adjustCredits(admin.id, cy.id, -61, "oops"),
    /below 0 credits \(they have 60\)/,
  );
  assert.deepEqual(await adjustCredits(admin.id, cy.id, -60, "reset"), {
    credits: 0,
  });
  const ledger =
    await db.sql`SELECT change, reason FROM credit_ledger WHERE account_id = ${cy.id} ORDER BY id`;
  assert.deepEqual(
    ledger.map((r) => [r.change, r.reason]),
    [
      [10, "welcome"],
      [50, "admin:beta tester thanks"],
      [-60, "admin:reset"],
    ],
  );
  const entry = (
    await listActivity({ chip: "credits", limit: 200 })
  ).entries.find((e) => e.name === "Cy" && e.text.startsWith("got +50"));
  assert.equal(entry.text, 'got +50 credits from Adele: "beta tester thanks"');
});

test("roles: admins set them, can't drop their own admin, can't touch the owner", async () => {
  const { admin, mod } = await staff();
  const dee = await person("Dee");
  await assert.rejects(setRoles(mod.id, dee.id, { mod: true }), /Only admins/);
  assert.equal((await setRoles(admin.id, dee.id, { mod: true })).mod, true);
  assert.equal((await setRoles(admin.id, dee.id, { admin: true })).admin, true);
  await assert.rejects(
    setRoles(admin.id, admin.id, { admin: false }),
    /your own admin role/,
  );
  const log = (await listActivity({ chip: "problems", limit: 200 })).entries;
  assert.ok(
    log.some((e) => e.text === "changed Dee's roles: made them a moderator"),
  );
});

test("delete & ban erases everything, fixes counts on others' posts, and blocks that Google account", async () => {
  const { admin } = await staff();
  const host = await person("Hosta");
  const gone = await person("Gone", "gone-sub");
  const thread = await createThread(
    host.id,
    { board: "general", title: "Popular one", body: "Hi" },
    fine,
  );
  await toggleLike(gone.id, thread.id);
  await addComment(gone.id, thread.id, "hello", fine);
  await assert.rejects(
    deleteAndBan(admin.id, gone.id, "gone"),
    /Type their display name/,
  );
  assert.deepEqual(await deleteAndBan(admin.id, gone.id, " Gone "), {
    deleted: true,
  });
  assert.equal(await getAccount(gone.id), null);
  const post =
    await db.sql`SELECT like_count, comment_count FROM posts WHERE id = ${thread.id}`;
  assert.deepEqual(post[0], { like_count: 0, comment_count: 0 });
  const banned =
    await db.sql`SELECT google_sub FROM banned_subs WHERE google_sub = 'gone-sub'`;
  assert.equal(banned.length, 1);
  await assert.rejects(
    setSuspended(admin.id, gone.id, true),
    /no longer exists/,
  );
  const log = (await listActivity({ chip: "problems", limit: 200 })).entries;
  assert.ok(
    log.some((e) => e.name === "Adele" && e.text === "deleted and banned Gone"),
  );
});
