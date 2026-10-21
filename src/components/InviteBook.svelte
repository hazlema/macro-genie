<script>
  import { api } from '../lib/account.svelte.js';

  // Everyone the owner has emailed an invite to, newest first. It shows
  // whether each code was used and when, never who used it. Clicking a row
  // puts that address in "To".
  let { open = $bindable(false), invites = [], onpick, onchanged } = $props();
  let dialog;
  let query = $state('');
  let busy = $state(null);
  let error = $state('');

  const shown = $derived(invites.filter((i) => i.email.toLowerCase().includes(query.trim().toLowerCase())));
  const used = $derived(invites.filter((i) => i.usedAt).length);
  const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  function pick(invite) {
    onpick(invite.email);
    open = false;
  }

  async function act(invite, action, question) {
    if (question && !confirm(question)) return;
    busy = invite.id; error = '';
    const res = await api(`/api/admin/invites/${invite.id}/${action}`, { method: 'POST', body: {} });
    busy = null;
    if (!res.ok) { error = res.error; return; }
    onchanged();
  }
</script>

<dialog class="dislikes invite-book" bind:this={dialog} onclose={() => open = false} onclick={(e) => { if (e.target === dialog) open = false; }} aria-labelledby="invite-book-title">
  <div class="dislikes-body">
    <div class="dislikes-head">
      <h2 id="invite-book-title">Address book</h2>
      <button class="dialog-close" aria-label="Close" onclick={() => open = false}>×</button>
    </div>
    <input class="invite-book-search" type="search" aria-label="Search addresses" placeholder="Search addresses" bind:value={query} />
    <p class="money-note">{invites.length} sent · {used} used</p>
    {#if error}<p class="method-error" role="alert">{error}</p>{/if}
    {#if !shown.length}
      <p class="dislike-empty">{invites.length ? 'No address matches that.' : 'No invites sent yet.'}</p>
    {:else}
      <div class="invite-book-scroll">
        <table class="invite-book-table">
          <thead><tr><th>Email</th><th>Sent</th><th>Credits</th><th>Used</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {#each shown as invite (invite.id)}
              <tr>
                <td><button class="text-button invite-pick" title="Put this address in To" onclick={() => pick(invite)}>{invite.email}</button></td>
                <td>{day(invite.sentAt)}</td>
                <td>{invite.credits}</td>
                <td>{#if invite.usedAt}<span class="invite-used">✓ {day(invite.usedAt)}</span>{:else if invite.canceledAt}<span class="money-note">canceled</span>{:else}—{/if}</td>
                <td><span class="invite-actions">
                  {#if !invite.usedAt && !invite.canceledAt}
                    <button class="text-button" disabled={busy === invite.id} onclick={() => act(invite, 'resend', `Send the same invite to ${invite.email} again?`)}>Resend</button>
                    <button class="text-button" disabled={busy === invite.id} onclick={() => act(invite, 'cancel', `Cancel the code sent to ${invite.email}? It stops working.`)}>Cancel</button>
                  {/if}
                  <button class="text-button" disabled={busy === invite.id} onclick={() => act(invite, 'forget', `Forget ${invite.email}? It comes out of the book${invite.usedAt || invite.canceledAt ? '' : ' and its code stops working'}.`)}>Forget</button>
                </span></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    <button class="done-button" onclick={() => open = false}>Done</button>
  </div>
</dialog>
