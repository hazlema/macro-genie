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
  import Community from './components/Community.svelte';
  import Admin from './components/Admin.svelte';
  import Help from './components/Help.svelte';
  import PolicyPage from './components/PolicyPage.svelte';
  import ContactPage from './components/ContactPage.svelte';
  import Credits from './components/Credits.svelte';
  import FooterLinks from './components/FooterLinks.svelte';
  import Landing from './components/Landing.svelte';
  import RecipeCard from './components/RecipeCard.svelte';
  import PanelToggle from './components/PanelToggle.svelte';
  import { panelStartsOpen, rememberPanelUsed, showResults } from './lib/panel.js';
  import { printJob } from './lib/print.svelte.js';
  import { route, navigate } from './lib/route.svelte.js';
  import { BASES, GROUPS, PRESETS, SORTS, emptyRanges, normalizeDataset, rangeSummary, searchFoods } from './lib/foods.js';
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
  // Which tab shows comes from the address (see lib/route.svelte.js).
  const tab = $derived(route.tab);
  let visible = $state(20);
  let activePreset = $state('');
  let mobileFilters = $state(panelStartsOpen(0));
  let dislikesOpen = $state(false);
  let accountMenu = $state(false);
  let tabsEl = $state();

  // Phones with large text: the tabs scroll inside their pill, so keep the
  // current one in view (without scrolling the page).
  $effect(() => {
    tab;
    const current = tabsEl?.querySelector('.current');
    if (!current || tabsEl.scrollWidth <= tabsEl.clientWidth) return;
    tabsEl.scrollLeft = current.offsetLeft - (tabsEl.clientWidth - current.offsetWidth) / 2;
  });

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

<svelte:window onpointerdown={(e) => { if (accountMenu && !e.target.closest('.account-menu')) accountMenu = false; }} onkeydown={(e) => { if (e.key === 'Escape') accountMenu = false; }} />

<svelte:head><title>Macro Genie — Food by your numbers</title></svelte:head>

