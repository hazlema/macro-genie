<script>
  import { prefs } from '../lib/prefs.svelte.js';
  let { onedit } = $props();
</script>

<div class="dislike-summary">
  <div class="dislike-summary-head">
    <span>Foods you won’t eat</span>
    <button onclick={onedit} aria-haspopup="dialog">{prefs.dislikes.length ? 'Edit' : 'Add'}</button>
  </div>
  {#if prefs.dislikes.length}
    <p>{prefs.dislikes.slice(0, 6).join(', ')}{prefs.dislikes.length > 6 ? `, and ${prefs.dislikes.length - 6} more` : ''}</p>
  {:else}
    <p class="muted">None yet.</p>
  {/if}
</div>
