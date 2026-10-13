# Help Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/help` hub with nine illustrated step-by-step guides (including MCP and Cronometer), the policy pages Stripe expects (`/terms`, `/refunds`, `/privacy`, `/contact`), a contact form feeding an Admin → Inbox tab, and a "Copy ingredients" button on recipe cards.

**Architecture:** Guides are plain JS content modules (`src/help/*.js`) rendered by one Svelte component; text is Markdown through the existing safe renderer. Screenshots come from a Playwright script against the local dev site with `/api/me` mocked and a captured browser-state fixture, so they can be re-taken in one command. The contact form posts to a new function that stores rows in a `messages` table; mods/admins read them in a new Admin tab, and each message adds a log entry under a new Messages chip.

**Tech Stack:** Svelte 5, Netlify Functions, Postgres (`pg`; `@netlify/database-dev` in tests), `node --test`, Playwright (dev only).

**Spec:** `docs/superpowers/specs/2026-10-13-help-section-design.md`

## Global Constraints

- Routes: `/help`, `/help/<slug>` for slugs `start, macros, builder, credits, book, community, mcp, cronometer, faq`; unknown slug shows the hub. Policy routes `/terms`, `/refunds`, `/privacy`, `/contact`.
- Refunds: unused credits refundable within 30 days of purchase; used credits aren't; failed AI jobs are refunded automatically.
- Privacy facts: stored = Google account id, display name, credits + history, community posts/comments/likes/reports, contact messages; not stored = email, password; in-browser only = Recipe Book, dislikes, recipe in progress; processors = Netlify, Neon, Anthropic, Google, Stripe (later); no ads or trackers on this site.
- Contact: topics `Question`, `Refund`, `Delete my data`, `Bug`, `Other`; message 10–3,000 chars; email required when signed out; honeypot field `website`; never show the owner's email anywhere.
- MCP URL shown is `${location.origin}/mcp` (follows the real domain).
- Screenshots: desktop 1280×800, phone 390×844, device scale 2; never real AI calls or real accounts during capture except the one-time fixture capture in Task 7.
- Policy pages are drafts for the owner to review; each shows "Last updated October 13, 2026".
- Phones: no sideways overflow at 360 and 390 px; 16 px form fields (already global).
- No push without the owner's OK. Commit locally per task.

## Review Focus

- A guide image that's missing must not break the page: the step still renders with its text. → test in Task 3 (data test checks every referenced file exists, so missing files fail CI instead of users).
- Contact form submitted twice quickly (double tap) must not create two messages. → test in Task 5 (identical body from the same sender within 60 s is stored once).
- Message text with HTML or Markdown must show as plain text in the Inbox. → Task 6 renders with `{text}` interpolation (Svelte escapes), never `{@html}`; checked in the browser step.
- Copy ingredients at a different servings count must copy the scaled amounts shown on screen. → test in Task 1.
- `/help/<unknown>` and `/help/` (trailing slash) must land on the hub, not a blank page. → test in Task 2.

---

## File Structure

- `src/lib/scale.js` — add `ingredientLines(recipe, servings)`; `structuredText` reuses it.
- `src/components/RecipeCard.svelte` — "Copy ingredients" button.
- `src/lib/route.svelte.js` — help and policy routes.
- `src/help/*.js` — one content module per guide; `src/help/index.js` lists them; `src/help/policies.js` holds the three policy texts.
- `src/components/Help.svelte` (hub or guide), `HelpGuide.svelte` (one guide), `PolicyPage.svelte`, `ContactPage.svelte`, `FooterLinks.svelte`, `AdminInbox.svelte`.
- `db/migrations/20261013140000_messages.sql`, `server/messages.js`, `netlify/functions/contact.js`; admin endpoints in `netlify/functions/admin.js`; `server/activity.js` gets the Messages chip.
- `scripts/screenshots.js`, `scripts/placeholders.js`, `scripts/help-fixtures/prefs.json`; images in `public/help/`.
- Tests: `tests/scale.test.js`, `tests/route.test.js`, `tests/help.test.js` (new), `tests/contact.test.js` (new).

---

### Task 1: Copy ingredients

**Files:**
- Modify: `src/lib/scale.js` (`structuredText`, new `ingredientLines`), `src/components/RecipeCard.svelte`, `src/style.css`
- Test: `tests/scale.test.js`

**Interfaces:**
- Produces: `ingredientLines(recipe, servings = recipe.servings) → string` (lines joined by `\n`, no bullets, seasonings line last).

- [ ] **Step 1: Failing test** — add `ingredientLines` to the import list in `tests/scale.test.js` and append:

```js
test("Copy ingredients gives one line per ingredient at the shown servings, ready for Cronometer", () => {
  assert.equal(
    ingredientLines(recipe),
    [
      "1 cup canned pumpkin (230 g)",
      "2 tbsp olive oil (30 g), divided",
      "3 large eggs (150 g)",
      "120 g Gruyère, shredded",
      "salt, nutmeg, to taste",
    ].join("\n"),
  );
  const doubled = ingredientLines(recipe, 8).split("\n");
  assert.equal(doubled[0], "2 cups canned pumpkin (460 g)");
  assert.equal(doubled[3], "240 g Gruyère, shredded");
  assert.equal(ingredientLines({ ...recipe, seasonings: [] }).split("\n").length, 4);
});
```

- [ ] **Step 2: Run** `node --test tests/scale.test.js` — Expected: FAIL (`ingredientLines` is not exported). If the eggs line renders differently (e.g. "3 large eggs" without grams because the unit is a count), change the expected line to what `renderRecipe` displays on the card; the requirement is "exactly as displayed".

- [ ] **Step 3: Implement** in `src/lib/scale.js`, above `structuredText`:

```js
// The ingredient list as shown on the card, one per line, for pasting into
// Cronometer's "Paste Ingredients" recipe import (or anywhere else).
export function ingredientLines(recipe, servings = recipe.servings) {
  const r = renderRecipe(recipe, servings);
  return [
    ...r.ingredients.map(
      (i) =>
        `${i.text}${i.measured ? ` (${i.grams} g)` : ""}${i.prep ? `, ${i.prep}` : ""}`,
    ),
    ...(recipe.seasonings?.length
      ? [`${recipe.seasonings.join(", ")}, to taste`]
      : []),
  ].join("\n");
}
```

and in `structuredText`, replace the two blocks that build ingredient lines (`...r.ingredients.map(…)` and the seasonings spread) with:

```js
    ...ingredientLines(recipe, servings)
      .split("\n")
      .map((line) => `- ${line}`),
```

- [ ] **Step 4: Run** `node --test tests/scale.test.js` — Expected: PASS (including the existing "copied text" test).

- [ ] **Step 5: Button** — in `src/components/RecipeCard.svelte` add to the imports `import { ingredientLines, renderRecipe } from '../lib/scale.js';` (replacing the `renderRecipe`-only import), add to the script:

```js
  let copiedIngredients = $state(false);
  async function copyIngredients() {
    try {
      await navigator.clipboard.writeText(ingredientLines(recipe, servings));
      copiedIngredients = true;
      setTimeout(() => (copiedIngredients = false), 2000);
    } catch {
      copiedIngredients = false;
    }
  }
```

and replace `<h3>Ingredients</h3>` with:

```svelte
      <div class="card-subhead">
        <h3>Ingredients</h3>
        {#if !writing}<button class="text-button copy-ingredients" onclick={copyIngredients}>{copiedIngredients ? 'Copied' : 'Copy ingredients'}</button>{/if}
      </div>
```

Append to `src/style.css`:

```css
.card-subhead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.card-subhead .copy-ingredients {
  padding: 4px 0;
  font-size: 13px;
}
@media print {
  .copy-ingredients {
    display: none;
  }
}
```