<a class="skip-link" href="#results">{tab === 'foods' ? 'Skip to foods' : 'Skip to content'}</a>
<header class="topbar">
  <a class="wordmark" href="/" onclick={(e) => { e.preventDefault(); navigate({ tab: 'home' }); }} aria-label="Macro Genie home">Macro Genie<span class="brand-dot"></span></a>
  <nav class="tabs" aria-label="Browse" bind:this={tabsEl}>
    <button class:current={tab === 'community'} aria-current={tab === 'community' ? 'page' : undefined} onclick={() => navigate({ tab: 'community' })}>Community</button>
    <button class:current={tab === 'saved'} aria-current={tab === 'saved' ? 'page' : undefined} onclick={() => navigate({ tab: 'saved' })}><span class="wide-label">Recipe Book</span><span class="narrow-label">Recipes</span>{#if prefs.recipes.length}<span class="tab-count">{prefs.recipes.length}</span>{/if}</button>
    <button class:current={tab === 'recipes'} aria-current={tab === 'recipes' ? 'page' : undefined} onclick={() => navigate({ tab: 'recipes' })}><span class="wide-label">Recipe Builder</span><span class="narrow-label">Builder</span></button>
    <button class:current={tab === 'foods'} aria-current={tab === 'foods' ? 'page' : undefined} onclick={() => navigate({ tab: 'foods' })}><span class="wide-label">Food Macros</span><span class="narrow-label">Foods</span><span class="tab-count wide-label">{dataset ? dataset.foods.length.toLocaleString() : '…'}</span></button>
  </nav>
  {#if tab === 'foods'}
    <div class="search-box">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
      <input type="search" aria-label="Search foods" placeholder="Search foods: steak, lentil, yogurt" bind:value={query} oninput={changed} />
    </div>
  {/if}
  <div class="account-area">
    {#if account.signedIn}
      <button class="text-button account-wide" onclick={() => navigate({ tab: 'help' })}>Help</button>
      {#if account.isMod}<button class="text-button account-wide" onclick={() => navigate({ tab: 'admin' })}>Admin</button>{/if}
      <span class="credit-pill account-wide" title="Each idea or written recipe uses one credit">{account.credits} {account.credits === 1 ? 'credit' : 'credits'}</span>
      <button class="text-button account-wide" onclick={() => navigate({ tab: 'credits' })}>Get credits</button>
      <span class="account-name account-wide">{account.displayName}</span>
      <button class="text-button account-wide" onclick={signOut}>Sign out</button>
      <!-- Phones: one button on the logo's row; name and Sign out in a menu. -->
      <div class="account-menu">
        <button class="credit-pill" aria-expanded={accountMenu} aria-controls="account-pop" onclick={() => accountMenu = !accountMenu}>{account.credits} {account.credits === 1 ? 'credit' : 'credits'} <span aria-hidden="true">▾</span></button>
        {#if accountMenu}
          <div class="account-pop" id="account-pop">
            <p>Signed in as <strong>{account.displayName}</strong></p>
            <p class="account-pop-note">Each idea or written recipe uses one credit.</p>
            <button class="outline-button" onclick={() => { accountMenu = false; navigate({ tab: 'credits' }); }}>Get more credits</button>
            <button class="outline-button" onclick={() => { accountMenu = false; navigate({ tab: 'help' }); }}>Help</button>
            {#if account.isMod}<button class="outline-button" onclick={() => { accountMenu = false; navigate({ tab: 'admin' }); }}>Admin</button>{/if}
            <button class="outline-button" onclick={() => { accountMenu = false; signOut(); }}>Sign out</button>
          </div>
        {/if}
      </div>
    {:else if account.loaded}
      <button class="text-button help-link" onclick={() => navigate({ tab: 'help' })}>Help</button>
      <button class="outline-button login-button" onclick={() => account.loginOpen = true}><span class="login-long">Login / Create Account</span><span class="login-short">Log in</span></button>
    {/if}
  </div>
</header>
{#if account.suspended}<p class="suspended-banner" role="status">Your account is suspended. You can browse, but not post, comment, like, or use credits.</p>{/if}

{#if tab === 'foods'}
  <div class="workspace">
    <aside class:mobile-open={mobileFilters}>
      <PanelToggle title="Set your macros" summary={rangeSummary(ranges)} hint="Protein, carbs, calories and more" bind:open={mobileFilters} controls="filter-content" ontoggle={(open) => { if (!open) rememberPanelUsed(); }} />
      <div class="filter-content" id="filter-content">
        <div class="filter-heading"><h1>Your ranges</h1><select class="basis-select" aria-label="Nutrient basis" bind:value={basis} onchange={() => visible = 20}>{#each Object.entries(BASES) as [key, name]}<option value={key}>{name}</option>{/each}</select></div>
        <p class="filter-intro"><span class="mobile-only">{BASES[basis]}. </span>Leave blank for no limit.</p>
        <RangeTable bind:ranges error={result.error} onchange={changed} />
        <label class="category-label" for="category">Category</label>
        <select id="category" bind:value={category} onchange={changed}>
          <option value="all">All foods</option>
          {#each categories as [id, name]}<option value={id}>{name}</option>{/each}
        </select>
        <p class="presets-label">A starting point <a href="/help/basics" onclick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate({ tab: 'help', helpSlug: 'basics' }); scrollTo(0, 0); }}>New to macros?</a></p>
        <div class="presets">
          {#each PRESETS as preset}<button class:chosen={activePreset === preset.name} aria-pressed={activePreset === preset.name} onclick={() => applyPreset(preset)}>{preset.name}</button>{/each}
        </div>
        <DislikeSummary onedit={() => dislikesOpen = true} />
        <button class="clear-button" onclick={clearAll}>↺ <span>Clear all</span></button>
        <button class="primary-button panel-done" onclick={() => { mobileFilters = false; showResults(); }}>{loading || result.error ? 'Show foods' : `Show ${result.foods.length.toLocaleString()} ${result.foods.length === 1 ? 'food' : 'foods'}`}</button>
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
      <footer><p>Food by your numbers. <span>Food search is free, no account needed.</span></p><p>USDA SR Legacy · {dataset?.total.toLocaleString() ?? '…'} food records. {dataset?.excluded ?? '…'} without serving sizes excluded.</p><p>Missing nutrients appear as — and won’t match an active range. Values are rounded for display; filters use full precision.</p><FooterLinks /></footer>
    </main>
  </div>
{:else if tab === 'admin'}
  <Admin adminTab={route.adminTab} />
{:else if tab === 'credits'}
  <Credits />
{:else if tab === 'page' && route.page === 'contact'}
  <ContactPage />
{:else if tab === 'page'}
  <PolicyPage page={route.page} />
{:else if tab === 'help'}
  <Help slug={route.helpSlug} />
{:else if tab === 'home'}
  <Landing foodCount={dataset?.foods.length} />
{:else if tab === 'community'}
  <Community postId={route.postId} />
{:else if tab === 'saved'}
  <SavedRecipes selectedId={route.recipeId} onselect={(id, replace) => navigate({ tab: 'saved', recipeId: id }, { replace })} onmakeone={() => navigate({ tab: 'recipes' })} foods={dataset?.foods ?? []} />
{:else if dataset}
  <Recipes foods={dataset.foods} oneditdislikes={() => dislikesOpen = true} onviewsaved={() => navigate({ tab: 'saved', recipeId: prefs.recipes[0]?.id ?? null })} />
{:else}
  <main class="coming-soon" id="results" tabindex="-1"><h1>{loading ? 'Loading foods…' : 'Food data unavailable'}</h1><p>{loading ? 'Recipes need the food library. One moment.' : loadError}</p>{#if !loading}<button class="outline-button" onclick={loadFoods}>Try again</button>{/if}</main>
{/if}

<DislikesModal bind:open={dislikesOpen} foods={dataset?.foods ?? []} />
<LoginModal />

<div class="print-only">{#if printJob.recipe}<RecipeCard recipe={printJob.recipe} servings={printJob.servings ?? printJob.recipe.servings} scalable={false} />
{:else if printJob.list}<article class="print-list"><h2>Shopping list</h2><p>For {printJob.list.recipes.map(r => r.name).join(', ')}</p><ul>{#each printJob.list.items.filter(i => !i.checked) as item}<li>{item.text}</li>{/each}</ul></article>{/if}</div>
