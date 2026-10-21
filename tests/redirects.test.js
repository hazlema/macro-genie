import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Every address the app answers must load the page on a direct visit or a
// refresh, or Netlify shows its 404 (as /help and /refunds did until 2026-10-14).
test("netlify.toml sends every app address to the page", () => {
  const toml = readFileSync("netlify.toml", "utf8");
  const froms = [...toml.matchAll(/from = "([^"]+)"\s+to = "\/index\.html"\s+status = 200/g)].map((m) => m[1]);
  for (const path of [
    "/foods", "/builder", "/community", "/recipes", "/recipes/*",
    "/help", "/help/*", "/admin", "/admin/*",
    "/terms", "/refunds", "/privacy", "/contact", "/credits", "/redeem",
  ])
    assert.ok(froms.includes(path), `missing redirect for ${path}`);
  assert.ok(!froms.includes("/community/*"), "/community/<id> is served by the seo-post function");
  assert.ok(!froms.some((f) => f.startsWith("/api") || f === "/*"), "no catch-all, /api untouched");
});

// /redeem is only reached from invite emails; search engines skip it.
test("netlify.toml keeps /redeem out of search", () => {
  const toml = readFileSync("netlify.toml", "utf8");
  assert.match(toml, /for = "\/redeem"\s+\[headers\.values\]\s+X-Robots-Tag = "noindex"/);
});
