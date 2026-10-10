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

export function searchFoods(
  foods,
  {
    query = "",
    category = "all",
    ranges = {},
    sort = "protein",
    basis = "serving",
  } = {},
) {
  validateRanges(ranges);
  if (!(basis in BASES)) throw new Error("Unknown nutrient basis.");
  const valueOf = (food, key) =>
    (basis === "100g" ? food.per100g : food.nutrients)[key];
  // Each word must start a word in the name, so "tea" finds tea, not steak.
  const terms = query
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (term) =>
        new RegExp(
          `(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
          "u",
        ),
    );
  const found = foods.filter((food) => {
    if (category !== "all" && food.category !== category) return false;
    if (!terms.every((term) => term.test(food.name.toLocaleLowerCase())))
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

export function formatAmount(value) {
  if (value == null) return "—";
  if (value > 0 && value < 0.1) return "<0.1";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
    value,
  );
}
