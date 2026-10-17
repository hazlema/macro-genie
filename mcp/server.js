import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import raw from "../foods.json" with { type: "json" };
import {
  BASES,
  GROUPS,
  NUTRIENTS,
  SORTS,
  normalizeDataset,
  searchFoods,
  withBasis,
} from "../src/lib/foods.js";
import { expandDislikes, solveRecipe } from "../src/lib/recipe.js";
import { getPost, listPosts } from "../server/community.js";
import { UserFacingError } from "../server/chef.js";
import { renderRecipe } from "../src/lib/scale.js";
import { MEAL_TYPES } from "../server/moderate.js";

const dataset = normalizeDataset(raw);
const exclude = z
  .array(z.string().min(1).max(40))
  .max(50)
  .optional()
  .describe(
    'Foods to leave out: any food whose name contains all words of an entry (matched at word starts), e.g. ["mushroom", "cilantro"]',
  );
const range = z
  .object({
    min: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
  })
  .strict();
const rangesInput = (basis) =>
  z
    .object(
      Object.fromEntries(
        NUTRIENTS.map((n) => [
          n.key,
          range.optional().describe(`${n.label} in ${n.unit} ${basis}`),
        ]),
      ),
    )
    .strict()
    .optional();
const units = Object.fromEntries(NUTRIENTS.map((n) => [n.key, n.unit]));
const reply = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const basisInput = z
  .enum(Object.keys(BASES))
  .default("serving")
  .describe(
    'Nutrient basis: "serving" (each food\'s listed serving) or "100g" (per 100 g, for weight-for-weight comparison)',
  );
const metadata = (basis) => ({
  basis: basis === "100g" ? "per 100 g" : "per serving",
  units: { ...units, carbs: "g", fiber: "g", saturatedFat: "g" },
  source: dataset.source,
  excludedWithoutServing: dataset.excluded,
  notes: `${basis === "100g" ? "Nutrients are per 100 g; the listed serving is included for reference." : "Each food uses its own listed serving size."} Null means not reported; unknown nutrients never match an active range. Net carbs = max(0, total carbs - fiber). IDs are local to this dataset version, not USDA FDC IDs.`,
});

const SITE = "https://macro-genie.com";
const COMMUNITY_NUTRIENTS = ["calories", "protein", "netCarbs", "fat", "sugar", "sodium"];
const communityRanges = z
  .object(
    Object.fromEntries(
      COMMUNITY_NUTRIENTS.map((key) => [
        key,
        range.optional().describe(`${units[key] ? `${key} in ${units[key]}` : key} per serving`),
      ]),
    ),
  )
  .strict()
  .optional();
const NO_COMMUNITY = "Community search isn't available on this server.";
const NOT_A_RECIPE = "That recipe isn't in the community.";
// Only messages written for people go out; anything else (no database,
// a connection error) becomes the one generic line.
const communityError = (error) => ({
  ...reply({ error: error instanceof UserFacingError ? error.message : NO_COMMUNITY }),
  isError: true,
});
const round1 = (n) => (typeof n === "number" ? Math.round(n * 10) / 10 : null);
// The post as an AI should see it: the recipe's description and per-serving
// numbers, plus where to find it on the site.
const summarizePost = (post) => ({
  id: post.id,
  name: post.name,
  meal: post.mealType,
  author: post.author,
  postedAt: post.createdAt,
  likes: post.likes,
  comments: post.comments,
  description: post.recipe?.description ?? "",
  perServing: Object.fromEntries(
    COMMUNITY_NUTRIENTS.map((key) => [key, round1(post.recipe?.perServing?.[key])]),
  ),
  url: `${SITE}/community/${post.id}`,
});
// The whole recipe, with ingredient lines and steps rendered the way the
// site shows them ("1 cup canned pumpkin", "{2:1/2}" → "60 g Gruyère").
const fullPost = (post) => {
  if (post.kind !== "recipe" || !post.recipe) throw new UserFacingError(NOT_A_RECIPE, 404);
  const r = post.recipe;
  const shown = renderRecipe(r);
  return {
    ...summarizePost(post),
    servings: r.servings,
    ingredients: (r.ingredients ?? []).map((i, index) => ({
      name: i.label || i.name,
      food: i.name,
      text: shown.ingredients[index]?.text ?? `${i.grams} g ${i.label || i.name}`,
      grams: i.grams,
      qty: i.qty ?? null,
      unit: i.unit ?? "",
      prep: i.prep ?? "",
    })),
    seasonings: r.seasonings ?? [],
    method: shown.steps,
    tip: r.tip || "",
  };
};

