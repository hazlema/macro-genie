// The USDA food data, loaded once per function instance. Its own file so the
// Community can look foods up without loading the Anthropic SDK.
import raw from "../foods.json" with { type: "json" };
import { normalizeDataset } from "../src/lib/foods.js";

export const { foods } = normalizeDataset(raw);
const byId = new Map(foods.map((f) => [f.id, f]));
export const foodById = (id) => byId.get(id) ?? null;
