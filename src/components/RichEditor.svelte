<script>
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { editorExtensions, normalizeUrl, plainTextDoc } from '../lib/editor.js';
  import { rememberEmoji, suggestionItems } from '../lib/emoji.js';
  import EmojiPicker from './EmojiPicker.svelte';

  // A rich-text box that reads and writes Markdown. The parent binds
  // markdown and clears it after posting; onsubmit runs on Ctrl/⌘+Enter.
  // autofocus: the stand-in textarea had focus, so carry on typing here.
  let { markdown = $bindable(''), maxlength = 1000, placeholder = '', label = '', onsubmit = () => {}, autofocus = false } = $props();

  let root;
  let element;
  let editor = $state.raw(null);
  let tick = $state(0); // bumps on every change so the toolbar re-reads isActive
  let emitted = '';
  let suggest = $state(null); // { items, index, rect, command } while ":fi" is open
  let pickerOpen = $state(false);
  let linkOpen = $state(false);
  let linkUrl = $state('');
  let linkError = $state('');

  const length = $derived(markdown.length);
  const is = (name) => (tick, editor?.isActive(name) ?? false);
  const keep = (e) => e.preventDefault(); // toolbar clicks keep the text selected
  const run = (fn) => fn(editor.chain().focus()).run();

  const show = (p) => {
    suggest = p.items.length ? { items: p.items, index: 0, rect: p.clientRect?.(), command: p.command } : null;
  };
  function choose(item) {
    suggest.command({ name: item.name });
    rememberEmoji(item.name);
    suggest = null;
  }
  function suggestKey(event) {
    if (!suggest) return false;
    const n = suggest.items.length;
    if (event.key === 'ArrowDown') suggest.index = (suggest.index + 1) % n;
    else if (event.key === 'ArrowUp') suggest.index = (suggest.index + n - 1) % n;
    else if (event.key === 'Enter' || event.key === 'Tab') choose(suggest.items[suggest.index]);
    else if (event.key === 'Escape') suggest = null;
    else return false;
    return true;
  }

  function openLink() {
    linkUrl = editor.getAttributes('link').href ?? '';
    linkError = '';
    linkOpen = true;
  }
  function applyLink(event) {
    event?.preventDefault();
    const href = normalizeUrl(linkUrl);
    if (href === null) { linkError = 'Use a web address, like https://example.com'; return; }
    if (!href) run((c) => c.extendMarkRange('link').unsetLink());
    else if (editor.state.selection.empty && !editor.isActive('link'))
      run((c) => c.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }));
    else run((c) => c.extendMarkRange('link').setLink({ href }));
    linkOpen = false;
  }
  function removeLink() {
    run((c) => c.extendMarkRange('link').unsetLink());
    linkOpen = false;
  }
  function pick(item) {
    run((c) => c.setEmoji(item.name));
    rememberEmoji(item.name);
    pickerOpen = false;
  }
  const focusNow = (el) => { el.focus(); };

  onMount(() => {
    editor = new Editor({
      element,
      extensions: editorExtensions({
        placeholder,
        onSubmit: () => onsubmit(),
        onLink: () => openLink(),
        suggestion: {
          items: ({ query }) => suggestionItems(query),
          render: () => ({ onStart: show, onUpdate: show, onKeyDown: ({ event }) => suggestKey(event), onExit: () => { suggest = null; } }),
        },
      }),
      // Anything typed into the stand-in textarea is kept exactly as typed.
      content: plainTextDoc(markdown),
      editorProps: { attributes: { class: 'rich-input', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label } },
      onTransaction: () => { tick++; },
      onUpdate: ({ editor }) => { emitted = editor.getMarkdown(); markdown = emitted; },
    });
    emitted = markdown ? editor.getMarkdown() : '';
    markdown = emitted;
    if (autofocus) editor.commands.focus('end');
    return () => editor.destroy();
  });

  // The parent changed the text (cleared it after posting).
  $effect(() => {
    if (editor && markdown !== emitted) {
      emitted = markdown;
      editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
    }
  });
</script>

<svelte:window onpointerdown={(e) => { if (pickerOpen && !root.contains(e.target)) pickerOpen = false; }} />

<div class="rich-editor" class:over={length > maxlength} bind:this={root}>
  <div class="rich-toolbar" role="toolbar" aria-label="Formatting">
    <button type="button" title="Bold (Ctrl+B)" aria-label="Bold" aria-pressed={is('bold')} onmousedown={keep} onclick={() => run((c) => c.toggleBold())}><strong>B</strong></button>
    <button type="button" title="Italic (Ctrl+I)" aria-label="Italic" aria-pressed={is('italic')} onmousedown={keep} onclick={() => run((c) => c.toggleItalic())}><em>I</em></button>
    <button type="button" title="Bulleted list" aria-label="Bulleted list" aria-pressed={is('bulletList')} onmousedown={keep} onclick={() => run((c) => c.toggleBulletList())}>•≡</button>
    <button type="button" title="Numbered list" aria-label="Numbered list" aria-pressed={is('orderedList')} onmousedown={keep} onclick={() => run((c) => c.toggleOrderedList())}>1≡</button>
    <button type="button" title="Link (Ctrl+K)" aria-label="Link" aria-pressed={is('link')} onmousedown={keep} onclick={openLink}>🔗</button>
    <button type="button" title="Emoji" aria-label="Emoji" aria-expanded={pickerOpen} onmousedown={keep} onclick={() => (pickerOpen = !pickerOpen)}>😊</button>
  </div>
  {#if linkOpen}
    <div class="rich-link">
      <input type="url" bind:value={linkUrl} placeholder="https://…" aria-label="Link address" {@attach focusNow}
        onkeydown={(e) => { if (e.key === 'Enter') applyLink(e); if (e.key === 'Escape') { e.preventDefault(); linkOpen = false; editor.commands.focus(); } }} />
      <button type="button" class="text-button" onclick={applyLink}>Apply</button>
      {#if is('link')}<button type="button" class="text-button" onclick={removeLink}>Remove link</button>{/if}
      <button type="button" class="text-button" onclick={() => { linkOpen = false; editor.commands.focus(); }}>Cancel</button>
      {#if linkError}<small role="alert">{linkError}</small>{/if}
    </div>
  {/if}
  {#if pickerOpen}
    <EmojiPicker onpick={pick} onclose={() => { pickerOpen = false; editor.commands.focus(); }} />
  {/if}
  <div bind:this={element}></div>
  {#if length > maxlength * 0.8}
    <p class="rich-count" aria-live="polite">{length.toLocaleString()} / {maxlength.toLocaleString()}</p>
  {/if}
  {#if suggest}
    <ul class="emoji-suggest" role="listbox" aria-label="Emoji suggestions" style:left="{suggest.rect?.left ?? 0}px" style:top="{(suggest.rect?.bottom ?? 0) + 4}px">
      {#each suggest.items as item, i (item.name)}
        <li role="option" aria-selected={i === suggest.index}>
          <button type="button" onmousedown={keep} onclick={() => choose(item)}>{item.emoji} <span>:{item.shortcodes[0]}:</span></button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
