# SEO, sitemap and link previews — design

Date: 2026-10-14. Status: approved in chat, awaiting spec review.

## Goal

Help people find Macro Genie without paid ads. Search engines should see a real page for the landing page, the fixed pages and each live community recipe. Shared links (Discord, Facebook, texts) should show a title, a picture and a short description. The cost on Netlify stays small and is shown on the admin Money tab as an estimate.

## Decisions

- **Approach:** fixed pages are built as their own HTML files at deploy time, so they cost nothing to serve. Community recipe pages and the sitemap are built by a Netlify function on request and cached on Netlify's CDN until they change. Rejected: an edge function, which would need a second database driver; and building recipe pages at deploy, which would cost a 15-credit deploy for every new post.
- **Indexed:** the landing page, `/foods`, `/builder`, `/community`, `/help`, each `/help/<guide>`, `/terms`, `/refunds`, `/privacy`, `/contact`, and every **live recipe** post at `/community/<id>`.
- **Not indexed:**
  - forum threads (General and Support)
  - held, blocked and removed posts
  - `/admin`, `/api`, `/credits`
  - `/recipes`: Recipe Book recipes live in one browser, so there's nothing for a crawler to see.
- **What a recipe page carries:** name, description, meal type, macros (calories, protein, carbs, fat per serving), servings, ingredients, steps, the poster's display name and the date. It has no likes and no comments, so they never invalidate the cache.
- **Images:** every page uses the genie lamp image for link previews. The page and structured data leave room for a per-recipe image, to be filled in later (AI-generated illustrations, labeled as such, are an idea for a later project). Without per-recipe images, recipes aren't eligible for Google's picture cards. They still appear as normal search results.
- **Netlify cost on the Money tab:** an estimate, for information only, and **not** subtracted in Net. Real Netlify dollars (the plan and top-ups) are already typed in as fixed costs. The rate is **1¢ per credit**, from the user's $5 for 500 credits. The credit rates follow Netlify's current pricing (April 2026): compute is 10 credits per GB-hour, and functions run with 1 GB.

## Pieces

### robots.txt (static, `public/robots.txt`)

```
User-agent: *
Disallow: /admin
Disallow: /api/
Disallow: /credits
Disallow: /recipes
Sitemap: https://macro-genie.com/sitemap.xml
```

### Fixed pages (build time)

- One table in code, `src/seo/pages.js`, gives each fixed path its title, description and canonical URL. The help guide entries come from the existing help guide list (`src/help/index.js`: slug, title, a one-line summary), so a new guide gets its own page automatically.
- A Vite build step writes `dist/<path>/index.html` for each one. It's a copy of the built `index.html` with that page's `<title>`, meta description, canonical link, Open Graph tags (`og:title`, `og:description`, `og:url`, `og:image`, `og:type`, `og:site_name`) and Twitter card tags.
- The Netlify redirect rules that send these paths to `/index.html` are changed to send each one to its own file. `/help/*` goes to `/help/:splat/index.html`, falling back to `/index.html` for an unknown guide.
- `index.html`'s own description is rewritten: the current "Find foods that fit your numbers" predates the Builder and Community.

### Recipe pages (function, cached)

- `netlify/functions/seo-post.js` takes over `/community/:id`, which today redirects to `/index.html`.
- The built `index.html` is included with the function (`included_files`) and read once per function instance, so the page gets the correct hashed script links.
- **Live recipe post:**
  - the page's title, description, canonical link and Open Graph and Twitter tags come from the post
  - a JSON-LD `schema.org/Recipe` block is added, with `name`, `description`, `author`, `datePublished`, `recipeCategory` (meal type), `recipeYield` (servings), `recipeIngredient`, `recipeInstructions` and `nutrition`, which holds `calories`, `proteinContent`, `carbohydrateContent` and `fatContent`
  - a plain HTML version of the recipe goes inside `<div id="app">`
- **Anything else** (a forum thread, a non-live post, an unknown id or a bad id) gets the plain `index.html` with `<meta name="robots" content="noindex">`. The app then shows what it shows today.
- **All text from a post is HTML-escaped**, including inside JSON-LD: `<` becomes `<` so a post can't close the script tag. Posts are user-written.
- The app's start-up (`src/main.js`) clears `#app` before mounting, so the server-built content never shows twice.
- **Cache headers on success:**
  - `Netlify-CDN-Cache-Control: public, durable, s-maxage=86400, stale-while-revalidate=604800`
  - `Netlify-Cache-Tag: post-<id>, posts`
  - `Cache-Control: public, max-age=0, must-revalidate`, so browsers always check with the CDN

  Fallback pages (database down) are sent with `Cache-Control: no-store` so they're never cached. `noindex` pages are cached the same way as live ones, under the post's tag, so a later approval clears them.

