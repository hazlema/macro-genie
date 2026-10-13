<script>
  import { untrack } from 'svelte';
  import { api } from '../lib/account.svelte.js';

  // Contact-form messages. Text is shown as plain text, never as HTML.
  let status = $state('new');
  let messages = $state(null);
  let error = $state('');
  let busy = $state(null);
  const when = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  async function load() {
    const res = await api(`/api/admin/messages?status=${status}`);
    if (res.ok) { messages = res.body.messages; error = ''; }
    else { error = res.error; messages ??= []; }
  }
  $effect(() => { status; untrack(() => load()); });

  async function mark(m, next) {
    busy = m.id;
    const res = await api(`/api/admin/messages/${m.id}/status`, { method: 'POST', body: { status: next } });
    busy = null;
    if (res.ok) messages = messages.filter((x) => x.id !== m.id);
    else error = res.error;
  }
</script>

<section class="admin-inbox">
  <div class="board-chips" role="group" aria-label="Show messages">
    <button class:chosen={status === 'new'} aria-pressed={status === 'new'} onclick={() => (status = 'new')}>New</button>
    <button class:chosen={status === 'done'} aria-pressed={status === 'done'} onclick={() => (status = 'done')}>Done</button>
  </div>
  {#if error}<p class="method-error" role="alert">{error}</p>{/if}
  {#if messages === null}
    <p class="comments-empty">Loading…</p>
  {:else if !messages.length}
    <p class="comments-empty">{status === 'new' ? 'No new messages.' : 'Nothing marked done yet.'}</p>
  {:else}
    <ul class="inbox-list">
      {#each messages as m (m.id)}
        <li class="inbox-item">
          <p class="inbox-meta"><span class="role-tag">{m.topic}</span> <strong>{m.name}</strong>{#if m.email} <span>{m.email}</span>{/if}{#if m.accountId} <span>(account {m.accountId})</span>{/if} <time datetime={m.at}>{when(m.at)}</time></p>
          <p class="inbox-body">{m.body}</p>
          <button class="outline-button" disabled={busy === m.id} onclick={() => mark(m, status === 'new' ? 'done' : 'new')}>{status === 'new' ? 'Mark done' : 'Move back to new'}</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