export function createMcpServer() {
  const server = new McpServer({ name: "macro-genie", version: "0.5.0" });
  server.registerTool(
    "search_foods",
    {
      description:
        'Find foods matching ALL nutrient ranges. Ranges, sorting, and returned nutrients use the chosen basis: per listed serving (default) or per 100 g (basis "100g"). Includes serving description and grams. Blank bounds impose no limit. Results use full-precision values. Use offset to page through results.',
      inputSchema: {
        query: z
          .string()
          .max(200)
          .optional()
          .describe("Food name; all space-separated words must match"),
        category: z.enum(["all", ...Object.keys(GROUPS)]).optional(),
        ranges: rangesInput("per the chosen basis"),
        sort: z.enum(Object.keys(SORTS)).optional(),
        basis: basisInput,
        exclude,
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().nonnegative().default(0),
      },
      annotations,
    },
    async ({ limit, offset, basis, exclude, ...options }) => {
      try {
        const found = searchFoods(dataset.foods, {
          ...options,
          basis,
          exclude: expandDislikes(exclude),
        });
        return reply({
          ...metadata(basis),
          total: found.length,
          offset,
          limit,
          foods: found
            .slice(offset, offset + limit)
            .map((food) => withBasis(food, basis)),
        });
      } catch (error) {
        return { ...reply({ error: error.message }), isError: true };
      }
    },
  );
  server.registerTool(
    "list_food_categories",
    {
      description:
        "List available category IDs, labels, and counts for food searches.",
      inputSchema: {},
      annotations,
    },
    async () =>
      reply({
        categories: Object.entries(GROUPS).map(([id, name]) => ({
          id,
          name,
          count: dataset.foods.filter((food) => food.category === id).length,
        })),
      }),
  );
  server.registerTool(
    "get_food_details",
    {
      description:
        "Get serving size, source, and nutrients for a food ID returned by search_foods, per serving (default) or per 100 g. IDs may change when the dataset is replaced.",
      inputSchema: { id: z.string().max(100), basis: basisInput },
      annotations,
    },
    async ({ id, basis }) => {
      const food = dataset.foods.find((food) => food.id === id);
      return food
        ? reply({ ...metadata(basis), food: withBasis(food, basis) })
        : {
            ...reply({
              error: "Food not found. Search again to get a current ID.",
            }),
            isError: true,
          };
    },
  );
  server.registerTool(
    "size_recipe",
    {
      description:
        "Work out ingredient amounts for a dish so EACH SERVING meets nutrient ranges, using USDA data. Use this instead of doing nutrition math yourself. Give food IDs from search_foods with the grams you'd like for the whole dish. Amounts stay as close to those as possible: each can shrink to 0 (a required one keeps at least a quarter) or grow to double. If the ranges can't all be met, it returns the closest match and lists the misses. Returned nutrients are per serving and computed from the whole-gram amounts.",
      inputSchema: {
        ingredients: z
          .array(
            z
              .object({
                id: z.string().max(100),
                grams: z
                  .number()
                  .positive()
                  .max(5000)
                  .describe("Grams you'd like in the whole dish"),
                required: z
                  .boolean()
                  .optional()
                  .describe("Keep at least a quarter of this amount"),
              })
              .strict(),
          )
          .min(1)
          .max(20),
        servings: z.number().int().min(1).max(50).default(1),
        ranges: rangesInput("per serving"),
      },
      annotations,
    },
    async ({ ingredients, servings, ranges = {} }) => {
      try {
        const items = ingredients.map(({ id, grams, required }) => {
          const food = dataset.foods.find((f) => f.id === id);
          if (!food)
            throw new Error(
              `Food ${id} not found. Search again to get a current ID.`,
            );
          return { food, grams, required: !!required };
        });
        const solved = solveRecipe(items, { servings, ranges });
        return reply({
          basis: "per serving",
          units: metadata("serving").units,
          source: dataset.source,
          servings,
          fits: solved.fits,
          misses: solved.misses,
          ingredients: solved.amounts.map(({ food, wanted, grams }) => ({
            id: food.id,
            name: food.name,
            requestedGrams: wanted,
            grams,
            listedServing: food.serving,
          })),
          totalGrams: solved.totalGrams,
          perServing: solved.perServing,
          notReported: solved.unknown,
          notes:
            "Use these amounts exactly. Seasonings with negligible calories (salt, pepper, herbs, spices, vinegar, water) can be added freely. notReported lists foods missing a nutrient; those totals may be low.",
        });
      } catch (error) {
        return { ...reply({ error: error.message }), isError: true };
      }
    },
  );
  server.registerTool(
    "search_community",
    {
      description:
        "Find recipes people have shared on Macro Genie's Community. Filter by words in the name or description, meal type, and per-serving nutrient ranges. Returns a page of live recipes with their per-serving nutrition and a link; use get_community_recipe for the full ingredients and method.",
      inputSchema: {
        query: z
          .string()
          .max(100)
          .optional()
          .describe("Words that must all appear in the recipe's name or description"),
        meal: z.enum(["all", ...MEAL_TYPES]).default("all"),
        ranges: communityRanges,
        sort: z.enum(["new", "liked"]).default("new"),
        limit: z.number().int().min(1).max(20).default(10),
        offset: z.number().int().nonnegative().default(0),
      },
      annotations,
    },
    async ({ query, meal, ranges, sort, limit, offset }) => {
      try {
        const { posts, more } = await listPosts({ query, meal, ranges: ranges ?? {}, sort, offset });
        return reply({
          basis: "per serving",
          units: Object.fromEntries(COMMUNITY_NUTRIENTS.map((key) => [key, units[key]])),
          total: null,
          offset,
          limit,
          more: more || posts.length > limit,
          recipes: posts.slice(0, limit).map(summarizePost),
        });
      } catch (error) {
        return communityError(error);
      }
    },
  );
  server.registerTool(
    "get_community_recipe",
    {
      description:
        "One Community recipe in full: servings, ingredients with gram amounts, method, seasonings, and per-serving nutrition. Use the id from search_community.",
      inputSchema: { id: z.number().int().positive() },
      annotations,
    },
    async ({ id }) => {
      try {
        return reply(fullPost(await getPost(id)));
      } catch (error) {
        return communityError(error);
      }
    },
  );
  return server;
}
