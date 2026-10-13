<script>
  import { untrack } from 'svelte';
  import { api } from '../lib/account.svelte.js';
  import { navigate } from '../lib/route.svelte.js';

  // Contributions, sign-ins, credits, and problems, newest first.
  const CHIPS = [['all', 'All'], ['posts', 'Posts'], ['signins', 'Sign-ins'], ['credits', 'Credits'], ['messages', 'Messages'], ['problems', 'Problems']];
  const PROBLEMS = ['held', 'blocked', 'report', 'admin_action'];
  let chip = $state('all');
  let entries = $state(null);
  let more = $state(false);
  let error = $state('');

  const today = new Date().toDateString();
  function when(iso) {
    const d = new Date(iso);
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === today ? time : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
  }

  async function load(append = false) {
    const params = new URLSearchParams({ chip });
    if (append && entries?.length) params.set('before', String(entries.at(-1).id));
    const res = await api(`/api/admin/log?${params}`);
    if (!res.ok) { error = res.error; entries ??= []; return; }
    error = '';
    entries = append ? [...entries, ...res.body.entries] : res.body.entries;
    more = res.body.more;
  }
  $effect(() => { chip; untrack(() => load()); });

  function openLink(event, link) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    event.preventDefault();
    navigate({ tab: 'community', postId: Number(link.split('/').pop()) });
  }
</script>

<section class="admin-log">
  <div class="board-chips" role="group" aria-label="Filter the log">
    {#each CHIPS as [id, label] (id)}<button class:chosen={chip === id} aria-pressed={chip === id} onclick={() => (chip = id)}>{label}</button>{/each}
  </div>
  {#if error}<p class="method-error" role="alert">{error}</p>{/if}
  {#if entries === null}
    <p class="comments-empty">Loading…</p>
  {:else if !entries.length}
    <p class="comments-empty">Nothing {chip === 'all' ? 'logged' : 'here'} in the last 90 days.</p>
  {:else}
    <ol class="log-list">
      {#each entries as e (e.id)}
        <li class="log-entry" class:problem={PROBLEMS.includes(e.kind)}>
          <time datetime={e.at}>{when(e.at)}</time>
          <p><strong>{e.name}</strong> {e.text}{#if e.link} <a href={e.link} onclick={(ev) => openLink(ev, e.link)}>Open</a>{/if}</p>
        </li>
      {/each}
    </ol>
    {#if more}<button class="outline-button" onclick={() => load(true)}>Load more</button>{/if}
  {/if}
</section>
