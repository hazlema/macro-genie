import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { esc, withBody, withHead } from "../src/seo/head.js";
import { FIXED_PAGES, IMAGE, SITE } from "../src/seo/pages.js";
import { GUIDES } from "../src/help/index.js";

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="description"
      content="Old description."
    />
    <title>Old title</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/assets/index-abc.js"></script>
  </body>
</html>`;

test("esc escapes the five HTML specials", () => {
  assert.equal(esc(`<a href="x">Tom & 'Jerry'</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
  assert.equal(esc(null), "");
});

test("withHead sets title, description, canonical, Open Graph and Twitter tags", () => {
  const html = withHead(TEMPLATE, {
    title: "Recipe Builder — Macro Genie",
    description: "Set your numbers.",
    canonical: `${SITE}/builder`,
    image: IMAGE,
  });
  assert.match(html, /<title>Recipe Builder — Macro Genie<\/title>/);
  assert.equal((html.match(/<title>/g) ?? []).length, 1);
  assert.match(html, /<meta name="description" content="Set your numbers\." \/>/);
  assert.ok(!html.includes("Old description"));
  for (const tag of [
    `<link rel="canonical" href="https://macro-genie.com/builder" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="Recipe Builder — Macro Genie" />`,
    `<meta property="og:url" content="https://macro-genie.com/builder" />`,
    `<meta property="og:image" content="https://macro-genie.com/img/og.jpg" />`,
    `<meta property="og:site_name" content="Macro Genie" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ])
    assert.ok(html.includes(tag), `missing ${tag}`);
  assert.ok(!html.includes(`name="robots"`));
  assert.ok(html.includes(`<script type="module" src="/assets/index-abc.js"></script>`));
});

test("withHead keeps hostile text literal and can add noindex", () => {
  const html = withHead(TEMPLATE, {
    title: `$& "><script>alert(1)</script>`,
    description: "$1 $'",
    canonical: `${SITE}/x`,
    image: IMAGE,
    noindex: true,
  });
  assert.ok(html.includes("<title>$&amp; &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>"));
  assert.ok(html.includes(`content="$1 $&#39;"`));
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(html.includes(`<meta name="robots" content="noindex" />`));
});

test("withBody fills the app container once", () => {
  const html = withBody(TEMPLATE, "<article>$& hi</article>");
  assert.ok(html.includes(`<div id="app"><article>$& hi</article></div>`));
});

test("fixed pages: every indexed page, each with its own title and description", () => {
  const paths = FIXED_PAGES.map((p) => p.path);
  for (const p of ["/", "/foods", "/builder", "/community", "/help", "/terms", "/refunds", "/privacy", "/contact"])
    assert.ok(paths.includes(p), `missing ${p}`);
  for (const g of GUIDES) assert.ok(paths.includes(`/help/${g.slug}`), `missing guide ${g.slug}`);
  for (const p of ["/admin", "/credits", "/recipes"]) assert.ok(!paths.includes(p));
  assert.equal(new Set(FIXED_PAGES.map((p) => p.title)).size, FIXED_PAGES.length);
  for (const p of FIXED_PAGES) {
    assert.ok(p.title.endsWith("Macro Genie") || p.path === "/", p.path);
    assert.ok(p.description.length >= 50 && p.description.length <= 170, `${p.path} description length ${p.description.length}`);
  }
});

test("robots.txt blocks private paths and points at the sitemap", () => {
  const robots = readFileSync("public/robots.txt", "utf8");
  for (const line of ["User-agent: *", "Disallow: /admin", "Disallow: /api/", "Disallow: /credits", "Disallow: /recipes", "Sitemap: https://macro-genie.com/sitemap.xml"])
    assert.ok(robots.split("\n").includes(line), `missing ${line}`);
});

test("the build writes one page per fixed path", async () => {
  const { fixedPageFiles } = await import("../src/seo/pages.js");
  const files = fixedPageFiles(TEMPLATE);
  assert.equal(files.length, FIXED_PAGES.length);
  const builder = files.find((f) => f.file === "seo/builder.html");
  assert.ok(files.some((f) => f.file === "seo/help--start.html"));
  assert.match(builder.html, /<title>Recipe Builder — Macro Genie<\/title>/);
  const home = files.find((f) => f.file === "index.html");
  assert.match(home.html, /og:url" content="https:\/\/macro-genie.com\/"/);
});

test("the build's _redirects rewrite each fixed path to its file, without changing the URL", async () => {
  const { seoRedirects } = await import("../src/seo/pages.js");
  const lines = seoRedirects().trim().split("\n");
  assert.ok(lines.includes("/foods /seo/foods.html 200"));
  assert.ok(lines.includes("/help/start /seo/help--start.html 200"));
  assert.ok(lines.includes("/help /seo/help.html 200"));
  assert.ok(!lines.some((l) => l.startsWith("/ ") || l.includes("/community/")));
});
