// Structured recipes: amounts are data, so a recipe can be shown for any
// number of servings. Per-serving nutrition doesn't change with servings;
// only the amounts in the ingredient list and the steps do.
//
// A recipe (version 2):
//   { version: 2, name, description, servings, perServing, gramsPerServing,
//     ingredients: [{ id, name, label, grams, qty, unit, prep }],
//     seasonings: [string], steps: [string], tip }
// Steps refer to amounts only through placeholders: {3} = all of ingredient 3,
// {3:1/2} or {3:0.5} = half of it (1-based).

const FRACTIONS = [
  [0, ""],
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [1 / 2, "½"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [1, ""],
];

// 0.67 -> "⅔", 1.5 -> "1 ½", 2.97 -> "3". Kitchen measures read best as fractions.
export function formatQty(qty) {
  if (!(qty > 0)) return "0";
  if (qty >= 10) return String(Math.round(qty));
  let whole = Math.floor(qty);
  const rest = qty - whole;
  const [value, glyph] = FRACTIONS.reduce((best, f) =>
    Math.abs(f[0] - rest) < Math.abs(best[0] - rest) ? f : best,
  );
  if (value === 1) whole += 1;
  if (!whole) return glyph || "⅛";
  return glyph && value !== 1 ? `${whole} ${glyph}` : String(whole);
}

// Volume and weight units move up or down a size when scaled, so 8 tbsp reads
// as ½ cup and 24 oz as 1 ½ lb. Values are in the smallest unit of each ladder.
const LADDERS = [
  { tsp: 1, teaspoon: 1, tbsp: 3, tablespoon: 3, cup: 48 },
  { oz: 1, ounce: 1, lb: 16, pound: 16 },
];
const CANONICAL = {
  teaspoon: "tsp",
  tablespoon: "tbsp",
  ounce: "oz",
  pound: "lb",
};

function singularUnit(unit) {
  const u = unit.trim().toLocaleLowerCase();
  if (u === "cups") return "cup";
  if (u === "lbs") return "lb";
  return u.replace(/(teaspoon|tablespoon|ounce|pound)s$/, "$1");
}

function pluralize(unit, qty) {
  if (qty <= 1 || !unit || /^(tsp|tbsp|oz|lb|g|ml|cup)$/.test(unit)) {
    return unit === "cup" && qty > 1 ? "cups" : unit;
  }
  // Pluralize the last word: "medium onion" -> "medium onions".
  // A word that's already plural ("slices") stays as it is.
  return unit.replace(/(\w+)$/, (word) =>
    /[^s]s$/.test(word)
      ? word
      : /(s|x|ch|sh)$/.test(word)
        ? `${word}es`
        : /[^aeiou]y$/.test(word)
          ? `${word.slice(0, -1)}ies`
          : `${word}s`,
  );
}

// A kitchen measure scaled by a factor: (2, "tbsp", 4) -> "½ cup".
export function scaleMeasure(qty, unit, factor = 1) {
  const parts = measureParts(qty, unit, factor);
  return parts && `${parts.qty} ${parts.unit}`;
}

// The same, as { qty: "½", unit: "cup" }.
function measureParts(qty, unit, factor) {
  if (!(qty > 0) || !unit) return null;
  let amount = qty * factor;
  let name = singularUnit(unit);
  const ladder = LADDERS.find((l) => name in l);
  if (ladder) {
    const base = amount * ladder[name];
    const steps = Object.entries(ladder)
      .filter(([u]) => !(u in CANONICAL))
      .sort((a, b) => b[1] - a[1]);
    // The largest unit that still reads as at least ¼ (a whole tsp at the bottom).
    const [bestUnit, size] =
      steps.find(([, size]) => base / size >= (size === 48 ? 0.25 : 1)) ??
      steps.at(-1);
    amount = base / size;
    name = bestUnit;
  } else if (name !== "g" && name !== "ml") {
    // Counted things (eggs, cloves, fillets) round to halves, or wholes past 3.
    amount =
      amount >= 3 ? Math.round(amount) : Math.round(amount * 2) / 2 || 0.5;
  }
  if (name === "g" || name === "ml")
    return { qty: String(Math.round(amount)), unit: name };
  return { qty: formatQty(amount), unit: pluralize(name, amount) };
}

// The same singular word for a counted unit: "onions" and "onion" match.
const countedKey = (unit) =>
  singularUnit(unit)
    .replace(/ies$/, "y")
    .replace(/(ch|sh|x)es$/, "$1")
    .replace(/s$/, "");

// A measure expressed in another unit, or null when they can't be compared:
// (2, "tsp", "tbsp") -> ⅔, (2, "onions", "onion") -> 2, (1, "cup", "g") -> null.
export function measureIn(qty, unit, to) {
  if (!unit || !to) return null;
  const from = singularUnit(unit);
  const target = singularUnit(to);
  if (from === target || countedKey(unit) === countedKey(to)) return qty;
  const ladder = LADDERS.find((l) => from in l && target in l);
  return ladder ? (qty * ladder[from]) / ladder[target] : null;
}

const ingredientAmount = (ingredient, factor, part = 1) =>
  scaleMeasure(ingredient.qty, ingredient.unit, factor * part) ??
  `${Math.round(ingredient.grams * factor * part)} g`;

const isCounted = (unit) => {
  const u = singularUnit(unit ?? "");
  return !!u && !/^(g|ml)$/.test(u) && !LADDERS.some((l) => u in l);
};
const nounOf = (text) =>
  (
    text
      .trim()
      .toLocaleLowerCase()
      .match(/[a-z]+$/)?.[0] ?? ""
  ).replace(/(ies|es|s)$/, "");

// "3 egg" + "large eggs" reads "3 large eggs", not "3 eggs large eggs": when
// the label already names the counted thing, the count goes in front of it.
export function ingredientLine(ing, label, factor) {
  if (
    ing.qty > 0 &&
    isCounted(ing.unit) &&
    nounOf(label) &&
    nounOf(label) === nounOf(ing.unit)
  ) {
    const { qty } = measureParts(ing.qty, ing.unit, factor);
    const single = /^(1|½|¼|⅓|⅛)$/.test(qty);
    const words = label.trim().split(/\s+/);
    const noun = words.pop();
    const fixed = single
      ? noun
          .replace(/ies$/, "y")
          .replace(/(ch|sh|x)es$/, "$1")
          .replace(/s$/, "")
      : /s$/.test(noun)
        ? noun
        : pluralize(noun, 2);
    return `${qty} ${[...words, fixed].join(" ")}`;
  }
  return `${ingredientAmount(ing, factor)} ${label}`;
}

function parsePart(text) {
  if (!text) return 1;
  const [a, b] = text.split("/").map(Number);
  const part = b ? a / b : a;
  return part > 0 && part <= 1 ? part : 1;
}

// Text for a recipe at a number of servings, with every amount filled in.
export function renderRecipe(recipe, servings = recipe.servings) {
  const factor = servings / recipe.servings;
  const ingredients = (recipe.ingredients ?? []).map((ing) => ({
    text: ingredientLine(ing, ing.label || ing.name, factor),
    grams: Math.round(ing.grams * factor),
    // With no kitchen measure the text already says the grams.
    measured: ing.qty > 0 && !!ing.unit,
    prep: ing.prep || "",
  }));
  const steps = (recipe.steps ?? []).map((step) =>
    step
      .replace(
        /\{(\d+)(?::([\d./]+))?\}(\s+([A-Za-z]+))?/g,
        (_, n, part, gap = "", next = "") => {
          const ing = recipe.ingredients?.[Number(n) - 1];
          if (!ing) return gap;
          const amount = ingredientAmount(ing, factor, parsePart(part));
          // "{3} eggs" for a counted unit would read "3 eggs eggs": the amount
          // already names the thing, so the repeated word is dropped.
          return next && nounOf(next) === nounOf(amount)
            ? amount
            : amount + gap;
        },
      )
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
  return {
    factor,
    servings,
    gramsPerServing: recipe.gramsPerServing,
    ingredients,
    steps,
    tip: recipe.tip || "",
  };
}

// The ingredient list as shown on the card, one per line, for pasting into
// Cronometer's "Paste Ingredients" recipe import (or anywhere else).
// Seasonings with an amount ("1 tbsp cider vinegar") get a line each, scaled
// with the servings; older recipes' bare ones ("salt, nutmeg") share one
// "to taste" line.
const hasAmount = (s) => /^(\d|[½⅓¼¾⅔⅛]|a |an |one |pinch|dash|splash|handful)/i.test(s.trim());
const GLYPHS = { "½": 0.5, "⅓": 1 / 3, "¼": 0.25, "¾": 0.75, "⅔": 2 / 3, "⅛": 0.125 };
const LEADING_QTY = /^(\d+(?:\.\d+)?(?:\s+(?:\d+\/\d+|[½⅓¼¾⅔⅛]))?|\d+\/\d+|[½⅓¼¾⅔⅛])\s+([^\s,]+)(.*)$/;
const readQty = (text) =>
  text
    .split(/\s+/)
    .reduce((sum, part) => {
      if (part in GLYPHS) return sum + GLYPHS[part];
      const [n, d] = part.split("/");
      return sum + (d ? Number(n) / Number(d) : Number(n));
    }, 0);

// "1 tbsp cider vinegar" at half the servings -> "1 ½ tsp cider vinegar".
export function scaleSeasoning(text, factor = 1) {
  const m = factor !== 1 && text.trim().match(LEADING_QTY);
  if (!m) return text;
  const qty = readQty(m[1]);
  if (!(qty > 0)) return text;
  // "cloves" is the unit of "2 cloves garlic"; count it as one clove.
  const unit = /[^s]s$/.test(m[2]) && !/(tsp|tbsp|oz|lbs)$/.test(m[2]) ? m[2].slice(0, -1) : m[2];
  const parts = measureParts(qty, unit, factor);
  return parts ? `${parts.qty} ${parts.unit}${m[3]}` : text;
}

export function seasoningLines(seasonings = [], factor = 1) {
  const bare = seasonings.filter((s) => !hasAmount(s));
  return [
    ...seasonings.filter(hasAmount).map((s) => scaleSeasoning(s, factor)),
    ...(bare.length ? [`${bare.join(", ")}, to taste`] : []),
  ];
}

export function ingredientLines(recipe, servings = recipe.servings) {
  const r = renderRecipe(recipe, servings);
  return [
    ...r.ingredients.map(
      (i) =>
        `${i.text}${i.measured ? ` (${i.grams} g)` : ""}${i.prep ? `, ${i.prep}` : ""}`,
    ),
    ...seasoningLines(recipe.seasonings, servings / recipe.servings),
  ].join("\n");
}

// Plain-text version at a number of servings, for copying.
export function structuredText(recipe, servings, nutrients = []) {
  const r = renderRecipe(recipe, servings);
  const per = nutrients
    .map(
      (n) =>
        `${Math.round((recipe.perServing?.[n.key] ?? 0) * 10) / 10} ${n.unit} ${n.label.toLocaleLowerCase()}`,
    )
    .join(", ");
  return [
    recipe.name,
    recipe.description,
    `Serves ${servings}.${per ? ` Per serving: ${per}.` : ""}`,
    "",
    "Ingredients",
    ...ingredientLines(recipe, servings)
      .split("\n")
      .map((line) => `- ${line}`),
    "",
    "Method",
    ...r.steps.map((s, i) => `${i + 1}. ${s}`),
    ...(r.tip ? ["", "Tip", r.tip] : []),
  ]
    .filter((line, i) => line !== undefined && (line !== "" || i > 2))
    .join("\n");
}
