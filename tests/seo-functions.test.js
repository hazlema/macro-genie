import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
import { connect, useDatabase } from "../server/db.js";
import { findOrCreateAccount } from "../server/accounts.js";
import { purgePost, usePurge, useTemplate } from "../server/seo.js";
import seoPost from "../netlify/functions/seo-post.js";
import * as seoMod from "../netlify/functions/seo-post.js";
import * as sitemapMod from "../netlify/functions/sitemap.js";
import sitemap from "../netlify/functions/sitemap.js";

const TEMPLATE = `<!doctype html><html><head><meta name="description" content="x" /><title>x</title></head><body><div id="app"></div></body></html>`;
const recipe = {
  version: 2, name: "Bowl", description: "Good.", servings: 1,
  perServing: { calories: 500, protein: 40, carbs: 50, netCarbs: 45, fat: 10, sugar: 2, sodium: 300 },
  gramsPerServing: 300, ingredients: [{ id: "a", name: "Rice", label: "rice", grams: 300, qty: null, unit: "", prep: "" }],
  seasonings: [], steps: ["Cook {1}."], tip: "",
};
let server, db, author, origins;

before(async () => {
  server = new NetlifyDB();
  const cs = await server.start();
  await server.applyMigrations("./db/migrations");
  db = connect(cs);
  useDatabase(db);
  author = await findOrCreateAccount({ sub: "seo-author", displayName: "Pat" });
});
beforeEach(async () => {
  origins = [];
  useTemplate(async (origin) => { origins.push(origin); return TEMPLATE; });
  await db.sql`DELETE FROM page_builds`;
});
after(async () => { await db?.pool.end(); await server?.stop(); });

const insertPost = async (overrides = {}) => {
  const o = { kind: "recipe", status: "live", ...overrides };
  const rows = o.kind === "recipe"
    ? await db.sql`INSERT INTO posts (account_id, kind, recipe, name, meal_type, calories, protein, net_carbs, fat, sugar, sodium, status, created_at)
                   VALUES (${author.id}, 'recipe', ${JSON.stringify(recipe)}, 'Bowl', 'dinner', 500, 40, 45, 10, 2, 300, ${o.status}, '2026-10-12T15:00:00Z') RETURNING id`
    : await db.sql`INSERT INTO posts (account_id, kind, board, name, body, status)
                   VALUES (${author.id}, 'thread', 'general', 'Hi', 'Hello', ${o.status}) RETURNING id`;
  return Number(rows[0].id);
};
const get = (fn, path) => fn(new Request(`https://macro-genie.com${path}`));

test("a live recipe is a cached real page", async () => {
  const id = await insertPost();
  const res = await get(seoPost, `/community/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(res.headers.get("netlify-cdn-cache-control"), "public, durable, s-maxage=86400, stale-while-revalidate=604800");
  assert.equal(res.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(res.headers.get("netlify-cache-tag"), `post-${id},posts`);
  const html = await res.text();
  assert.match(html, /<title>Bowl — Macro Genie<\/title>/);
  assert.ok(!html.includes("noindex"));
  assert.deepEqual(origins, ["https://macro-genie.com"]);
});

test("threads, waiting posts and unknown or bad ids get the plain noindex page", async () => {
  const thread = await insertPost({ kind: "thread" });
  const held = await insertPost({ status: "held" });
  const blocked = await insertPost({ status: "blocked" });
  const removed = await insertPost({ status: "removed" });
  for (const path of [`/community/${thread}`, `/community/${held}`, `/community/${blocked}`, `/community/${removed}`,
    "/community/99999999", "/community/abc", "/community/0", "/community/12.5", "/community/99999999999999999999"]) {
    const res = await get(seoPost, path);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.ok(html.includes(`<meta name="robots" content="noindex" />`), path);
    assert.ok(html.includes(`<div id="app"></div>`), path);
  }
  // Waiting posts are cached under their tag, so approving them clears it.
  const res = await get(seoPost, `/community/${held}`);
  assert.equal(res.headers.get("netlify-cache-tag"), `post-${held},posts`);
});

test("database trouble falls back to the plain page, never cached", async () => {
  const id = await insertPost();
  const quiet = console.error;
  console.error = () => {};
  useDatabase({ sql: async () => { throw new Error("db down"); }, pool: { query: async () => { throw new Error("db down"); } } });
  try {
    const res = await get(seoPost, `/community/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("netlify-cdn-cache-control"), null);
    assert.ok((await res.text()).includes("noindex"));
    const map = await get(sitemap, "/sitemap.xml");
    assert.equal(map.status, 503);
    assert.equal(map.headers.get("cache-control"), "no-store");
  } finally {
    useDatabase(db);
    console.error = quiet;
  }
});

test("the sitemap lists live recipes only, cached under its tag", async () => {
  const live = await insertPost();
  const held = await insertPost({ status: "held" });
  const thread = await insertPost({ kind: "thread" });
  const res = await get(sitemap, "/sitemap.xml");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/xml; charset=utf-8");
  assert.equal(res.headers.get("netlify-cache-tag"), "sitemap");
  const xml = await res.text();
  assert.ok(xml.includes(`/community/${live}</loc><lastmod>2026-10-12</lastmod>`));
  assert.ok(!xml.includes(`/community/${held}<`) && !xml.includes(`/community/${thread}<`));
});

test("each page build is counted for the Money tab", async () => {
  const id = await insertPost();
  await get(seoPost, `/community/${id}`);
  await get(sitemap, "/sitemap.xml");
  const [row] = await db.sql`SELECT builds, ms FROM page_builds`;
  assert.equal(row.builds, 2);
  assert.ok(Number(row.ms) >= 0);
});

test("a live recipe with malformed data gets the plain page, never cached, no 500", async () => {
  const id = await insertPost();
  await db.sql`UPDATE posts SET recipe = ${JSON.stringify({ ...recipe, steps: [42] })} WHERE id = ${id}`;
  const quiet = console.error;
  console.error = () => {};
  try {
    const res = await get(seoPost, `/community/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok((await res.text()).includes("noindex"));
  } finally {
    console.error = quiet;
  }
});

test("HEAD requests are answered", async () => {
  const id = await insertPost();
  const res = await seoPost(new Request(`https://macro-genie.com/community/${id}`, { method: "HEAD" }));
  assert.equal(res.status, 200);
  for (const mod of [seoMod, sitemapMod]) assert.ok(mod.config.method.includes("HEAD") && mod.config.method.includes("GET"));
});

test("purgePost clears each post and the sitemap, and never throws", async () => {
  const seen = [];
  usePurge(async (tags) => { seen.push(tags); });
  await purgePost(5);
  await purgePost([6, 7]);
  assert.deepEqual(seen, [["post-5", "sitemap"], ["post-6", "post-7", "sitemap"]]);
  await purgePost([]);
  assert.equal(seen.length, 2, "nothing to clear, no call");
  const quiet = console.error;
  console.error = () => {};
  try {
    usePurge(async () => { throw new Error("netlify down"); });
    await purgePost(8); // resolves
  } finally {
    console.error = quiet;
  }
});
