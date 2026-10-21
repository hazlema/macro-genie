<script>
  import { account, api } from '../lib/account.svelte.js';

  // Find a user and act on them. The buttons follow your role; the server
  // checks every action again.
  let query = $state('');
  let users = $state(null);
  let more = $state(false);
  let error = $state('');
  let open = $state(null);
  let note = $state('');
  let busy = $state(false);
  let credit = $state({ amount: '', reason: '' });
  let confirm = $state('');
  let confirmName = $state('');
  let timer;

  const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  // Mods can act on regular users; admins on anyone but the owner.
  const canTouch = (u) => !u.owner && (account.isAdmin || !(u.admin || u.mod));

  async function load(append = false) {
    const params = new URLSearchParams({ q: query.trim(), offset: String(append ? users.length : 0) });
    const res = await api(`/api/admin/users?${params}`);
    if (!res.ok) { error = res.error; users ??= []; return; }
    error = '';
    users = append ? [...users, ...res.body.users] : res.body.users;
    more = res.body.more;
  }
  load();

  function search() {
    clearTimeout(timer);
    timer = setTimeout(() => load(), 300);
  }
  function toggle(u) {
    open = open === u.id ? null : u.id;
    note = ''; confirm = ''; confirmName = '';
    credit = { amount: '', reason: '' };
  }
  function update(changed) {
    users = users.map((u) => (u.id === changed.id ? { ...u, ...changed } : u));
  }
  async function act(u, path, body, done) {
    busy = true; note = '';
    const res = await api(`/api/admin/users/${u.id}/${path}`, { method: 'POST', body: body ?? {} });
    busy = false;
    if (!res.ok) { note = res.error; return; }
    done(res.body);
  }
</script>

<section class="admin-users">
  <input type="search" class="admin-search" placeholder="Find a user by name" aria-label="Find a user by name" bind:value={query} oninput={search} />
  {#if error}<p class="method-error" role="alert">{error}</p>{/if}
  {#if users === null}
    <p class="comments-empty">Loading…</p>
  {:else if !users.length}
    <p class="comments-empty">{query.trim() ? `No users match “${query.trim()}”.` : 'No users yet.'}</p>
  {:else}
    <ul class="user-list">
      {#each users as u (u.id)}
        <li class="user-row" class:open={open === u.id}>
          <button class="user-summary" aria-expanded={open === u.id} onclick={() => toggle(u)}>
            <strong>{u.displayName}</strong>
            {#if u.owner}<span class="role-tag">Owner</span>{:else if u.admin}<span class="role-tag">Admin</span>{:else if u.mod}<span class="role-tag">Mod</span>{/if}
            {#if u.suspended}<span class="role-tag suspended">Suspended</span>{/if}
            <span class="user-facts">{u.credits} credits, {u.posts} {u.posts === 1 ? 'post' : 'posts'}, joined {day(u.joinedAt)}</span>
          </button>
          {#if open === u.id}
            <div class="user-panel">
              {#if canTouch(u)}
                <div class="user-actions">
                  <button class="outline-button" disabled={busy} onclick={() => act(u, 'suspend', { on: !u.suspended }, (b) => { update(b); note = b.suspended ? `${u.displayName} is suspended.` : `${u.displayName} can take part again.`; })}>{u.suspended ? 'Unsuspend' : 'Suspend'}</button>
                  {#if confirm === 'remove'}
                    <span class="confirm-delete">Remove all of {u.displayName}’s posts and comments?
                      <button class="danger-button" disabled={busy} onclick={() => act(u, 'remove-content', {}, (b) => { note = `Removed ${b.posts} ${b.posts === 1 ? 'post' : 'posts'} and ${b.comments} ${b.comments === 1 ? 'comment' : 'comments'}.`; confirm = ''; update({ id: u.id, posts: 0 }); })}>Remove</button>
                      <button class="text-button" onclick={() => (confirm = '')}>Cancel</button>
                    </span>
                  {:else}
                    <button class="outline-button" onclick={() => (confirm = 'remove')}>Remove their community posts</button>
                  {/if}
                </div>
              {:else if u.owner}
                <p class="user-note">The site owner’s account can’t be changed here.</p>
              {:else}
                <p class="user-note">Only admins can act on moderators and admins.</p>
              {/if}

              {#if account.isAdmin}
                <form class="credit-form" onsubmit={(e) => { e.preventDefault(); act(u, 'credits', { amount: Number(credit.amount), reason: credit.reason }, (b) => { update({ id: u.id, credits: b.credits }); note = `${u.displayName} now has ${b.credits} credits.`; credit = { amount: '', reason: '' }; }); }}>
                  <label><span>Credits</span><input type="number" step="1" placeholder="20 or -5" bind:value={credit.amount} required /></label>
                  <label class="grow"><span>Reason</span><input placeholder="Goes in their credit history" maxlength="200" bind:value={credit.reason} required /></label>
                  <button class="primary-button" disabled={busy}>Apply</button>
                </form>
                {#if !u.owner}
                  <div class="user-actions">
                    <label class="dislike-toggle"><input type="checkbox" checked={u.mod} disabled={busy} onchange={(e) => act(u, 'roles', { mod: e.currentTarget.checked }, update)} /> Moderator</label>
                    <label class="dislike-toggle"><input type="checkbox" checked={u.admin} disabled={busy} onchange={(e) => act(u, 'roles', { admin: e.currentTarget.checked }, update)} /> Admin</label>
                  </div>
                  {#if confirm === 'delete'}
                    <div class="delete-confirm">
                      <p>This erases {u.displayName}’s account, posts, comments, likes, credits, and messages to us. The credit history stays without their name, for tax records. <strong>Delete</strong> is for a “Delete my data” request: they can sign up again later. <strong>Delete and ban</strong> also stops that Google account signing in again. Type <strong>{u.displayName}</strong> to confirm.</p>
                      <input bind:value={confirmName} aria-label="Type their display name to confirm" />
                      <div class="user-actions">
                        <button class="danger-button" disabled={busy || confirmName.trim() !== u.displayName} onclick={() => act(u, 'delete', { confirm: confirmName, ban: false }, () => { users = users.filter((x) => x.id !== u.id); open = null; })}>Delete</button>
                        <button class="danger-button" disabled={busy || confirmName.trim() !== u.displayName} onclick={() => act(u, 'delete', { confirm: confirmName, ban: true }, () => { users = users.filter((x) => x.id !== u.id); open = null; })}>Delete and ban</button>
                        <button class="text-button" onclick={() => (confirm = '')}>Cancel</button>
                      </div>
                    </div>
                  {:else}
                    <button class="danger-button" onclick={() => { confirm = 'delete'; confirmName = ''; }}>Delete…</button>
                  {/if}
                {/if}
              {/if}
              {#if note}<p class="post-note" role="status">{note}</p>{/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if more}<button class="outline-button" onclick={() => load(true)}>Show more</button>{/if}
  {/if}
</section>
