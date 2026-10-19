# Macro Genie

A Svelte food search with nutrient ranges **per listed serving** or **per 100 g** (chosen from a dropdown). The website is a static Svelte app; a read-only Netlify Function exposes the same search through MCP. The Recipe Builder asks Claude for dish ideas and recipes (Anthropic API key), and accounts, credits, the Community, the admin page, and contact messages live in Postgres (Neon). Food search needs no account; dislikes, the recipe in progress, and the Recipe Book are kept in the visitor's browser.

## Run locally

Use Node 24 (Node 22.12+ is also supported).

```sh
npm ci
npm run dev
```

Open the address printed by Vite. The Netlify Vite plugin runs the `/api` and `/mcp` functions inside `npm run dev`, so the Netlify CLI isn't needed. To try recipe ideas locally, put your key in a `.env` file at the repository root (it is git-ignored):

```sh
ANTHROPIC_API_KEY=sk-ant-...
```

Without it, everything works except the Recipe Builder's ideas and recipe writing, which say the key is missing. `npm run build` validates the food file and creates `dist/`. `npm run preview` serves that production build locally. `npm run check` checks Svelte, and `npm test` runs the search and MCP integration tests.

To try credit purchases locally, delete any leftover `dist/` folder before `npm run dev`: the Netlify dev plugin otherwise serves the old built `index.html` for redirected paths such as `/credits`. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli); it uses the key from `.env`, so no `stripe login` is needed. With `STRIPE_SECRET_KEY` (a test key) in `.env`, `npm run dev` runs `stripe listen` for you and forwards webhooks to the dev server; its output is prefixed `[stripe]`. Copy the `whsec_…` signing secret it prints into `.env` as `STRIPE_WEBHOOK_SECRET` (it stays the same between runs).

Pay with the Stripe test card `4242 4242 4242 4242`.

The admin **Money** tab counts Anthropic's actual bill for the key (local testing included) in its net, next to the app's own AI cost estimate, when `ANTHROPIC_ADMIN_KEY` (an `sk-ant-admin…` Admin API key from the Claude Console; it needs an organization, not an individual account) is in `.env` locally or in the Netlify environment in production. Without it, the tab shows the estimate only.

## Deploy to Netlify

Connect this GitHub repository to Netlify. The included `netlify.toml` supplies:

- Build command: `npm run build`
- Publish directory: `dist`
- Node version: 24
- A stateless function exposed at `/mcp`
- `/api/idea` and `/api/recipe`, which call Claude for the Recipe Builder tab

Push changes to the branch connected to Netlify to rebuild both the website and MCP data. The static website works independently of the functions.

### Accounts and credits

The Recipe Builder needs a free account: "Login / Create Account" signs in with Google, and new accounts get 10 credits. Each idea or written recipe uses one credit; a job that fails is refunded. Food search, the Recipe Book, browsing the Community, and the MCP server need no account.

