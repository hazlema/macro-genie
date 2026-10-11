export const GROUPS = {
  "0100": "Dairy & eggs",
  "0200": "Spices & herbs",
  "0300": "Baby food",
  "0400": "Fats & oils",
  "0500": "Poultry",
  "0600": "Soups & sauces",
  "0700": "Sausages & deli",
  "0800": "Breakfast cereals",
  "0900": "Fruit",
  1000: "Pork",
  1100: "Vegetables",
  1200: "Nuts & seeds",
  1300: "Beef",
  1400: "Beverages",
  1500: "Fish & shellfish",
  1600: "Legumes",
  1700: "Lamb, veal & game",
  1800: "Baked goods",
  1900: "Sweets",
  2000: "Grains & pasta",
  2100: "Fast food",
  2200: "Meals & entrees",
  2500: "Snacks",
  3500: "Native American",
  3600: "Restaurant",
};

export const NUTRIENTS = [
  { key: "protein", label: "Protein", unit: "g" },
  { key: "netCarbs", label: "Net carbs", unit: "g" },
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "fat", label: "Fat", unit: "g" },
  { key: "sugar", label: "Sugar", unit: "g" },
  { key: "sodium", label: "Sodium", unit: "mg" },
];

export const SORTS = {
  none: "None",
  protein: "Most protein",
  netCarbs: "Fewest net carbs",
  calories: "Fewest calories",
  sodium: "Lowest sodium",
  name: "Name: A to Z",
};

export const BASES = {
  serving: "Per serving",
  "100g": "Per 100 g",
};

// Returns the food with `nutrients` expressed for the chosen basis.
export function withBasis({ per100g, ...food }, basis = "serving") {
  return basis === "100g" ? { ...food, nutrients: per100g } : food;
}

export const PRESETS = [
  { name: "Keto strict", ranges: { netCarbs: { max: 5 } } },
  {
    name: "Protein hunt",
    ranges: { protein: { min: 20 }, netCarbs: { max: 6 } },
  },
  {
    name: "Lean cut",
    ranges: { protein: { min: 20 }, fat: { max: 10 }, calories: { max: 300 } },
  },
  { name: "Bulk", ranges: { protein: { min: 20 }, calories: { min: 300 } } },
  { name: "Low sodium", ranges: { sodium: { max: 140 } } },
];

export function emptyRanges() {
  return Object.fromEntries(
    NUTRIENTS.map(({ key }) => [key, { min: undefined, max: undefined }]),
  );
}

const known = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function normalizeDataset(raw) {
  if (!raw || !Array.isArray(raw.foods) || typeof raw.src !== "string") {
    throw new Error("Invalid food dataset: expected a source and food rows.");
  }
  let excluded = 0;
  const foods = raw.foods.flatMap((row, index) => {
    if (!Array.isArray(row) || row.length < 12 || typeof row[0] !== "string") {
      throw new Error(`Invalid food row ${index + 1}.`);
    }
    if (
      !known(row[10]) ||
      row[10] === 0 ||
      typeof row[11] !== "string" ||
      !row[11].trim()
    ) {
      excluded++;
      return [];
    }
    const nutrientsAt = (grams) => {
      const scale = grams / 100;
      const amount = (i) => (known(row[i]) ? row[i] * scale : null);
      return {
        calories: amount(2),
        protein: amount(3),
        fat: amount(4),
        carbs: amount(5),
        fiber: amount(6),
        sugar: amount(7),
        sodium: amount(8),
        saturatedFat: amount(9),
        netCarbs:
          known(row[5]) && known(row[6])
            ? Math.max(0, row[5] - row[6]) * scale
            : null,
      };
    };
    return [
      {
        id: `usda-row-${index + 1}`,
        name: row[0],
        category: row[1],
        categoryName: GROUPS[row[1]] || "Other",
        serving: { label: row[11], grams: row[10] },
        source: raw.src,
        nutrients: nutrientsAt(row[10]),
        per100g: nutrientsAt(100),
      },
    ];
  });
  return { foods, excluded, source: raw.src, total: raw.foods.length };
}

export function validateRanges(ranges = {}) {
  for (const [key, range] of Object.entries(ranges)) {
    if (
      !NUTRIENTS.some((n) => n.key === key) ||
      !range ||
      typeof range !== "object"
    ) {
      throw new Error("Unknown nutrient range.");
    }
    const { min, max } = range;
    if ((min != null && !known(min)) || (max != null && !known(max))) {
      throw new Error("Enter a number of zero or more for each range.");
    }
    if (min != null && max != null && min > max) {
      throw new Error(
        `${NUTRIENTS.find((n) => n.key === key).label} range: minimum must not exceed maximum.`,
      );
    }
  }
}

// Each word must start a word in the name, so "tea" finds tea, not steak.
export function queryMatchers(query) {
  return query
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => new RegExp(`(^|[^\\p{L}\\p{N}])${wordPattern(term)}`, "u"));
}

// A search word as a pattern that also matches its plural spelling:
// "strawberry" finds "strawberries", "leaf" finds "leaves". (Plain plurals
// like "tomato" -> "tomatoes" already match because the word is a prefix.)
function wordPattern(term) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (/[^aeiou]y$/.test(term) && term.length > 3)
    return `${escape(term.slice(0, -1))}(?:y|ies)`;
  if (/[^f]fe?$/.test(term) && term.length > 3)
    return `${escape(term.replace(/fe?$/, ""))}(?:fe?|ves)`;
  return escape(term);
}

// True when every word of any phrase starts a word in the food's name.
export function matchesAny(food, phrases) {
  const name = food.name.toLocaleLowerCase();
  return phrases.some((phrase) => {
    const words = queryMatchers(phrase);
    return words.length > 0 && words.every((term) => term.test(name));
  });
}

