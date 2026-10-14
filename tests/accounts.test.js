import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { listActivity } from "../server/activity.js";
import { NetlifyDB } from "@netlify/database-dev";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { connect, useDatabase } from "../server/db.js";
import {
  addCredits,
  findOrCreateAccount,
  getAccount,
  refundCredit,
  spendCredit,
} from "../server/accounts.js";
import { withCredit } from "../server/credits.js";
import { emptyUsage, logUsage } from "../server/usage.js";
import {
  readSession,
  sessionCookie,
  useGoogleKeys,
} from "../server/session.js";
import account from "../netlify/functions/account.js";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
let server;
let db;
let signer;

before(async () => {
  server = new NetlifyDB();
  const connectionString = await server.start();
  await server.applyMigrations("./db/migrations");
  db = connect(connectionString);
  useDatabase(db);
  process.env.SESSION_SECRET = "x".repeat(40);
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  useGoogleKeys(
    createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" }],
    }),
  );
  signer = (claims, audience = CLIENT_ID) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("https://accounts.google.com")
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
});
after(async () => {
  await db?.pool.end();
  await server?.stop();
});

const req = (path, init = {}) =>
  new Request(`https://example.com${path}`, init);

test("a new account starts with 10 credits; signing in again finds it", async () => {
  const first = await findOrCreateAccount({ sub: "g-1", displayName: "Ada" });
  assert.equal(first.isNew, true);
  assert.equal(first.credits, 10);
  const again = await findOrCreateAccount({ sub: "g-1", displayName: "Ada" });
  assert.equal(again.isNew, false);
  assert.equal(again.id, first.id);
  assert.equal((await getAccount(first.id)).credits, 10);
});

test("credits can't be overspent, even by many requests at once", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-2", displayName: "Bo" });
  const results = await Promise.all(
    Array.from({ length: 15 }, () => spendCredit(id, "idea")),
  );
  assert.equal(results.filter((r) => r !== null).length, 10);
  assert.equal(typeof results.find((r) => r !== null).credits, "number");
  assert.equal((await getAccount(id)).credits, 0);
  assert.equal(await spendCredit(id, "idea"), null);
});

test("a payment applies once, however often its notification arrives", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-3", displayName: "Cy" });
  assert.equal(await addCredits(id, 30, "purchase", "evt_123"), 40);
  assert.equal(await addCredits(id, 30, "purchase", "evt_123"), null);
  assert.equal((await getAccount(id)).credits, 40);
});

test("sessions are signed: tampered or expired cookies are ignored", () => {
  const request = req("/");
  const cookie = sessionCookie(7, request).split(";")[0];
  assert.match(
    sessionCookie(7, request),
    /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/,
  );
  const withCookie = (c) => req("/", { headers: { cookie: c } });
  assert.equal(readSession(withCookie(cookie)), 7);
  const [name, value] = cookie.split("=");
  const [body, mac] = value.split(".");
  const forged = Buffer.from(
    JSON.stringify({ a: 1, e: Date.now() + 9e9 }),
  ).toString("base64url");
  assert.equal(readSession(withCookie(`${name}=${forged}.${mac}`)), null);
  assert.equal(readSession(withCookie(`${name}=${body}.${mac}x`)), null);
  assert.equal(
    readSession(withCookie(cookie), Date.now() + 31 * 86_400_000),
    null,
  );
  assert.equal(readSession(req("/")), null);
});

test("signing in with Google creates the account and a session; only a first name is kept", async () => {
  const credential = await signer({
    sub: "g-100",
    given_name: "Matthew",
    name: "Matthew Smith",
    email: "m@example.com",
  });
  const res = await account(
    req("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    }),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    signedIn: true,
    account: { displayName: "Matthew", credits: 10 },
    isNew: true,
  });
  const cookie = res.headers.get("set-cookie").split(";")[0];

  const me = await (
    await account(req("/api/me", { headers: { cookie } }))
  ).json();
  assert.deepEqual(me, {
    signedIn: true,
    account: {
      displayName: "Matthew",
      credits: 10,
      isAdmin: false,
      isMod: false,
      suspended: false,
    },
    googleClientId: CLIENT_ID,
  });
  const anon = await (await account(req("/api/me"))).json();
  assert.equal(anon.signedIn, false);

  const wrongAudience = await signer(
    { sub: "g-101", given_name: "Eve" },
    "someone-else",
  );
  const refused = await account(
    req("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: wrongAudience }),
    }),
  );
  assert.equal(refused.status, 401);
  const garbage = await account(
    req("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: "nope" }),
    }),
  );
  assert.equal(garbage.status, 401);

  const out = await account(req("/api/auth/logout", { method: "POST" }));
  assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
});

