<script>
  import FooterLinks from './FooterLinks.svelte';
  import RecipeCard from './RecipeCard.svelte';
  import PostDialog from './PostDialog.svelte';
  import ShoppingList from './ShoppingList.svelte';
  import { NUTRIENTS, formatAmount } from '../lib/foods.js';
  import { recipeText } from '../lib/recipe.js';
  import { buildShoppingList, canShop } from '../lib/shopping.js';
  import { structuredText } from '../lib/scale.js';
  import { prefs, deleteRecipe, updateRecipe, setShopping } from '../lib/prefs.svelte.js';
  import { printRecipe } from '../lib/print.svelte.js';
  import { account, noteResponse } from '../lib/account.svelte.js';

  // selectedId comes from the address (/recipes/<id>, or /recipes/shopping for
  // the shopping list); onselect changes it.
  let { selectedId = null, onselect, onmakeone, foods = [] } = $props();
  let servings = $state(4);
  let rewriting = $state(false);
  let rewriteError = $state('');
  let confirming = $state(false);
  let copied = $state(false);
  let mobileOpen = $state(false);
  let posting = $state(null);

  // Picking recipes for a shopping list: id -> servings to shop for.
  let picking = $state(false);
  let picks = $state({});
  let replacing = $state(false);
  let shopError = $state('');

  const onList = $derived(selectedId === 'shopping' && !!prefs.shopping);
  const selected = $derived(onList ? null : prefs.recipes.find(r => r.id === selectedId) ?? prefs.recipes[0] ?? null);
  const pickCount = $derived(Object.keys(picks).length);
  const toGet = $derived(prefs.shopping?.items.filter(i => !i.checked).length ?? 0);
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

  function pick(id) { onselect?.(id); confirming = false; mobileOpen = false; }

  function startPicking() { picking = true; picks = {}; replacing = false; shopError = ''; }
  function togglePick(r) {
    if (r.id in picks) delete picks[r.id];
    else picks[r.id] = r.shownServings ?? r.servings;
  }
  // A list that's been ticked or edited is only replaced after asking.
  function build(sure = false) {
    if (prefs.shopping?.touched && !sure) { replacing = true; return; }
    const chosen = prefs.recipes.filter(r => r.id in picks).map(r => ({ recipe: $state.snapshot(r), servings: picks[r.id] }));
    if (!setShopping(buildShoppingList(chosen))) { shopError = 'This browser wouldn’t store the list.'; replacing = false; return; }
    picking = false; picks = {}; replacing = false;
    pick('shopping');
  }

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
    if (!account.signedIn) { account.loginOpen = true; return; }
    rewriting = true; rewriteError = '';
    try {
      const res = await fetch('/api/recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: target.name, description: target.description ?? '', servings, seasonings: target.seasonings ?? [], dislikes: $state.snapshot(prefs.dislikes), ingredients: ingredients.map(i => ({ id: i.food.id, grams: i.grams })) }),
      });
      const body = await res.json().catch(() => null);
      noteResponse(res, body);
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
    onselect?.(prefs.recipes[Math.min(index, prefs.recipes.length - 1)]?.id ?? null, true);
    confirming = false;
  }
  async function copy() {
    const text = selected.version === 2 ? structuredText(selected, servings, NUTRIENTS) : recipeText(selected);
    try { await navigator.clipboard.writeText(text); copied = true; setTimeout(() => copied = false, 2000); } catch { copied = false; }
  }
</script>

