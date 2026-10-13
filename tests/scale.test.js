import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatQty,
  ingredientLines,
  renderRecipe,
  scaleMeasure,
  structuredText,
} from "../src/lib/scale.js";

const recipe = {
  version: 2,
  name: "Pumpkin gratin",
  description: "Custardy and savory.",
  servings: 4,
  gramsPerServing: 170,
  perServing: { protein: 20.04, calories: 395.8 },
  ingredients: [
    {
      name: "Pumpkin, canned",
      label: "canned pumpkin",
      grams: 230,
      qty: 1,
      unit: "cup",
      prep: "",
    },
    {
      name: "Oil, olive",
      label: "olive oil",
      grams: 30,
      qty: 2,
      unit: "tbsp",
      prep: "divided",
    },
    {
      name: "Egg, whole",
      label: "large eggs",
      grams: 150,
      qty: 3,
      unit: "egg",
      prep: "",
    },
    {
      name: "Cheese, gruyere",
      label: "Gruyère",
      grams: 120,
      qty: null,
      unit: "",
      prep: "shredded",
    },
  ],
  seasonings: ["salt", "nutmeg"],
  steps: [
    "Heat {2:1/2} olive oil in a skillet.",
    "Whisk {1} pumpkin with {3} and {4:0.75} Gruyère.",
    "Top with the rest of the cheese ({4:1/4}) and bake.",
    "A broken {9} reference disappears.",
  ],
  tip: "Rest it 10 minutes.",
};

test("quantities read as kitchen fractions", () => {
  assert.deepEqual(
    [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2.97, 0.05, 12.4].map(formatQty),
    ["¼", "⅓", "½", "⅔", "¾", "1", "1 ½", "3", "⅛", "12"],
  );
});

test("measures scale and move between units", () => {
  assert.equal(scaleMeasure(2, "tbsp", 4), "½ cup");
  assert.equal(scaleMeasure(2, "tbsp", 0.5), "1 tbsp");
  assert.equal(scaleMeasure(0.5, "tsp", 4), "2 tsp");
  assert.equal(scaleMeasure(2, "tablespoons", 1), "2 tbsp");
  assert.equal(scaleMeasure(1, "cup", 3), "3 cups");
  assert.equal(scaleMeasure(6, "oz", 4), "1 ½ lb");
  assert.equal(scaleMeasure(3, "egg", 0.5), "1 ½ eggs");
  assert.equal(scaleMeasure(2, "medium onion", 1.5), "3 medium onions");
  assert.equal(scaleMeasure(2, "patty", 2), "4 patties");
  assert.equal(scaleMeasure(5, "g", 2), "10 g");
  assert.equal(scaleMeasure(null, "", 2), null);
});

test("a recipe renders at any servings; per-serving numbers never change", () => {
  const four = renderRecipe(recipe);
  assert.deepEqual(
    four.ingredients.map((i) => i.text),
    [
      "1 cup canned pumpkin",
      "2 tbsp olive oil",
      "3 large eggs",
      "120 g Gruyère",
    ],
  );
  assert.deepEqual(four.steps, [
    "Heat 1 tbsp olive oil in a skillet.",
    "Whisk 1 cup pumpkin with 3 eggs and 90 g Gruyère.",
    "Top with the rest of the cheese (30 g) and bake.",
    "A broken reference disappears.",
  ]);
  const two = renderRecipe(recipe, 2);
  assert.equal(two.factor, 0.5);
  assert.deepEqual(
    two.ingredients.map((i) => [i.text, i.grams]),
    [
      ["½ cup canned pumpkin", 115],
      ["1 tbsp olive oil", 15],
      ["1 ½ large eggs", 75],
      ["60 g Gruyère", 60],
    ],
  );
  assert.equal(two.steps[0], "Heat 1 ½ tsp olive oil in a skillet.");
  assert.equal(renderRecipe(recipe, 1).ingredients[2].text, "1 large egg");
  assert.equal(two.gramsPerServing, 170);
});

test("copied text is the recipe at the chosen servings", () => {
  const text = structuredText(recipe, 8, [
    { key: "protein", label: "Protein", unit: "g" },
  ]);
  assert.match(
    text,
    /^Pumpkin gratin\nCustardy and savory\.\nServes 8\. Per serving: 20 g protein\./,
  );
  assert.match(text, /- 2 cups canned pumpkin \(460 g\)/);
  assert.match(text, /- ¼ cup olive oil \(60 g\), divided/);
  assert.match(text, /- salt, nutmeg, to taste/);
  assert.match(text, /- 240 g Gruyère, shredded\n/, "no repeated grams");
  assert.match(text, /\n1\. Heat 2 tbsp olive oil in a skillet\./);
  assert.match(text, /Tip\nRest it 10 minutes\.$/);
});

test("a noun repeated after a counted amount is dropped", () => {
  const r = {
    ...recipe,
    ingredients: [
      { label: "onion", grams: 100, qty: 1, unit: "small onion", prep: "" },
      { label: "large eggs", grams: 150, qty: 3, unit: "egg", prep: "" },
      { label: "canned pumpkin", grams: 230, qty: 1, unit: "cup", prep: "" },
    ],
    steps: [
      "Cook {1} onion, then whisk {2} eggs with {3} pumpkin.",
      "Add {2:1/3} egg.",
    ],
  };
  assert.deepEqual(renderRecipe(r).steps, [
    "Cook 1 small onion, then whisk 3 eggs with 1 cup pumpkin.",
    "Add 1 egg.",
  ]);
  assert.equal(
    renderRecipe(r, 8).steps[0],
    "Cook 2 small onions, then whisk 6 eggs with 2 cups pumpkin.",
  );
});

test("Copy ingredients gives one line per ingredient at the shown servings, ready for Cronometer", () => {
  assert.equal(
    ingredientLines(recipe),
    [
      "1 cup canned pumpkin (230 g)",
      "2 tbsp olive oil (30 g), divided",
      "3 large eggs (150 g)",
      "120 g Gruyère, shredded",
      "salt, nutmeg, to taste",
    ].join("\n"),
  );
  const doubled = ingredientLines(recipe, 8).split("\n");
  assert.equal(doubled[0], "2 cups canned pumpkin (460 g)");
  assert.equal(doubled[3], "240 g Gruyère, shredded");
  assert.equal(
    ingredientLines({ ...recipe, seasonings: [] }).split("\n").length,
    4,
  );
});
