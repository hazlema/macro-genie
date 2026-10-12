<script>
  import { EMOJI_GROUPS, recentEmoji, searchEmoji } from '../lib/emoji.js';

  // The 😊 button's popover: search, categories, and recently used.
  let { onpick, onclose } = $props();
  const recent = recentEmoji();
  let query = $state('');
  let group = $state(recent.length ? 'recent' : EMOJI_GROUPS[0].id);
  const shown = $derived(
    query.trim() ? searchEmoji(query, 160)
    : group === 'recent' ? recent
    : EMOJI_GROUPS.find((g) => g.id === group).items,
  );
  // Type-to-search on desktop; on phones, don't pop the keyboard over the grid.
  const focusOnDesktop = (el) => { if (matchMedia('(pointer: fine)').matches) el.focus(); };
  const pickGroup = (id) => { group = id; query = ''; };
</script>

<div class="emoji-picker" role="dialog" aria-label="Emoji" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onclose(); } }}>
  <input type="search" placeholder="Search emoji" aria-label="Search emoji" bind:value={query} {@attach focusOnDesktop} />
  <div class="emoji-tabs" role="tablist" aria-label="Emoji categories">
    {#if recent.length}
      <button type="button" role="tab" aria-selected={!query && group === 'recent'} title="Recently used" onclick={() => pickGroup('recent')}>🕘</button>
    {/if}
    {#each EMOJI_GROUPS as g (g.id)}
      <button type="button" role="tab" aria-selected={!query && group === g.id} title={g.label} onclick={() => pickGroup(g.id)}>{g.icon}</button>
    {/each}
  </div>
  <div class="emoji-grid">
    {#each shown as e (e.name)}
      <button type="button" title={`:${e.shortcodes[0]}:`} aria-label={e.name.replaceAll('_', ' ')} onclick={() => onpick(e)}>{e.emoji}</button>
    {:else}
      <p class="emoji-empty">No emoji found</p>
    {/each}
  </div>
</div>