### Sitemap (function, cached)

- `netlify/functions/sitemap.js` serves `/sitemap.xml`.
- It lists every fixed page from `src/seo/pages.js`, plus every live recipe post as `/community/<id>` with `<lastmod>`. `lastmod` is the post's creation date (posts can't be edited).
- The cache headers are the same as the recipe pages, with tag `sitemap`.
- If the database fails, it returns 503 with `no-store`. Crawlers retry.

### Clearing the cache

- `server/seo.js` exports `purgePost(postId)`, which calls `purgeCache({ tags: ["post-<id>", "sitemap"] })` from `@netlify/functions`, which is added as a dependency.
- It's called after every change that alters what a recipe page or the sitemap shows:
  - a post created live, or approved from held
  - a post removed by its poster or a moderator (including a moderator removing all of a user's content)
  - a post blocked

  Posts can't be edited today, so there's no edit trigger. Never on likes, comments or display-name changes: a renamed poster shows up within the 1-day limit.
- `purgePost` never throws. On failure it logs with `console.error`, and the user's action still succeeds. Under `npm run dev` and in tests it does nothing: there's no CDN, and the purge client is swappable for a fake in tests. The 1-day `s-maxage` caps how stale a missed purge can leave a page.

### Netlify estimate on the Money tab

- New table `page_builds`: `month DATE PRIMARY KEY`, `builds INTEGER NOT NULL DEFAULT 0`, `ms BIGINT NOT NULL DEFAULT 0`.
- Each time `seo-post` or `sitemap` actually runs, meaning a cache miss (a cached response never reaches the function), it adds 1 build and its run time in milliseconds to the current UTC month with one upsert. A failed upsert is logged and ignored, the same rule as `ai_usage`.
- `buildMonth` adds `netlifyPages: { builds, credits, cents }`:
  - credits = `ms / 3_600_000 × 10` (compute at 1 GB) + `builds × 2 / 10_000` (web requests), rounded to 2 decimals
  - cents = `credits × 1`, rounded to 2 decimals
  - constants `CREDITS_PER_GB_HOUR = 10`, `CREDITS_PER_10K_REQUESTS = 2` and `CENTS_PER_CREDIT = 1` sit together in `server/money.js` with a comment naming the source and date
- It is **not** part of `netCents`. Saved months keep it inside their totals like everything else.
- On the Money tab it shows under the fixed costs as "Netlify pages (estimate): N built ≈ X credits ≈ $Y", styled like the Anthropic comparison line.

## When something fails

| Failure | What happens |
|---|---|
| Database down on a recipe page | The plain app page is sent with `no-store`. The visitor sees the app as today, and the next request tries again. |
| Database down on the sitemap | 503 with `no-store`. |
| Cache purge fails | Logged. The page refreshes within 1 day at most. |
| `page_builds` upsert fails | Logged and ignored. The estimate is a little low. |
| Unknown help guide path | Falls back to `/index.html`, and the app shows its own "not found". |

## Testing

- Node tests:
  - a live recipe's HTML has the right title, description, canonical link, Open Graph and Twitter tags, valid JSON-LD with nutrition, and escaped content; a test post named `</script><script>alert(1)</script>` stays inert in both the HTML and the JSON-LD
  - a forum thread, held, blocked and removed posts, an unknown id and a bad id each get `noindex` and the plain page
  - database down gives the plain page with `no-store`
  - the cache headers and tags are right
  - the sitemap lists the fixed pages and live recipes only, with `lastmod`, as valid XML
  - `robots.txt` has the expected lines
  - each fixed page's built file has its own title and description; the build step is tested as a function that takes the built `index.html` and returns each page's HTML
  - `purgePost` is called on each change that affects the page, never on likes or comments, and a failing purge doesn't fail the action
  - each page build adds to `page_builds`
  - the Money tab's estimate math, and that Net is unchanged
- After the push, by hand:
  - check one recipe URL in Google's Rich Results Test
  - paste a recipe link into Discord or a text message to check the preview
  - submit the sitemap in Google Search Console

## Out of scope

- Per-recipe images: a later project, maybe AI illustrations with a label.
- Indexing forum threads.
- Building the whole app on the server.
- Pulling real Netlify usage figures (Netlify doesn't seem to offer them through an API).
