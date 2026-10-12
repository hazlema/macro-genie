import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyRanges, rangeSummary } from "../src/lib/foods.js";

const set = (changes) => {
  const ranges = emptyRanges();
  for (const [key, value] of Object.entries(changes)) ranges[key] = value;
  return ranges;
};

test("the macro button says nothing when no range is set", () => {
  assert.equal(rangeSummary(emptyRanges()), "");
  assert.equal(
    rangeSummary(set({ protein: { min: null, max: undefined } })),
    "",
  );
});

test("each set range reads plainly, in table order", () => {
  assert.equal(
    rangeSummary(
      set({
        calories: { max: 600 },
        protein: { min: 30 },
        fat: { min: 10, max: 20 },
      }),
    ),
    "Protein ≥ 30 g, Calories ≤ 600 kcal, Fat 10–20 g",
  );
  assert.equal(
    rangeSummary(set({ netCarbs: { min: 0, max: 0 } })),
    "Net carbs 0 g",
  );
  assert.equal(
    rangeSummary(set({ sodium: { max: 1500.25 } })),
    "Sodium ≤ 1,500.3 mg",
  );
});

test("long summaries stop after three and count the rest", () => {
  assert.equal(
    rangeSummary(
      set({
        protein: { min: 30 },
        netCarbs: { max: 20 },
        calories: { max: 600 },
        fat: { max: 40 },
        sugar: { max: 10 },
      }),
    ),
    "Protein ≥ 30 g, Net carbs ≤ 20 g, Calories ≤ 600 kcal, +2 more",
  );
});