- [ ] **Step 6: Verify** `npm run check && npm test` — 0 errors, all pass.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/scale.js tests/scale.test.js
git add src/lib/scale.js src/components/RecipeCard.svelte src/style.css tests/scale.test.js
git commit -m "Recipe cards: Copy ingredients (one line each, ready for Cronometer)"
```

---

### Task 2: Help and policy routes

**Files:**
- Modify: `src/lib/route.svelte.js`
- Test: `tests/route.test.js`

**Interfaces:**
- Produces: `parse("/help/mcp") → { tab: "help", postId: null, recipeId: null, helpSlug: "mcp" }`; `parse("/help") → { …, tab: "help", helpSlug: null }`; `parse("/terms") → { tab: "page", postId: null, recipeId: null, page: "terms" }` (same for `refunds`, `privacy`, `contact`); `pathFor({ tab: "help", helpSlug })`, `pathFor({ tab: "page", page })`.

- [ ] **Step 1: Failing test** — append inside the existing test in `tests/route.test.js`:

```js
    assert.deepEqual(parse("/help"), {
      tab: "help",
      postId: null,
      recipeId: null,
      helpSlug: null,
    });
    assert.equal(parse("/help/mcp").helpSlug, "mcp");
    assert.equal(parse("/help/").helpSlug, null);
    assert.equal(parse("/help/Not-A-Guide!").helpSlug, null);
    assert.deepEqual(parse("/terms"), {
      tab: "page",
      postId: null,
      recipeId: null,
      page: "terms",
    });
    for (const p of ["refunds", "privacy", "contact"])
      assert.equal(parse(`/${p}`).page, p);
    assert.equal(pathFor({ tab: "help" }), "/help");
    assert.equal(pathFor({ tab: "help", helpSlug: "cronometer" }), "/help/cronometer");
    assert.equal(pathFor({ tab: "page", page: "privacy" }), "/privacy");
```

- [ ] **Step 2: Run** `node --test tests/route.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** — in `src/lib/route.svelte.js` add to the header comment `//   /help, /help/<guide>   Help;  /terms /refunds /privacy /contact   policies`, and:

```js
const PAGES = ["terms", "refunds", "privacy", "contact"];
// Guide slugs are lowercase words; anything else shows the help hub.
const SLUG = /^[a-z]+$/;
```

In `parse`, compute the tab with help/pages first:

```js
  const tab =
    section === "admin"
      ? "admin"
      : section === "help"
        ? "help"
        : PAGES.includes(section)
          ? "page"
          : section
            ? (TABS[section] ?? "community")
            : "home";
```

and add to the returned object, next to the admin spread:

```js
    ...(tab === "help" ? { helpSlug: SLUG.test(id) ? id : null } : {}),
    ...(tab === "page" ? { page: section } : {}),
```

In `pathFor`, add parameters `helpSlug = null, page = null` and, at the top:

```js
  if (tab === "help") return helpSlug ? `/help/${helpSlug}` : "/help";
  if (tab === "page") return `/${page}`;
```

(The hub vs. unknown-guide decision happens in the component, which knows the guide list; the route only accepts well-formed slugs.)

- [ ] **Step 4: Run** `node --test tests/route.test.js` — PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write tests/route.test.js
git add src/lib/route.svelte.js tests/route.test.js
git commit -m "Routes for /help, /help/<guide>, and the policy pages"
```

---

### Task 3: Guide content, help pages, footer links

**Files:**
- Create: `src/help/index.js`, `src/help/{start,macros,builder,credits,book,community,mcp,cronometer,faq}.js`, `src/components/Help.svelte`, `src/components/HelpGuide.svelte`, `src/components/FooterLinks.svelte`, `scripts/placeholders.js`
- Modify: `src/App.svelte` (route rendering, header Help link), `src/components/Community.svelte`, `src/components/Recipes.svelte`, `src/components/Landing.svelte` (footer links), `src/style.css`, `package.json` (script `placeholders`)
- Test: `tests/help.test.js`

**Interfaces:**
- Produces: `GUIDES: Guide[]` and `guideBySlug(slug) → Guide | undefined` from `src/help/index.js`. `Guide = { slug, title, summary, thumb, intro, steps: Step[], outro }`, `Step = { title, text, image?, imagePhone?, markers?: Array<{ n: number, x: number, y: number }> }` (`x`, `y` are percentages 0–100; `text`, `intro`, `outro` are Markdown). Image paths are site-absolute (`/help/builder-1.png`).

- [ ] **Step 1: Failing test** — create `tests/help.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { GUIDES, guideBySlug } from "../src/help/index.js";

const SLUGS = ["start", "macros", "builder", "credits", "book", "community", "mcp", "cronometer", "faq"];

test("the hub lists the nine guides in order, each findable by slug", () => {
  assert.deepEqual(GUIDES.map((g) => g.slug), SLUGS);
  for (const slug of SLUGS) assert.equal(guideBySlug(slug).slug, slug);
  assert.equal(guideBySlug("nope"), undefined);
});

test("every guide has a title, summary, intro, and at least one step", () => {
  for (const g of GUIDES) {
    assert.ok(g.title && g.summary && g.intro, g.slug);
    assert.ok(g.steps.length >= 1, g.slug);
    for (const s of g.steps) assert.ok(s.title && s.text, `${g.slug}: ${s.title}`);
  }
});

