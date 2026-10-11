<script>
  import { onMount } from 'svelte';
  import FoodCard from './components/FoodCard.svelte';
  import RangeTable from './components/RangeTable.svelte';
  import DislikeSummary from './components/DislikeSummary.svelte';
  import DislikesModal from './components/DislikesModal.svelte';
  import LoginModal from './components/LoginModal.svelte';
  import { account, refreshAccount, signOut } from './lib/account.svelte.js';
  import Recipes from './components/Recipes.svelte';
  import SavedRecipes from './components/SavedRecipes.svelte';
  import RecipeCard from './components/RecipeCard.svelte';
  import { printJob } from './lib/print.svelte.js';
  import { BASES, GROUPS, PRESETS, SORTS, emptyRanges, normalizeDataset, searchFoods } from './lib/foods.js';
  import { expandDislikes } from './lib/recipe.js';
  import { prefs } from './lib/prefs.svelte.js';

  let dataset = $state(null);
  let loading = $state(true);
  let loadError = $state('');
  let query = $state('');
  let category = $state('all');
  let sort = $state('protein');
  let basis = $state('serving');
  let ranges = $state(emptyRanges());
  let tab = $state('foods');
  let visible = $state(20);
  let activePreset = $state('');
  let mobileFilters = $state(false);
  let dislikesOpen = $state(false);
  let savedSelected = $state(null);

  const activeCount = $derived(Object.values(ranges).filter(r => r.min != null || r.max != null).length);
  const result = $derived.by(() => {
    try { return { foods: searchFoods(dataset?.foods ?? [], { query, category, sort, ranges, basis, exclude: prefs.hideOnFoods ? expandDislikes(prefs.dislikes) : [] }), error: '' }; }
    catch (error) { return { foods: [], error: error.message }; }
  });
  const categories = $derived(Object.entries(GROUPS).filter(([id]) => dataset?.foods.some(food => food.category === id)));

  async function loadFoods() {
    loading = true;
    loadError = '';
    try {
      const response = await fetch('/foods.json');
      if (!response.ok) throw new Error('Food data request failed.');
      dataset = normalizeDataset(await response.json());
      if (!dataset.foods.length) throw new Error('Food data is empty.');
    } catch {
      loadError = 'The food data couldn’t be loaded. Check your connection and try again.';
    } finally { loading = false; }
  }
  onMount(() => { loadFoods(); refreshAccount(); });

  function changed() { visible = 20; activePreset = ''; }
  function applyPreset(preset) {
    ranges = { ...emptyRanges(), ...structuredClone(preset.ranges) };
    activePreset = preset.name;
    visible = 20;
  }
  function clearAll() {
    ranges = emptyRanges(); query = ''; category = 'all'; sort = 'protein'; basis = 'serving'; activePreset = ''; visible = 20;
  }
</script>

<svelte:head><title>Macro Genie — Food by your numbers</title></svelte:head>

