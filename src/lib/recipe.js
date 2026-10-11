import solver from "javascript-lp-solver";
import { NUTRIENTS, matchesAny, singular, validateRanges } from "./foods.js";

// USDA names use American words. Map common alternatives onto them.
const SYNONYMS = {
  cilantro: ["coriander"],
  coriander: ["cilantro"],
  prawn: ["shrimp"],
  prawns: ["shrimp"],
  shrimp: ["prawn"],
  aubergine: ["eggplant"],
  eggplant: ["aubergine"],
  courgette: ["squash, summer"],
  zucchini: ["squash, summer"],
  chickpea: ["garbanzo"],
  chickpeas: ["garbanzo"],
  garbanzo: ["chickpeas"],
  "green onion": ["onions, spring", "scallions"],
  scallion: ["onions, spring"],
  liver: ["liverwurst"],
  // Everyday names for foods USDA lists differently.
  hamburger: ["beef, ground"],
  burger: ["beef, ground"],
  "ground beef": ["beef, ground"],
  "ground turkey": ["turkey, ground"],
  "ground pork": ["pork, ground"],
  "ground chicken": ["chicken, ground"],
  "bell pepper": ["peppers, sweet"],
  "green beans": ["beans, snap"],
  "string beans": ["beans, snap"],
  "hot dog": ["frankfurter"],
  ketchup: ["catsup"],
  "broccoli rabe": ["broccoli raab"],
  rapini: ["broccoli raab"],
};

// The USDA names for an everyday food name: "hamburgers" -> ["beef, ground"].
export const usdaNamesFor = (word) => {
  const w = word.toLocaleLowerCase().trim();
  return SYNONYMS[w] ?? SYNONYMS[singular(w)] ?? [];
};

export function expandDislikes(words = []) {
  const phrases = words
    .map((w) => w.toLocaleLowerCase().trim())
    .filter(Boolean);
  // "pecans" should also catch "pecan pie", so add the singular.
  return [
    ...new Set(
      phrases.flatMap((w) => [
        w,
        singular(w),
        ...(SYNONYMS[w] ?? SYNONYMS[singular(w)] ?? []),
      ]),
    ),
  ];
}

// True when the food's name contains any of the words (plurals and common
// alternative names included).
export const nameMatches = (food, words) =>
  matchesAny(food, expandDislikes(words));
export const isDisliked = nameMatches;

// "eggs, pumpkin. onions and leeks" -> ["eggs", "pumpkin", "onions", "leeks"].
// Periods split too, but not decimal points.
export function splitFoodList(text = "") {
  return [
    ...new Set(
      text
        .split(/[,;\n&]|\.(?!\d)|\band\b/i)
        .map((w) => w.trim().replace(/\s+/g, " ").toLocaleLowerCase())
        .filter(Boolean),
    ),
  ]
    .slice(0, 8)
    .map((w) => w.slice(0, 40));
}

// Words that say how a food is prepared or sold, not what it is.
const DESCRIBING = new Set(
  "shaved sliced diced chopped minced grated shredded fresh frozen raw cooked canned dried smoked whole large small baby lean boneless skinless cloves clove slices pieces fillets".split(
    " ",
  ),
);

// Whether a food (or seasoning) answers a requested one. Any main word of
// the request is enough: "shaved steak" -> "steak", "garlic cloves" -> "garlic".
export function answersRequest(food, phrase) {
  const main = phrase
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !DESCRIBING.has(w));
  return nameMatches(food, [phrase]) || nameMatches(food, main);
}

// Requested foods that none of the ingredients or seasonings answer.
export function missingRequests(names, wanted) {
  return wanted.filter(
    (phrase) => !names.some((name) => answersRequest({ name }, phrase)),
  );
}

// Nutrients shown for a dish, in order.
export const DISH_NUTRIENTS = [
  ...NUTRIENTS,
  { key: "carbs", label: "Total carbs", unit: "g" },
  { key: "fiber", label: "Fiber", unit: "g" },
];

// How much one unit of each nutrient "costs" when a limit is missed, so a
// 50 kcal miss and a 1 g carb miss weigh about the same.
const MISS_SCALE = { calories: 50, sodium: 100 };

/**
 * Size ingredient amounts so each serving of the dish meets the ranges.
 * items: [{ food, grams, required }] where grams is the amount you'd like.
 * Amounts stay as close to what you asked for as possible, between zero
 * (a quarter for must-use items) and double. When the ranges
 * can't all be met, it returns the closest match and lists what's missed.
 */
