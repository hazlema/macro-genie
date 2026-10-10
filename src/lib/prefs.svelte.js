import { untrack } from "svelte";

// Browser-only settings: dislikes and the recipe in progress. Nothing leaves the device.
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
    };
  } catch {
    return { dislikes: [], hideOnFoods: false, draft: null };
  }
}

export const prefs = $state(load());

export function save() {
  try {
    localStorage.setItem(
      KEY,
      untrack(() => JSON.stringify(prefs)),
    );
  } catch {
    // Private browsing or full storage: settings last for this visit only.
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
