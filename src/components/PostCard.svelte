<script>
  import { untrack } from 'svelte';
  import RecipeCard from './RecipeCard.svelte';
  import { formatAmount } from '../lib/foods.js';
  import { account, api } from '../lib/account.svelte.js';
  import { prefs, saveRecipe } from '../lib/prefs.svelte.js';

  // post: { id, name, mealType, author, createdAt, recipe, likes, comments,
  //         likedByMe, mine, status, reason }
  let { post, onremoved } = $props();

  // Starting values from the post; the card keeps its own from then on.
  const start = untrack(() => ({ likes: post.likes, liked: post.likedByMe, comments: post.comments, servings: post.recipe.servings, id: post.id }));
  let likes = $state(start.likes);
  let liked = $state(start.liked);
  let commentCount = $state(start.comments);
  let status = $state(untrack(() => post.status));
  let open = $state(false);
  let servings = $state(start.servings);
  let comments = $state(null);
  let commentsOpen = $state(false);
  let draft = $state('');
  let sending = $state(false);
  let note = $state('');
  let confirm = $state(''); // 'report' | 'remove' | ''
  let reportReason = $state('Spam or advertising');
  let saved = $state(prefs.recipes.some((r) => r.communityId === start.id));

  const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const per = $derived(post.recipe.perServing ?? {});

  async function like() {
    if (!account.signedIn) { account.loginOpen = true; return; }
    const res = await api(`/api/community/posts/${post.id}/like`, { method: 'POST' });
    if (res.ok) { liked = res.body.liked; likes = res.body.likes; }
    else note = res.error;
  }

  async function loadComments() {
    commentsOpen = !commentsOpen;
    if (!commentsOpen || comments) return;
    const res = await api(`/api/community/posts/${post.id}/comments`);
    comments = res.ok ? res.body.comments : [];
    if (!res.ok) note = res.error;
  }

  async function send(event) {
    event.preventDefault();
    if (!draft.trim() || sending) return;
    sending = true; note = '';
    const res = await api(`/api/community/posts/${post.id}/comments`, { method: 'POST', body: { body: draft } });
    sending = false;
    if (!res.ok) { note = res.error; return; }
    if (res.body.status === 'blocked') { note = `Your comment wasn’t posted: ${res.body.reason}`; return; }
    comments = [...(comments ?? []), { id: res.body.id, body: draft.trim(), author: account.displayName, createdAt: new Date().toISOString(), mine: true, status: res.body.status }];
    if (res.body.status === 'live') commentCount += 1;
    else note = 'Thanks. Your comment shows once a moderator has looked at it.';
    draft = '';
  }

  async function removeComment(c) {
    const res = await api(`/api/community/comments/${c.id}`, { method: 'DELETE' });
    if (!res.ok) { note = res.error; return; }
    comments = comments.filter((x) => x.id !== c.id);
    if (c.status === 'live') commentCount -= 1;
  }

  async function reportItem(type, id) {
    if (!account.signedIn) { account.loginOpen = true; return; }
    const res = await api('/api/community/report', { method: 'POST', body: { type, id, reason: type === 'post' ? reportReason : '' } });
    confirm = '';
    note = res.ok ? 'Thanks for the report. A moderator will take a look.' : res.error;
  }

  async function removePost() {
    const res = await api(`/api/community/posts/${post.id}`, { method: 'DELETE' });
    if (res.ok) onremoved?.(post.id);
    else note = res.error;
  }

  // Moderators decide on waiting posts and comments right where they are.
  async function moderate(type, id, action) {
    const res = await api('/api/admin/decide', { method: 'POST', body: { type, id, action } });
    if (!res.ok) { note = res.error; return; }
    if (type === 'post') {
      status = res.body.status;
      if (status === 'removed') onremoved?.(post.id);
      return;
    }
    const c = comments.find((x) => x.id === id);
    if (res.body.status === 'live') { c.status = 'live'; commentCount += 1; }
    else comments = comments.filter((x) => x.id !== id);
  }

  function save() {
    const { perServing, gramsPerServing, ...rest } = $state.snapshot(post.recipe);
    saved = !!saveRecipe({ ...rest, perServing, gramsPerServing, shownServings: servings, communityId: post.id });
    note = saved ? 'Saved to My recipes.' : 'This browser wouldn’t store the recipe.';
  }
</script>

