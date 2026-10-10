import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDataset, searchFoods } from "../src/lib/foods.js";

const raw = {
  src: "Fixture source",
  foods: [
    ["Chicken, cooked", "0500", 200, 30, 8, 4, 1, null, 100, 2, 50, "1 piece"],
    ["Beans, cooked", "1600", 100, 8, 1, 20, 5, 2, 20, 0, 200, "1 cup"],
    ["Chicken, unknown portion", "0500", 200, 30, 8, 4, 1, 0, 100, 2, null, ""],
    ["Broth", "0600", 10, 1, 0, 1, null, 0, null, 0, 100, "1 cup"],
  ],
};

test("normalizes nutrients to the actual serving and excludes missing portions", () => {
  const data = normalizeDataset(raw);
  assert.equal(data.foods.length, 3);
  assert.equal(data.excluded, 1);
  assert.deepEqual(data.foods[0].serving, { label: "1 piece", grams: 50 });
  assert.equal(data.foods[0].nutrients.protein, 15);
  assert.equal(data.foods[0].nutrients.calories, 100);
  assert.equal(data.foods[0].nutrients.netCarbs, 1.5);
  assert.equal(data.foods[0].nutrients.sugar, null);
});

test("intersects inclusive min/max ranges using unrounded serving values", () => {
  const { foods } = normalizeDataset(raw);
  const found = searchFoods(foods, {
    ranges: { protein: { min: 15, max: 16 }, netCarbs: { max: 2 } },
  });
  assert.deepEqual(
    found.map((f) => f.name),
    ["Chicken, cooked"],
  );
  assert.equal(
    searchFoods(foods, { ranges: { protein: { min: 15.01, max: 16 } } })[0]
      .name,
    "Beans, cooked",
  );
});

test("unknown nutrients cannot satisfy an active limit, including zero", () => {
  const { foods } = normalizeDataset(raw);
  assert.equal(searchFoods(foods, { ranges: { sugar: { max: 0 } } }).length, 1);
  assert.equal(
    searchFoods(foods, { ranges: { sodium: { max: 0 } } }).length,
    0,
  );
  assert.equal(
    searchFoods(foods, { ranges: { netCarbs: { max: 1 } } }).length,
    0,
  );
});

test("search combines words, category, and per-serving sorting", () => {
  const { foods } = normalizeDataset(raw);
  assert.deepEqual(
    searchFoods(foods, { query: "COOKED chicken", category: "0500" }).map(
      (f) => f.name,
    ),
    ["Chicken, cooked"],
  );
  assert.equal(
    searchFoods(foods, { sort: "protein" })[0].name,
    "Beans, cooked",
  );
  assert.equal(
    searchFoods(foods, { query: "chicken", category: "1600" }).length,
    0,
  );
});

test("invalid ranges fail explicitly instead of silently clearing filters", () => {
  const { foods } = normalizeDataset(raw);
  for (const ranges of [
    { protein: { min: 20, max: 10 } },
    { sugar: { min: -1 } },
    { calories: { max: NaN } },
  ]) {
    assert.throws(() => searchFoods(foods, { ranges }), /range|number/i);
  }
});

test("per-100 g basis filters and sorts on source values", () => {
  const { foods } = normalizeDataset(raw);
  assert.equal(foods[0].per100g.protein, 30);
  assert.equal(foods[0].per100g.netCarbs, 3);
  assert.deepEqual(
    searchFoods(foods, {
      basis: "100g",
      ranges: { protein: { min: 25 } },
    }).map((f) => f.name),
    ["Chicken, cooked"],
  );
  assert.equal(
    searchFoods(foods, { basis: "100g", sort: "protein" })[0].name,
    "Chicken, cooked",
  );
  assert.throws(() => searchFoods(foods, { basis: "cup" }), /basis/);
});

test("search words match word starts and sort none keeps source order", () => {
  const { foods } = normalizeDataset({
    src: "Fixture source",
    foods: [
      ["Beef, sirloin steak", "1300", 200, 30, 8, 0, 0, 0, 60, 3, 85, "3 oz"],
      ["Beverages, tea, brewed", "1400", 1, 0, 0, 0, 0, 0, 3, 0, 240, "1 cup"],
      ["Tea biscuits", "1800", 400, 6, 12, 70, 2, 20, 300, 5, 10, "1 piece"],
      ["Mr. (tea) blend", "1400", 2, 0, 0, 0, 0, 0, 3, 0, 240, "1 cup"],
    ],
  });
  assert.deepEqual(
    searchFoods(foods, { query: "tea", sort: "none" }).map((f) => f.name),
    ["Beverages, tea, brewed", "Tea biscuits", "Mr. (tea) blend"],
  );
  assert.equal(searchFoods(foods, { query: "mr." }).length, 1);
  assert.equal(searchFoods(foods, { query: "(" }).length, 1);
});