test("every image a guide points to exists, and markers sit on the image", () => {
  for (const g of GUIDES) {
    for (const path of [g.thumb, ...g.steps.flatMap((s) => [s.image, s.imagePhone])].filter(Boolean)) {
      assert.ok(path.startsWith("/help/"), path);
      assert.ok(existsSync(`public${path}`), `missing public${path}`);
    }
    for (const s of g.steps)
      for (const m of s.markers ?? []) {
        assert.ok(m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 100, `${g.slug} marker ${m.n}`);
        assert.ok(s.image, `${g.slug}: markers need an image`);
      }
  }
});
```

- [ ] **Step 2: Run** `node --test tests/help.test.js` — Expected: FAIL (module missing).

- [ ] **Step 3: Placeholder generator** — create `scripts/placeholders.js`:

```js
// Writes "Screenshot needed" SVGs for images only the owner can capture.
//   npm run placeholders
// A real screenshot saved under the same name (as .png) replaces it; update
// the guide's image path from .svg to .png at the same time.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const NEEDED = [
  ["mcp-1", 1280, 800, "Claude: Settings → Connectors → Add custom connector, with the Macro Genie URL"],
  ["mcp-2", 1280, 800, "A chat where the AI uses search_foods (e.g. high-protein snacks)"],
  ["mcp-3", 1280, 800, "A chat where the AI uses size_recipe to fit a dish to targets"],
  ["cronometer-5", 1280, 800, "Cronometer diary with the imported recipe added"],
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
mkdirSync("public/help", { recursive: true });
for (const [name, w, h, what] of NEEDED) {
  const file = `public/help/${name}.svg`;
  if (existsSync(file.replace(/\.svg$/, ".png"))) continue;
  writeFileSync(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#1a1e20"/>
  <rect x="12" y="12" width="${w - 24}" height="${h - 24}" fill="none" stroke="#c2db75" stroke-width="3" stroke-dasharray="14 10" rx="18"/>
  <text x="50%" y="46%" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#c2db75">Screenshot needed</text>
  <text x="50%" y="54%" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#969d98">${esc(what)}</text>
  <text x="50%" y="60%" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#969d98">public/help/${name}.png (${w}×${h})</text>
</svg>
`,
  );
  console.log(`placeholder: ${file}`);
}
```

Add to `package.json` scripts: `"placeholders": "node scripts/placeholders.js"`. Run `npm run placeholders`. Copy the owner's Cronometer screenshots into place:

```bash
A=/home/frosty/.t3/userdata/attachments/4154351a-dea3-42f4-a6cf-8821e4148e34
cp "$A-dd01255c-995c-40ea-b2e7-9b1ca798e3f5.png" public/help/cronometer-1.png   # Macro Genie recipe, ingredients selected
cp "$A-10927324-6960-4d71-bc7a-f63f0ee89b8b.png" public/help/cronometer-2.png   # Cronometer Custom Recipes → Import Recipe
cp "$A-1df8a75d-478b-4b6e-8f4c-5d2104fad2fd.png" public/help/cronometer-3.png   # Import dialog, Paste Ingredients
cp "$A-1d3a9821-e8b8-4afd-bbdd-d96f79562993.png" public/help/cronometer-4.png   # Imported recipe with matches
```

Open each copied file to confirm the order matches the comments; swap names if not.

- [ ] **Step 4: Content modules** — create `src/help/index.js`:

```js
import start from "./start.js";
import macros from "./macros.js";
import builder from "./builder.js";
import credits from "./credits.js";
import book from "./book.js";
import community from "./community.js";
import mcp from "./mcp.js";
import cronometer from "./cronometer.js";
import faq from "./faq.js";

// Hub order.
export const GUIDES = [start, macros, builder, credits, book, community, mcp, cronometer, faq];
export const guideBySlug = (slug) => GUIDES.find((g) => g.slug === slug);
```

Each guide file exports a default object in this shape (this is the complete Cronometer guide; it uses only images that exist after Step 3):

```js
// src/help/cronometer.js
export default {
  slug: "cronometer",
  title: "Log it in Cronometer",
  summary: "Paste a Macro Genie recipe into Cronometer in under a minute.",
  thumb: "/help/cronometer-4.png",
  intro:
    "Macro Genie's numbers come from USDA data, the same kind of data Cronometer uses, so its recipe import recognizes the ingredients and keeps your amounts.",
  steps: [
    {
      title: "Copy the ingredients",
      text: "Open the recipe (Recipe Builder, Recipe Book, or a Community post) at the servings you'll cook, then tap **Copy ingredients**.",
      image: "/help/cronometer-1.png",
    },
    {
      title: "Open Custom Recipes in Cronometer",
      text: "In Cronometer, go to **Foods → Custom Recipes** and choose **Import Recipe**.",
      image: "/help/cronometer-2.png",
    },
    {
      title: "Paste the ingredients",
      text: "Paste into **Paste Ingredients** and select **Import**.",
      image: "/help/cronometer-3.png",
    },
    {
      title: "Check the matches and save",
      text: "Cronometer matches each line to a food and keeps the grams. Seasonings like salt and pepper come in as a dash. Fix any match you'd describe differently, set the servings, and select **Save Changes**.",
      image: "/help/cronometer-4.png",
    },
    {
      title: "Add it to your diary",
      text: "Log a serving of the recipe like any other food.",
      image: "/help/cronometer-5.svg",
    },
  ],
  outro: "Tip: change the servings on Macro Genie's recipe card before copying; the amounts you copy follow it.",
};
```

Write the other eight in the same shape. Content requirements (write plain, second-person, short sentences; one action per step; bold the exact button/menu names as they appear in the app; screenshot paths are added in Task 7, so leave `image` off for now except where noted):

- `start` — "Getting started": intro = what Macro Genie does (set the numbers a dish has to hit; it finds foods and sizes every gram). Steps: Explore foods for free (Food Macros, no account) · Sign in with Google to use the Recipe Builder (10 free credits) · Make a recipe (link to `/help/builder`) · Keep it, share it, log it (links to book, community, cronometer guides) · Chat with your AI (link to `/help/mcp`). `thumb: "/help/cronometer-1.png"` until Task 7 replaces it.
- `macros` — "Set your macros": per-serving min/max ranges; leaving a box blank means no limit; per serving vs per 100 g on Food Macros; presets ("A starting point"); on phones the **Set your macros** button opens the panel and **Show N foods** jumps to results; foods you won't eat. `thumb: "/help/cronometer-1.png"`.
- `builder` — "Make a recipe with the Recipe Builder": set targets and servings · type foods you want (optional) and anything else (optional) · choose how many ideas (each costs a credit) and **Get ideas** · read the pairing rating (great / mixed / clashes) · **Cook this one** · adjust amounts, lock "must use" · **Write the recipe** (1 credit) · change servings, **Save**, **Copy**, **Copy ingredients**, **Print**. `thumb: "/help/cronometer-1.png"`.
- `credits` — "Credits": 10 free on sign-up; 1 per idea, 1 per written recipe; failed jobs refunded automatically; where to see your balance (header pill / phone menu); buying more is coming soon (Stripe project fills this in); credits don't expire. `thumb: "/help/cronometer-1.png"`.
- `book` — "Your Recipe Book": saving from the Builder or **Save to Recipe Book** on Community posts; recipes live in this browser only (private browsing may not keep them); to use a recipe on another device, post it to the Community or copy it; **Copy**, **Copy ingredients**, **Print**, delete. `thumb: "/help/cronometer-1.png"`.
- `community` — "The Community": browse recipe boards and forums without an account; **Filter by macros**; open a post, **Show recipe**, **Save to Recipe Book**; post your own recipe from the Recipe Book (choose a meal type); comments support bold, italic, lists, links, and emoji (type `:` for suggestions); likes and **Report**; posts with links wait for a moderator. `thumb: "/help/cronometer-1.png"`.
- `mcp` — "Chat with your AI (MCP)": intro = connect Claude (or Fable, or any MCP app) and just ask; it searches 8,490 USDA foods and sizes recipes for you; free, read-only, no account. Steps:
  1. "Copy the server address" — text includes the literal token `{{MCP_URL}}` which `HelpGuide` replaces with `${location.origin}/mcp`, and mentions the Copy button rendered below the step.
  2. "Claude on the web or desktop" — **Settings → Connectors → Add custom connector**, name "Macro Genie", paste the URL. `image: "/help/mcp-1.svg"`. Before writing, check Anthropic's current help article for custom connectors and use its exact menu names.
  3. "Claude Code" — the command `claude mcp add --transport http macro-genie {{MCP_URL}}` in a code span.
  4. "Other MCP apps" — add a Streamable HTTP server with the URL; no sign-in needed.
  5. "Ask it things" — 6 example prompts as a bullet list, e.g. "Find snacks under 150 kcal with at least 15 g protein", "Which cheeses have the most protein per 100 g?", "I have chicken thighs, broccoli and rice: size a dish for 4 with 40 g protein and under 600 kcal per serving", "Compare the sodium in canned vs dried black beans", "List the food categories you know", "What's in 100 g of salmon?". `image: "/help/mcp-2.svg"`.
  6. "Let it size recipes" — explains `size_recipe` in one sentence. `image: "/help/mcp-3.svg"`.
  Outro: the four tools in a short table-free list (search foods, food details, categories, size a recipe); "Community recipes aren't searchable from your AI yet." `thumb: "/help/mcp-2.svg"`.
- `faq` — "Questions": How accurate are the numbers? (USDA SR Legacy; cooking changes weights; estimates, not medical advice) · Why did an ingredient shrink or grow? (the solver keeps each between zero and double, must-use keeps a quarter) · Where are my saved recipes? (this browser) · Does it work on my phone? (yes) · How do I delete my account or data? (link to `/contact`, topic "Delete my data") · Is my AI chat private? (the MCP server is read-only and keeps nothing). One step per question: `title` = question, `text` = answer. `thumb: "/help/cronometer-1.png"`.

- [ ] **Step 5: Run** `node --test tests/help.test.js` — Expected: PASS.

- [ ] **Step 6: Components** — create `src/components/HelpGuide.svelte`:

```svelte
<script>
  import Markdown from './Markdown.svelte';
  import { GUIDES } from '../help/index.js';
  import { navigate } from '../lib/route.svelte.js';

  // One guide: numbered steps, each with its screenshot and numbered markers.
  let { guide } = $props();
  const mcpUrl = `${location.origin}/mcp`;
  const fill = (text) => (text ?? '').replaceAll('{{MCP_URL}}', mcpUrl);
  const next = $derived(GUIDES[GUIDES.indexOf(guide) + 1]);
  let copied = $state(false);
  async function copyUrl() {
    try { await navigator.clipboard.writeText(mcpUrl); copied = true; setTimeout(() => (copied = false), 2000); } catch { copied = false; }
  }
  function go(e, to) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    navigate(to);
    scrollTo(0, 0);
  }
  // The Markdown renderer opens links in a new tab; links to our own pages
  // (/help/…, /contact) should open here instead.
  function internal(e) {
    const a = e.target.closest?.('a[href^="/"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    const [section, slug] = a.getAttribute('href').split('/').filter(Boolean);
    navigate(section === 'help' ? { tab: 'help', helpSlug: slug ?? null } : { tab: 'page', page: section });
    scrollTo(0, 0);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article class="guide" onclick={internal}>
  <a class="back-link" href="/help" onclick={(e) => go(e, { tab: 'help' })}>← All help</a>
  <h1>{guide.title}</h1>
  <Markdown class="guide-intro" text={fill(guide.intro)} />
  <ol class="guide-steps">
    {#each guide.steps as step, i (step.title)}
      <li class="guide-step">
        <h2><span class="step-number" aria-hidden="true">{i + 1}</span>{step.title}</h2>
        <Markdown class="guide-text" text={fill(step.text)} />
        {#if guide.slug === 'mcp' && i === 0}
          <p class="mcp-url"><code>{mcpUrl}</code> <button class="outline-button" onclick={copyUrl}>{copied ? 'Copied' : 'Copy'}</button></p>
        {/if}
        {#if step.image}
          <figure class="guide-shot">
            <picture>
              {#if step.imagePhone}<source media="(max-width: 760px)" srcset={step.imagePhone} />{/if}
              <img src={step.image} alt={step.title} loading="lazy" />
            </picture>
            {#each step.markers ?? [] as m (m.n)}
              <span class="shot-marker" style:left="{m.x}%" style:top="{m.y}%" aria-hidden="true">{m.n}</span>
            {/each}
          </figure>
        {/if}
      </li>
    {/each}
  </ol>
  {#if guide.outro}<Markdown class="guide-outro" text={fill(guide.outro)} />{/if}
  {#if next}<a class="outline-button next-guide" href={`/help/${next.slug}`} onclick={(e) => go(e, { tab: 'help', helpSlug: next.slug })}>Next: {next.title}</a>{/if}
</article>
```

Create `src/components/Help.svelte`:

```svelte
<script>
  import HelpGuide from './HelpGuide.svelte';
  import { GUIDES, guideBySlug } from '../help/index.js';
  import { navigate } from '../lib/route.svelte.js';

  // /help: the hub, or one guide. An unknown guide shows the hub.
  let { slug = null } = $props();
  const guide = $derived(slug ? guideBySlug(slug) : undefined);
  function go(e, to) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    navigate(to);
    scrollTo(0, 0);
  }
</script>

<main id="results" tabindex="-1" class="help">
  {#if guide}
    {#key guide.slug}<HelpGuide {guide} />{/key}
  {:else}
    <h1>Help</h1>
    <p class="help-lede">Short, step-by-step guides with pictures. Start anywhere.</p>
    <ul class="help-cards">
      {#each GUIDES as g (g.slug)}
        <li>
          <a class="help-card" href={`/help/${g.slug}`} onclick={(e) => go(e, { tab: 'help', helpSlug: g.slug })}>
            <img src={g.thumb} alt="" loading="lazy" />
            <strong>{g.title}</strong>
            <span>{g.summary}</span>
          </a>
        </li>
      {/each}
    </ul>
    <p class="help-policies">
      <a href="/terms" onclick={(e) => go(e, { tab: 'page', page: 'terms' })}>Terms</a>
      <a href="/refunds" onclick={(e) => go(e, { tab: 'page', page: 'refunds' })}>Refunds</a>
      <a href="/privacy" onclick={(e) => go(e, { tab: 'page', page: 'privacy' })}>Privacy</a>
      <a href="/contact" onclick={(e) => go(e, { tab: 'page', page: 'contact' })}>Contact us</a>
    </p>
  {/if}
</main>
```

Create `src/components/FooterLinks.svelte`:

```svelte
<script>
  import { navigate } from '../lib/route.svelte.js';
  const LINKS = [['Help', { tab: 'help' }, '/help'], ['Terms', { tab: 'page', page: 'terms' }, '/terms'], ['Refunds', { tab: 'page', page: 'refunds' }, '/refunds'], ['Privacy', { tab: 'page', page: 'privacy' }, '/privacy'], ['Contact', { tab: 'page', page: 'contact' }, '/contact']];
  function go(e, to) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    navigate(to);
    scrollTo(0, 0);
  }
</script>

<nav class="footer-links" aria-label="Help and policies">
  {#each LINKS as [label, to, href] (href)}<a {href} onclick={(e) => go(e, to)}>{label}</a>{/each}
</nav>
```

- [ ] **Step 7: Wire up**
  - `src/App.svelte`: `import Help from './components/Help.svelte';`; in the tab chain before `{:else if tab === 'home'}` add `{:else if tab === 'help'}\n  <Help slug={route.helpSlug} />`. Header: in the signed-in `account-area`, before the Admin button, `<button class="text-button account-wide" onclick={() => navigate({ tab: 'help' })}>Help</button>`; in the phone `account-pop`, before Admin, `<button class="outline-button" onclick={() => { accountMenu = false; navigate({ tab: 'help' }); }}>Help</button>`; in the signed-out branch, before the Log in button, `<button class="text-button help-link" onclick={() => navigate({ tab: 'help' })}>Help</button>`. Add `import FooterLinks from './components/FooterLinks.svelte';` and put `<FooterLinks />` as the last child inside the Food Macros `<footer>`.
  - `src/components/Community.svelte`, `src/components/Recipes.svelte`, `src/components/Landing.svelte`: import `FooterLinks` and add `<FooterLinks />` as the last child of each `<footer>`.
  - `src/style.css`: append

```css
/* Help */
.help {
  max-width: 980px;
  margin: 0 auto;
  padding: 32px 24px 64px;
}
.help-lede {
  color: var(--muted);
  margin: 0 0 24px;
}
.help-cards {
  list-style: none;
  margin: 0 0 28px;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  gap: 16px;
}
.help-card {
  display: grid;
  gap: 6px;
  height: 100%;
  padding: 0 0 16px;
  overflow: hidden;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  color: inherit;
  text-decoration: none;
}
.help-card:hover {
  border-color: #4a5356;
}
.help-card img {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  object-position: top left;
  border-bottom: 1px solid var(--line);
}
.help-card strong,
.help-card span {
  padding: 0 16px;
}
.help-card span {
  color: var(--muted);
  font-size: 14px;
}
.help-policies,
.footer-links {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 13px;
}
.help-policies a,
.footer-links a {
  color: var(--muted);
}
.help-policies a:hover,
.footer-links a:hover {
  color: var(--lime);
}
.footer-links {
  margin-top: 10px;
}
.guide h1 {
  margin: 12px 0 10px;
}
.guide-steps {
  list-style: none;
  margin: 28px 0;
  padding: 0;
  display: grid;
  gap: 36px;
}
.guide-step h2 {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 20px;
  margin: 0 0 8px;
}
.step-number,
.shot-marker {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--lime);
  color: #151819;
  font-size: 15px;
  font-weight: 700;
}
.guide-text,
.guide-intro,
.guide-outro {
  max-width: 68ch;
  line-height: 1.6;
}
.guide-shot {
  position: relative;
  margin: 14px 0 0;
}
.guide-shot img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.shot-marker {
  position: absolute;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 3px #111415;
}
.mcp-url {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.mcp-url code {
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--panel);
  overflow-wrap: anywhere;
}
.next-guide {
  display: inline-block;
  text-decoration: none;
}
@media (max-width: 760px) {
  .help {
    padding: 22px 20px 48px;
  }
}
```

- [ ] **Step 8: Verify** `npm run check && npm test && npm run build` — 0 errors, all pass. Run `npm run dev` and open `/help`, `/help/cronometer`, `/help/mcp`, `/help/nope` (shows the hub).

- [ ] **Step 9: Commit**

```bash
npx prettier --write src/help scripts/placeholders.js tests/help.test.js
git add src scripts/placeholders.js public/help package.json tests/help.test.js
git commit -m "Help: hub and nine guides, Cronometer screenshots, placeholders, footer links"
```

- [ ] **Step 10: TODO items** — add one Project TODO item per placeholder ("Macro Genie help: capture public/help/mcp-1.png — Claude connector setup", etc., four items), each saying to replace the `.svg` path in the guide with `.png`.

---

### Task 4: Policy pages

**Files:**
- Create: `src/help/policies.js`, `src/components/PolicyPage.svelte`
- Modify: `src/App.svelte`, `src/style.css`
- Test: `tests/help.test.js`

**Interfaces:**
- Produces: `POLICIES = { terms: { title, updated, body }, refunds: {…}, privacy: {…} }` (body is Markdown).

- [ ] **Step 1: Failing test** — append to `tests/help.test.js`:

```js
test("the policy pages say what the owner decided", async () => {
  const { POLICIES } = await import("../src/help/policies.js");
  assert.deepEqual(Object.keys(POLICIES).sort(), ["privacy", "refunds", "terms"]);
  for (const p of Object.values(POLICIES)) assert.equal(p.updated, "October 13, 2026");
  assert.match(POLICIES.refunds.body, /unused credits/i);
  assert.match(POLICIES.refunds.body, /30 days/);
  assert.match(POLICIES.refunds.body, /refunded automatically/i);
  for (const word of ["Netlify", "Neon", "Anthropic", "Google", "Stripe"])
    assert.match(POLICIES.privacy.body, new RegExp(word));
  assert.match(POLICIES.privacy.body, /no ads or trackers/i);
  assert.match(POLICIES.privacy.body, /don't store your email/i);
  assert.match(POLICIES.terms.body, /not medical advice/i);
  assert.match(POLICIES.terms.body, /no cash value/i);
  for (const p of Object.values(POLICIES))
    assert.doesNotMatch(p.body, /@[a-z0-9-]+\.[a-z]/i, "no email address on the site");
});
```

- [ ] **Step 2: Run** `node --test tests/help.test.js` — FAIL.

- [ ] **Step 3: Write `src/help/policies.js`** exporting `POLICIES` with `updated: "October 13, 2026"` and Markdown bodies covering, in plain language with short headed sections (`**Bold lead-ins**` rather than headings, since the renderer shows headings as text):
  - **terms** ("Terms of use"): what Macro Genie is; accounts use Google sign-in; credits (10 free, 1 per idea or written recipe, failed jobs refunded automatically, credits have no cash value, don't expire, can't be transferred); acceptable use (no abuse, spam, illegal content; community posts are checked automatically and by people); AI and nutrition numbers are estimates, **not medical advice**, check labels and talk to a professional about medical diets; we may suspend or remove accounts that break these terms; the service is provided as is; we may change these terms and the date above changes; questions via [Contact us](/contact).
  - **refunds** ("Refunds"): unused credits from a purchased pack can be refunded within 30 days of purchase; used credits can't; failed AI jobs are refunded automatically, no need to ask; free welcome credits aren't refundable; how: [Contact us](/contact) with topic "Refund" and the email on the receipt; refunds go back to the original payment method and usually show up in 5–10 business days.
  - **privacy** ("Privacy"): what we store (Google account id, display name, credits and credit history, community posts, comments, likes and reports, messages you send us); what we don't (we don't store your email or a password; Google tells us only an id and a first name we use as your display name); what stays in your browser (Recipe Book, foods you won't eat, the recipe in progress); who processes data (Netlify hosts the site, Neon stores the database, Anthropic's Claude writes ideas and recipes from the foods and targets you send, Google handles sign-in, Stripe will process payments and we never see card numbers); no ads or trackers; the MCP server keeps nothing; deleting your data via [Contact us](/contact) with topic "Delete my data"; changes to this page.

- [ ] **Step 4: Run** `node --test tests/help.test.js` — PASS.

- [ ] **Step 5: Component and wiring** — create `src/components/PolicyPage.svelte`:

```svelte
<script>
  import Markdown from './Markdown.svelte';
  import { POLICIES } from '../help/policies.js';

  import { navigate } from '../lib/route.svelte.js';

  let { page } = $props();
  const policy = $derived(POLICIES[page]);
  // Links to our own pages open here, not in a new tab.
  function internal(e) {
    const a = e.target.closest?.('a[href^="/"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    const [section, slug] = a.getAttribute('href').split('/').filter(Boolean);
    navigate(section === 'help' ? { tab: 'help', helpSlug: slug ?? null } : { tab: 'page', page: section });
    scrollTo(0, 0);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<main id="results" tabindex="-1" class="help policy" onclick={internal}>
  <h1>{policy.title}</h1>
  <p class="help-lede">Last updated {policy.updated}</p>
  <Markdown class="policy-body" text={policy.body} />
</main>
```

In `src/App.svelte`: `import PolicyPage from './components/PolicyPage.svelte';` and in the tab chain `{:else if tab === 'page' && route.page !== 'contact'}\n  <PolicyPage page={route.page} />` (contact is Task 5). Append to `src/style.css`:

```css
.policy-body {
  max-width: 70ch;
  line-height: 1.65;
}
.policy-body p + p {
  margin-top: 0.9em;
}
```

- [ ] **Step 6: Verify** `npm run check && npm test && npm run build`; open `/terms`, `/refunds`, `/privacy`.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/help/policies.js tests/help.test.js
git add src tests/help.test.js
git commit -m "Policy pages: terms, refunds (unused credits within 30 days), privacy"
```

---

### Task 5: Contact messages — storage and endpoint

**Files:**
- Create: `db/migrations/20261013140000_messages.sql`, `server/messages.js`, `netlify/functions/contact.js`
- Modify: `server/activity.js` (Messages chip)
- Test: `tests/contact.test.js`

**Interfaces:**
- Consumes: `logActivity` (`server/activity.js`), `requireMod` (`server/roles.js`), `readSession` (`server/session.js`), `UserFacingError` (`server/chef.js`).
- Produces: `TOPICS`; `saveMessage({ accountId?, name, email?, topic, body }) → { id, duplicate: boolean }`; `listMessages(actorId, { status = "new" }) → { messages: Array<{ id, at, accountId, name, email, topic, body, status }> }`; `setMessageStatus(actorId, id, status: "new" | "done") → { status }`; `POST /api/contact { topic, body, email?, website? } → { sent: true }`.

- [ ] **Step 1: Migration**

```sql
-- db/migrations/20261013140000_messages.sql
-- Messages sent with the contact form, read in Admin → Inbox.
CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_id BIGINT REFERENCES accounts (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done'))
);
CREATE INDEX messages_status ON messages (status, id DESC);
```

- [ ] **Step 2: Failing tests** — create `tests/contact.test.js`:

```js
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
import { connect, useDatabase } from "../server/db.js";
import { findOrCreateAccount } from "../server/accounts.js";
import { listActivity } from "../server/activity.js";
import { listMessages, saveMessage, setMessageStatus } from "../server/messages.js";
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
const person = (name) => findOrCreateAccount({ sub: `ct-${++n}`, displayName: name });
const send = async (payload, who) => {
  const { default: handler } = await import("../netlify/functions/contact.js");
  const headers = { "Content-Type": "application/json" };
  if (who) headers.cookie = sessionCookie(who.id, new Request("https://example.com/")).split(";")[0];
  return handler(
    new Request("https://example.com/api/contact", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }),
  );
};

