<script>
  import RangeTable from './RangeTable.svelte';
  import PostCard from './PostCard.svelte';
  import ReviewQueue from './ReviewQueue.svelte';
  import LazyEditor from './LazyEditor.svelte';
  import { emptyRanges } from '../lib/foods.js';
  import { account, api } from '../lib/account.svelte.js';
  import { navigate } from '../lib/route.svelte.js';

  // postId: set when the address is /community/<id>, showing that one post.
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

  const FORUMS = [['general', 'General'], ['support', 'Support']];
  const MEALS = [['all', 'All'], ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack'], ['dessert', 'Dessert']];
  let board = $state(null); // a forum, or null for the recipe boards
  let meal = $state('all');
  let sort = $state('new');
  let ranges = $state(emptyRanges());
  let posts = $state([]);
  let more = $state(false);
  let loading = $state(true);
  let error = $state('');
  let counts = $state({});
  let queue = $state(0);
  let mobileOpen = $state(false);
  let reviewing = $state(false);
  let needsReview = $state(false);
  let composing = $state(false);
  let title = $state('');
  let message = $state('');
  let posting = $state(false);
  let composeNote = $state('');
  let threadForm = $state();
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
    const params = new URLSearchParams({ sort, offset: String(append ? posts.length : 0) });
    if (board) params.set('board', board);
    else { params.set('meal', meal); params.set('ranges', JSON.stringify(activeRanges())); }
    if (needsReview) params.set('review', '1');
    const res = await api(`/api/community?${params}`);
    if (token !== request) return;
    loading = false;
    if (!res.ok) { error = res.error; if (!append) posts = []; return; }
    posts = append ? [...posts, ...res.body.posts] : res.body.posts;
    more = res.body.more;
  }

  async function loadCounts() {
    const res = await api('/api/community/counts');
    if (!res.ok) return;
    counts = res.body.counts;
    queue = res.body.queue ?? 0;
  }

  // Reload when the filters or the signed-in account change; typing in the
  // ranges waits a moment so each keystroke isn't a request.
  let timer;
  $effect(() => {
    board; meal; sort; JSON.stringify(ranges); account.signedIn; needsReview;
    clearTimeout(timer);
    timer = setTimeout(() => load(), 250);
    return () => clearTimeout(timer);
  });
  $effect(() => { account.signedIn; account.isAdmin; loadCounts(); });

  function pickForum(id) { board = id; composing = false; composeNote = ''; }
  function pickMeal(id) { board = null; meal = id; composing = false; }
  function clearFilters() { ranges = emptyRanges(); meal = 'all'; board = null; sort = 'new'; needsReview = false; }

  async function startThread(event) {
    event.preventDefault();
    if (posting || message.length > 5000) return;
    posting = true; composeNote = '';
    const res = await api('/api/community/threads', { method: 'POST', body: { board, title, body: message } });
    posting = false;
    if (!res.ok) { composeNote = res.error; return; }
    if (res.body.status === 'blocked') { composeNote = `Not posted: ${res.body.reason}`; return; }
    composeNote = res.body.status === 'live' ? 'Posted.' : 'Posted. It shows once a moderator has looked at it.';
    title = ''; message = ''; composing = false;
    load(); loadCounts();
  }

  const activeCount = $derived(Object.values(ranges).filter(r => r.min != null || r.max != null).length);
  const noun = $derived(board ? (posts.length === 1 ? 'thread' : 'threads') : (posts.length === 1 ? 'recipe shared' : 'recipes shared'));
  const boardName = $derived(FORUMS.find(([id]) => id === board)?.[1]);
</script>

