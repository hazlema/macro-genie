import { ingredientLine, measureIn } from "./scale.js";

// A shopping list merges the ingredients of several saved recipes, each at
// its own servings. The same food (by dataset name) becomes one line, and its
// kitchen measures add up when they can be compared; otherwise the line
// shows grams. Lines are plain text after that, so the cook can edit them.
//
// A list: { builtAt, recipes: [{ id, name, servings }],
//           items: [{ id, text, from: [recipe name], checked }] }

// Older text recipes have no ingredient amounts to add up.
export const canShop = (recipe) =>
  recipe?.version === 2 && Array.isArray(recipe.ingredients);

export const newItem = (text, from = []) => ({
  id: crypto.randomUUID(),
  text,
  from,
  checked: false,
});

export function buildShoppingList(picks) {
  const foods = new Map();
  const seasonings = new Map();
  for (const { recipe, servings } of picks) {
    const factor = servings / recipe.servings;
    for (const ing of recipe.ingredients) {
      const key = ing.name || ing.label;
      const grams = ing.grams * factor;
      const qty = ing.qty > 0 && ing.unit ? ing.qty * factor : 0;
      const food = foods.get(key);
      if (!food) {
        foods.set(key, {
          label: ing.label || ing.name,
          unit: qty ? ing.unit : "",
          qty,
          grams,
          from: [recipe.name],
        });
        continue;
      }
      food.grams += grams;
      if (!food.from.includes(recipe.name)) food.from.push(recipe.name);
      const more =
        qty && food.unit ? measureIn(qty, ing.unit, food.unit) : null;
      // One amount that can't be measured the same way: grams for the lot.
      if (more == null) food.unit = "";
      else food.qty += more;
    }
    for (const s of recipe.seasonings ?? []) {
      const word = s.trim().toLocaleLowerCase();
      if (word && !seasonings.has(word)) seasonings.set(word, recipe.name);
    }
  }

  const items = [...foods.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((f) => {
      const grams = Math.round(f.grams);
      const measured = f.unit && f.qty > 0;
      const ing = measured
        ? { qty: f.qty, unit: f.unit, grams }
        : { qty: 0, unit: "", grams };
      return newItem(
        `${ingredientLine(ing, f.label, 1)}${measured ? ` (${grams} g)` : ""}`,
        f.from,
      );
    });
  if (seasonings.size)
    items.push(
      newItem(`To taste: ${[...seasonings.keys()].join(", ")}`, [
        ...new Set(seasonings.values()),
      ]),
    );

  return {
    builtAt: new Date().toISOString(),
    recipes: picks.map(({ recipe, servings }) => ({
      id: recipe.id,
      name: recipe.name,
      servings,
    })),
    items,
  };
}

// Plain text for copying: unticked lines first.
export function shoppingText(list) {
  const lines = (checked) =>
    list.items.filter((i) => i.checked === checked).map((i) => `- ${i.text}`);
  const got = lines(true);
  return [
    "Shopping list",
    `For: ${list.recipes.map((r) => r.name).join(", ")}`,
    "",
    ...lines(false),
    ...(got.length ? ["", "Already got", ...got] : []),
  ].join("\n");
}