test("AI jobs cost a credit, need a sign-in, and refund on failure", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-4", displayName: "Di" });
  const signedIn = req("/api/idea", {
    headers: { cookie: sessionCookie(id, req("/")).split(";")[0] },
  });

  await assert.rejects(
    withCredit(req("/api/idea"), "idea", async () => ({})),
    (e) => e.status === 401,
  );
  const ok = await withCredit(signedIn, "idea", async () => ({ name: "Dish" }));
  assert.deepEqual(ok, { name: "Dish", credits: 9 });
  await assert.rejects(
    withCredit(signedIn, "idea", async () => {
      throw new Error("model fell over");
    }),
    /model fell over/,
  );
  assert.equal((await getAccount(id)).credits, 9, "failed job refunded");

  for (let i = 0; i < 9; i++)
    await withCredit(signedIn, "idea", async () => ({}));
  await assert.rejects(
    withCredit(signedIn, "idea", async () => ({})),
    (e) => e.status === 402,
  );
});

test("a suspended account can't spend credits", async () => {
  const { id } = await findOrCreateAccount({
    sub: "g-susp",
    displayName: "Sy",
  });
  await db.sql`UPDATE accounts SET suspended_at = now() WHERE id = ${id}`;
  process.env.SESSION_SECRET ??= "x".repeat(40);
  const cookie = sessionCookie(id, req("/")).split(";")[0];
  await assert.rejects(
    withCredit(req("/", { headers: { cookie } }), "idea", async () => ({})),
    /Your account is suspended/,
  );
  assert.equal((await getAccount(id)).credits, 10, "nothing was taken");
});

test("sign-ins are logged (first time as joined), and banned Google accounts can't sign in", async () => {
  const signIn = async (sub, given_name) =>
    account(
      req("/api/auth/google", {
        method: "POST",
        body: JSON.stringify({ credential: await signer({ sub, given_name }) }),
      }),
    );
  assert.equal((await signIn("g-log", "Logan")).status, 200);
  assert.equal((await signIn("g-log", "Logan")).status, 200);
  const mine = (await listActivity({ chip: "signins", limit: 200 })).entries
    .filter((e) => e.name === "Logan")
    .map((e) => e.kind);
  assert.deepEqual(mine, ["sign_in", "joined"]);

  await db.sql`INSERT INTO banned_subs (google_sub) VALUES ('g-banned')`;
  const refused = await signIn("g-banned", "Bad");
  assert.equal(refused.status, 403);
  assert.equal(
    (await refused.json()).error,
    "This Google account can't sign in here.",
  );
  const rows =
    await db.sql`SELECT id FROM accounts WHERE google_sub = 'g-banned'`;
  assert.equal(rows.length, 0, "no account was created");
});

const paidOf = async (id) =>
  Number((await db.sql`SELECT paid_credits FROM accounts WHERE id = ${id}`)[0].paid_credits);

test("free credits are spent before paid ones", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-paid-1", displayName: "Fay" });
  assert.equal(await addCredits(id, 20, "purchase", "cs_paid_1", { paid: true }), 30);
  assert.equal(await paidOf(id), 20);
  for (let i = 0; i < 10; i++) {
    const spend = await spendCredit(id, "idea");
    assert.equal(spend.paid, false);
  }
  assert.equal(await paidOf(id), 20);
  const paidSpend = await spendCredit(id, "recipe");
  assert.deepEqual(
    { credits: paidSpend.credits, paid: paidSpend.paid },
    { credits: 19, paid: true },
  );
  assert.ok(Number.isInteger(paidSpend.ledgerId));
  assert.equal(await paidOf(id), 19);
  const [row] = await db.sql`SELECT change, paid FROM credit_ledger WHERE id = ${paidSpend.ledgerId}`;
  assert.deepEqual({ change: row.change, paid: row.paid }, { change: -1, paid: true });
});

