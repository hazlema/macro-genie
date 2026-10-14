import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { esc, withBody, withHead } from "../src/seo/head.js";
import { FIXED_PAGES, IMAGE, SITE } from "../src/seo/pages.js";
import { plainPage, postDescription, postPage, sitemapXml } from "../server/seo.js";
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
  for (const line of ["User-agent: *", "Disallow: /admin", "Disallow: /api/", "Disallow: /credits", "Disallow: /recipes", "Disallow: /seo/", "Sitemap: https://macro-genie.com/sitemap.xml"])
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


const recipe = {
  version: 2,
  name: "Chicken Burrito Bowl",
  description: "Smoky chicken over rice with black beans.",
  servings: 2,
  perServing: { calories: 520.4, protein: 45.2, carbs: 48.6, netCarbs: 40.1, fat: 14.9, sugar: 3, sodium: 600 },
  gramsPerServing: 400,
  ingredients: [
    { id: "a", name: "Chicken breast", label: "chicken breast", grams: 300, qty: null, unit: "", prep: "diced" },
    { id: "b", name: "Rice, cooked", label: "cooked rice", grams: 300, qty: null, unit: "", prep: "" },
  ],
  seasonings: ["salt"],
  steps: ["Brown {1} in a hot pan.", "Serve over {2}."],
  tip: "",
};
const post = { id: 42, name: recipe.name, mealType: "dinner", author: "Pat", createdAt: new Date("2026-10-12T15:00:00Z"), recipe, kind: "recipe", status: "live" };

test("a recipe page carries the recipe for crawlers and previews", () => {
  const html = postPage(TEMPLATE, post);
  assert.match(html, /<title>Chicken Burrito Bowl — Macro Genie<\/title>/);
  assert.ok(html.includes(`<link rel="canonical" href="https://macro-genie.com/community/42" />`));
  assert.ok(html.includes(`<meta property="og:type" content="article" />`));
  assert.ok(html.includes("520 cal · 45 g protein"));
  assert.ok(!html.includes(`name="robots"`));
  const body = html.slice(html.indexOf(`<div id="app">`));
  assert.ok(body.includes("<h1>Chicken Burrito Bowl</h1>"));
  assert.ok(body.includes("chicken breast"));
  assert.ok(body.includes("<li>Brown 300 g in a hot pan.</li>"), "steps have amounts filled in");
  assert.ok(body.includes("Pat"));
  assert.ok(!/like|comment/i.test(body));
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld["@type"], "Recipe");
  assert.equal(ld.name, "Chicken Burrito Bowl");
  assert.equal(ld.recipeCategory, "dinner");
  assert.equal(ld.recipeYield, "2 servings");
  assert.equal(ld.author.name, "Pat");
  assert.equal(ld.datePublished, "2026-10-12");
  assert.equal(ld.recipeIngredient.length, 2);
  assert.equal(ld.recipeInstructions[0]["@type"], "HowToStep");
  assert.deepEqual(ld.nutrition, {
    "@type": "NutritionInformation",
    servingSize: "1 serving",
    calories: "520 kcal",
    proteinContent: "45 g",
    carbohydrateContent: "49 g",
    fatContent: "15 g",
  });
});

test("hostile recipe text stays inert in head, body and JSON-LD", () => {
  const evil = `</script><script>alert(1)</script> "><img src=x onerror=alert(2)> $&`;
  const html = postPage(TEMPLATE, { ...post, name: evil, author: evil, recipe: { ...recipe, name: evil, description: evil, steps: [evil] } });
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(!html.includes("<img src=x"));
  const ldText = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.ok(!ldText.includes("<"), "no raw < inside JSON-LD");
  assert.equal(JSON.parse(ldText).name, evil);
  assert.ok(html.includes("$&amp;"), "the $& stays literal (escaped)");
});

test("one serving reads in the singular", () => {
  const html = postPage(TEMPLATE, { ...post, recipe: { ...recipe, servings: 1 } });
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.recipeYield, "1 serving");
  assert.ok(html.includes("· 1 serving ·"));
});

test("postDescription is short and leads with the macros", () => {
  const d = postDescription({ ...post, recipe: { ...recipe, description: "word ".repeat(80) } });
  assert.ok(d.startsWith("Chicken Burrito Bowl · dinner · 520 cal · 45 g protein per serving."));
  assert.ok(d.length <= 160 && d.endsWith("…"));
});

