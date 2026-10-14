import { purgeCache } from "@netlify/functions";
import { database } from "./db.js";
import { renderRecipe } from "../src/lib/scale.js";
import { esc, withBody, withHead } from "../src/seo/head.js";
import { FIXED_PAGES, IMAGE, SHELL_PATH, SITE } from "../src/seo/pages.js";

// Search engines and link previews: a community recipe as a real page, the
// plain app page for everything else, and the sitemap.

const round = (n) => Math.round(Number(n) || 0);
const servingsText = (n) => `${n} ${Number(n) === 1 ? "serving" : "servings"}`;
const day = (date) => new Date(date).toISOString().slice(0, 10);
// JSON inside <script>: "<" can't close the tag once it's <.
const jsonLd = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

export function postDescription(post) {
  const n = post.recipe.perServing ?? {};
  const lead = `${post.name} · ${post.mealType} · ${round(n.calories)} cal · ${round(n.protein)} g protein per serving.`;
  const full = `${lead} ${post.recipe.description ?? ""}`.trim();
  if (full.length <= 160) return full;
  const cut = full.slice(0, 159);
  return `${cut.slice(0, cut.lastIndexOf(" ")).trimEnd()}…`;
}

function recipeLd(post, shown) {
  const n = post.recipe.perServing ?? {};
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: post.name,
    description: post.recipe.description ?? "",
    author: { "@type": "Person", name: post.author },
    datePublished: day(post.createdAt),
    recipeCategory: post.mealType,
    recipeYield: servingsText(post.recipe.servings),
    recipeIngredient: shown.ingredients.map((i) => (i.prep ? `${i.text}, ${i.prep}` : i.text)),
    recipeInstructions: shown.steps.map((text) => ({ "@type": "HowToStep", text })),
    nutrition: {
      "@type": "NutritionInformation",
      servingSize: "1 serving",
      calories: `${round(n.calories)} kcal`,
      proteinContent: `${round(n.protein)} g`,
      carbohydrateContent: `${round(n.carbs)} g`,
      fatContent: `${round(n.fat)} g`,
    },
  };
}

export function postPage(template, post) {
  const shown = renderRecipe(post.recipe);
  const n = post.recipe.perServing ?? {};
  const canonical = `${SITE}/community/${post.id}`;
  const body = [
    `<article>`,
    `<h1>${esc(post.name)}</h1>`,
    `<p>${esc(post.recipe.description ?? "")}</p>`,
    `<p>${esc(post.mealType)} · ${esc(servingsText(post.recipe.servings))} · per serving: ${round(n.calories)} cal, ${round(n.protein)} g protein, ${round(n.carbs)} g carbs, ${round(n.fat)} g fat</p>`,
    `<h2>Ingredients</h2><ul>${shown.ingredients.map((i) => `<li>${esc(i.prep ? `${i.text}, ${i.prep}` : i.text)}</li>`).join("")}</ul>`,
    `<h2>Steps</h2><ol>${shown.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`,
    `<p>Shared by ${esc(post.author)} on ${day(post.createdAt)}</p>`,
    `</article>`,
  ].join("");
  const page = withHead(template, {
    title: `${post.name} — Macro Genie`,
    description: postDescription(post),
    canonical,
    image: IMAGE,
    type: "article",
    extraHead: `<script type="application/ld+json">${jsonLd(recipeLd(post, shown))}</script>`,
  });
  return withBody(page, body);
}

export const plainPage = (template, { path }) =>
  withHead(template, {
    title: "Macro Genie — Your macros, granted",
    description: FIXED_PAGES[0].description,
    canonical: `${SITE}${path}`,
    image: IMAGE,
    noindex: true,
  });

