import { test } from "node:test";
import assert from "node:assert/strict";
import raw from "../foods.json" with { type: "json" };
import {
  findFoods,
  normalizeDataset,
  searchFoods,
  swapOptions,
} from "../src/lib/foods.js";
import {
  expandDislikes,
  isDisliked,
  isSavedRecipe,
  missingRequests,
  parseMethod,
  recipeText,
  solveRecipe,
  splitFoodList,
  usdaNamesFor,
} from "../src/lib/recipe.js";

const { foods } = normalizeDataset({
  src: "Fixture source",
  foods: [
    // name, group, kcal, protein, fat, carbs, fiber, sugar, sodium, satFat, grams, label
    ["Pumpkin, canned", "1100", 34, 1, 0.3, 8, 3, 3, 5, 0.1, 245, "1 cup"],
    ["Cheese, gruyere", "0100", 413, 30, 32, 0.4, 0, 0.4, 700, 19, 28, "1 oz"],
    ["Cream, heavy", "0100", 340, 3, 36, 3, 0, 3, 27, 23, 15, "1 tbsp"],
  ],
});
const [pumpkin, gruyere, cream] = foods;

test("amounts stay as asked when every target already fits", () => {
  const r = solveRecipe(
    [
      { food: pumpkin, grams: 200 },
      { food: gruyere, grams: 100 },
    ],
    { servings: 4, ranges: { calories: { max: 1000 } } },
  );
  assert.equal(r.fits, true);
  assert.deepEqual(
    r.amounts.map((a) => a.grams),
    [200, 100],
  );
  assert.equal(r.perServing.protein, (2 + 30) / 4);
});

test("the food driving a missed limit is cut, others stay", () => {
  const r = solveRecipe(
    [
      { food: pumpkin, grams: 400, required: true },
      { food: gruyere, grams: 100 },
    ],
    { servings: 4, ranges: { netCarbs: { max: 4 } } },
  );
  assert.equal(r.fits, true);
  assert.ok(r.amounts[0].grams < 400 && r.amounts[0].grams >= 100);
  assert.equal(r.amounts[1].grams, 100);
  assert.ok(r.perServing.netCarbs <= 4.05);
});

test("impossible targets return the closest match within the amount bounds", () => {
  const r = solveRecipe(
    [
      { food: pumpkin, grams: 400, required: true },
      { food: cream, grams: 50 },
    ],
    { servings: 2, ranges: { protein: { min: 30 }, netCarbs: { max: 1 } } },
  );
  assert.equal(r.fits, false);
  assert.ok(r.misses.length > 0);
  assert.ok(r.amounts[0].grams >= 100, "must-use keeps a quarter");
  assert.ok(
    r.amounts.every((a) => a.grams <= a.wanted * 2),
    "at most double",
  );
});

test("rounding to whole grams never causes a miss the solver avoided", () => {
  const { foods: all } = normalizeDataset(raw);
  const pick = (q) => searchFoods(all, { query: q, sort: "name" })[0];
  const items = [
    ["pumpkin canned without salt", 400, true],
    ["cream heavy whipping fluid", 150],
    ["egg whole raw fresh", 150],
    ["cheese gruyere", 120],
    ["bacon cooked", 60],
    ["pecans", 20],
  ].map(([q, grams, required]) => ({ food: pick(q), grams, required }));
  const r = solveRecipe(items, {
    servings: 4,
    ranges: {
      protein: { min: 40 },
      netCarbs: { max: 5 },
      calories: { max: 600 },
    },
  });
  assert.deepEqual(
    r.misses.map((m) => m.key),
    ["protein"],
  );
  assert.ok(Math.round(r.perServing.calories * 10) / 10 <= 600);
  assert.ok(Math.round(r.perServing.netCarbs * 10) / 10 <= 5);
});

test("bad servings or ranges fail explicitly; no usable items gives nothing", () => {
  const items = [{ food: pumpkin, grams: 100 }];
  assert.throws(() => solveRecipe(items, { servings: 0 }), /Servings/);
  assert.throws(
    () => solveRecipe(items, { ranges: { protein: { min: 5, max: 1 } } }),
    /range/,
  );
  assert.equal(solveRecipe([{ food: pumpkin, grams: 0 }]), null);
});

test("dislikes match word starts and common alternative names", () => {
  assert.equal(isDisliked(pumpkin, ["pump"]), true);
  assert.equal(isDisliked(pumpkin, ["kin"]), false);
  assert.equal(isDisliked(gruyere, ["Cheese  "]), true);
  assert.deepEqual(expandDislikes(["Cilantro"]), ["cilantro", "coriander"]);
  assert.deepEqual(expandDislikes(["pecans", "berries", "tomatoes", "swiss"]), [
    "pecans",
    "pecan",
    "berries",
    "berry",
    "tomatoes",
    "tomato",
    "swiss",
  ]);
  assert.equal(
    searchFoods(foods, { exclude: expandDislikes(["cheese", "heavy"]) }).length,
    1,
  );
});

