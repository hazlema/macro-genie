<script>
  import PostCard from './PostCard.svelte';
  import { account, api } from '../lib/account.svelte.js';

  // One post, opened, over the community list (/community/<id>). Only the
  // post shows here: no boards or filters, which keep working on the list
  // underneath. Search engines get this address from the seo-post function.
  let { postId, onclose, onremoved } = $props();
  let dialog;
  let post = $state(null);
  let error = $state('');

  $effect(() => {
    const id = postId;
    post = null; error = '';
    account.signedIn;
    api(`/api/community/posts/${id}`).then((res) => {
      if (id !== postId) return;
      if (res.ok) post = res.body.post; else error = res.error;
    });
  });

  $effect(() => {
    if (!dialog.open) dialog.showModal();
  });
</script>

<dialog class="dislikes post-popup" bind:this={dialog} oncancel={(e) => { e.preventDefault(); onclose(); }} onclick={(e) => { if (e.target === dialog) onclose(); }} aria-label={post?.name ?? 'Community post'}>
  <div class="post-popup-body">
    <div class="post-popup-head">
      <button class="dialog-close" aria-label="Close" onclick={onclose}>×</button>
    </div>
    {#if error}
      <div class="empty-state" role="alert"><h2>Not found</h2><p>{error} It may have been removed.</p></div>
    {:else if !post}
      <p class="comments-empty">Loading…</p>
    {:else}
      {#key post.id}<ul class="post-list single"><PostCard {post} startOpen onremoved={(id) => { onremoved(id); onclose(); }} /></ul>{/key}
    {/if}
  </div>
</dialog>