export function sitemapXml(posts) {
  const urls = [
    ...FIXED_PAGES.map((p) => `<url><loc>${esc(SITE + p.path)}</loc></url>`),
    ...posts.map((p) => `<url><loc>${SITE}/community/${Number(p.id)}</loc><lastmod>${day(p.createdAt)}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}


export const NO_STORE = { "Cache-Control": "no-store" };

// Netlify's CDN keeps the page until a purge of one of its tags, or a day.
// Browsers always ask the CDN again.
// Netlify-Vary makes ?fbclid= and ?utm_* variants share one cache entry.
export const cacheHeaders = (tags, { maxAge = 86400 } = {}) => ({
  "Netlify-CDN-Cache-Control": `public, durable, s-maxage=${maxAge}, stale-while-revalidate=604800`,
  "Netlify-Vary": "query=v",
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Netlify-Cache-Tag": tags.join(","),
});

// The built index.html (with this deploy's hashed script names), fetched
// from the site itself once per function instance; under npm run dev it's
// Vite's page.
let template = null;
// The build keeps an untouched copy at SHELL_PATH (index.html itself carries
// the home page's tags); there's none under npm run dev, so fall back.
export async function fetchTemplate(origin, fetcher = fetch) {
  let res = await fetcher(`${origin}${SHELL_PATH}`);
  if (res.status === 404) res = await fetcher(`${origin}/index.html`);
  if (!res.ok) throw new Error(`template ${res.status}`);
  return res.text();
}
let loadTemplate = fetchTemplate;
export function useTemplate(fn) {
  loadTemplate = fn;
  template = null;
}
export async function getTemplate(origin) {
  template ??= await loadTemplate(origin);
  return template;
}

export async function livePost(id) {
  const { rows } = await database().pool.query(
    `SELECT p.id, p.name, p.meal_type, p.recipe, p.created_at, a.display_name AS author
       FROM posts p JOIN accounts a ON a.id = p.account_id
      WHERE p.id = $1 AND p.kind = 'recipe' AND p.status = 'live'`,
    [id],
  );
  const r = rows[0];
  return r
    ? { id: Number(r.id), name: r.name, mealType: r.meal_type, recipe: r.recipe, createdAt: r.created_at, author: r.author, kind: "recipe", status: "live" }
    : null;
}

export async function liveRecipes() {
  const rows = await database().sql`
    SELECT id, created_at FROM posts WHERE kind = 'recipe' AND status = 'live' ORDER BY id`;
  return rows.map((r) => ({ id: Number(r.id), createdAt: r.created_at }));
}

// Adds one server-built page and its run time to this month, for the Money
// tab. Never throws: a lost count only makes the estimate a little low.
export async function recordPageBuild(ms) {
  try {
    await database().sql`
      INSERT INTO page_builds (month, builds, ms)
      VALUES (date_trunc('month', now() AT TIME ZONE 'UTC')::date, 1, ${Math.round(ms)})
      ON CONFLICT (month) DO UPDATE
        SET builds = page_builds.builds + 1, ms = page_builds.ms + EXCLUDED.ms`;
  } catch (error) {
    console.error("page_builds:", error.message);
  }
}

// Only the real Netlify runtime has a CDN to clear.
let purge = async (tags) => {
  if (process.env.MACRO_GENIE_LOCAL || !process.env.NETLIFY_PURGE_API_TOKEN) return;
  await purgeCache({ tags });
};
export function usePurge(fn) {
  purge = fn;
}

// After a post goes live, comes down or is deleted: its page and the
// sitemap are rebuilt on the next visit. Never throws. Netlify allows each
// tag to be purged twice per 5 seconds, and "sitemap" is in every call, so
// the post's own tags go first in a call of their own. A dropped sitemap
// purge heals within the sitemap's hour; a missed post purge within a day.
export async function purgePost(ids) {
  const list = [ids].flat().map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
  if (!list.length) return;
  for (const tags of [list.map((id) => `post-${id}`), ["sitemap"]]) {
    try {
      await purge(tags);
    } catch (error) {
      console.error("purge:", error.message);
    }
  }
}
