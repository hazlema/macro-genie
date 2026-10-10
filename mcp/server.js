import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import raw from "../foods.json" with { type: "json" };
import {
  GROUPS,
  NUTRIENTS,
  SORTS,
  normalizeDataset,
  searchFoods,
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
const metadata = {
  basis: "per serving",
  units: { ...units, carbs: "g", fiber: "g", saturatedFat: "g" },
  source: dataset.source,
  excludedWithoutServing: dataset.excluded,
  notes:
    "Each food uses its own listed serving size. Null means not reported; unknown nutrients never match an active range. Net carbs = max(0, total carbs - fiber). IDs are local to this dataset version, not USDA FDC IDs.",
};

export function createMcpServer() {
  const server = new McpServer({ name: "macro-genie", version: "0.1.0" });
  server.registerTool(
    "search_foods",
    {
      description:
        "Find foods matching ALL nutrient ranges PER LISTED SERVING. Includes serving description and grams. Blank bounds impose no limit. Results use full-precision values. Use offset to page through results.",
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
                  .describe(`${n.label} in ${n.unit} per serving`),
              ]),
            ),
          )
          .strict()
          .optional(),
        sort: z.enum(Object.keys(SORTS)).optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().nonnegative().default(0),
      },
      annotations,
    },
    async ({ limit, offset, ...options }) => {
      try {
        const found = searchFoods(dataset.foods, options);
        return reply({
          ...metadata,
          total: found.length,
          offset,
          limit,
          foods: found.slice(offset, offset + limit),
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
        "List available category IDs, labels, and counts for serving-based food searches.",
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
        "Get serving size, source, and nutrients for a food ID returned by search_foods. IDs may change when the dataset is replaced.",
      inputSchema: { id: z.string().max(100) },
      annotations,
    },
    async ({ id }) => {
      const food = dataset.foods.find((food) => food.id === id);
      return food
        ? reply({ ...metadata, food })
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
