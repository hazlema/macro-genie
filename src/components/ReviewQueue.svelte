<script>
  import RecipeCard from './RecipeCard.svelte';
  import { api } from '../lib/account.svelte.js';

  let { onclose } = $props();
  let items = $state(null);
  let error = $state('');
  let busy = $state(null);
  let openRecipe = $state(null);

  const day = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const label = { held: 'Waiting', blocked: 'Blocked by the automatic check', live: 'Live, reported' };

  async function load() {
    const res = await api('/api/admin/queue');
    if (res.ok) items = res.body.items;
    else { error = res.error; items = []; }
  }
  load();

  async function decide(item, action) {
    busy = `${item.type}-${item.id}`;
    const res = await api('/api/admin/decide', { method: 'POST', body: { type: item.type, id: item.id, action } });
    busy = null;
    if (res.ok) items = items.filter((i) => !(i.type === item.type && i.id === item.id));
    else error = res.error;
  }
</script>

<main id="results" tabindex="-1" class="review">
  <div class="review-head">
    <div>
      <h1>Review queue</h1>
      <p>Posts and comments the automatic check wasn’t sure about, ones it blocked, and anything people reported.</p>
    </div>
    <button class="outline-button" onclick={onclose}>Back to the community</button>
  </div>
  {#if error}<p class="method-error" role="alert">{error}</p>{/if}
  {#if items === null}
    <p class="comments-empty">Loading…</p>
  {:else if !items.length}
    <div class="empty-state"><h2>Nothing to review.</h2><p>New items appear here when the automatic check is unsure or someone reports something.</p></div>
  {:else}
    <ul class="review-list">
      {#each items as item (`${item.type}-${item.id}`)}
        <li class="review-item">
          <p class="review-meta"><span class="meal-tag">{item.type}</span> <strong>{label[item.status] ?? item.status}</strong> · by {item.author}{item.authorBanned ? ' (banned)' : ''} · {day(item.createdAt)}{item.reports ? ` · ${item.reports} ${item.reports === 1 ? 'report' : 'reports'}` : ''}</p>
          {#if item.reason}<p class="review-reason">{item.reason}</p>{/if}
          {#if item.type === 'post' && item.kind === 'thread'}
            <h3>{item.name}</h3>
            <p class="review-comment">{item.body}</p>
            <p class="review-context">Thread in {item.board === 'support' ? 'Support' : 'General'}</p>
          {:else if item.type === 'post'}
            <h3>{item.name}</h3>
            <button class="text-button" onclick={() => openRecipe = openRecipe === item.id ? null : item.id}>{openRecipe === item.id ? 'Hide recipe' : 'Read the recipe'}</button>
            {#if openRecipe === item.id}<div class="post-recipe"><RecipeCard recipe={item.recipe} scalable={false} /></div>{/if}
          {:else}
            <p class="review-comment">“{item.body}”</p>
            <p class="review-context">On “{item.postName}”</p>
          {/if}
          <div class="post-actions">
            <button class="primary-button" disabled={busy} onclick={() => decide(item, 'approve')}>Approve</button>
            <button class="outline-button" disabled={busy} onclick={() => decide(item, 'remove')}>Remove</button>
            <button class="danger-button" disabled={busy || item.authorBanned} onclick={() => decide(item, 'ban')}>Remove and ban {item.author}</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>
