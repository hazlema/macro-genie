<script>
  import { NUTRIENTS, formatAmount } from '../lib/foods.js';
  import { parseMethod } from '../lib/recipe.js';

  // recipe: { name, description, servings, perServing, gramsPerServing, method, savedAt? }
  let { recipe, writing = false, stale = false, children } = $props();
  const blocks = $derived(parseMethod(recipe.method));
</script>

<article class="recipe-card" aria-busy={writing}>
  <header class="card-head">
    <h2>{recipe.name}</h2>
    {#if recipe.description}<p class="card-description">{recipe.description}</p>{/if}
    <p class="card-meta">Serves {recipe.servings}{#if recipe.gramsPerServing}, about {Math.round(recipe.gramsPerServing).toLocaleString()} g each{/if}</p>
  </header>

  <dl class="card-nutrition" aria-label="Nutrition per serving">
    {#each NUTRIENTS as n}
      <div><dt>{n.label}</dt><dd><strong>{formatAmount(recipe.perServing?.[n.key])}</strong> {n.unit}</dd></div>
    {/each}
  </dl>

  <div class="card-body" class:stale aria-live={writing ? 'polite' : undefined}>
    {#each blocks as block}
      {#if block.kind === 'h'}<h3>{block.text}</h3>
      {:else if block.kind === 'ul'}<ul>{#each block.items as item}<li>{item}</li>{/each}</ul>
      {:else if block.kind === 'ol'}<ol>{#each block.items as item}<li>{item}</li>{/each}</ol>
      {:else}<p>{block.text}</p>{/if}
    {/each}
    {#if writing}<p class="writing">Writing…</p>{/if}
  </div>

  <footer class="card-foot">Nutrition per serving from USDA SR28, worked out by Macro Genie.</footer>
  {#if children}<div class="card-actions">{@render children()}</div>{/if}
</article>