test("a failed job's credit goes back to the pool it came from", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-paid-2", displayName: "Gil" });
  await addCredits(id, 20, "purchase", "cs_paid_2", { paid: true });
  for (let i = 0; i < 10; i++) await spendCredit(id, "idea");
  const spend = await spendCredit(id, "idea");
  assert.equal(await paidOf(id), 19);
  await refundCredit(id, "idea", spend.paid);
  assert.equal(await paidOf(id), 20);
  const free = await findOrCreateAccount({ sub: "g-paid-3", displayName: "Hal" });
  const freeSpend = await spendCredit(free.id, "idea");
  await refundCredit(free.id, "idea", freeSpend.paid);
  assert.equal(await paidOf(free.id), 0);
});

test("admin removals take free credits first; grants are free", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-paid-4", displayName: "Ivy" });
  await addCredits(id, 20, "purchase", "cs_paid_4", { paid: true });
  assert.equal(await addCredits(id, -5, "admin:tidy"), 25);
  assert.equal(await paidOf(id), 20);
  assert.equal(await addCredits(id, -15, "admin:tidy"), 10);
  assert.equal(await paidOf(id), 10);
  assert.equal(await addCredits(id, 7, "admin:gift"), 17);
  assert.equal(await paidOf(id), 10);
});

const usageRows = (ledgerId) =>
  db.sql`SELECT step, model, input, output, cost_usd, failed FROM ai_usage WHERE ledger_id = ${ledgerId}`;
const lastSpend = async (id) =>
  Number(
    (
      await db.sql`SELECT max(id) AS id FROM credit_ledger WHERE account_id = ${id} AND change = -1`
    )[0].id,
  );

test("an AI job's usage is saved against the credit that paid for it", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-use-1", displayName: "Jo" });
  const signedIn = req("/api/idea", {
    headers: { cookie: sessionCookie(id, req("/")).split(";")[0] },
  });
  await withCredit(signedIn, "idea", async () => {
    const total = { ...emptyUsage("claude-opus-5-5"), calls: 1, input: 1000, output: 200 };
    logUsage("idea", total, { ms: 5 });
    return { name: "Dish" };
  });
  const rows = await usageRows(await lastSpend(id));
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { step: rows[0].step, input: rows[0].input, output: rows[0].output, failed: rows[0].failed },
    { step: "idea", input: 1000, output: 200, failed: false },
  );
  assert.equal(Number(rows[0].cost_usd), 0.008); // 1000×$4 + 200×$20 per million
});

test("a failed job's usage is saved as failed, and the credit comes back", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-use-2", displayName: "Kit" });
  const signedIn = req("/api/recipe", {
    headers: { cookie: sessionCookie(id, req("/")).split(";")[0] },
  });
  await assert.rejects(
    withCredit(signedIn, "recipe", async () => {
      logUsage("recipe", { ...emptyUsage("claude-opus-5-5"), calls: 1, input: 500 }, { failed: "no recipe" });
      throw new Error("no recipe");
    }),
  );
  const rows = await usageRows(await lastSpend(id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].failed, true);
  assert.equal((await getAccount(id)).credits, 10);
});

test("a usage row that can't be saved doesn't break the job", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-use-3", displayName: "Lu" });
  const signedIn = req("/api/idea", {
    headers: { cookie: sessionCookie(id, req("/")).split(";")[0] },
  });
  const quiet = console.error;
  console.error = () => {};
  try {
    const result = await withCredit(signedIn, "idea", async () => {
      logUsage("not-a-step", emptyUsage("claude-opus-5-5")); // fails the CHECK
      return { name: "Still fine" };
    });
    assert.equal(result.name, "Still fine");
  } finally {
    console.error = quiet;
  }
});
