import { tick } from "svelte";

// The recipe being printed. App renders it into a print-only area, so the
// printout is just the card, not the page around it.
export const printJob = $state({ recipe: null, servings: null });

export async function printRecipe(recipe, servings = recipe.servings) {
  printJob.recipe = recipe;
  printJob.servings = servings;
  await tick();
  window.addEventListener("afterprint", () => (printJob.recipe = null), {
    once: true,
  });
  window.print();
}
