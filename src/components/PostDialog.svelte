<script>
  import { account, api, changeDisplayName } from '../lib/account.svelte.js';

  // recipe: the saved (structured) recipe to share. onposted(id) records it.
  let { recipe = $bindable(null), onposted } = $props();

  const MEALS = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'];
  let dialog;
  let check = $state(null); // { verdict, reason, mealType, token }
  let checking = $state(false);
  let mealType = $state('');
  let name = $state('');
  let posting = $state(false);
  let error = $state('');
  let done = $state('');

  $effect(() => {
    if (recipe && !dialog.open) {
      if (!account.signedIn) { recipe = null; account.loginOpen = true; return; }
      check = null; error = ''; done = ''; mealType = ''; name = account.displayName;
      dialog.showModal();
      runCheck();
    } else if (!recipe && dialog.open) dialog.close();
  });

  async function runCheck() {
    checking = true;
    const res = await api('/api/community/check', { method: 'POST', body: { recipe: $state.snapshot(recipe) } });
    checking = false;
    if (!res.ok) { error = res.error; return; }
    check = res.body;
    mealType = res.body.mealType ?? '';
  }

  async function post(event) {
    event.preventDefault();
    if (posting || !mealType) return;
    posting = true; error = '';
    if (name.trim() !== account.displayName) {
      const problem = await changeDisplayName(name);
      if (problem) { error = problem; posting = false; return; }
    }
    const res = await api('/api/community/posts', { method: 'POST', body: { recipe: $state.snapshot(recipe), mealType, token: check?.token } });
    posting = false;
    if (!res.ok) { error = res.error; return; }
    const { id, status, reason } = res.body;
    if (status === 'blocked') { error = `This recipe can’t be posted: ${reason}`; return; }
    onposted?.(id);
    done = status === 'live'
      ? 'Posted. It’s in the Community tab now.'
      : 'Posted. It shows in the Community tab once a moderator has looked at it.';
  }
</script>

<dialog class="dislikes" bind:this={dialog} onclose={() => recipe = null} onclick={(e) => { if (e.target === dialog) recipe = null; }} aria-labelledby="post-title">
  <div class="dislikes-body">
    <div class="dislikes-head">
      <h2 id="post-title">Post to the community</h2>
      <button class="dialog-close" aria-label="Close" onclick={() => recipe = null}>×</button>
    </div>
    {#if recipe}
      <p class="dislikes-intro">Share “{recipe.name}”. Anyone can see it; people can like it, comment, and save a copy. Its nutrition is recalculated from USDA data.</p>
      {#if done}
        <p class="post-done" role="status">{done}</p>
        <button class="done-button" onclick={() => recipe = null}>Done</button>
      {:else}
        <form class="post-form" onsubmit={post}>
          <label class="note-field"><span>Shown as</span><input bind:value={name} maxlength="30" autocomplete="nickname" /></label>
          <label class="note-field"><span>Meal</span>
            <select bind:value={mealType} required disabled={checking}>
              <option value="" disabled>{checking ? 'Suggesting…' : 'Pick one'}</option>
              {#each MEALS as m}<option value={m}>{m[0].toUpperCase() + m.slice(1)}</option>{/each}
            </select>
          </label>
          {#if checking}
            <p class="dislike-warning">Checking the recipe…</p>
          {:else if check?.verdict === 'unsure'}
            <p class="post-check unsure">It will wait for a quick review before others see it: {check.reason}</p>
          {:else if check?.verdict === 'blocked'}
            <p class="post-check blocked">This recipe can’t be posted: {check.reason}</p>
          {/if}
          {#if error}<p class="method-error" role="alert">{error}</p>{/if}
          <button class="done-button" disabled={checking || posting || !mealType || check?.verdict === 'blocked'}>{posting ? 'Posting…' : 'Post it'}</button>
        </form>
      {/if}
    {/if}
  </div>
</dialog>
