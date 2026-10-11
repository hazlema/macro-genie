<script>
  import RangeTable from './RangeTable.svelte';
  import PostCard from './PostCard.svelte';
  import ReviewQueue from './ReviewQueue.svelte';
  import { emptyRanges } from '../lib/foods.js';
  import { account, api } from '../lib/account.svelte.js';
  import { navigate } from '../lib/route.svelte.js';

  // postId: set when the address is /community/<id>, showing that one recipe.
  let { postId = null } = $props();
  let single = $state(null);
  let singleError = $state('');
  $effect(() => {
    if (!postId) { single = null; return; }
    single = null; singleError = '';
    const id = postId;
    account.signedIn;
    api(`/api/community/posts/${id}`).then((res) => {
      if (id !== postId) return;
      if (res.ok) single = res.body.post; else singleError = res.error;
    });
  });

  const MEALS = ['all', 'breakfast', 'lunch', 'dinner', 'snack', 'dessert'];
  let meal = $state('all');
  let sort = $state('new');
  let ranges = $state(emptyRanges());
  let posts = $state([]);
  let more = $state(false);
  let loading = $state(true);
  let error = $state('');
  let mobileOpen = $state(false);
  let reviewing = $state(false);
  let needsReview = $state(false);
  let request = 0;

  const activeRanges = () =>
    Object.fromEntries(Object.entries($state.snapshot(ranges)).flatMap(([k, r]) => {
      const out = {};
      if (r.min != null) out.min = r.min;
      if (r.max != null) out.max = r.max;
      return Object.keys(out).length ? [[k, out]] : [];
    }));

  async function load(append = false) {
    const token = ++request;
    loading = true; error = '';
    const params = new URLSearchParams({ meal, sort, offset: String(append ? posts.length : 0), ranges: JSON.stringify(activeRanges()) });
    if (needsReview) params.set('review', '1');
    const res = await api(`/api/community?${params}`);
    if (token !== request) return;
    loading = false;
    if (!res.ok) { error = res.error; if (!append) posts = []; return; }
    posts = append ? [...posts, ...res.body.posts] : res.body.posts;
    more = res.body.more;
  }

  // Reload when the filters or the signed-in account change; typing in the
  // ranges waits a moment so each keystroke isn't a request.
  let timer;
  $effect(() => {
    meal; sort; JSON.stringify(ranges); account.signedIn; needsReview;
    clearTimeout(timer);
    timer = setTimeout(() => load(), 250);
    return () => clearTimeout(timer);
  });

  const activeCount = $derived(Object.values(ranges).filter(r => r.min != null || r.max != null).length);
</script>

{#if reviewing}
  <ReviewQueue onclose={() => { reviewing = false; load(); }} />
{:else}
  <div class="workspace">
    <aside class:mobile-open={mobileOpen}>
      <button class="mobile-filter-toggle" onclick={() => mobileOpen = !mobileOpen} aria-expanded={mobileOpen} aria-controls="community-filters">Filters {activeCount || meal !== 'all' ? `(${activeCount + (meal !== 'all' ? 1 : 0)})` : ''}<span>{mobileOpen ? '−' : '+'}</span></button>
      <div class="filter-content" id="community-filters">
        <div class="filter-heading"><h1>Community</h1></div>
        <p class="filter-intro">Recipes people built and shared. Nutrition is per serving, from USDA data.</p>
        <div class="meal-filter" role="group" aria-label="Meal">
          {#each MEALS as m}<button class:chosen={meal === m} aria-pressed={meal === m} onclick={() => meal = m}>{m === 'all' ? 'All' : m[0].toUpperCase() + m.slice(1)}</button>{/each}
        </div>
        <RangeTable bind:ranges />
        <label class="category-label" for="community-sort">Sort</label>
        <select id="community-sort" bind:value={sort}><option value="new">Newest first</option><option value="liked">Most liked</option></select>
        <button class="clear-button" onclick={() => { ranges = emptyRanges(); meal = 'all'; sort = 'new'; }}>↺ <span>Clear filters</span></button>
        {#if account.isAdmin}
          <label class="dislike-toggle mod-filter"><input type="checkbox" bind:checked={needsReview} /> Needs review only</label>
          <button class="outline-button review-button" onclick={() => reviewing = true}>Review queue</button>
        {/if}
      </div>
    </aside>
    <main id="results" tabindex="-1" class="dish">
      {#if postId}
        <a class="back-link" href="/community" onclick={(e) => { e.preventDefault(); navigate({ tab: 'community' }); }}>← All community recipes</a>
        {#if singleError}
          <div class="empty-state" role="alert"><h2>Recipe not found</h2><p>{singleError} It may have been removed.</p></div>
        {:else if !single}
          <p class="comments-empty">Loading the recipe…</p>
        {:else}
          {#key single.id}<ul class="post-list single"><PostCard post={single} startOpen onremoved={() => navigate({ tab: 'community' })} /></ul>{/key}
        {/if}
      {:else}
      <div class="results-top">
        <div class="result-count" aria-live="polite" aria-atomic="true"><strong>{loading && !posts.length ? '…' : posts.length}{more ? '+' : ''}</strong><span>{posts.length === 1 ? 'recipe' : 'recipes'} shared</span></div>
      </div>
      {#if error}
        <div class="empty-state" role="alert"><h2>Couldn’t load the community</h2><p>{error}</p><button class="outline-button" onclick={() => load()}>Try again</button></div>
      {:else if !loading && !posts.length}
        <div class="empty-state"><h2>No recipes here yet.</h2><p>Nothing matches these filters. Build a recipe in the Recipe Builder,<br />save it, and post it from My recipes.</p></div>
      {:else}
        <ul class="post-list">
          {#each posts as post (post.id)}<PostCard {post} onremoved={(id) => posts = posts.filter((p) => p.id !== id)} />{/each}
        </ul>
        {#if more}<div class="pagination"><button class="outline-button" disabled={loading} onclick={() => load(true)}>{loading ? 'Loading…' : 'Show more'}</button></div>{/if}
      {/if}
      {/if}
      <footer><p>Food by your numbers. <span>Browsing is free; posting, liking, and commenting need an account.</span></p><p>Posts and comments are checked automatically and by a person when unsure. Report anything that doesn’t belong.</p></footer>
    </main>
  </div>
{/if}
