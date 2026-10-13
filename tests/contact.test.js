import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
import { connect, useDatabase } from "../server/db.js";
import { findOrCreateAccount } from "../server/accounts.js";
import { listActivity } from "../server/activity.js";
import {
  listMessages,
  saveMessage,
  setMessageStatus,
} from "../server/messages.js";
import { sessionCookie } from "../server/session.js";

let server;
let db;
before(async () => {
  server = new NetlifyDB();
  const connectionString = await server.start();
  await server.applyMigrations("./db/migrations");
  db = connect(connectionString);
  useDatabase(db);
  process.env.SESSION_SECRET = "c".repeat(40);
});
after(async () => {
  await db?.pool.end();
  await server?.stop();
});

let n = 0;
const person = (name) =>
  findOrCreateAccount({ sub: `ct-${++n}`, displayName: name });
const send = async (payload, who) => {
  const { default: handler } = await import("../netlify/functions/contact.js");
  const headers = { "Content-Type": "application/json" };
  if (who)
    headers.cookie = sessionCookie(
      who.id,
      new Request("https://example.com/"),
    ).split(";")[0];
  return handler(
    new Request("https://example.com/api/contact", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }),
  );
};

test("a visitor's message is stored and logged; an email is required when signed out", async () => {
  const missing = await send({
    topic: "Question",
    body: "How do credits work here?",
  });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /email/i);
  const res = await send({
    topic: "Question",
    body: "How do credits work here?",
    email: "ana@example.com",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { sent: true });
  const rows =
    await db.sql`SELECT name, email, topic, body, status, account_id FROM messages WHERE email = 'ana@example.com'`;
  assert.deepEqual(rows[0], {
    name: "Visitor",
    email: "ana@example.com",
    topic: "Question",
    body: "How do credits work here?",
    status: "new",
    account_id: null,
  });
  const entry = (await listActivity({ chip: "messages" })).entries[0];
  assert.equal(entry.text, "sent a message: Question");
});

test("signed-in messages carry the account; email is optional", async () => {
  const kim = await person("Kim");
  assert.equal(
    (
      await send(
        { topic: "Refund", body: "Please refund my unused pack." },
        kim,
      )
    ).status,
    200,
  );
  const rows =
    await db.sql`SELECT name, account_id, email FROM messages WHERE body = 'Please refund my unused pack.'`;
  assert.equal(rows[0].name, "Kim");
  assert.equal(Number(rows[0].account_id), kim.id);
  assert.equal(rows[0].email, "");
});

test("bad input is refused; bots filling the hidden field are dropped quietly; double taps store once", async () => {
  assert.equal(
    (await send({ topic: "Spam", body: "Ten chars plus", email: "a@b.co" }))
      .status,
    400,
  );
  assert.equal(
    (await send({ topic: "Bug", body: "short", email: "a@b.co" })).status,
    400,
  );
  assert.equal(
    (await send({ topic: "Bug", body: "x".repeat(3001), email: "a@b.co" }))
      .status,
    400,
  );
  assert.equal(
    (
      await send({
        topic: "Bug",
        body: "A real bug report",
        email: "not-an-email",
      })
    ).status,
    400,
  );
  const bot = await send({
    topic: "Other",
    body: "Buy cheap things now",
    email: "bot@x.co",
    website: "http://spam",
  });
  assert.equal(bot.status, 200);
  assert.equal(
    (
      await db.sql`SELECT count(*)::int AS n FROM messages WHERE email = 'bot@x.co'`
    )[0].n,
    0,
  );
  const twice = {
    topic: "Bug",
    body: "The page froze once",
    email: "dt@example.com",
  };
  await send(twice);
  await send(twice);
  assert.equal(
    (
      await db.sql`SELECT count(*)::int AS n FROM messages WHERE email = 'dt@example.com'`
    )[0].n,
    1,
  );
});

test("mods read the inbox and mark messages done; others can't", async () => {
  const mod = await person("Mo");
  const plain = await person("Pat");
  await db.sql`UPDATE accounts SET is_mod = true WHERE id = ${mod.id}`;
  const { id } = await saveMessage({
    name: "Visitor",
    email: "z@example.com",
    topic: "Other",
    body: "Hello there, team",
  });
  const inbox = await listMessages(mod.id);
  assert.ok(inbox.messages.some((m) => m.id === id && m.status === "new"));
  assert.deepEqual(await setMessageStatus(mod.id, id, "done"), {
    status: "done",
  });
  assert.ok(!(await listMessages(mod.id)).messages.some((m) => m.id === id));
  assert.ok(
    (await listMessages(mod.id, { status: "done" })).messages.some(
      (m) => m.id === id,
    ),
  );
  await assert.rejects(listMessages(plain.id), /Only moderators/);
  await assert.rejects(setMessageStatus(mod.id, id, "lost"), /new or done/);
  await assert.rejects(
    setMessageStatus(mod.id, 999999, "done"),
    /wasn't found/,
  );
});
