<script>
  import { renderMarkdown } from '../lib/markdown.js';

  // Community text (thread messages, comments). renderMarkdown escapes
  // everything and only emits a small allow-list of tags, so {@html} is safe.
  let { text = '', class: className = '' } = $props();
</script>

<div class="markdown {className}">{@html renderMarkdown(text)}</div>