export function solveRecipe(items, { servings = 1, ranges = {} } = {}) {
  validateRanges(ranges);
  if (!Number.isInteger(servings) || servings < 1 || servings > 50)
    throw new Error("Servings must be a whole number from 1 to 50.");
  const usable = items.filter((item) => item.grams > 0);
  if (!usable.length) return null;

  const active = Object.entries(ranges).filter(
    ([, r]) => r && (r.min != null || r.max != null),
  );
  const constraints = {};
  const variables = {};
  usable.forEach((item, i) => {
    // Amounts can shrink to zero or grow to double what was asked for.
    const x = { cost: 0, [`want${i}`]: 1, [`cap${i}`]: 1 };
    constraints[`want${i}`] = { equal: item.grams };
    constraints[`cap${i}`] = { max: item.grams * 2 };
    // Deviation from the requested amount, relative to that amount.
    variables[`more${i}`] = { cost: 1 / item.grams, [`want${i}`]: -1 };
    variables[`less${i}`] = { cost: 1 / item.grams, [`want${i}`]: 1 };
    if (item.required) {
      // A must-use ingredient keeps at least a quarter of its amount.
      constraints[`floor${i}`] = { min: item.grams / 4 };
      x[`floor${i}`] = 1;
    }
    for (const [key] of active)
      x[key] = (item.food.per100g[key] ?? 0) / 100 / servings;
    variables[`x${i}`] = x;
  });
  for (const [key, { min, max }] of active) {
    constraints[key] = {};
    if (min != null) constraints[key].min = min;
    if (max != null) constraints[key].max = max;
    const cost = 1000 / Math.max(MISS_SCALE[key] ?? 1, min ?? 0, max ?? 0);
    if (max != null) variables[`over_${key}`] = { cost, [key]: -1 };
    if (min != null) variables[`under_${key}`] = { cost, [key]: 1 };
  }

  const solution = solver.Solve({
    optimize: "cost",
    opType: "min",
    constraints,
    variables,
  });
  if (!solution.feasible) throw new Error("These amounts couldn't be sized.");

  const amounts = usable.map((item, i) => ({
    ...item,
    wanted: item.grams,
    grams: Math.round(solution[`x${i}`] ?? 0),
  }));
  // Rounding to whole grams can push a total just past a limit the exact
  // solution met. Nudge single grams until those limits hold again.
  const total = (key) =>
    amounts.reduce((sum, a) => sum + (a.food.per100g[key] ?? 0) * a.grams, 0) /
    100 /
    servings;
  const shownValue = (v) => Math.round(v * 10) / 10;
  for (let step = 0; step < 200; step++) {
    const broken = active.find(
      ([key, { min, max }]) =>
        ((max != null && shownValue(total(key)) > max) ||
          (min != null && shownValue(total(key)) < min)) &&
        !(solution[`over_${key}`] > 1e-6 || solution[`under_${key}`] > 1e-6),
    );
    if (!broken) break;
    const [key, { max }] = broken;
    const down = max != null && shownValue(total(key)) > max;
    const options = amounts.filter((a) =>
      down
        ? a.grams > (a.required ? Math.ceil(a.wanted / 4) : 0)
        : a.grams < a.wanted * 2,
    );
    const best = options.sort(
      (x, y) => (y.food.per100g[key] ?? 0) - (x.food.per100g[key] ?? 0),
    )[0];
    if (!best || !best.food.per100g[key]) break;
    best.grams += down ? -1 : 1;
  }

  const perServing = {};
  const unknown = {};
  for (const { key } of DISH_NUTRIENTS) {
    perServing[key] = 0;
    for (const amount of amounts) {
      const value = amount.food.per100g[key];
      if (value == null) {
        if (amount.grams > 0) (unknown[key] ??= []).push(amount.food.name);
      } else perServing[key] += (value * amount.grams) / 100 / servings;
    }
  }
  const misses = active.flatMap(([key, { min, max }]) => {
    const value = shownValue(perServing[key]);
    if (max != null && value > max)
      return [{ key, bound: "max", limit: max, value: perServing[key] }];
    if (min != null && value < min)
      return [{ key, bound: "min", limit: min, value: perServing[key] }];
    return [];
  });
  return {
    servings,
    amounts,
    perServing,
    unknown,
    misses,
    fits: misses.length === 0,
    totalGrams: amounts.reduce((sum, a) => sum + a.grams, 0),
  };
}

// Turns the written recipe (plain text with "## Heading", "- item", and
// "1. step" lines) into blocks the page renders without injecting HTML.
export function parseMethod(text = "") {
  const blocks = [];
  for (const line of text.split("\n")) {
    const value = line.trim();
    if (!value) continue;
    const kind = value.startsWith("## ")
      ? "h"
      : /^[-*] /.test(value)
        ? "ul"
        : /^\d+[.)] /.test(value)
          ? "ol"
          : "p";
    const body =
      kind === "h"
        ? value.slice(3)
        : kind === "ul"
          ? value.slice(2)
          : kind === "ol"
            ? value.replace(/^\d+[.)] /, "")
            : value;
    const last = blocks.at(-1);
    if ((kind === "ul" || kind === "ol") && last?.kind === kind)
      last.items.push(body);
    else
      blocks.push(
        kind === "ul" || kind === "ol"
          ? { kind, items: [body] }
          : { kind, text: body },
      );
  }
  return blocks;
}

// Plain-text version of a recipe card, for copying.
export function recipeText(recipe) {
  const per = NUTRIENTS.map(
    (n) =>
      `${Math.round((recipe.perServing?.[n.key] ?? 0) * 10) / 10} ${n.unit} ${n.label.toLocaleLowerCase()}`,
  ).join(", ");
  return [
    recipe.name,
    recipe.description,
    `Serves ${recipe.servings}. Per serving: ${per}.`,
    "",
    recipe.method.trim().replace(/^## /gm, ""),
  ]
    .filter((line, i) => line !== undefined && (line !== "" || i === 3))
    .join("\n");
}

// A saved recipe is either structured (version 2: ingredients + steps) or an
// older text recipe (method).
export const isSavedRecipe = (r) =>
  !!r &&
  typeof r.id === "string" &&
  typeof r.name === "string" &&
  ((r.version === 2 &&
    Array.isArray(r.ingredients) &&
    Array.isArray(r.steps)) ||
    typeof r.method === "string");
