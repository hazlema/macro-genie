import { tick } from "svelte";

// The recipe being printed. App renders it into a print-only area, so the
// printout is just the card, not the page around it.
// The shopping list prints the same way.
export const printJob = $state({ recipe: null, servings: null, list: null });

async function print() {
  await tick();
  window.addEventListener(
    "afterprint",
    () => {
      printJob.recipe = null;
      printJob.list = null;
    },
    { once: true },
  );
  window.print();
}

export function printRecipe(recipe, servings = recipe.servings) {
  printJob.recipe = recipe;
  printJob.servings = servings;
  printJob.list = null;
  return print();
}

export function printList(list) {
  printJob.list = list;
  printJob.recipe = null;
  return print();
}