test("a visitor's message is stored and logged; an email is required when signed out", async () => {
  const missing = await send({ topic: "Question", body: "How do credits work here?" });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /email/i);
  const res = await send({ topic: "Question", body: "How do credits work here?", email: "ana@example.com" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { sent: true });
  const rows = await db.sql`SELECT name, email, topic, body, status, account_id FROM messages WHERE email = 'ana@example.com'`;
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
  assert.equal((await send({ topic: "Refund", body: "Please refund my unused pack." }, kim)).status, 200);
  const rows = await db.sql`SELECT name, account_id, email FROM messages WHERE body = 'Please refund my unused pack.'`;
  assert.equal(rows[0].name, "Kim");
  assert.equal(Number(rows[0].account_id), kim.id);
  assert.equal(rows[0].email, "");
});

test("bad input is refused; bots filling the hidden field are dropped quietly; double taps store once", async () => {
  assert.equal((await send({ topic: "Spam", body: "Ten chars plus", email: "a@b.co" })).status, 400);
  assert.equal((await send({ topic: "Bug", body: "short", email: "a@b.co" })).status, 400);
  assert.equal((await send({ topic: "Bug", body: "x".repeat(3001), email: "a@b.co" })).status, 400);
  assert.equal((await send({ topic: "Bug", body: "A real bug report", email: "not-an-email" })).status, 400);
  const bot = await send({ topic: "Other", body: "Buy cheap things now", email: "bot@x.co", website: "http://spam" });
  assert.equal(bot.status, 200);
  assert.equal((await db.sql`SELECT count(*)::int AS n FROM messages WHERE email = 'bot@x.co'`)[0].n, 0);
  const twice = { topic: "Bug", body: "The page froze once", email: "dt@example.com" };
  await send(twice);
  await send(twice);
  assert.equal((await db.sql`SELECT count(*)::int AS n FROM messages WHERE email = 'dt@example.com'`)[0].n, 1);
});

