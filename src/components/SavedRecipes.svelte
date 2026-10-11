<script>
  import RecipeCard from './RecipeCard.svelte';
  import { NUTRIENTS, formatAmount } from '../lib/foods.js';
  import { recipeText } from '../lib/recipe.js';
  import { structuredText } from '../lib/scale.js';
  import { prefs, deleteRecipe, updateRecipe } from '../lib/prefs.svelte.js';
  import { printRecipe } from '../lib/print.svelte.js';

  let { selectedId = $bindable(null), onmakeone, foods = [] } = $props();
  let servings = $state(4);
  let rewriting = $state(false);
  let rewriteError = $state('');
  let confirming = $state(false);
  let copied = $state(false);
  let mobileOpen = $state(false);

  const selected = $derived(prefs.recipes.find(r => r.id === selectedId) ?? prefs.recipes[0] ?? null);
  const savedOn = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  // Each recipe opens at the servings it was saved at.
  let shownFor = null;
  $effect.pre(() => {
    if (selected && selected.id !== shownFor) {
      shownFor = selected.id;
      servings = selected.shownServings ?? selected.servings ?? 4;
      rewriteError = '';
    }
  });

  function pick(id) { selectedId = id; confirming = false; mobileOpen = false; }

  // Older recipes are text, so they can't scale. A rewrite turns one into a
  // structured recipe for the chosen servings and replaces it in place.
  const byName = $derived(new Map(foods.map(f => [f.name, f])));
  async function rewrite() {
    const target = selected;
    const factor = servings / target.servings;
    const ingredients = (target.ingredients ?? []).map(i => ({ food: byName.get(i.name), grams: Math.round(i.grams * factor) }));
    if (!ingredients.length || ingredients.some(i => !i.food || !(i.grams > 0))) {
      rewriteError = 'Some of this recipe’s foods couldn’t be found, so it can’t be rewritten. Build it again in the Recipe Builder.';
      return;
    }
    rewriting = true; rewriteError = '';
    try {
      const res = await fetch('/api/recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: target.name, description: target.description ?? '', servings, seasonings: target.seasonings ?? [], dislikes: $state.snapshot(prefs.dislikes), ingredients: ingredients.map(i => ({ id: i.food.id, grams: i.grams })) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.version !== 2) {
        rewriteError = body?.error ?? (res.status === 429 ? 'You’re making requests faster than the site allows. Wait a minute, then try again.' : 'The recipe service had a problem. Try again.');
        return;
      }
      const { usage, ...fresh } = body;
      if (!updateRecipe(target.id, { ...fresh, shownServings: servings })) rewriteError = 'This browser wouldn’t store the rewritten recipe.';
      shownFor = null;
    } catch {
      rewriteError = 'Couldn’t reach the recipe service. Check your connection and try again.';
    } finally { rewriting = false; }
  }
  function remove() {
    const index = prefs.recipes.findIndex(r => r.id === selected.id);
    deleteRecipe(selected.id);
    selectedId = prefs.recipes[Math.min(index, prefs.recipes.length - 1)]?.id ?? null;
    confirming = false;
  }
  async function copy() {
    const text = selected.version === 2 ? structuredText(selected, servings, NUTRIENTS) : recipeText(selected);
    try { await navigator.clipboard.writeText(text); copied = true; setTimeout(() => copied = false, 2000); } catch { copied = false; }
  }
</script>

{#if !prefs.recipes.length}
  <main class="coming-soon" id="results" tabindex="-1">
    <h1>No saved recipes yet.</h1>
    <p>Get ideas in the Recipe Builder, write one up, and save it.<br />It’s kept in this browser, ready to cook or print.</p>
    <button class="outline-button" onclick={onmakeone}>Find a recipe</button>
  </main>
{:else}
  <div class="workspace">
    <aside class:mobile-open={mobileOpen}>
      <button class="mobile-filter-toggle" onclick={() => mobileOpen = !mobileOpen} aria-expanded={mobileOpen} aria-controls="saved-list">Saved recipes ({prefs.recipes.length})<span>{mobileOpen ? '−' : '+'}</span></button>
      <div class="filter-content" id="saved-list">
        <div class="filter-heading"><h1>My recipes</h1></div>
        <p class="filter-intro">Saved in this browser. Clearing site data removes them.</p>
        <ul class="saved-list">
          {#each prefs.recipes as r (r.id)}
            <li><button class:current={selected?.id === r.id} aria-current={selected?.id === r.id ? 'true' : undefined} onclick={() => pick(r.id)}>
              <span class="saved-name">{r.name}</span>
              <span class="saved-facts">Serves {r.servings}, {formatAmount(r.perServing?.calories)} kcal and {formatAmount(r.perServing?.protein)} g protein each</span>
              <span class="saved-date">Saved {savedOn(r.savedAt)}</span>
            </button></li>
          {/each}
        </ul>
      </div>
    </aside>
    <main id="results" tabindex="-1" class="dish">
      {#if selected}
        <RecipeCard recipe={selected} bind:servings writing={rewriting}>
          {#if selected.version !== 2}
            <div class="rewrite-note">
              <p>Saved before servings could change. Rewrite it for the number you want:</p>
              <span class="servings" role="group" aria-label="Servings for the rewrite">
                <button aria-label="Fewer servings" disabled={servings <= 1 || rewriting} onclick={() => servings--}>−</button>
                <span aria-live="polite">Serves {servings}</span>
                <button aria-label="More servings" disabled={servings >= 50 || rewriting} onclick={() => servings++}>+</button>
              </span>
              <button class="outline-button" disabled={rewriting} onclick={rewrite}>{rewriting ? 'Rewriting…' : `Rewrite for ${servings} ${servings === 1 ? 'serving' : 'servings'}`}</button>
            </div>
          {/if}
          {#if rewriteError}<p class="method-error" role="alert">{rewriteError}</p>{/if}
          <button class="primary-button" onclick={() => printRecipe($state.snapshot(selected), selected.version === 2 ? servings : selected.servings)}>Print</button>
          <button class="outline-button" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          {#if confirming}
            <span class="confirm-delete" role="group" aria-label="Confirm delete">
              <span>Delete “{selected.name}”?</span>
              <button class="danger-button" onclick={remove}>Delete</button>
              <button class="text-button" onclick={() => confirming = false}>Keep it</button>
            </span>
          {:else}
            <button class="text-button" onclick={() => confirming = true}>Delete</button>
          {/if}
        </RecipeCard>
      {/if}
    </main>
  </div>
{/if}