- **Stored:** Google's account id, a first name for display, the credit balance, in Postgres (Neon, via `DATABASE_URL`). No Stripe customer id: purchases are one-time Checkout payments. A credit ledger records each change with its reason. No password, and accounts hold no email (the contact form keeps the email a sender types, with their message).
- **Environment variables** (Functions scope): `GOOGLE_CLIENT_ID` (a Google Cloud OAuth "Web application" client; authorized JavaScript origins `http://localhost`, `http://localhost:5173`, and the site's URL) and `SESSION_SECRET` (any random string of 32+ characters; signs the session cookie).
- **Database:** `DATABASE_URL` points at Postgres (production: a Netlify secret; locally: a Neon dev branch in `.env`). Migrations in `db/migrations/` are applied by `npm run db:migrate`, which also runs during production Netlify builds. After creating or resetting a dev branch, run `npm run db:migrate`. `sslmode=require` is upgraded to `verify-full` in code (`server/db.js`).
- **Buying credits:** the Get more credits page (`/credits`) sells three packs: 20 credits for $3, 50 for $6, and 120 for $12 (`server/packs.js`). `POST /api/credits/checkout` starts a hosted Stripe Checkout, and the page confirms the payment on return through `POST /api/credits/confirm`. Stripe also calls `POST /api/stripe/webhook` (`netlify/functions/stripe-webhook.js`), which adds a purchase's credits once per Checkout session, and takes back credits in proportion when a charge is refunded (never below zero). Environment variables (Functions scope): `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. In the live Stripe dashboard, add a webhook endpoint for `https://<your-site>/api/stripe/webhook` subscribed to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `charge.refunded`; its signing secret is the production `STRIPE_WEBHOOK_SECRET`.
- **Writing in the Community:** threads and comments use a rich-text editor (Tiptap, loaded only when a writing box opens) that saves Markdown: bold, italic, lists, and links. Emoji: the 😊 picker, `:shortcode:` with suggestions after two letters, and a few emoticons (`:)`, `:D`, `<3`…). Text is stored as Markdown with real emoji characters and shown through a small allow-list renderer (`src/lib/markdown.js`); anything else, including HTML, shows as plain text. Links to other sites must be http(s) and open in a new tab; plain paths on this site (`/help/builder`) open in place. Any post with a link waits for a moderator.
- **Admin page (`/admin`):** for moderators and admins. Reviews (the moderation queue), Users (find someone; mods can suspend and remove their community posts, admins can also add or remove credits with a reason, set roles, and delete and ban), and Log (recipe posts, sign-ins, credit changes, and problems such as held posts, reports, and admin actions; kept 90 days). Roles live on the account (`is_admin`, `is_mod`); accounts listed in `ADMIN_SUBS` are owners, always admins, and can't be changed from the page. Suspended accounts can browse but not post, comment, like, report, or use credits. Delete and ban erases the account and keeps only its Google id on a ban list.
- **Help (`/help`):** nine illustrated guides (`src/help/*.js`, Markdown text, screenshots in `public/help/`), plus Terms, Refunds, Privacy, and a contact form at `/contact` whose messages appear in Admin → Inbox. `npm run screenshots` re-takes the screenshots from the running dev site (Sam with 10 credits is mocked; the Builder state comes from `scripts/help-fixtures/prefs.json`). `npm run placeholders` writes "Screenshot needed" images for shots only the owner can take.

### Recipe ideas (Claude)

Set `CLAUDE_API_KEY` (an Anthropic API key) in Netlify under **Project configuration → Environment variables**, scoped to **Functions**, then redeploy. Without it, the Recipe Builder explains that ideas aren't set up. Calls always go straight to `api.anthropic.com`; the `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` that Netlify's AI Gateway injects are ignored, because the gateway was slow, sometimes not ready, and billed in Netlify credits.

- **How it works:** "Get 4 ideas" sends four requests at once, each asking Claude (`IDEA_MODEL`, low effort) for one dish with a different lean (a bake, a skillet dish, a soup or stew, something unexpected), plus an honest rating of how well its ingredients go together (great / mixed / clashes) shown on the idea card. Claude searches the USDA data through a `find_foods` tool and submits food IDs with rough grams. Visitors type the foods they want as plain text ("eggs, pumpkin, onions"). The server drops anything unknown or disliked (seasonings too), keeps the asked-for foods from being cut below a quarter, notes any the idea left out, and sizes the amounts with the same solver the page uses. "Write the recipe" returns a structured recipe (ingredients with kitchen measures, steps with amount placeholders) for the chosen dish with the amounts fixed, so it can be shown for any number of servings. Claude never supplies nutrition numbers.
- **Cost:** you pay per request on your Anthropic account. Each idea is one or two short model calls; check real usage in the Anthropic Console and set a monthly spend limit there.
- **Abuse limits:** Netlify rate limits per visitor IP: 20 idea requests and 6 recipe write-ups a minute. Requests are validated and capped in size.
- **Refusals:** requests use Anthropic's server-side fallback (`fallbacks: "default"`), so a safety decline is retried on another model before the visitor sees an error.
- Each request finishes inside Netlify's 60-second function limit. Ideas usually arrive in 10–30 seconds.
- **Choosing the model:** set `IDEA_MODEL` and/or `RECIPE_MODEL` in Netlify to `claude-opus-5-5` (the default), `claude-sonnet-5-5`, or `claude-haiku-5-5`, then redeploy.
- **Cost per job:** every idea and written recipe logs one `ai_usage` line in the Netlify function logs with the model, tokens, time, and an estimated `costUsd` from the list prices in `server/usage.js`. The billing dashboard is the source of truth.
- **Comparing models:** `npm run compare` sends three sample requests to Opus and Sonnet (two ideas and one written recipe each) and writes a side-by-side report to `reports/`. Pass model names to compare others, e.g. `npm run compare -- claude-opus-5-5 claude-haiku-5-5`. It needs `ANTHROPIC_API_KEY` in `.env` and costs roughly $0.50 a run. Vite's local preview does not run Netlify Functions.

The configuration follows [Netlify's Vite deployment guidance](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/).

## Update the data

Replace or edit the root `foods.json`, run `npm test` and `npm run build`, then commit and push. The build copies that file into the static site; the function imports the same file at build time. There is no live USDA API request. The supplied file is labeled USDA SR28 / SR Legacy and contains 8,789 records. Its original upstream record identifiers and extraction date were not supplied.

The source format remains:

```text
{ "src": "Source description", "foods": [
  [name, categoryCode, kcal, protein, fat, carbs, fiber, sugar,
   sodium, saturatedFat, servingGrams, servingDescription]
] }
```

Source nutrients are **per 100 g**, with sodium in mg and other nutrient masses in g. The shared normalization code keeps the per-100 g values and also converts every value to the row's listed serving; the chosen basis is used for filtering, sorting, and returned results. Do not put per-serving values into this source format; they would be converted twice.

Important data behavior:

- 8,490 records have a positive serving weight and description. The other 299 are excluded, and the site reports that count.
- The source's portion is used verbatim. Some portions are whole roasts, whole turkey breasts, or a pound of meat rather than an individual eating portion. Curate the weight and description together if replacing these with more practical serving sizes; keep source nutrient values per 100 g.
- `null` is unknown, not zero. A missing nutrient cannot match an active range. Unfiltered foods may still have missing nutrients.
- Net carbs = max(0, total carbs − fiber). If either input is missing, net carbs are unknown.
- Bounds are inclusive and applied together. Filtering uses full precision; the UI rounds values to one decimal and displays positive values below 0.1 as `<0.1`.
- Presets are editable numeric shortcuts, not dietary recommendations or nutrition-label certifications.
- IDs such as `usda-row-2684` identify positions in this file. They are not USDA FDC identifiers and can change when rows are reordered.

Recipes intentionally shows “Coming soon.” Additional food sources can be added later; this version uses only the supplied USDA file.

## MCP access

The server uses the [official MCP SDK](https://ts.sdk.modelcontextprotocol.io/server) and exposes four read-only tools:

| Tool                   | Purpose                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `search_foods`         | Intersect nutrient min/max ranges, name terms, and a category; sort and paginate |
| `list_food_categories` | Get category codes, labels, and searchable counts                                |
| `get_food_details`     | Retrieve serving and nutrient information using a search result ID               |
| `size_recipe`          | Size ingredient grams so each serving of a dish meets nutrient ranges            |

`search_foods` accepts `query`, `category`, `ranges`, `sort`, `basis` (`serving` by default, or `100g`), `limit` (1–100, default 20), and `offset`. `get_food_details` also accepts `basis`. `search_foods` accepts `exclude`, a list of words for foods to leave out (plurals also match the singular). Range keys are `protein`, `netCarbs`, `calories`, `fat`, `sugar`, and `sodium`. Sort keys are `none` (source order), `protein` (descending), `netCarbs`, `calories`, `sodium` (ascending), and `name`. Query words match the start of words in the food name. Every returned nutrient is per the chosen basis (reported in `basis`); source, units, and missing-data rules are included.

`size_recipe` takes `ingredients` (food IDs with the grams you'd like for the whole dish, optionally `required`), `servings` (1–50), and per-serving `ranges`. It keeps amounts as close to the request as possible: each can drop to zero (a required one keeps a quarter) or grow to double. When the ranges can't all be met, it returns the closest match with `fits: false` and the `misses`. It uses the same solver as the Recipe Builder.

Example tool arguments:

```json
{
  "query": "chicken",
  "ranges": {
    "protein": { "min": 20, "max": 40 },
    "calories": { "max": 300 }
  },
  "sort": "protein",
  "limit": 10
}
```

### Hosted connection

After deployment, add `https://YOUR-SITE.netlify.app/mcp` to an MCP client as a **Streamable HTTP** endpoint. It is public and read-only, with no authentication. It responds with JSON and creates no sessions. A normal browser GET returns 405; this endpoint is intended for MCP clients. Each request reads the bundled data without contacting any external food service.

### Local connection

For a client that supports stdio, point it at the repository's script using an absolute path:

```json
{
  "mcpServers": {
    "macro-genie": {
      "command": "node",
      "args": ["/absolute/path/to/health/mcp/stdio.js"]
    }
  }
}
```

Run `npm ci` in that checkout first. Local MCP reads the local checkout's food file; it does not automatically follow deployed updates.

## Project layout

- `src/App.svelte`: filters, search state, results, and tab switching
- `src/components/Recipes.svelte`: targets and wanted foods, four Claude ideas with a pairing rating, then an editable recipe sized to the targets with a written method
- `src/components/RecipeCard.svelte`: the written recipe as a card with per-serving nutrition, used on screen and for printing
- `src/components/SavedRecipes.svelte`: the My recipes tab (saved in localStorage; print, copy, delete)
- `src/components/DislikesModal.svelte`: foods you won't eat, saved in the browser's localStorage
- `src/lib/recipe.js`: ingredient solver (linear programming via `javascript-lp-solver`) and dislike matching
- `src/lib/prefs.svelte.js`: browser-stored dislikes and the recipe in progress
- `server/chef.js`: Claude calls for ideas and recipe methods, plus the checks and sizing applied to what comes back
- `netlify/functions/idea.js`, `netlify/functions/recipe.js`: the `/api` endpoints, rate limited
- `src/lib/scale.js`: renders a structured recipe at any number of servings (kitchen fractions, unit changes, amounts in steps)
- `src/components/FoodCard.svelte`: serving-based cards and expandable details
- `src/lib/foods.js`: data normalization and shared range search
- `mcp/server.js`: MCP tools shared by the HTTP and stdio entry points
- `netlify/functions/mcp.js`: stateless hosted transport
- `prototype/index.html`: preserved original HTML prototype
- `what-fits.png`: supplied visual reference

The interface uses DM Sans from Google Fonts with a system sans-serif fallback.
