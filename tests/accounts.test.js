import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
import { getDatabase } from "@netlify/database";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { useDatabase } from "../server/db.js";
import {
  addCredits,
  findOrCreateAccount,
  getAccount,
  spendCredit,
} from "../server/accounts.js";
import { withCredit } from "../server/credits.js";
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
  await server.applyMigrations("./netlify/database/migrations");
  db = getDatabase({ connectionString });
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
    account: { displayName: "Matthew", credits: 10, isAdmin: false },
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
