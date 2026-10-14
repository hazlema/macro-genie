import { GUIDES } from "../help/index.js";
import { withHead } from "./head.js";

// The pages search engines should find, each with its own title and
// description. Community recipes are added by the sitemap function.
export const SITE = "https://macro-genie.com";
export const IMAGE = `${SITE}/img/og.jpg`;

export const FIXED_PAGES = [
  { path: "/", title: "Macro Genie — Your macros, granted", description: "Set your protein, carbs and calories, name the kind of dish, and Macro Genie writes a recipe sized to hit your numbers." },
  { path: "/foods", title: "Food Macros — Macro Genie", description: "Search 8,490 USDA foods by protein, net carbs, calories, fat, sugar and sodium per serving. Free, no account needed." },
  { path: "/builder", title: "Recipe Builder — Macro Genie", description: "Pick foods, set your macro targets, and the genie sizes every gram so each serving lands in range, then writes the recipe." },
  { path: "/community", title: "Community Recipes — Macro Genie", description: "Browse recipes shared by Macro Genie cooks, filtered by meal type and by protein, carbs and calories per serving." },
  { path: "/help", title: "Help — Macro Genie", description: "How Macro Genie works: finding foods by macros, building and writing recipes, credits, the community, and the MCP server." },
  ...GUIDES.map((g) => ({ path: `/help/${g.slug}`, title: `${g.title} — Macro Genie`, description: g.summary.length >= 50 ? g.summary : `${g.summary} A Macro Genie help guide.` })),
  { path: "/terms", title: "Terms — Macro Genie", description: "The terms for using Macro Genie: accounts, credits, community posts, and what the AI-written recipes are and aren't." },
  { path: "/refunds", title: "Refunds — Macro Genie", description: "Macro Genie's refund policy: unused credits from a pack can be refunded within 30 days. How to ask, and how long it takes." },
  { path: "/privacy", title: "Privacy — Macro Genie", description: "What Macro Genie keeps about you (a Google id and a first name, no email) and what it never collects." },
  { path: "/contact", title: "Contact — Macro Genie", description: "Questions, refunds or problems with Macro Genie? Send a message and we'll reply by email." },
];

// The build's copies of index.html, one per fixed page, kept in seo/ and
// reached through _redirects rewrites so the URL never changes ("/foods"
// stays "/foods"; a foods/index.html folder could make Netlify add a "/").
const fileFor = (path) => (path === "/" ? "index.html" : `seo/${path.slice(1).replaceAll("/", "--")}.html`);

export const fixedPageFiles = (template) =>
  FIXED_PAGES.map((p) => ({
    file: fileFor(p.path),
    html: withHead(template, { title: p.title, description: p.description, canonical: `${SITE}${p.path}`, image: IMAGE }),
  }));

// dist/_redirects (read before netlify.toml): each fixed path to its file.
export const seoRedirects = () =>
  FIXED_PAGES.filter((p) => p.path !== "/").map((p) => `${p.path} /${fileFor(p.path)} 200`).join("\n") + "\n";
