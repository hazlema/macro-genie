<script>
  import { api } from '../lib/account.svelte.js';
  import { channelLink, parseContacts } from '../lib/invite-contacts.js';

  // Everyone in the owner's invite list: people imported from a JSON file
  // and anyone already emailed, newest work first. It shows whether each
  // code was used and when, never who used it. Clicking a person puts them
  // in the form. onchanged(action, person) after a change here.
  let { open = $bindable(false), people = [], onpick, onchanged } = $props();
  let dialog;
  let fileInput = $state();
  let query = $state('');
  let onlyNew = $state(false);
  let busy = $state(null);
  let error = $state('');
  let notice = $state('');
  let incoming = $state(null); // { fresh, already, skipped } while previewing an import
  let importing = $state(false);

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => (!onlyNew || p.status === 'new')
      && (!q || [p.email, p.name, p.channel].some((s) => s.toLowerCase().includes(q))));
  });
  const invited = $derived(people.filter((p) => p.status !== 'new').length);
  const used = $derived(people.filter((p) => p.status === 'used').length);
  const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  // Only the day of use is stored, as midnight UTC; show that same day.
  const usedDay = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  function pick(person) {
    onpick(person);
    open = false;
  }

  async function act(person, path, action, question) {
    if (!confirm(question)) return;
    busy = person.email; error = ''; notice = '';
    const res = await api(`/api/admin/${path}`, { method: 'POST', body: action === 'forget' ? { email: person.email } : {} });
    busy = null;
    if (!res.ok) { error = res.error; return; }
    onchanged(action, person);
  }

  // Read and check the file here first, so the owner sees what will happen
  // before anything is saved.
  async function chooseFile(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    error = ''; notice = ''; incoming = null;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      error = `${file.name} isn't valid JSON.`;
      return;
    }
    try {
      const { contacts, skipped } = parseContacts(data);
      const known = new Set(people.map((p) => p.email.toLowerCase()));
      incoming = {
        fresh: contacts.filter((c) => !known.has(c.email)),
        already: contacts.filter((c) => known.has(c.email)),
        skipped,
      };
    } catch (err) {
      error = err.message;
    }
  }

  async function addIncoming() {
    importing = true; error = '';
    const res = await api('/api/admin/contacts/import', { method: 'POST', body: { contacts: incoming.fresh } });
    importing = false;
    if (!res.ok) { error = res.error; return; }
    await onchanged('import');
    incoming = null;
    notice = `Added ${res.body.added} ${res.body.added === 1 ? 'person' : 'people'}.`;
    onlyNew = true;
  }
</script>

<dialog class="dislikes invite-book" bind:this={dialog} onclose={() => { open = false; notice = ''; incoming = null; }} onclick={(e) => { if (e.target === dialog) open = false; }} aria-labelledby="invite-book-title">
  <div class="dislikes-body">
    <div class="dislikes-head">
      <h2 id="invite-book-title">Address book</h2>
      <button class="dialog-close" aria-label="Close" onclick={() => open = false}>×</button>
    </div>
    {#if error}<p class="method-error" role="alert">{error}</p>{/if}
    {#if notice}<p class="post-note" role="status">{notice}</p>{/if}

    {#if incoming}
      <div class="invite-import">
        <p><strong>{incoming.fresh.length} new</strong> · {incoming.already.length} already in the book · {incoming.skipped.length} skipped</p>
        {#if incoming.skipped.length}
          <ul class="invite-skipped">
            {#each incoming.skipped as s (s.row)}<li>Row {s.row}{s.label ? ` (${s.label})` : ''}: {s.reason}</li>{/each}
          </ul>
        {/if}
        <div class="invite-buttons">
          <button class="text-button" onclick={() => (incoming = null)}>Cancel</button>
          <button class="primary-button" disabled={importing || !incoming.fresh.length} onclick={addIncoming}>{importing ? 'Adding…' : `Add ${incoming.fresh.length} ${incoming.fresh.length === 1 ? 'person' : 'people'}`}</button>
        </div>
      </div>
    {:else}
      <div class="invite-book-tools">
        <input class="invite-book-search" type="search" aria-label="Search people" placeholder="Search names, emails, channels" bind:value={query} />
        <button class="outline-button" onclick={() => fileInput.click()}>Import list…</button>
        <input class="sr-only" type="file" accept=".json,application/json" tabindex="-1" aria-hidden="true" bind:this={fileInput} onchange={chooseFile} />
      </div>
      <div class="invite-book-tools">
        <p class="money-note">{people.length} {people.length === 1 ? 'person' : 'people'} · {invited} invited · {used} used</p>
        <label class="dislike-toggle"><input type="checkbox" bind:checked={onlyNew} /> Not invited yet</label>
      </div>
      {#if !shown.length}
        <p class="dislike-empty">{people.length ? 'Nobody matches that.' : 'Nobody here yet. Import a list or send an invite.'}</p>
      {:else}
        <div class="invite-book-scroll">
          <table class="invite-book-table">
            <thead><tr><th>Person</th><th>Channel</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {#each shown as person (person.email)}
                {@const link = channelLink(person.channel)}
                <tr>
                  <td><button class="text-button invite-pick" title="Write to this person" onclick={() => pick(person)}>{#if person.name}<strong>{person.name}</strong><br />{/if}{person.email}</button></td>
                  <td class="invite-channel">{#if link}<a href={link} target="_blank" rel="noopener noreferrer">{person.channel}</a>{:else}{person.channel}{/if}</td>
                  <td>
                    {#if person.status === 'used'}<span class="invite-used">✓ {usedDay(person.usedAt)}</span>
                    {:else if person.status === 'canceled'}<span class="money-note">canceled</span>
                    {:else if person.status === 'invited'}{day(person.invite.sentAt)} · {person.invite.credits}
                    {:else}<span class="money-note">not invited</span>{/if}
                  </td>
                  <td><span class="invite-actions">
                    {#if person.invite && !person.invite.usedAt && !person.invite.canceledAt}
                      <button class="text-button" disabled={busy === person.email} onclick={() => act(person, `invites/${person.invite.id}/resend`, 'resend', `Send the same invite to ${person.email} again?`)}>Resend</button>
                      <button class="text-button" disabled={busy === person.email} onclick={() => act(person, `invites/${person.invite.id}/cancel`, 'cancel', `Cancel the code sent to ${person.email}? It stops working.`)}>Cancel</button>
                    {/if}
                    <button class="text-button" disabled={busy === person.email} onclick={() => act(person, 'contacts/forget', 'forget', `Forget ${person.email}? They come out of the book${person.status === 'invited' ? ' and their code stops working' : ''}.`)}>Forget</button>
                  </span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
    <button class="done-button" onclick={() => open = false}>Done</button>
  </div>
</dialog>