<a class="skip-link" href="#results">{tab === 'foods' ? 'Skip to foods' : 'Skip to content'}</a>
<header class="topbar">
  <a class="wordmark" href="/" aria-label="Macro Genie home">Macro Genie<span class="brand-dot"></span></a>
  <nav class="tabs" aria-label="Browse">
    <button class:current={tab === 'foods'} aria-current={tab === 'foods' ? 'page' : undefined} onclick={() => tab = 'foods'}>Foods <span>{dataset ? dataset.foods.length.toLocaleString() : '…'}</span></button>
    <button class:current={tab === 'recipes'} aria-current={tab === 'recipes' ? 'page' : undefined} onclick={() => tab = 'recipes'}>Recipe Builder</button>
    <button class:current={tab === 'saved'} aria-current={tab === 'saved' ? 'page' : undefined} onclick={() => tab = 'saved'}>My recipes{#if prefs.recipes.length}<span>{prefs.recipes.length}</span>{/if}</button>
  </nav>
  {#if tab === 'foods'}
    <div class="search-box">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
      <input type="search" aria-label="Search foods" placeholder="Search foods: steak, lentil, yogurt" bind:value={query} oninput={changed} />
    </div>
  {/if}
  <div class="account-area">
    {#if account.signedIn}
      <span class="credit-pill" title="Each idea or written recipe uses one credit">{account.credits} {account.credits === 1 ? 'credit' : 'credits'}</span>
      <span class="account-name">{account.displayName}</span>
      <button class="text-button" onclick={signOut}>Sign out</button>
    {:else if account.loaded}
      <button class="outline-button login-button" onclick={() => account.loginOpen = true}>Login / Create Account</button>
    {/if}
  </div>
</header>

{#if tab === 'foods'}
  <div class="workspace">
    <aside class:mobile-open={mobileFilters}>
      <button class="mobile-filter-toggle" onclick={() => mobileFilters = !mobileFilters} aria-expanded={mobileFilters} aria-controls="filter-content">Your ranges {activeCount ? `(${activeCount})` : ''}<span>{mobileFilters ? '−' : '+'}</span></button>
      <div class="filter-content" id="filter-content">
        <div class="filter-heading"><h1>Your ranges</h1><select class="basis-select" aria-label="Nutrient basis" bind:value={basis} onchange={() => visible = 20}>{#each Object.entries(BASES) as [key, name]}<option value={key}>{name}</option>{/each}</select></div>
        <p class="filter-intro"><span class="mobile-only">{BASES[basis]}. </span>Leave blank for no limit.</p>
        <RangeTable bind:ranges error={result.error} onchange={changed} />
        <label class="category-label" for="category">Category</label>
        <select id="category" bind:value={category} onchange={changed}>
          <option value="all">All foods</option>
          {#each categories as [id, name]}<option value={id}>{name}</option>{/each}
        </select>
        <p class="presets-label">A starting point</p>
        <div class="presets">
          {#each PRESETS as preset}<button class:chosen={activePreset === preset.name} aria-pressed={activePreset === preset.name} onclick={() => applyPreset(preset)}>{preset.name}</button>{/each}
        </div>
        <DislikeSummary onedit={() => dislikesOpen = true} />
        <button class="clear-button" onclick={clearAll}>↺ <span>Clear all</span></button>
        <div class="serving-note"><span class="note-icon" aria-hidden="true">i</span><p>{basis === '100g' ? 'Every number is for 100 g of the food, so foods compare weight for weight.' : 'Every number is for the serving shown. Different foods have different serving sizes.'}</p></div>
      </div>
    </aside>

    <main id="results" tabindex="-1">
      <div class="results-top">
        <div class="result-count" aria-live="polite" aria-atomic="true"><strong>{loading ? '…' : loadError || result.error ? '—' : result.foods.length.toLocaleString()}</strong><span>{loading ? 'Loading foods' : `of ${(dataset?.foods.length ?? 0).toLocaleString()} foods fit`}</span></div>
        <select aria-label="Sort foods" bind:value={sort} onchange={() => visible = 20}>{#each Object.entries(SORTS) as [key, name]}<option value={key}>{name}</option>{/each}</select>
      </div>
      <div class="results-context"><span>Nutrition {basis === '100g' ? 'per 100 g' : 'per serving'}</span><div class="legend" aria-label="Macro bar legend"><span><i class="protein-key"></i>Protein</span><span><i class="carb-key"></i>Net carbs</span><span><i class="fat-key"></i>Fat</span></div></div>
      {#if loading}
        <div class="empty-state"><h2>Finding your food data…</h2><p>Loading the food library.</p></div>
      {:else if loadError}
        <div class="empty-state" role="alert"><h2>Food data unavailable</h2><p>{loadError}</p><button class="outline-button" onclick={loadFoods}>Try again</button></div>
      {:else if result.error}
        <div class="empty-state"><h2>Check your ranges</h2><p>{result.error}</p></div>
      {:else if result.foods.length === 0}
        <div class="empty-state"><span class="empty-symbol" aria-hidden="true">∅</span><h2>No foods fit just yet.</h2><p>Try widening a range, choosing another category,<br />or using fewer search words.</p><button class="outline-button" onclick={clearAll}>Clear all filters</button></div>
      {:else}
        <div class="food-list">{#each result.foods.slice(0, visible) as food (food.id)}<FoodCard {food} {basis} />{/each}</div>
        <div class="pagination"><span>Showing {Math.min(visible, result.foods.length).toLocaleString()} of {result.foods.length.toLocaleString()}</span>{#if result.foods.length > visible}<button class="outline-button" onclick={() => visible += 20}>Show {Math.min(20, result.foods.length - visible)} more <span aria-hidden="true">↓</span></button>{/if}</div>
      {/if}
      <footer><p>Food by your numbers. <span>Food search is free, no account needed.</span></p><p>USDA SR Legacy · {dataset?.total.toLocaleString() ?? '…'} food records. {dataset?.excluded ?? '…'} without serving sizes excluded.</p><p>Missing nutrients appear as — and won’t match an active range. Values are rounded for display; filters use full precision.</p></footer>
    </main>
  </div>
{:else if tab === 'saved'}
  <SavedRecipes bind:selectedId={savedSelected} onmakeone={() => tab = 'recipes'} foods={dataset?.foods ?? []} />
{:else if dataset}
  <Recipes foods={dataset.foods} oneditdislikes={() => dislikesOpen = true} onviewsaved={() => { savedSelected = prefs.recipes[0]?.id ?? null; tab = 'saved'; }} />
{:else}
  <main class="coming-soon" id="results" tabindex="-1"><h1>{loading ? 'Loading foods…' : 'Food data unavailable'}</h1><p>{loading ? 'Recipes need the food library. One moment.' : loadError}</p>{#if !loading}<button class="outline-button" onclick={loadFoods}>Try again</button>{/if}</main>
{/if}

<DislikesModal bind:open={dislikesOpen} foods={dataset?.foods ?? []} />
<LoginModal />

<div class="print-only">{#if printJob.recipe}<RecipeCard recipe={printJob.recipe} servings={printJob.servings ?? printJob.recipe.servings} scalable={false} />{/if}</div>
