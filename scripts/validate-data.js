import { readFileSync } from "node:fs";
import { normalizeDataset } from "../src/lib/foods.js";
const data = normalizeDataset(
  JSON.parse(readFileSync(new URL("../foods.json", import.meta.url), "utf8")),
);
if (!data.foods.length)
  throw new Error("Dataset has no foods with serving sizes.");
console.log(
  `${data.foods.length.toLocaleString()} searchable foods; ${data.excluded} without a serving size excluded.`,
);
