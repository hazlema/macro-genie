import { renderRecipe } from "../src/lib/scale.js";
import { esc, withBody, withHead } from "../src/seo/head.js";
import { FIXED_PAGES, IMAGE, SITE } from "../src/seo/pages.js";

// Search engines and link previews: a community recipe as a real page, the
// plain app page for everything else, and the sitemap.

const round = (n) => Math.round(Number(n) || 0);
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
    recipeYield: `${post.recipe.servings} servings`,
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
    `<p>${esc(post.mealType)} · ${esc(post.recipe.servings)} servings · per serving: ${round(n.calories)} cal, ${round(n.protein)} g protein, ${round(n.carbs)} g carbs, ${round(n.fat)} g fat</p>`,
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
