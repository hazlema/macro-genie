# Macro Genie

A Svelte food search with nutrient ranges **per listed serving** or **per 100 g** (chosen from a dropdown). The website is static; a read-only Netlify Function exposes the same search through MCP. Neither needs a database, accounts, API keys, or persistent storage.

## Run locally

Use Node 24 (Node 22.12+ is also supported).

```sh
npm ci
npm run dev
```

Open the address printed by Vite. `npm run build` validates the food file and creates `dist/`. `npm run preview` serves that production build locally. `npm run check` checks Svelte, and `npm test` runs the search and MCP integration tests.

## Deploy to Netlify

Connect this GitHub repository to Netlify. The included `netlify.toml` supplies:

- Build command: `npm run build`
- Publish directory: `dist`
- Node version: 24
- A stateless function exposed at `/mcp`

Push changes to the branch connected to Netlify to rebuild both the website and MCP data. No environment variables are required. The static website works independently of the MCP function. Vite's local preview does not run Netlify Functions.

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

The server uses the [official MCP SDK](https://ts.sdk.modelcontextprotocol.io/server) and exposes three read-only tools:

| Tool                   | Purpose                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `search_foods`         | Intersect nutrient min/max ranges, name terms, and a category; sort and paginate |
| `list_food_categories` | Get category codes, labels, and searchable counts                                |
| `get_food_details`     | Retrieve serving and nutrient information using a search result ID               |

`search_foods` accepts `query`, `category`, `ranges`, `sort`, `basis` (`serving` by default, or `100g`), `limit` (1–100, default 20), and `offset`. `get_food_details` also accepts `basis`. Range keys are `protein`, `netCarbs`, `calories`, `fat`, `sugar`, and `sodium`. Sort keys are `none` (source order), `protein` (descending), `netCarbs`, `calories`, `sodium` (ascending), and `name`. Query words match the start of words in the food name. Every returned nutrient is per the chosen basis (reported in `basis`); source, units, and missing-data rules are included.

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

- `src/App.svelte`: filters, search state, results, and Recipes placeholder
- `src/components/FoodCard.svelte`: serving-based cards and expandable details
- `src/lib/foods.js`: data normalization and shared range search
- `mcp/server.js`: MCP tools shared by the HTTP and stdio entry points
- `netlify/functions/mcp.js`: stateless hosted transport
- `prototype/index.html`: preserved original HTML prototype
- `what-fits.png`: supplied visual reference

The interface uses DM Sans from Google Fonts with a system sans-serif fallback.
