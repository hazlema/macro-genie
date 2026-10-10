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

const dataset = normalizeDataset(raw);
const range = z
  .object({
    min: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
  })
  .strict();
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

export function createMcpServer() {
  const server = new McpServer({ name: "macro-genie", version: "0.2.0" });
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
        ranges: z
          .object(
            Object.fromEntries(
              NUTRIENTS.map((n) => [
                n.key,
                range
                  .optional()
                  .describe(`${n.label} in ${n.unit} per the chosen basis`),
              ]),
            ),
          )
          .strict()
          .optional(),
        sort: z.enum(Object.keys(SORTS)).optional(),
        basis: basisInput,
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().nonnegative().default(0),
      },
      annotations,
    },
    async ({ limit, offset, basis, ...options }) => {
      try {
        const found = searchFoods(dataset.foods, { ...options, basis });
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
  return server;
}