test("the plain page is the app with noindex", () => {
  const html = plainPage(TEMPLATE, { path: "/community/7" });
  assert.ok(html.includes(`<meta name="robots" content="noindex" />`));
  assert.ok(html.includes(`<link rel="canonical" href="https://macro-genie.com/community/7" />`));
  assert.ok(html.includes(`<div id="app"></div>`));
});

test("the sitemap lists fixed pages and live recipes", () => {
  const xml = sitemapXml([{ id: 42, createdAt: new Date("2026-10-12T15:00:00Z") }, { id: 7, createdAt: new Date("2026-10-11T01:00:00Z") }]);
  assert.ok(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`));
  assert.ok(xml.includes(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`));
  assert.ok(xml.includes("<url><loc>https://macro-genie.com/</loc></url>"));
  assert.ok(xml.includes("<url><loc>https://macro-genie.com/help/start</loc></url>"));
  assert.ok(xml.includes("<url><loc>https://macro-genie.com/community/42</loc><lastmod>2026-10-12</lastmod></url>"));
  assert.equal((xml.match(/<url>/g) ?? []).length, FIXED_PAGES.length + 2);
  for (const p of ["/admin", "/credits", "/recipes", "/api"]) assert.ok(!xml.includes(`<loc>${SITE}${p}</loc>`), p);
});

const DIRTY = TEMPLATE.replace("</head>", `<link rel="canonical" href="https://macro-genie.com/" />
<meta property="og:title" content="STALE" /><meta property="og:url" content="https://macro-genie.com/" />
<meta name="twitter:card" content="summary" /><meta name="robots" content="index" /></head>`);
const count = (html, re) => (html.match(re) ?? []).length;
const assertClean = (html, canonical) => {
  assert.equal(count(html, /rel="canonical"/g), 1);
  assert.ok(html.includes(`rel="canonical" href="${canonical}"`));
  assert.equal(count(html, /og:title/g), 1);
  assert.equal(count(html, /og:url/g), 1);
  assert.equal(count(html, /twitter:card/g), 1);
  assert.ok(!html.includes("STALE") && !html.includes(`content="summary"`) && !html.includes(`content="index"`));
};

test("withHead, postPage and plainPage replace tags a template already carries", () => {
  assertClean(withHead(DIRTY, { title: "T", description: "D", canonical: `${SITE}/foods`, image: IMAGE }), `${SITE}/foods`);
  assertClean(plainPage(DIRTY, { path: "/community/abc" }), `${SITE}/community/abc`);
  const post = { id: 7, name: "Bowl", mealType: "dinner", author: "Pat", createdAt: new Date("2026-10-12T15:00:00Z"), kind: "recipe", status: "live",
    recipe: { name: "Bowl", description: "Good.", servings: 1, perServing: { calories: 500, protein: 40, carbs: 50, fat: 10 }, ingredients: [], seasonings: [], steps: ["Cook."] } };
  assertClean(postPage(DIRTY, post), `${SITE}/community/7`);
});

test("the template loader prefers the clean shell and falls back to index.html on 404", async () => {
  const { fetchTemplate } = await import("../server/seo.js");
  const seen = [];
  const make = (shellStatus) => async (url) => {
    seen.push(url);
    return url.endsWith("/seo/shell.html")
      ? new Response("shell", { status: shellStatus })
      : new Response("index", { status: 200 });
  };
  assert.equal(await fetchTemplate("https://x", make(200)), "shell");
  seen.length = 0;
  assert.equal(await fetchTemplate("https://x", make(404)), "index");
  assert.deepEqual(seen, ["https://x/seo/shell.html", "https://x/index.html"]);
  await assert.rejects(fetchTemplate("https://x", make(500)));
});

// Needs `npm run build` first; skipped when there's no dist.
test("the build keeps a clean shell and the home page carries one canonical", { skip: !existsSync("dist/seo/shell.html") }, () => {
  const shell = readFileSync("dist/seo/shell.html", "utf8");
  assert.ok(shell.includes('<div id="app"></div>'), "withBody needs this exact mount point");
  assert.equal(count(shell, /rel="canonical"/g), 0);
  assert.equal(count(shell, /og:title/g), 0);
  assert.equal(count(readFileSync("dist/index.html", "utf8"), /rel="canonical"/g), 1);
});
