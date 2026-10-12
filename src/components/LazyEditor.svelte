<script>
  import { onMount } from 'svelte';

  // Shows a plain textarea straight away and swaps in the rich editor once
  // its code (Tiptap, emoji list) has loaded. If loading fails, the textarea
  // stays, so people can still post.
  let { markdown = $bindable(''), maxlength = 1000, placeholder = '', label = '', rows = 2, onsubmit = () => {} } = $props();
  let RichEditor = $state(null);

  onMount(() => {
    import('./RichEditor.svelte').then((m) => (RichEditor = m.default)).catch(() => {});
  });

  const keydown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onsubmit(); }
  };
</script>

{#if RichEditor}
  <RichEditor bind:markdown {maxlength} {placeholder} {label} {onsubmit} />
{:else}
  <textarea class="rich-fallback" bind:value={markdown} {maxlength} {rows} {placeholder} aria-label={label} onkeydown={keydown}></textarea>
{/if}
