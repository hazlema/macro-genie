import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
import { connect, useDatabase } from "../server/db.js";
import { WELCOME_CREDITS, findOrCreateAccount } from "../server/accounts.js";
import {
  cancelInvite,
  deleteTemplate,
  forgetInvite,
  listInvites,
  redeemInvite,
  resendInvite,
  saveTemplate,
  sendInvite,
  useMailer,
} from "../server/invites.js";
import {
  fillInvite,
  findBlanks,
  inviteParts,
  normalizeCode,
} from "../src/lib/invite-text.js";

test("fillInvite fills credits and link in any case and spacing", () => {
  const out = fillInvite(
    "Take [Credits] credits: [ redeem link ] / [REDEEM LINK]",
    { credits: 50, link: "https://x/redeem?code=ab" },
  );
  assert.equal(
    out,
    "Take 50 credits: https://x/redeem?code=ab / https://x/redeem?code=ab",
  );
});

test("findBlanks lists the other brackets once each", () => {
  assert.deepEqual(
    findBlanks(
      'Hi [user], [user]! [credits] [One recipe, e.g. "x"] [redeem link]',
    ),
    ["[user]", '[One recipe, e.g. "x"]'],
  );
  assert.deepEqual(findBlanks("no blanks [credits]"), []);
});

test("inviteParts marks filled and blank parts for the preview", () => {
  assert.deepEqual(inviteParts("Hi [user], [Credits] here: [redeem link]", { credits: 50, link: "L" }), [
    { text: "Hi ", kind: "plain" },
    { text: "[user]", kind: "blank" },
    { text: ", ", kind: "plain" },
    { text: "50", kind: "auto" },
    { text: " here: ", kind: "plain" },
    { text: "L", kind: "auto" },
  ]);
  assert.deepEqual(inviteParts("", { credits: 1, link: "L" }), []);
});

test("normalizeCode", () => {
  const c = "a".repeat(32) + "0123456789abcdef".repeat(2);
  assert.equal(normalizeCode(` ${c.slice(0, 20)}-${c.slice(20)}\n`), c);
  assert.equal(
    normalizeCode(`https://macro-genie.com/redeem?code=${c.toUpperCase()}`),
    c,
  );
  assert.equal(normalizeCode("abc"), "");
  assert.equal(normalizeCode(""), "");
});

// The rest runs against a real (local) Postgres with the migrations applied,
// and a mailer that only remembers what it was asked to send.
let server;
let db;
let sent = [];
let owner;
let n = 0;
const ORIGIN = "https://mg.test";
const person = (name = "Ida") =>
  findOrCreateAccount({ sub: `inv-${++n}`, displayName: name });
const invite = (extra = {}) => ({
  to: "hello@realbalanced.com",
  subject: "A macro tool for you",
  body: "Hi Sam, here are [credits] credits: [redeem link]",
  credits: 50,
  ...extra,
});
const codeIn = (text) => text.match(/redeem\?code=([0-9a-f]{64})/)[1];
const count = async () => Number((await db.sql`SELECT count(*) AS n FROM invites`)[0].n);

before(async () => {
  server = new NetlifyDB();
  const connectionString = await server.start();
  await server.applyMigrations("./db/migrations");
  db = connect(connectionString);
  useDatabase(db);
  owner = await findOrCreateAccount({ sub: "inv-owner", displayName: "Matthew" });
  process.env.ADMIN_SUBS = "inv-owner";
  useMailer(async (mail) => sent.push(mail));
});
after(async () => {
  delete process.env.ADMIN_SUBS;
  useMailer(null);
  await db?.pool.end();
  await server?.stop();
});

test("send fills the link and stores the invite", async () => {
  sent = [];
  await sendInvite(owner.id, invite(), ORIGIN);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "hello@realbalanced.com");
  assert.match(sent[0].text, /^Hi Sam, here are 50 credits: https:\/\/mg\.test\/redeem\?code=[0-9a-f]{64}$/);
  const { invites } = await listInvites(owner.id);
  assert.equal(invites[0].email, "hello@realbalanced.com");
  assert.equal(invites[0].credits, 50);
  assert.equal(invites[0].usedAt, null);
});