test("food finding ranks plain foods first and matches plurals", () => {
  const { foods: all } = normalizeDataset(raw);
  const names = (q) => findFoods(all, q, { limit: 10 }).map((f) => f.name);
  assert.match(names("shrimp")[0], /^Crustaceans, shrimp/);
  assert.ok(names("eggs").includes("Egg, whole, raw, fresh"));
  assert.ok(!names("eggs").some((n) => /eggnog|eggplant/i.test(n)));
  assert.equal(names("onions")[0], "Onions, raw");
  assert.ok(
    !names("pumpkin")
      .slice(0, 3)
      .some((n) => /pie mix/i.test(n)),
  );
});

test("written recipes parse into headings, lists, and steps for the card", () => {
  const blocks = parseMethod(
    "## Ingredients\n- 1 cup pumpkin (230 g)\n- 3 eggs\n\n## Method\n1. Heat oven.\n2) Bake.\nEnjoy warm.",
  );
  assert.deepEqual(blocks, [
    { kind: "h", text: "Ingredients" },
    { kind: "ul", items: ["1 cup pumpkin (230 g)", "3 eggs"] },
    { kind: "h", text: "Method" },
    { kind: "ol", items: ["Heat oven.", "Bake."] },
    { kind: "p", text: "Enjoy warm." },
  ]);
  const text = recipeText({
    name: "Gratin",
    description: "",
    servings: 4,
    perServing: { protein: 20.04, calories: 400 },
    method: "## Method\n1. Bake.",
  });
  assert.match(text, /^Gratin\nServes 4\. Per serving: 20 g protein/);
  assert.match(text, /\n\nMethod\n1\. Bake\.$/);
});

test("requested foods are recognized despite periods and describing words", () => {
  const wanted = splitFoodList(
    "portabella mushrooms. mozzarella, tomato sauce, shaved steak, pepperoni",
  );
  assert.deepEqual(wanted, [
    "portabella mushrooms",
    "mozzarella",
    "tomato sauce",
    "shaved steak",
    "pepperoni",
  ]);
  assert.deepEqual(splitFoodList("Eggs, pumpkin and onions\n1.5 oz feta"), [
    "eggs",
    "pumpkin",
    "onions",
    "1.5 oz feta",
  ]);
  const names = [
    "Mushrooms, portabella, raw",
    "Cheese, mozzarella, whole milk",
    "Tomato products, canned, sauce",
    'Beef, ribeye cap steak, boneless, separable lean only, trimmed to 0" fat, all grades, raw',
    "Pepperoni, beef and pork, sliced",
  ];
  assert.deepEqual(missingRequests(names, wanted), []);
  assert.deepEqual(missingRequests(names, ["onions", "steak"]), ["onions"]);
  assert.deepEqual(missingRequests(["garlic"], ["garlic cloves"]), []);
});

test("everyday names count as the USDA food they mean", () => {
  const groundBeef = ["Beef, ground, 85% lean meat / 15% fat, raw"];
  assert.deepEqual(missingRequests(groundBeef, ["hamburger", "burgers"]), []);
  assert.deepEqual(
    missingRequests(["Peppers, sweet, red, raw"], ["bell peppers", "onions"]),
    ["onions"],
  );
  assert.deepEqual(usdaNamesFor("Hamburgers"), ["beef, ground"]);
});

test("singular words find plural spellings: strawberry, cherry, leaf", () => {
  const { foods: all } = normalizeDataset(raw);
  const first = (q) => findFoods(all, q, { limit: 1 })[0].name;
  assert.equal(first("strawberry"), "Strawberries, raw");
  assert.match(first("cherry"), /^Cherries/);
  assert.deepEqual(missingRequests(["Strawberries, raw"], ["strawberry"]), []);
  assert.ok(searchFoods(all, { query: "strawberry" }).length > 10);
});

test("swap offers the same kind of food first, and searches when typed", () => {
  const { foods: all } = normalizeDataset(raw);
  const by = (name) => all.find((f) => f.name === name);
  const beef = swapOptions(
    all,
    by("Beef, ground, 85% lean meat / 15% fat, raw"),
  );
  assert.ok(
    beef.slice(0, 6).every((f) => /^Beef, ground, .*raw$/.test(f.name)),
  );
  const cheese = swapOptions(all, by("Cheese, feta"));
  assert.ok(
    cheese.length >= 30 && cheese.every((f) => /^Cheese, /.test(f.name)),
  );
  assert.equal(
    swapOptions(all, by("Broccoli raab, raw"))[0].name,
    "Broccoli, raw",
  );
  assert.ok(
    swapOptions(all, by("Cheese, feta"), "", { exclude: ["brie"] }).every(
      (f) => !/brie/i.test(f.name),
    ),
  );
  assert.equal(
    swapOptions(all, by("Cheese, feta"), "broccoli")[0].name,
    "Broccoli, raw",
  );
});

test("saved recipes survive a reload whether structured or text", () => {
  const structured = {
    id: "a",
    name: "Gratin",
    version: 2,
    ingredients: [],
    steps: ["Bake."],
  };
  const text = { id: "b", name: "Old", method: "## Method\n1. Bake." };
  assert.equal(isSavedRecipe(structured), true);
  assert.equal(isSavedRecipe(text), true);
  assert.equal(isSavedRecipe({ id: "c", name: "Broken", version: 2 }), false);
  assert.equal(isSavedRecipe({ name: "No id", method: "x" }), false);
  assert.equal(isSavedRecipe(null), false);
});