{#if reviewing}
  <ReviewQueue onclose={() => { reviewing = false; load(); loadCounts(); }} />
{:else}
  <div class="workspace">
    <aside class:mobile-open={mobileOpen}>
      <button class="mobile-filter-toggle" onclick={() => mobileOpen = !mobileOpen} aria-expanded={mobileOpen} aria-controls="community-filters">Macros {activeCount ? `(${activeCount})` : ''}<span>{mobileOpen ? '−' : '+'}</span></button>
      <div class="filter-content" id="community-filters">
        <div class="filter-heading"><h1>Macros</h1></div>
        <p class="filter-intro">For the recipe boards, per serving. Leave blank for no limit.</p>
        <RangeTable bind:ranges />
        {#if board}<p class="range-note">Macro filters apply to the recipe boards, not forum threads.</p>{/if}
        {#if account.isAdmin}
          <label class="dislike-toggle mod-filter"><input type="checkbox" bind:checked={needsReview} /> Needs review only</label>
        {/if}
      </div>
    </aside>
    <main id="results" tabindex="-1" class="dish community-main">
      <div class="community-head">
        <div>
          <h1>Community</h1>
          <p>Recipes people built and shared, plus open discussion. Nutrition is per serving, from USDA data.</p>
        </div>
        {#if account.isAdmin}
          <button class="outline-button queue-button" onclick={() => reviewing = true}>Review queue{#if queue}<span class="queue-count" aria-label={`${queue} waiting`}>{queue}</span>{/if}</button>
        {/if}
      </div>

      <div class="board-bar">
        <div class="board-group">
          <p class="board-label">Recipe boards</p>
          <div class="board-chips" role="group" aria-label="Recipe boards">
            {#each MEALS as [id, label]}<button class:chosen={!board && meal === id} aria-pressed={!board && meal === id} onclick={() => pickMeal(id)}>{label}<span>{counts[id] ?? 0}</span></button>{/each}
          </div>
        </div>
        <div class="board-group forums">
          <p class="board-label">Forums</p>
          <div class="board-chips forum" role="group" aria-label="Forums">
            {#each FORUMS as [id, label]}<button class:chosen={board === id} aria-pressed={board === id} onclick={() => pickForum(id)}>{label}<span>{counts[id] ?? 0}</span></button>{/each}
          </div>
        </div>
      </div>

      {#if postId}
        <a class="back-link" href="/community" onclick={(e) => { e.preventDefault(); navigate({ tab: 'community' }); }}>← All of the community</a>
        {#if singleError}
          <div class="empty-state" role="alert"><h2>Not found</h2><p>{singleError} It may have been removed.</p></div>
        {:else if !single}
          <p class="comments-empty">Loading…</p>
        {:else}
          {#key single.id}<ul class="post-list single"><PostCard post={single} startOpen onremoved={() => navigate({ tab: 'community' })} /></ul>{/key}
        {/if}
      {:else}
        <div class="results-top community-results">
          <div class="result-count" aria-live="polite" aria-atomic="true"><strong>{loading && !posts.length ? '…' : posts.length}{more ? '+' : ''}</strong><span>{noun}{boardName ? ` in ${boardName}` : ''}</span></div>
          <div class="results-tools">
            <button class="clear-button" onclick={clearFilters}>↺ <span>Clear filters</span></button>
            <select aria-label="Sort" bind:value={sort}><option value="new">Newest first</option><option value="liked">Most liked</option></select>
          </div>
        </div>

        {#if board}
          {#if !account.signedIn}
            <button class="outline-button compose-toggle" onclick={() => account.loginOpen = true}>Sign in to start a thread</button>
          {:else if !composing}
            <button class="primary-button compose-toggle" onclick={() => composing = true}>Start a thread in {boardName}</button>
          {:else}
            <form class="thread-form" onsubmit={startThread} bind:this={threadForm}>
              <label class="note-field"><span>Title</span><input bind:value={title} maxlength="120" placeholder={board === 'support' ? 'What do you need help with?' : 'What’s on your mind?'} required /></label>
              <div class="note-field"><span>Message</span><LazyEditor bind:markdown={message} maxlength={5000} rows={5} label="Message" placeholder="Write your message" onsubmit={() => threadForm.requestSubmit()} /></div>
              <div class="post-actions">
                <button class="primary-button" disabled={posting || title.trim().length < 3 || !message.trim() || message.length > 5000}>{posting ? 'Posting…' : 'Post thread'}</button>
                <button type="button" class="text-button" onclick={() => composing = false}>Cancel</button>
              </div>
            </form>
          {/if}
          {#if composeNote}<p class="post-note" role="status">{composeNote}</p>{/if}
        {/if}

        {#if error}
          <div class="empty-state" role="alert"><h2>Couldn’t load the community</h2><p>{error}</p><button class="outline-button" onclick={() => load()}>Try again</button></div>
        {:else if !loading && !posts.length}
          {#if board}
            <div class="empty-state"><h2>No threads yet.</h2><p>Start the first one in {boardName}.</p></div>
          {:else}
            <div class="empty-state"><h2>No recipes here yet.</h2><p>Nothing matches these filters. Build a recipe in the Recipe Builder,<br />save it, and post it from your Recipe Book.</p></div>
          {/if}
        {:else}
          <ul class="post-list">
            {#each posts as post (post.id)}<PostCard {post} onremoved={(id) => { posts = posts.filter((p) => p.id !== id); loadCounts(); }} />{/each}
          </ul>
          {#if more}<div class="pagination"><button class="outline-button" disabled={loading} onclick={() => load(true)}>{loading ? 'Loading…' : 'Show more'}</button></div>{/if}
        {/if}
      {/if}
      <footer><p>Food by your numbers. <span>Browsing is free; posting, liking, and commenting need an account.</span></p><p>Posts and comments are checked automatically and by a person when unsure. Report anything that doesn’t belong.</p></footer>
    </main>
  </div>
{/if}