<li class="post" class:waiting={status !== 'live'}>
  {#if status === 'held' || status === 'blocked'}
    <div class="post-status" class:blocked={status === 'blocked'}>
      <p>{status === 'held' ? 'Waiting for a moderator' : 'Blocked by the automatic check'}{post.reason ? `: ${post.reason}` : ''}</p>
      {#if account.isAdmin}
        <span class="mod-actions"><button class="text-button approve" onclick={() => moderate('post', post.id, 'approve')}>Approve</button><button class="text-button" onclick={() => moderate('post', post.id, 'remove')}>Remove</button></span>
      {/if}
    </div>
  {:else if account.isAdmin && (post.waitingComments || post.reports)}
    <p class="post-status">{[post.waitingComments ? `${post.waitingComments} ${post.waitingComments === 1 ? 'comment' : 'comments'} waiting` : '', post.reports ? `${post.reports} ${post.reports === 1 ? 'report' : 'reports'}` : ''].filter(Boolean).join(', ')}</p>
  {/if}
  <div class="post-head">
    <div>
      <h3><button class="post-title" aria-expanded={open} onclick={() => open = !open}>{post.name}</button></h3>
      <p class="post-meta"><span class="meal-tag">{post.mealType}</span> by {post.author}, {day(post.createdAt)}</p>
    </div>
    <button class="like" class:liked aria-pressed={liked} aria-label={`${liked ? 'Unlike' : 'Like'} ${post.name}`} onclick={like} disabled={status !== 'live'}>
      <span aria-hidden="true">{liked ? '♥' : '♡'}</span> {likes}
    </button>
  </div>
  {#if post.recipe.description}<p class="post-description">{post.recipe.description}</p>{/if}
  <p class="idea-macros">Per serving: <strong>{formatAmount(per.calories)}</strong> kcal<span class="separator">·</span><strong>{formatAmount(per.protein)}</strong> g protein<span class="separator">·</span><strong>{formatAmount(per.netCarbs)}</strong> g net carbs<span class="separator">·</span><strong>{formatAmount(per.fat)}</strong> g fat</p>

  <div class="post-actions">
    <button class="outline-button" aria-expanded={open} onclick={() => open = !open}>{open ? 'Hide recipe' : 'Show recipe'}</button>
    {#if status === 'live'}
      <button class="text-button" aria-expanded={commentsOpen} onclick={loadComments}>{commentsOpen ? 'Hide comments' : `Comments (${commentCount})`}</button>
    {/if}
    {#if !post.mine}
      {#if saved}<span class="post-saved">In My recipes</span>{:else}<button class="text-button" onclick={save}>Save to My recipes</button>{/if}
    {/if}
    {#if confirm === 'remove'}
      <span class="confirm-delete">Remove your post for everyone? <button class="danger-button" onclick={removePost}>Remove</button><button class="text-button" onclick={() => confirm = ''}>Keep it</button></span>
    {:else if confirm === 'report'}
      <span class="confirm-delete">
        <select bind:value={reportReason} aria-label="Why are you reporting it?"><option>Spam or advertising</option><option>Offensive</option><option>Unsafe food advice</option><option>Something else</option></select>
        <button class="danger-button" onclick={() => reportItem('post', post.id)}>Report</button><button class="text-button" onclick={() => confirm = ''}>Cancel</button>
      </span>
    {:else if post.mine}
      <button class="text-button" onclick={() => confirm = 'remove'}>Remove my post</button>
    {:else if status === 'live'}
      <button class="text-button" onclick={() => confirm = 'report'}>Report</button>
    {/if}
  </div>
  {#if note}<p class="post-note" role="status">{note}</p>{/if}

  {#if open}
    <div class="post-recipe"><RecipeCard recipe={post.recipe} bind:servings /></div>
  {/if}

  {#if commentsOpen}
    <section class="comments" aria-label={`Comments on ${post.name}`}>
      {#if comments === null}
        <p class="comments-empty">Loading comments…</p>
      {:else}
        {#each comments as c (c.id)}
          <div class="comment" class:waiting={c.status !== 'live'}>
            <p class="comment-meta"><strong>{c.author}</strong> {day(c.createdAt)}</p>
            {#if c.status !== 'live' && account.isAdmin}
              <p class="comment-waiting">{c.status === 'held' ? 'Waiting for a moderator' : 'Blocked'}{c.reason ? `: ${c.reason}` : ''}
                <span class="mod-actions"><button class="text-button approve" onclick={() => moderate('comment', c.id, 'approve')}>Approve</button><button class="text-button" onclick={() => moderate('comment', c.id, 'remove')}>Remove</button></span>
              </p>
            {:else if c.status !== 'live'}<p class="comment-waiting">Waiting for a moderator. Only you can see this until it’s approved.</p>{/if}
            <p class="comment-body">{c.body}</p>
            {#if c.mine}<button class="text-button" onclick={() => removeComment(c)}>Delete</button>
            {:else}<button class="text-button" onclick={() => reportItem('comment', c.id)}>Report</button>{/if}
          </div>
        {:else}
          <p class="comments-empty">No comments yet.</p>
        {/each}
      {/if}
      {#if account.signedIn}
        <form class="comment-form" onsubmit={send}>
          <textarea bind:value={draft} maxlength="1000" rows="2" aria-label="Write a comment" placeholder="Made it? Tweaked it? Say how it went."></textarea>
          <button class="primary-button" disabled={sending || !draft.trim()}>{sending ? 'Posting…' : 'Comment'}</button>
        </form>
      {:else}
        <button class="text-button" onclick={() => account.loginOpen = true}>Sign in to comment</button>
      {/if}
    </section>
  {/if}
</li>
