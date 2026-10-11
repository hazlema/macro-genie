import { untrack } from "svelte";
import { isSavedRecipe } from "./recipe.js";

// Browser-only settings: dislikes, the recipe in progress, and saved recipes.
// Nothing leaves the device.
const KEY = "macro-genie:prefs:v1";

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      dislikes: Array.isArray(saved.dislikes)
        ? saved.dislikes.filter((w) => typeof w === "string")
        : [],
      hideOnFoods: saved.hideOnFoods === true,
      draft:
        saved.draft && typeof saved.draft === "object" ? saved.draft : null,
      recipes: Array.isArray(saved.recipes)
        ? saved.recipes.filter(isSavedRecipe)
        : [],
    };
  } catch {
    return { dislikes: [], hideOnFoods: false, draft: null, recipes: [] };
  }
}

export const prefs = $state(load());

// Returns false when the browser won't store it (private browsing, full storage).
export function save() {
  try {
    localStorage.setItem(
      KEY,
      untrack(() => JSON.stringify(prefs)),
    );
    return true;
  } catch {
    return false;
  }
}

export function addDislike(word) {
  const clean = word.toLocaleLowerCase().trim().replace(/\s+/g, " ");
  if (!clean || prefs.dislikes.includes(clean)) return false;
  prefs.dislikes = [...prefs.dislikes, clean];
  save();
  return true;
}

export function removeDislike(word) {
  prefs.dislikes = prefs.dislikes.filter((w) => w !== word);
  save();
}

// Saved recipes are snapshots: they keep their numbers even if the food data
// changes. Returns the new id, or null if the browser couldn't store it.
export function saveRecipe(recipe) {
  const saved = {
    ...recipe,
    id: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
  };
  prefs.recipes = [saved, ...prefs.recipes];
  if (save()) return saved.id;
  prefs.recipes = prefs.recipes.filter((r) => r.id !== saved.id);
  return null;
}

export function deleteRecipe(id) {
  prefs.recipes = prefs.recipes.filter((r) => r.id !== id);
  save();
}

// Replaces a saved recipe's content (e.g. a rewrite), keeping its id and date.
export function updateRecipe(id, recipe) {
  prefs.recipes = prefs.recipes.map((r) =>
    r.id === id ? { ...recipe, id: r.id, savedAt: r.savedAt } : r,
  );
  return save();
}
