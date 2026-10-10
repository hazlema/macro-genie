<script>
  import { prefs, save, addDislike, removeDislike } from '../lib/prefs.svelte.js';
  import { isDisliked } from '../lib/recipe.js';

  let { open = $bindable(false), foods = [] } = $props();
  let dialog;
  let word = $state('');
  let note = $state('');

  const counts = $derived(Object.fromEntries(prefs.dislikes.map(w => [w, foods.filter(f => isDisliked(f, [w])).length])));

  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  function add(event) {
    event.preventDefault();
    const clean = word.trim();
    if (!clean) return;
    note = addDislike(clean) ? '' : `${clean} is already on your list.`;
    word = '';
  }
</script>

<dialog class="dislikes" bind:this={dialog} onclose={() => open = false} onclick={(e) => { if (e.target === dialog) open = false; }} aria-labelledby="dislikes-title">
  <div class="dislikes-body">
    <div class="dislikes-head">
      <h2 id="dislikes-title">Foods you won’t eat</h2>
      <button class="dialog-close" aria-label="Close" onclick={() => open = false}>×</button>
    </div>
    <p class="dislikes-intro">Foods with these words in their name never go into a recipe. Saved in this browser only.</p>
    <form class="dislike-form" onsubmit={add}>
      <input aria-label="Food to avoid" placeholder="mushroom, liver, cilantro" bind:value={word} oninput={() => note = ''} maxlength="40" />
      <button class="outline-button" type="submit">Add</button>
    </form>
    {#if note}<p class="dislike-note" role="status">{note}</p>{/if}
    {#if prefs.dislikes.length}
      <ul class="dislike-list">
        {#each prefs.dislikes as w (w)}
          <li>
            <span class="dislike-word">{w}</span>
            <span class="dislike-count">{counts[w] ? `blocks ${counts[w].toLocaleString()} ${counts[w] === 1 ? 'food' : 'foods'}` : 'matches no foods'}</span>
            <button aria-label={`Remove ${w}`} onclick={() => removeDislike(w)}>×</button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="dislike-empty">Nothing here yet. Add a word and every food named with it is left out.</p>
    {/if}
    <label class="dislike-toggle"><input type="checkbox" bind:checked={prefs.hideOnFoods} onchange={save} /> Hide these on the Foods tab too</label>
    <p class="dislike-warning">Matches food names only. Not safe for allergies: some foods contain ingredients their names don’t mention.</p>
    <button class="done-button" onclick={() => open = false}>Done</button>
  </div>
</dialog>
