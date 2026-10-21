<script>
  import { NUTRIENTS, formatAmount } from '../lib/foods.js';
  import { parseMethod } from '../lib/recipe.js';
  import { ingredientLines, renderRecipe, seasoningLines } from '../lib/scale.js';

  // recipe: a structured recipe (version 2: ingredients + steps, scalable) or an
  // older text recipe ({ name, description, servings, perServing, method }).
  // servings: how many servings to show it for; only structured recipes scale.
  let { recipe, servings = $bindable(recipe.servings), writing = false, stale = false, scalable = true, children } = $props();

  const structured = $derived(recipe.version === 2);
  const shown = $derived(structured ? renderRecipe(recipe, servings) : null);
  const blocks = $derived(structured ? [] : parseMethod(recipe.method));
  const gramsEach = $derived(recipe.gramsPerServing);
  let copiedIngredients = $state(false);
  async function copyIngredients() {
    try {
      await navigator.clipboard.writeText(ingredientLines(recipe, servings));
      copiedIngredients = true;
      setTimeout(() => (copiedIngredients = false), 2000);
    } catch {
      copiedIngredients = false;
    }
  }
</script>

<article class="recipe-card" aria-busy={writing}>
  <header class="card-head">
    <h2>{recipe.name}</h2>
    {#if recipe.description}<p class="card-description">{recipe.description}</p>{/if}
    <div class="card-meta">
      {#if structured && scalable && !writing}
        <span class="servings card-servings" role="group" aria-label="Servings">
          <button aria-label="Fewer servings" disabled={servings <= 1} onclick={() => servings--}>−</button>
          <span aria-live="polite">Serves {servings}</span>
          <button aria-label="More servings" disabled={servings >= 50} onclick={() => servings++}>+</button>
        </span>
      {:else}
        <span>Serves {structured ? servings : recipe.servings}</span>
      {/if}
      {#if gramsEach}<span>about {Math.round(gramsEach).toLocaleString()} g each</span>{/if}
      {#if structured && servings !== recipe.servings}<span class="scaled-note">Scaled from {recipe.servings}; times and pan size may need a small change.</span>{/if}
    </div>
  </header>

  <dl class="card-nutrition" aria-label="Nutrition per serving">
    {#each NUTRIENTS as n}
      <div><dt>{n.label}</dt><dd><strong>{formatAmount(recipe.perServing?.[n.key])}</strong> {n.unit}</dd></div>
    {/each}
  </dl>

  <div class="card-body" class:stale aria-live={writing ? 'polite' : undefined}>
    {#if structured}
      <div class="card-subhead">
        <h3>Ingredients</h3>
        {#if !writing}<button class="text-button copy-ingredients" onclick={copyIngredients}>{copiedIngredients ? 'Copied' : 'Copy ingredients'}</button>{/if}
      </div>
      <ul>
        {#each shown.ingredients as ing}
          <li>{ing.text}{#if ing.measured}{' '}<span class="card-grams">({ing.grams.toLocaleString()} g)</span>{/if}{#if ing.prep}, {ing.prep}{/if}</li>
        {/each}
        {#each seasoningLines(recipe.seasonings, servings / recipe.servings) as line}<li>{line}</li>{/each}
      </ul>
      {#if shown.steps.length}
        <h3>Method</h3>
        <ol>{#each shown.steps as step}<li>{step}</li>{/each}</ol>
      {/if}
      {#if shown.tip}<h3>Tip</h3><p>{shown.tip}</p>{/if}
    {:else}
      {#each blocks as block}
        {#if block.kind === 'h'}<h3>{block.text}</h3>
        {:else if block.kind === 'ul'}<ul>{#each block.items as item}<li>{item}</li>{/each}</ul>
        {:else if block.kind === 'ol'}<ol>{#each block.items as item}<li>{item}</li>{/each}</ol>
        {:else}<p>{block.text}</p>{/if}
      {/each}
    {/if}
    {#if writing}<p class="writing">Writing the steps… this takes about 15 seconds.</p>{/if}
  </div>

  <footer class="card-foot">Nutrition per serving from USDA SR28, worked out by Macro Genie.</footer>
  {#if children}<div class="card-actions">{@render children()}</div>{/if}
</article>