test("mods read the inbox and mark messages done; others can't", async () => {
  const mod = await person("Mo");
  const plain = await person("Pat");
  await db.sql`UPDATE accounts SET is_mod = true WHERE id = ${mod.id}`;
  const { id } = await saveMessage({ name: "Visitor", email: "z@example.com", topic: "Other", body: "Hello there, team" });
  const inbox = await listMessages(mod.id);
  assert.ok(inbox.messages.some((m) => m.id === id && m.status === "new"));
  assert.deepEqual(await setMessageStatus(mod.id, id, "done"), { status: "done" });
  assert.ok(!(await listMessages(mod.id)).messages.some((m) => m.id === id));
  assert.ok((await listMessages(mod.id, { status: "done" })).messages.some((m) => m.id === id));
  await assert.rejects(listMessages(plain.id), /Only moderators/);
  await assert.rejects(setMessageStatus(mod.id, id, "lost"), /new or done/);
  await assert.rejects(setMessageStatus(mod.id, 999999, "done"), /wasn't found/);
});
```

- [ ] **Step 3: Run** `node --test tests/contact.test.js` — FAIL (modules missing).

- [ ] **Step 4: `server/messages.js`**

```js
import { logActivity } from "./activity.js";
import { UserFacingError } from "./chef.js";
import { database } from "./db.js";
import { requireMod } from "./roles.js";

// Contact-form messages. The owner's address never appears on the site;
// messages are read in Admin → Inbox.
export const TOPICS = ["Question", "Refund", "Delete my data", "Bug", "Other"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkMessage({ topic, body, email, signedIn }) {
  const text = String(body ?? "").trim();
  const address = String(email ?? "").trim();
  if (!TOPICS.includes(topic)) throw new UserFacingError("Pick a topic.");
  if (text.length < 10 || text.length > 3000)
    throw new UserFacingError("Messages are 10 to 3,000 characters.");
  if (!signedIn && !address)
    throw new UserFacingError("Add your email so we can reply.");
  if (address && (address.length > 200 || !EMAIL.test(address)))
    throw new UserFacingError("That email doesn't look right.");
  return { topic, body: text, email: address };
}

// The same text from the same sender within a minute is a double tap:
// stored once.
export async function saveMessage({ accountId = null, name, email = "", topic, body }) {
  const db = database();
  const recent = await db.sql`
    SELECT id FROM messages
     WHERE body = ${body} AND email = ${email}
       AND account_id IS NOT DISTINCT FROM ${accountId}::bigint
       AND created_at > now() - interval '1 minute'
     LIMIT 1`;
  if (recent[0]) return { id: Number(recent[0].id), duplicate: true };
  const rows = await db.sql`
    INSERT INTO messages (account_id, name, email, topic, body)
    VALUES (${accountId}, ${name}, ${email}, ${topic}, ${body}) RETURNING id`;
  const id = Number(rows[0].id);
  await logActivity({ kind: "message", accountId, actorName: name, text: `sent a message: ${topic}` });
  return { id, duplicate: false };
}

export async function listMessages(actorId, { status = "new" } = {}) {
  await requireMod(actorId);
  const rows = await database().sql`
    SELECT id, created_at, account_id, name, email, topic, body, status
      FROM messages WHERE status = ${status === "done" ? "done" : "new"}
     ORDER BY id DESC LIMIT 200`;
  return {
    messages: rows.map((r) => ({
      id: Number(r.id),
      at: new Date(r.created_at).toISOString(),
      accountId: r.account_id == null ? null : Number(r.account_id),
      name: r.name,
      email: r.email,
      topic: r.topic,
      body: r.body,
      status: r.status,
    })),
  };
}

export async function setMessageStatus(actorId, id, status) {
  await requireMod(actorId);
  if (!["new", "done"].includes(status))
    throw new UserFacingError("Status is new or done.");
  const rows = await database()
    .sql`UPDATE messages SET status = ${status} WHERE id = ${id} RETURNING status`;
  if (!rows[0]) throw new UserFacingError("That message wasn't found.", 404);
  return { status };
}
```

In `server/activity.js` add `messages: ["message"],` to `CHIPS`.

- [ ] **Step 5: `netlify/functions/contact.js`**

```js
import { UserFacingError } from "../../server/chef.js";
import { fail } from "../../server/http.js";
import { checkMessage, saveMessage } from "../../server/messages.js";
import { roleOf } from "../../server/roles.js";
import { readSession } from "../../server/session.js";

// The contact form. Works signed out; a hidden "website" field catches bots
// (they get a normal-looking reply and nothing is stored). Netlify's limiter
// allows at most a 3-minute window, so: 3 messages per 3 minutes per IP.
export const config = {
  path: "/api/contact",
  method: "POST",
  rateLimit: { windowLimit: 3, windowSize: 180, aggregateBy: ["ip", "domain"] },
};

export default async function handler(request) {
  try {
    const input = await request.json().catch(() => {
      throw new UserFacingError("Send the request as JSON.");
    });
    if (String(input?.website ?? "").trim()) return Response.json({ sent: true });
    const accountId = process.env.SESSION_SECRET ? readSession(request) : null;
    const role = await roleOf(accountId);
    const clean = checkMessage({ ...input, signedIn: role.exists });
    await saveMessage({
      accountId: role.exists ? accountId : null,
      name: role.exists ? role.displayName : "Visitor",
      ...clean,
    });
    return Response.json({ sent: true });
  } catch (error) {
    return fail(error);
  }
}
```

- [ ] **Step 6: Run** `node --test tests/contact.test.js` then `npm test` — PASS, all pass.

- [ ] **Step 7: Commit**

```bash
npx prettier --write server/messages.js server/activity.js netlify/functions/contact.js tests/contact.test.js
git add db/migrations/20261013140000_messages.sql server netlify/functions/contact.js tests/contact.test.js
git commit -m "Contact form backend: messages table, /api/contact with honeypot and limits, Messages log chip"
```

---

### Task 6: Contact page and Admin → Inbox

**Files:**
- Create: `src/components/ContactPage.svelte`, `src/components/AdminInbox.svelte`
- Modify: `netlify/functions/admin.js`, `src/components/Admin.svelte`, `src/components/AdminLog.svelte`, `src/lib/route.svelte.js` (admin tab `inbox`), `src/App.svelte`, `src/style.css`
- Test: `tests/admin.test.js`, `tests/route.test.js`

**Interfaces:**
- Consumes: `listMessages`, `setMessageStatus`, `TOPICS` (Task 5).
- Produces: `GET /api/admin/messages?status=new|done → { messages }`, `POST /api/admin/messages/:id/status { status } → { status }`; `parse("/admin/inbox").adminTab === "inbox"`.

- [ ] **Step 1: Failing tests** — append to the admin endpoints test region of `tests/admin.test.js` a new test:

```js
test("inbox endpoints: mods list and mark messages; others can't", async () => {
  const { default: handler } = await import("../netlify/functions/admin.js");
  const { sessionCookie } = await import("../server/session.js");
  const { saveMessage } = await import("../server/messages.js");
  const { mod } = await staff();
  const plain = await person("Inbox Pat");
  const cookie = (who) => sessionCookie(who.id, new Request("https://example.com/")).split(";")[0];
  const { id } = await saveMessage({ name: "Visitor", email: "q@example.com", topic: "Bug", body: "Something broke here" });
  const call = (path, who, body) =>
    handler(new Request(`https://example.com${path}`, {
      method: body ? "POST" : "GET",
      headers: { cookie: cookie(who), "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }));
  assert.equal((await call("/api/admin/messages", plain)).status, 403);
  const list = await call("/api/admin/messages?status=new", mod);
  assert.ok((await list.json()).messages.some((m) => m.id === id));
  const done = await call(`/api/admin/messages/${id}/status`, mod, { status: "done" });
  assert.deepEqual(await done.json(), { status: "done" });
});
```

and in `tests/route.test.js` add `assert.equal(parse("/admin/inbox").adminTab, "inbox");`.

- [ ] **Step 2: Run** `node --test tests/admin.test.js tests/route.test.js` — FAIL.

- [ ] **Step 3: Endpoints and route** — in `netlify/functions/admin.js` import `{ listMessages, setMessageStatus }` from `../../server/messages.js` and add cases:

```js
      case "GET messages":
        return Response.json(
          await listMessages(actor, { status: url.searchParams.get("status") || "new" }),
          noStore,
        );
      case "POST messages/:id/status": {
        const body = await json(request);
        return Response.json(await setMessageStatus(actor, idFrom(id), body.status));
      }
```

In `src/lib/route.svelte.js`: `const ADMIN_TABS = ["reviews", "users", "log", "inbox"];`.

- [ ] **Step 4: Run** the two tests — PASS.

- [ ] **Step 5: Contact page** — create `src/components/ContactPage.svelte`:

```svelte
<script>
  import { account } from '../lib/account.svelte.js';

  // The contact form. There's no public address; messages go to Admin → Inbox.
  const TOPICS = ['Question', 'Refund', 'Delete my data', 'Bug', 'Other'];
  let topic = $state('Question');
  let body = $state('');
  let email = $state('');
  let website = $state('');
  let sending = $state(false);
  let error = $state('');
  let sent = $state(false);
  let sentWithEmail = $state(false);

  async function send(e) {
    e.preventDefault();
    if (sending) return;
    sending = true; error = '';
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, body, email, website }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        error = res.status === 429
          ? 'You’ve sent a few messages already. Try again in a few minutes.'
          : (data?.error ?? 'Something went wrong. Try again.');
        return;
      }
      sentWithEmail = !!email.trim();
      sent = true;
    } catch {
      error = 'Couldn’t send. Check your connection and try again.';
    } finally {
      sending = false;
    }
  }
</script>

<main id="results" tabindex="-1" class="help contact">
  <h1>Contact us</h1>
  {#if sent}
    <p class="post-note" role="status">Thanks, your message was sent.{sentWithEmail ? ' We’ll reply by email.' : ''}</p>
  {:else}
    <p class="help-lede">Questions, refunds, deleting your data, or something broken: tell us here.</p>
    <form class="contact-form" onsubmit={send}>
      <label class="note-field"><span>Topic</span>
        <select bind:value={topic}>{#each TOPICS as t (t)}<option>{t}</option>{/each}</select>
      </label>
      <label class="note-field"><span>Message</span>
        <textarea bind:value={body} rows="6" minlength="10" maxlength="3000" required></textarea>
      </label>
      <label class="note-field"><span>Your email {#if account.signedIn}<small>Optional</small>{/if}</span>
        <input type="email" bind:value={email} maxlength="200" required={!account.signedIn} autocomplete="email" />
        {#if account.signedIn && !email.trim()}<small class="contact-hint">Without an email we can’t reply.</small>{/if}
      </label>
      <label class="contact-trap" aria-hidden="true">Website <input tabindex="-1" autocomplete="off" bind:value={website} /></label>
      {#if error}<p class="method-error" role="alert">{error}</p>{/if}
      <button class="primary-button" disabled={sending}>{sending ? 'Sending…' : 'Send message'}</button>
    </form>
  {/if}
</main>
```

In `src/App.svelte`: `import ContactPage from './components/ContactPage.svelte';` and before the PolicyPage branch: `{:else if tab === 'page' && route.page === 'contact'}\n  <ContactPage />`.

- [ ] **Step 6: Inbox** — create `src/components/AdminInbox.svelte`:

```svelte
<script>
  import { untrack } from 'svelte';
  import { api } from '../lib/account.svelte.js';

  // Contact-form messages. Text is shown as plain text, never as HTML.
  let status = $state('new');
  let messages = $state(null);
  let error = $state('');
  let busy = $state(null);
  const when = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  async function load() {
    const res = await api(`/api/admin/messages?status=${status}`);
    if (res.ok) { messages = res.body.messages; error = ''; }
    else { error = res.error; messages ??= []; }
  }
  $effect(() => { status; untrack(() => load()); });

  async function mark(m, next) {
    busy = m.id;
    const res = await api(`/api/admin/messages/${m.id}/status`, { method: 'POST', body: { status: next } });
    busy = null;
    if (res.ok) messages = messages.filter((x) => x.id !== m.id);
    else error = res.error;
  }
</script>

<section class="admin-inbox">
  <div class="board-chips" role="group" aria-label="Show messages">
    <button class:chosen={status === 'new'} aria-pressed={status === 'new'} onclick={() => (status = 'new')}>New</button>
    <button class:chosen={status === 'done'} aria-pressed={status === 'done'} onclick={() => (status = 'done')}>Done</button>
  </div>
  {#if error}<p class="method-error" role="alert">{error}</p>{/if}
  {#if messages === null}
    <p class="comments-empty">Loading…</p>
  {:else if !messages.length}
    <p class="comments-empty">{status === 'new' ? 'No new messages.' : 'Nothing marked done yet.'}</p>
  {:else}
    <ul class="inbox-list">
      {#each messages as m (m.id)}
        <li class="inbox-item">
          <p class="inbox-meta"><span class="role-tag">{m.topic}</span> <strong>{m.name}</strong>{#if m.email} <span>{m.email}</span>{/if}{#if m.accountId} <span>(account {m.accountId})</span>{/if} <time datetime={m.at}>{when(m.at)}</time></p>
          <p class="inbox-body">{m.body}</p>
          <button class="outline-button" disabled={busy === m.id} onclick={() => mark(m, status === 'new' ? 'done' : 'new')}>{status === 'new' ? 'Mark done' : 'Move back to new'}</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
```

In `src/components/Admin.svelte`: import `AdminInbox`, add `['inbox', 'Inbox']` to `TABS`, and `{:else if adminTab === 'inbox'}\n      <AdminInbox />` before the final `{:else}`. In `src/components/AdminLog.svelte` add `['messages', 'Messages']` to `CHIPS` (after Credits).

Append to `src/style.css`:

```css
.contact-form {
  display: grid;
  gap: 16px;
  max-width: 560px;
}
.contact-form select,
.contact-form textarea,
.contact-form input {
  padding: 11px 14px;
  border-radius: 10px;
  background: #111415;
  color: inherit;
  font: inherit;
}
.contact-hint {
  color: var(--muted);
}
.contact-trap {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
.inbox-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}
.inbox-item {
  display: grid;
  gap: 10px;
  justify-items: start;
  padding: 16px 18px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
}
.inbox-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.inbox-meta strong {
  color: #e6e8e4;
}
.inbox-body {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 7: Verify** `npm run check && npm test && npm run build` — all pass.

- [ ] **Step 8: Commit**

```bash
npx prettier --write netlify/functions/admin.js tests/admin.test.js tests/route.test.js
git add src netlify tests
git commit -m "Contact page and Admin → Inbox"
```

---

### Task 7: Screenshots

**Files:**
- Create: `scripts/screenshots.js`, `scripts/help-fixtures/prefs.json`
- Modify: `package.json` (dev dependency `playwright`, script `screenshots`), `src/help/*.js` (image paths and markers), `public/help/*.png`

**Interfaces:**
- Consumes: guide modules (Task 3), routes (Tasks 2, 6).

- [ ] **Step 1: Install** `npm i -D playwright` and, if its Chromium revision isn't already in `~/.cache/ms-playwright`, `npx playwright install chromium`.

- [ ] **Step 2: Capture the browser-state fixture (one time, real)** — with `npm run dev` running and signed in locally as the owner (mint a session cookie from `.env`'s `SESSION_SECRET` for the owner's account id, as in the admin plan's browser check; account ids are numbers), use the Recipe Builder once: Serves 4; Protein min 30, Calories max 600; foods "chicken thighs, broccoli, rice"; note "weeknight"; 1 idea; **Cook this one**; **Write the recipe**; **Save**. This spends 2 credits on the dev account and a few cents of AI. Then copy `localStorage["macro-genie:prefs:v1"]` from the page into `scripts/help-fixtures/prefs.json` (pretty-printed). Delete any local-only fields that identify the owner (there should be none: prefs hold dislikes, the draft, and saved recipes).

- [ ] **Step 3: Write `scripts/screenshots.js`**

```js
// Re-takes the help screenshots from the running dev site.
//   npm run dev            (in another terminal)
//   npm run screenshots
// /api/me is mocked as "Sam" with 10 credits and the browser starts with a
// saved Builder session (scripts/help-fixtures/prefs.json), so no real
// account, credits, or AI calls are used. Community pages show the dev
// database's public posts.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.HELP_BASE_URL ?? "http://localhost:5173";
const prefs = readFileSync(new URL("./help-fixtures/prefs.json", import.meta.url), "utf8");
const ME = {
  signedIn: true,
  account: { displayName: "Sam", credits: 10, isAdmin: false, isMod: false, suspended: false },
  googleClientId: null,
};
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

// [file, viewport, path, actions(page)]
const SHOTS = [
  ["start-1", DESKTOP, "/", async () => {}],
  ["macros-1", DESKTOP, "/foods", async (p) => { await p.fill('input[aria-label="Protein minimum"]', "30"); await p.fill('input[aria-label="Calories maximum"]', "300"); }],
  ["macros-1-phone", PHONE, "/foods", async (p) => { await p.fill('input[aria-label="Protein minimum"]', "30"); }],
  ["macros-2-phone", PHONE, "/foods", async (p) => { await p.fill('input[aria-label="Protein minimum"]', "30"); await p.click("aside .panel-done"); await p.waitForTimeout(400); }],
  ["builder-1", DESKTOP, "/builder", async () => {}],
  ["builder-2", DESKTOP, "/builder", async (p) => { await p.locator(".idea").first().scrollIntoViewIfNeeded(); }],
  ["builder-3", DESKTOP, "/builder", async (p) => { await p.locator(".recipe-card").first().scrollIntoViewIfNeeded(); }],
  ["builder-3-phone", PHONE, "/builder", async (p) => { await p.locator(".recipe-card").first().scrollIntoViewIfNeeded(); }],
  ["credits-1", DESKTOP, "/builder", async () => {}],
  ["credits-1-phone", PHONE, "/builder", async (p) => { await p.click(".account-menu .credit-pill"); }],
  ["book-1", DESKTOP, "/recipes", async () => {}],
  ["community-1", DESKTOP, "/community", async () => {}],
  ["community-2", DESKTOP, "/community", async (p) => { await p.locator(".post-actions .text-button", { hasText: "Comments" }).first().click(); await p.waitForTimeout(800); }],
  ["community-1-phone", PHONE, "/community", async () => {}],
];

const browser = await chromium.launch();
for (const [file, viewport, path, act] of SHOTS) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await context.addInitScript((value) => {
    localStorage.setItem("macro-genie:prefs:v1", value);
    localStorage.setItem("macro-genie:macro-panel-used:v1", "");
  }, prefs);
  await context.route("**/api/me", (route) => route.fulfill({ json: ME }));
  const page = await context.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(800);
  await page.evaluate((to) => { history.pushState({}, "", to); dispatchEvent(new PopStateEvent("popstate")); }, path);
  await page.waitForTimeout(1500);
  await act(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `public/help/${file}.png` });
  console.log(`saved public/help/${file}.png`);
  await context.close();
}
await browser.close();
```

Add `"screenshots": "node scripts/screenshots.js"` to `package.json` scripts. (Navigation goes through `/` then `pushState` because the dev server can serve a stale `dist/index.html` for deep links.)

- [ ] **Step 4: Run** `npm run dev` in the background, then `npm run screenshots`. Expected: 14 files saved. Open each image and check it shows what its step describes; adjust the action for any that don't (e.g. a selector that changed).

- [ ] **Step 5: Use them in the guides** — set `image` / `imagePhone` and `thumb` in the guide modules:
  - `start`: step 1 `image: "/help/start-1.png"`, `thumb: "/help/start-1.png"`.
  - `macros`: the panel step `image: "/help/macros-1.png", imagePhone: "/help/macros-1-phone.png"`; the "Show N foods" step `image: "/help/macros-2-phone.png"`; `thumb: "/help/macros-1.png"`.
  - `builder`: targets step `/help/builder-1.png`; ideas step `/help/builder-2.png`; written-recipe step `image: "/help/builder-3.png", imagePhone: "/help/builder-3-phone.png"`; `thumb: "/help/builder-2.png"`.
  - `credits`: balance step `image: "/help/credits-1.png", imagePhone: "/help/credits-1-phone.png"`; `thumb: "/help/credits-1.png"`.
  - `book`: `/help/book-1.png` on the first step; `thumb` same.
  - `community`: browse step `image: "/help/community-1.png", imagePhone: "/help/community-1-phone.png"`; comments step `/help/community-2.png`; `thumb: "/help/community-1.png"`.
  - `faq`: `thumb: "/help/start-1.png"`.
  Then add `markers` where a step points at a specific control: view the image, estimate the control's centre as percentages of width/height, and add `{ n: 1, x, y }` (one marker per step, numbered with the step). At minimum: macros (the **Set your macros** card), builder (**Get ideas** button, **Cook this one**, **Write the recipe**), credits (the credits pill), community (**Comments**).

- [ ] **Step 6: Verify** `node --test tests/help.test.js && npm run check && npm run build`; look at `/help/builder` and `/help/macros` on desktop and at 390 px: markers sit on the controls, nothing overflows sideways.

- [ ] **Step 7: Commit**

```bash
npx prettier --write scripts/screenshots.js src/help
git add package.json package-lock.json scripts public/help src/help
git commit -m "Help: screenshots script, captured screenshots, markers"
```

---

### Task 8: Browser check, docs, TODO

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Apply the migration to the dev database** — confirm `.env`'s active `DATABASE_URL` is the dev branch (compare hostnames with the commented production one, never print passwords), then `npm run db:migrate`. Expected: `applied 20261013140000_messages.sql`.

- [ ] **Step 2: Browser check (short steps)** — with `npm run dev`:
  1. Header shows **Help**; `/help` hub cards at 1280 px and 390 px (no sideways overflow, element scan).
  2. `/help/cronometer` shows five steps; step 5 is the "Screenshot needed" placeholder.
  3. `/help/mcp` shows the site's own `/mcp` URL and Copy works.
  4. Footer links reach `/terms`, `/refunds`, `/privacy`, `/contact`.
  5. Signed out: send a contact message with an email → "Thanks…"; signed in as the owner (minted local session): Admin → Inbox shows it with the text as plain text (send one containing `<b>hi</b>` and check it shows literally); Mark done moves it to Done; Log → Messages shows "sent a message".
  6. A recipe card's **Copy ingredients** copies only the ingredient lines.

- [ ] **Step 3: README** — after the "Admin page" bullet add:

```markdown
- **Help (`/help`):** nine illustrated guides (`src/help/*.js`, Markdown text, screenshots in `public/help/`), plus Terms, Refunds, Privacy, and a contact form at `/contact` whose messages appear in Admin → Inbox. `npm run screenshots` re-takes the screenshots from the running dev site (Sam with 10 credits is mocked; the Builder state comes from `scripts/help-fixtures/prefs.json`). `npm run placeholders` writes "Screenshot needed" images for shots only the owner can take.
```

- [ ] **Step 4: Final verification** `npm run check && npm test && npm run build` — all pass.

- [ ] **Step 5: Commit, TODO, ask before pushing**

```bash
git add README.md
git commit -m "README: help section"
```

Update the Project TODO: mark the Help item built locally (date, not pushed); keep the four placeholder items open. Ask the owner before pushing.