test("send refuses blanks and a missing link", async () => {
  const before = await count();
  await assert.rejects(
    sendInvite(owner.id, invite({ body: "Hi [user], [credits] credits: [redeem link]" }), ORIGIN),
    /Fill in the blanks first: \[user\]/,
  );
  await assert.rejects(
    sendInvite(owner.id, invite({ subject: "For [blog name]" }), ORIGIN),
    /Fill in the blanks first: \[blog name\]/,
  );
  await assert.rejects(
    sendInvite(owner.id, invite({ body: "Here are [credits] credits." }), ORIGIN),
    /Add \[redeem link\] so they can claim the credits/,
  );
  await assert.rejects(sendInvite(owner.id, invite({ to: "not an email" }), ORIGIN), (e) => e.status === 400);
  await assert.rejects(sendInvite(owner.id, invite({ credits: 0 }), ORIGIN), (e) => e.status === 400);
  await assert.rejects(sendInvite(owner.id, invite({ credits: 501 }), ORIGIN), (e) => e.status === 400);
  await assert.rejects(sendInvite(owner.id, invite({ credits: 2.5 }), ORIGIN), (e) => e.status === 400);
  assert.equal(await count(), before);
});

test("send failure stores nothing", async () => {
  const before = await count();
  useMailer(async () => {
    throw new Error("535 bad login");
  });
  try {
    await assert.rejects(
      sendInvite(owner.id, invite(), ORIGIN),
      (e) => e.status === 502 && /Gmail didn't take the email: 535 bad login/.test(e.message),
    );
  } finally {
    useMailer(async (mail) => sent.push(mail));
  }
  assert.equal(await count(), before);
});

test("without SMTP settings, sending says so", async () => {
  useMailer(null);
  const saved = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  try {
    await assert.rejects(
      sendInvite(owner.id, invite(), ORIGIN),
      (e) => e.status === 503 && /Email isn't set up yet/.test(e.message),
    );
  } finally {
    if (saved !== undefined) process.env.SMTP_HOST = saved;
    useMailer(async (mail) => sent.push(mail));
  }
});

test("owner only", async () => {
  const admin = await person("Ann");
  await db.sql`UPDATE accounts SET is_admin = true WHERE id = ${admin.id}`;
  const forbidden = (e) => e.status === 403;
  await assert.rejects(listInvites(admin.id), forbidden);
  await assert.rejects(sendInvite(admin.id, invite(), ORIGIN), forbidden);
  await assert.rejects(saveTemplate(admin.id, { name: "x", subject: "s", body: "b" }), forbidden);
  await assert.rejects(listInvites(null), (e) => e.status === 401 || e.status === 403);
});

