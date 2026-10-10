import { tick } from "svelte";

// The recipe being printed. App renders it into a print-only area, so the
// printout is just the card, not the page around it.
export const printJob = $state({ recipe: null });

export async function printRecipe(recipe) {
  printJob.recipe = recipe;
  await tick();
  window.addEventListener("afterprint", () => (printJob.recipe = null), {
    once: true,
  });
  window.print();
}
