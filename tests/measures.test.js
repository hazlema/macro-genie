import { test } from "node:test";
import assert from "node:assert/strict";
import raw from "../foods.json" with { type: "json" };
import { normalizeDataset } from "../src/lib/foods.js";
import { checkMeasure, gramsPerUnit } from "../src/lib/measures.js";

const { foods } = normalizeDataset(raw);
const by = (name) => foods.find((f) => f.name === name);
const apple = by("Apples, raw, granny smith, with skin");
const egg = by("Egg, whole, raw, fresh");
const onion = by("Onions, raw");
const strawberries = by("Strawberries, raw");
const cream = by("Cream, fluid, heavy whipping");
const butter = by("Butter, salted");

test("piece weights come from the USDA serving or typical sizes", () => {
  assert.equal(gramsPerUnit(egg, "large egg"), 50);
  assert.equal(gramsPerUnit(apple, "medium apple"), 180);
  assert.equal(Math.round(gramsPerUnit(onion, "small onion")), 77);
  assert.equal(Math.round(gramsPerUnit(strawberries, "cup")), 152);
  assert.equal(
    gramsPerUnit(cream, "tbsp"),
    null,
    "whipped cream isn't a reference",
  );
  assert.equal(gramsPerUnit(butter, "tsp"), null);
});

test("a wrong kitchen measure is corrected; a right one is kept", () => {
  // The bug: "½ Granny Smith apple" for 35 g (about a fifth of one).
  assert.deepEqual(checkMeasure(apple, 35, 0.5, "Granny Smith apple"), {
    qty: null,
    unit: "",
  });
  assert.deepEqual(checkMeasure(apple, 90, 1, "apple"), {
    qty: 0.5,
    unit: "apple",
  });
  assert.deepEqual(checkMeasure(egg, 150, 3, "large egg"), {
    qty: 3,
    unit: "large egg",
  });
  assert.deepEqual(checkMeasure(onion, 100, 2, "medium onion"), {
    qty: 0.91,
    unit: "medium onion",
  });
  assert.deepEqual(checkMeasure(strawberries, 50, 1, "cup"), {
    qty: 0.33,
    unit: "cup",
  });
  assert.deepEqual(
    checkMeasure(strawberries, 50, 0.4, "cup"),
    { qty: 0.4, unit: "cup" },
    "close enough",
  );
  assert.deepEqual(checkMeasure(cream, 35, 2.5, "tbsp"), {
    qty: 2.5,
    unit: "tbsp",
  });
  assert.deepEqual(
    checkMeasure(butter, 5, 1, "tsp"),
    { qty: 1, unit: "tsp" },
    "no reference: trusted",
  );
  assert.deepEqual(checkMeasure(egg, 50, 0, "egg"), { qty: null, unit: "" });
});
