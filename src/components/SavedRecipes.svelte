<script>
  import RecipeCard from './RecipeCard.svelte';
  import { formatAmount } from '../lib/foods.js';
  import { recipeText } from '../lib/recipe.js';
  import { prefs, deleteRecipe } from '../lib/prefs.svelte.js';
  import { printRecipe } from '../lib/print.svelte.js';

  let { selectedId = $bindable(null), onmakeone } = $props();
  let confirming = $state(false);
  let copied = $state(false);
  let mobileOpen = $state(false);

  const selected = $derived(prefs.recipes.find(r => r.id === selectedId) ?? prefs.recipes[0] ?? null);
  const savedOn = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  function pick(id) { selectedId = id; confirming = false; mobileOpen = false; }
  function remove() {
    const index = prefs.recipes.findIndex(r => r.id === selected.id);
    deleteRecipe(selected.id);
    selectedId = prefs.recipes[Math.min(index, prefs.recipes.length - 1)]?.id ?? null;
    confirming = false;
  }
  async function copy() {
    try { await navigator.clipboard.writeText(recipeText(selected)); copied = true; setTimeout(() => copied = false, 2000); } catch { copied = false; }
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
        <RecipeCard recipe={selected}>
          <button class="primary-button" onclick={() => printRecipe($state.snapshot(selected))}>Print</button>
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
