<script>
  import ReviewQueue from './ReviewQueue.svelte';
  import { account, api } from '../lib/account.svelte.js';
  import { navigate } from '../lib/route.svelte.js';

  // The admin page. The server checks every request; this only hides what
  // the signed-in person can't use.
  let { adminTab = 'reviews' } = $props();
  let queue = $state(0);
  const TABS = [['reviews', 'Reviews']];
  $effect(() => {
    if (!account.isMod) return;
    api('/api/community/counts').then((res) => { if (res.ok) queue = res.body.queue ?? 0; });
  });
</script>

<main id="results" tabindex="-1" class="admin">
  {#if !account.loaded}
    <p class="comments-empty">Loading…</p>
  {:else if !account.isMod}
    <div class="empty-state"><h2>Moderators only</h2><p>This page is for the site’s moderators and admins.</p></div>
  {:else}
    <h1>Admin</h1>
    <div class="admin-tabs" role="tablist" aria-label="Admin sections">
      {#each TABS as [id, label] (id)}
        <button role="tab" aria-selected={adminTab === id} class:current={adminTab === id} onclick={() => navigate({ tab: 'admin', adminTab: id })}>{label}{#if id === 'reviews' && queue}<span class="queue-count" aria-label={`${queue} waiting`}>{queue}</span>{/if}</button>
      {/each}
    </div>
    <ReviewQueue onchange={(count) => (queue = count)} />
  {/if}
</main>