test("redeem adds credits once", async () => {
  sent = [];
  await sendInvite(owner.id, invite(), ORIGIN);
  const code = codeIn(sent[0].text);
  const guest = await person("Guest");
  assert.deepEqual(await redeemInvite(guest.id, code), { added: 50, credits: WELCOME_CREDITS + 50 });
  await assert.rejects(
    redeemInvite(guest.id, code),
    (e) => e.status === 404 && e.message === "This code has already been used or isn't valid.",
  );
  const ledger = await db.sql`SELECT * FROM credit_ledger WHERE account_id = ${guest.id} AND reason = 'invite'`;
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].ref, null);
  assert.equal(ledger[0].paid, false);
  const columns = await db.sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'invites'`;
  assert.ok(!columns.some((c) => /account/.test(c.column_name)), "invites never names an account");
  const { invites } = await listInvites(owner.id);
  assert.ok(invites.find((i) => i.usedAt));
});

test("redeem twice at once adds once", async () => {
  sent = [];
  await sendInvite(owner.id, invite({ credits: 30 }), ORIGIN);
  const code = codeIn(sent[0].text);
  const guest = await person("Twice");
  const results = await Promise.allSettled([redeemInvite(guest.id, code), redeemInvite(guest.id, code)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const [row] = await db.sql`SELECT credits FROM accounts WHERE id = ${guest.id}`;
  assert.equal(Number(row.credits), WELCOME_CREDITS + 30);
});

test("pasted links and spaced codes redeem; junk doesn't", async () => {
  sent = [];
  await sendInvite(owner.id, invite({ credits: 5 }), ORIGIN);
  const code = codeIn(sent[0].text);
  const guest = await person("Paster");
  const result = await redeemInvite(guest.id, `  ${ORIGIN}/redeem?code=${code.toUpperCase()} `);
  assert.equal(result.added, 5);
  await assert.rejects(redeemInvite(guest.id, "nope"), (e) => e.status === 404);
});

test("canceled and forgotten codes don't redeem; resend refuses used codes", async () => {
  sent = [];
  await sendInvite(owner.id, invite({ to: "first@example.com" }), ORIGIN);
  await sendInvite(owner.id, invite({ to: "second@example.com" }), ORIGIN);
  await sendInvite(owner.id, invite({ to: "third@example.com" }), ORIGIN);
  const [canceled, forgotten, used] = sent.map((m) => codeIn(m.text));
  const ids = async () => {
    const { invites } = await listInvites(owner.id);
    return Object.fromEntries(invites.map((i) => [i.email, i]));
  };
  let book = await ids();
  await cancelInvite(owner.id, book["first@example.com"].id);
  await forgetInvite(owner.id, book["second@example.com"].id);
  const guest = await person("Late");
  await assert.rejects(redeemInvite(guest.id, canceled), (e) => e.status === 404);
  await assert.rejects(redeemInvite(guest.id, forgotten), (e) => e.status === 404);
  book = await ids();
  assert.ok(book["first@example.com"].canceledAt);
  assert.equal(book["second@example.com"], undefined);

  await redeemInvite(guest.id, used);
  await assert.rejects(resendInvite(owner.id, book["third@example.com"].id), (e) => e.status === 409);
  await assert.rejects(resendInvite(owner.id, book["first@example.com"].id), (e) => e.status === 409);
  await assert.rejects(cancelInvite(owner.id, book["third@example.com"].id), (e) => e.status === 409);
});

test("resend sends the same email and code again", async () => {
  sent = [];
  await sendInvite(owner.id, invite({ to: "again@example.com" }), ORIGIN);
  const { invites } = await listInvites(owner.id);
  const row = invites.find((i) => i.email === "again@example.com");
  await resendInvite(owner.id, row.id);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0]);
});

test("redeem needs an active account", async () => {
  sent = [];
  await sendInvite(owner.id, invite(), ORIGIN);
  const code = codeIn(sent[0].text);
  await assert.rejects(redeemInvite(null, code), (e) => e.status === 401);
  const sue = await person("Sue");
  await db.sql`UPDATE accounts SET suspended_at = now() WHERE id = ${sue.id}`;
  await assert.rejects(redeemInvite(sue.id, code), (e) => e.status === 403);
  const fresh = await person("Fresh");
  assert.equal((await redeemInvite(fresh.id, code)).added, 50, "the refused tries didn't use it up");
});

test("templates", async () => {
  const { templates } = await listInvites(owner.id);
  const seed = templates.find((t) => t.name === "Recipe blogger");
  assert.ok(seed, "the seed template is there");
  assert.match(seed.body, /\[redeem link\]/);
  assert.match(seed.body, /\[credits\] credits/);
  assert.doesNotMatch(seed.body, /reply with your username/);
  const { id } = await saveTemplate(owner.id, { name: "Coach", subject: "Hi", body: "one" });
  await saveTemplate(owner.id, { name: "Coach", subject: "Hi", body: "two" });
  let list = (await listInvites(owner.id)).templates.filter((t) => t.name === "Coach");
  assert.equal(list.length, 1);
  assert.equal(list[0].body, "two");
  assert.equal(list[0].id, id);
  await assert.rejects(saveTemplate(owner.id, { name: " ", subject: "Hi", body: "x" }), (e) => e.status === 400);
  await deleteTemplate(owner.id, id);
  list = (await listInvites(owner.id)).templates.filter((t) => t.name === "Coach");
  assert.equal(list.length, 0);
});