{#if !prefs.recipes.length && !prefs.shopping}
  <main class="coming-soon" id="results" tabindex="-1">
    <h1>No saved recipes yet.</h1>
    <p>Get ideas in the Recipe Builder, write one up, and save it.<br />It’s kept in this browser, ready to cook or print.</p>
    <button class="outline-button" onclick={onmakeone}>Find a recipe</button>
    <footer><p>Food by your numbers. <span>Saved recipes stay in this browser.</span></p><FooterLinks /></footer>
  </main>
{:else}
  <div class="workspace">
    <aside class:mobile-open={mobileOpen}>
      <button class="mobile-filter-toggle" onclick={() => mobileOpen = !mobileOpen} aria-expanded={mobileOpen} aria-controls="saved-list">{picking ? `Picking recipes (${pickCount} picked)` : `Saved recipes (${prefs.recipes.length}) & shopping list`}<span>{mobileOpen ? '−' : '+'}</span></button>
      <div class="filter-content" id="saved-list">
        <div class="filter-heading"><h1>Recipe Book</h1></div>
        <p class="filter-intro">Saved in this browser. Clearing site data removes them.</p>
        {#if picking}
          <p class="pick-intro">Pick the recipes to shop for. Ingredients they share are added up into one line.</p>
        {:else}
          <div class="shop-entry">
            {#if prefs.shopping}
              <ul class="saved-list"><li><button class:current={onList} aria-current={onList ? 'true' : undefined} onclick={() => pick('shopping')}>
                <span class="saved-name">Shopping list</span>
                <span class="saved-facts">{toGet ? `${toGet} to get` : 'All ticked off'} for {prefs.shopping.recipes.length} {prefs.shopping.recipes.length === 1 ? 'recipe' : 'recipes'}</span>
              </button></li></ul>
            {/if}
            {#if prefs.recipes.length}<button class="outline-button" onclick={startPicking}>{prefs.shopping ? 'New shopping list' : 'Make a shopping list'}</button>{/if}
          </div>
        {/if}
        <ul class="saved-list">
          {#each prefs.recipes as r (r.id)}
            {#if picking}
              {@const picked = r.id in picks}
              <li class="pick-row">
                <button class="pick-card" class:picked aria-pressed={picked} disabled={!canShop(r)} onclick={() => togglePick(r)}>
                  <span class="pick-box" aria-hidden="true">{picked ? '✓' : ''}</span>
                  <span class="pick-text">
                    <span class="saved-name">{r.name}</span>
                    <span class="saved-facts">{canShop(r) ? `Serves ${r.shownServings ?? r.servings}` : 'Saved as text. Rewrite it to add it to a list.'}</span>
                  </span>
                </button>
                {#if picked}
                  <span class="servings pick-servings" role="group" aria-label="Servings of {r.name}">
                    <button aria-label="Fewer servings" disabled={picks[r.id] <= 1} onclick={() => picks[r.id]--}>−</button>
                    <span aria-live="polite">Shop for {picks[r.id]}</span>
                    <button aria-label="More servings" disabled={picks[r.id] >= 50} onclick={() => picks[r.id]++}>+</button>
                  </span>
                {/if}
              </li>
            {:else}
              <li><button class:current={selected?.id === r.id} aria-current={selected?.id === r.id ? 'true' : undefined} onclick={() => pick(r.id)}>
                <span class="saved-name">{r.name}</span>
                <span class="saved-facts">Serves {r.shownServings ?? r.servings}, {formatAmount(r.perServing?.calories)} kcal and {formatAmount(r.perServing?.protein)} g protein each</span>
                <span class="saved-date">Saved {savedOn(r.savedAt)}</span>
              </button></li>
            {/if}
          {/each}
        </ul>
        {#if picking}
          <div class="pick-actions">
            {#if shopError}<p class="method-error" role="alert">{shopError}</p>{/if}
            {#if replacing}
              <p>Replace your shopping list? Its ticks and edits will be lost.</p>
              <button class="primary-button" onclick={() => build(true)}>Replace it</button>
              <button class="text-button" onclick={() => replacing = false}>Keep it</button>
            {:else}
              <button class="primary-button" disabled={!pickCount} onclick={() => build()}>{pickCount ? `Build list (${pickCount} ${pickCount === 1 ? 'recipe' : 'recipes'})` : 'Pick a recipe'}</button>
              <button class="text-button" onclick={() => picking = false}>Cancel</button>
            {/if}
          </div>
        {/if}
      </div>
    </aside>
    <main id="results" tabindex="-1" class="dish">
      {#if onList}
        <ShoppingList ondeleted={() => onselect?.(prefs.recipes[0]?.id ?? null, true)} />
      {:else if selected}
        <RecipeCard recipe={selected} bind:servings writing={rewriting}>
          {#if selected.version !== 2}
            <div class="rewrite-note">
              <p>Saved before servings could change. Rewrite it for the number you want:</p>
              <span class="servings" role="group" aria-label="Servings for the rewrite">
                <button aria-label="Fewer servings" disabled={servings <= 1 || rewriting} onclick={() => servings--}>−</button>
                <span aria-live="polite">Serves {servings}</span>
                <button aria-label="More servings" disabled={servings >= 50 || rewriting} onclick={() => servings++}>+</button>
              </span>
              <button class="outline-button" disabled={rewriting} onclick={rewrite}>{rewriting ? 'Rewriting…' : `Rewrite for ${servings} ${servings === 1 ? 'serving' : 'servings'} · 1 credit`}</button>
            </div>
          {/if}
          {#if rewriteError}<p class="method-error" role="alert">{rewriteError}</p>{/if}
          {#if selected.version === 2 && !selected.communityId}
            {#if selected.postedId}<span class="post-saved">Posted to the community</span>
            {:else}<button class="outline-button" onclick={() => posting = $state.snapshot(selected)}>Post to community</button>{/if}
          {/if}
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
      <footer><p>Food by your numbers. <span>Saved recipes stay in this browser.</span></p><FooterLinks /></footer>
    </main>
  </div>
{/if}

<PostDialog bind:recipe={posting} onposted={(id) => updateRecipe(selected.id, { ...$state.snapshot(selected), postedId: id })} />