export function searchFoods(
  foods,
  {
    query = "",
    category = "all",
    ranges = {},
    sort = "protein",
    basis = "serving",
    exclude = [],
  } = {},
) {
  validateRanges(ranges);
  if (!(basis in BASES)) throw new Error("Unknown nutrient basis.");
  const valueOf = (food, key) =>
    (basis === "100g" ? food.per100g : food.nutrients)[key];
  const terms = queryMatchers(query);
  const blocked = (exclude ?? []).map(queryMatchers).filter((m) => m.length);
  const found = foods.filter((food) => {
    if (category !== "all" && food.category !== category) return false;
    const name = food.name.toLocaleLowerCase();
    if (!terms.every((term) => term.test(name))) return false;
    if (blocked.some((words) => words.every((term) => term.test(name))))
      return false;
    return Object.entries(ranges).every(([key, { min, max }]) => {
      if (min == null && max == null) return true;
      const value = valueOf(food, key);
      return (
        value != null &&
        (min == null || value >= min) &&
        (max == null || value <= max)
      );
    });
  });
  if (sort === "none") return found;
  return found.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    const left = valueOf(a, sort);
    const right = valueOf(b, sort);
    if (left == null) return right == null ? a.name.localeCompare(b.name) : 1;
    if (right == null) return -1;
    return (
      (sort === "protein" ? right - left : left - right) ||
      a.name.localeCompare(b.name)
    );
  });
}

// "pecans" -> "pecan", "berries" -> "berry", "tomatoes" -> "tomato".
export function singular(word) {
  if (word.length < 4 || !word.endsWith("s") || word.endsWith("ss"))
    return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("oes")) return word.slice(0, -2);
  return word.slice(0, -1);
}

// Restaurant meals, brands, and processed versions rank below the plain food.
const PREPARED =
  /^(fast foods|restaurant|babyfood|baby food|cereals|soup|sauce|snacks|candies|cookies|crackers|bread|pizza|fruit-flavored|beverages, .*(drink|mix))/i;
const PROCESSED =
  /\b(breaded|battered|fried|mix|sweetened|condensed|frozen mixture|with added|imitation|cured|sausage|spread|loaf|stew|entree|sticks|jerky|luncheon|bologna|salami|pastrami|frankfurter|pre-cooked|nuggets?|patty|patties|sauce|soup|dip)\b/i;
const BRAND = /\b[A-Z][A-Z'.&-]{2,}\b/;

// How plain and on-topic a food is for a search word: lower is better. USDA
// names read "Category, item, details", so the word appearing in the first
// or second part is a good sign.
function plainness(food, word) {
  const parts = food.name.toLocaleLowerCase().split(",");
  const words = (part) => part.trim().split(/[^\p{L}\p{N}]+/u);
  const index = parts.findIndex((part) =>
    words(part).some((w) => w.startsWith(word) || singular(w).startsWith(word)),
  );
  // "egg" should prefer "Egg, whole" over "Eggplant".
  const whole = parts.some((part) =>
    words(part).some((w) => w === word || singular(w) === word),
  );
  return (
    (index < 0 ? 40 : index * 10) +
    (whole ? 0 : 15) +
    (PREPARED.test(food.name) ? 30 : 0) +
    (BRAND.test(food.name) ? 30 : 0) +
    (PROCESSED.test(food.name) ? 8 : 0) +
    food.name.length / 25
  );
}

// Best matches for a typed food name, plain foods first. Plurals also match
// the singular, so "eggs" finds "Egg, whole, raw, fresh".
export function findFoods(foods, query, { exclude = [], limit = 8 } = {}) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const found = new Map();
  for (const q of new Set([words.join(" "), words.map(singular).join(" ")]))
    for (const food of searchFoods(foods, { query: q, sort: "none", exclude }))
      found.set(food.id, food);
  const first = singular(words[0]);
  return [...found.values()]
    .map((food) => ({ food, score: plainness(food, first) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ food }) => food);
}

// Foods to offer in place of one in a recipe. With no search, it's the same
// kind of food (names starting "Beef," for ground beef), the closest variety
// first ("Beef, ground, …"), raw kept with raw and cooked with cooked.
// A search looks across all foods.
export function swapOptions(
  foods,
  current,
  query = "",
  { exclude = [], limit = 40 } = {},
) {
  if (query.trim().length >= 2)
    return findFoods(foods, query, { exclude, limit: limit + 1 })
      .filter((f) => f.id !== current.id)
      .slice(0, limit);
  const parts = (food) =>
    food.name
      .toLocaleLowerCase()
      .split(",")
      .map((p) => p.trim());
  const [kind, variety] = parts(current);
  const raw = /\braw\b/i.test(current.name);
  const candidates = foods
    .filter((f) => f.id !== current.id && !matchesAny(f, exclude))
    .map((f) => ({ f, p: parts(f) }));
  let same = candidates.filter(({ p }) => p[0] === kind && p.length > 1);
  // A narrow kind like "Broccoli raab" widens to its first word, "broccoli".
  if (same.length < 8) {
    const word = kind.split(" ")[0];
    same = candidates.filter(({ p }) => p[0].split(" ")[0] === word);
  }
  return same
    .map(({ f, p }) => ({
      f,
      score:
        (variety && p[1] === variety ? 0 : 20) +
        (/\braw\b/i.test(f.name) === raw ? 0 : 6) +
        (PROCESSED.test(f.name) ? 8 : 0) +
        (BRAND.test(f.name) ? 30 : 0) +
        f.name.length / 25,
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ f }) => f);
}

export function formatAmount(value) {
  if (value == null) return "—";
  if (value > 0 && value < 0.1) return "<0.1";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
    value,
  );
}
