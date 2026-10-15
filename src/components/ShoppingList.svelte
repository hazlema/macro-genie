<script>
  import { tick } from 'svelte';
  import { prefs, changeShopping, setShopping } from '../lib/prefs.svelte.js';
  import { newItem, shoppingText } from '../lib/shopping.js';
  import { printList } from '../lib/print.svelte.js';

  // The list built from picked recipes. Lines are plain text: tap one to tick
  // it off, edit or remove it, or add your own.
  let { ondeleted } = $props();
  const list = $derived(prefs.shopping);
  const toGet = $derived(list.items.filter(i => !i.checked));
  const got = $derived(list.items.filter(i => i.checked));

  let editingId = $state(null);
  let draft = $state('');
  let adding = $state('');
  let copied = $state(false);
  let confirming = $state(false);

  const builtOn = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  function toggle(id) {
    changeShopping(l => { const item = l.items.find(i => i.id === id); item.checked = !item.checked; });
  }
  async function edit(item) {
    editingId = item.id;
    draft = item.text;
    await tick();
    document.getElementById(`edit-${item.id}`)?.focus();
  }
  function saveEdit() {
    const text = draft.trim();
    const id = editingId;
    editingId = null;
    if (!text) return remove(id);
    changeShopping(l => { l.items.find(i => i.id === id).text = text; });
  }
  function remove(id) {
    changeShopping(l => { l.items = l.items.filter(i => i.id !== id); });
  }
  function add(event) {
    event.preventDefault();
    const text = adding.trim();
    if (!text) return;
    changeShopping(l => { l.items.push(newItem(text)); });
    adding = '';
  }
  function clearTicked() {
    changeShopping(l => { l.items = l.items.filter(i => !i.checked); });
  }
  async function copy() {
    try { await navigator.clipboard.writeText(shoppingText($state.snapshot(list))); copied = true; setTimeout(() => copied = false, 2000); } catch { copied = false; }
  }
  function deleteList() {
    setShopping(null);
    ondeleted?.();
  }
</script>

{#snippet line(item)}
  <li class="shop-item" class:checked={item.checked}>
    {#if editingId === item.id}
      <form class="shop-edit" onsubmit={(e) => { e.preventDefault(); saveEdit(); }}>
        <label class="sr-only" for="edit-{item.id}">Edit line</label>
        <input id="edit-{item.id}" bind:value={draft} onkeydown={(e) => { if (e.key === 'Escape') editingId = null; }} />
        <button class="outline-button" type="submit">Save</button>
        <button class="text-button" type="button" onclick={() => editingId = null}>Cancel</button>
      </form>
    {:else}
      <button class="shop-tick" aria-pressed={item.checked} onclick={() => toggle(item.id)}>
        <span class="shop-box" aria-hidden="true">{item.checked ? '✓' : ''}</span>
        <span class="shop-text">
          <span>{item.text}</span>
          {#if item.from.length}<small>{item.from.join(', ')}</small>{/if}
        </span>
      </button>
      <span class="shop-tools">
        <button class="text-button" aria-label="Edit {item.text}" onclick={() => edit(item)}>Edit</button>
        <button class="text-button" aria-label="Remove {item.text}" onclick={() => remove(item.id)}>Remove</button>
      </span>
    {/if}
  </li>
{/snippet}

<article class="recipe-card shop-card">
  <header class="card-head">
    <h2>Shopping list</h2>
    <p class="card-meta">For {list.recipes.map(r => `${r.name} (serves ${r.servings})`).join(', ')}. Built {builtOn(list.builtAt)}.</p>
  </header>

  {#if toGet.length}
    <ul class="shop-items">{#each toGet as item (item.id)}{@render line(item)}{/each}</ul>
  {:else}
    <p class="shop-done">Everything’s ticked off.</p>
  {/if}

  <form class="shop-add" onsubmit={add}>
    <label class="sr-only" for="shop-add">Add an item</label>
    <input id="shop-add" placeholder="Add an item, e.g. foil" bind:value={adding} />
    <button class="outline-button" type="submit" disabled={!adding.trim()}>Add</button>
  </form>

  {#if got.length}
    <div class="shop-got-head">
      <h3>Got it ({got.length})</h3>
      <button class="text-button" onclick={clearTicked}>Clear ticked</button>
    </div>
    <ul class="shop-items">{#each got as item (item.id)}{@render line(item)}{/each}</ul>
  {/if}

  <div class="card-actions">
    <button class="primary-button" onclick={() => printList($state.snapshot(list))}>Print</button>
    <button class="outline-button" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    {#if confirming}
      <span class="confirm-delete" role="group" aria-label="Confirm delete">
        <span>Delete this list?</span>
        <button class="danger-button" onclick={deleteList}>Delete</button>
        <button class="text-button" onclick={() => confirming = false}>Keep it</button>
      </span>
    {:else}
      <button class="text-button" onclick={() => confirming = true}>Delete list</button>
    {/if}
  </div>
</article>
