import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShoppingList, canShop } from "../src/lib/shopping.js";

const recipe = (name, servings, ingredients, seasonings = []) => ({
  version: 2,
  id: name,
  name,
  servings,
  ingredients,
  seasonings,
  steps: [],
});

const stirFry = recipe(
  "Stir-fry",
  2,
  [
    { name: "Onions, raw", label: "onion", grams: 150, qty: 1, unit: "onion" },
    { name: "Beef, steak", label: "flank steak", grams: 300, qty: 0, unit: "" },
    { name: "Oil, olive", label: "olive oil", grams: 14, qty: 1, unit: "tbsp" },
  ],
  ["Salt", "pepper"],
);
const bowl = recipe(
  "Philly bowl",
  4,
  [
    { name: "Onions, raw", label: "onion", grams: 300, qty: 2, unit: "onions" },
    { name: "Beef, steak", label: "steak", grams: 400, qty: 0, unit: "" },
    { name: "Oil, olive", label: "olive oil", grams: 28, qty: 2, unit: "tsp" },
    {
      name: "Peppers, bell",
      label: "green pepper",
      grams: 120,
      qty: 1,
      unit: "cup",
    },
  ],
  ["salt", "Paprika"],
);

const text = (list) => list.items.map((i) => i.text);

test("the same food from several recipes becomes one line", () => {
  const list = buildShoppingList([
    { recipe: stirFry, servings: 2 },
    { recipe: bowl, servings: 4 },
  ]);
  const onion = list.items.find((i) => i.text.includes("onion"));
  assert.equal(onion.text, "3 onions (450 g)");
  assert.deepEqual(onion.from, ["Stir-fry", "Philly bowl"]);
  assert.equal(list.items.filter((i) => i.text.includes("onion")).length, 1);
});

test("amounts scale to the servings picked for each recipe", () => {
  const list = buildShoppingList([
    { recipe: stirFry, servings: 4 },
    { recipe: bowl, servings: 2 },
  ]);
  // 2 onions (300 g) + 1 onion (150 g)
  assert.ok(text(list).includes("3 onions (450 g)"));
  // 600 g + 200 g of steak, no kitchen measure
  assert.ok(text(list).includes("800 g flank steak"));
});

test("measures on the same ladder add up (tbsp + tsp)", () => {
  const list = buildShoppingList([
    { recipe: stirFry, servings: 2 },
    { recipe: bowl, servings: 4 },
  ]);
  // 1 tbsp + 2 tsp = 5 tsp = 1 ⅔ tbsp
  assert.ok(
    text(list).includes("1 ⅔ tbsp olive oil (42 g)"),
    text(list).join(" | "),
  );
});

test("measures that don't match fall back to grams", () => {
  const odd = recipe("Odd", 1, [
    {
      name: "Peppers, bell",
      label: "bell pepper",
      grams: 150,
      qty: 1,
      unit: "pepper",
    },
  ]);
  const list = buildShoppingList([
    { recipe: bowl, servings: 4 },
    { recipe: odd, servings: 1 },
  ]);
  assert.ok(text(list).includes("270 g green pepper"), text(list).join(" | "));
});

test("seasonings collect into one to-taste line at the end", () => {
  const list = buildShoppingList([
    { recipe: stirFry, servings: 2 },
    { recipe: bowl, servings: 4 },
  ]);
  assert.equal(list.items.at(-1).text, "To taste: salt, pepper, paprika");
});

test("lines sort alphabetically and start unticked", () => {
  const list = buildShoppingList([{ recipe: bowl, servings: 4 }]);
  assert.deepEqual(text(list).slice(0, -1), [
    "1 cup green pepper (120 g)",
    "2 tsp olive oil (28 g)",
    "2 onions (300 g)",
    "400 g steak",
  ]);
  assert.ok(list.items.every((i) => i.checked === false && i.id));
  assert.deepEqual(list.recipes, [
    { id: "Philly bowl", name: "Philly bowl", servings: 4 },
  ]);
});

test("only structured recipes can go on a list", () => {
  assert.equal(canShop(bowl), true);
  assert.equal(canShop({ id: "x", name: "Old", method: "text" }), false);
});
