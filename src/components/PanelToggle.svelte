<script>
  // Phones only: the button that opens a page's macro panel. It looks like a
  // card you can tap and says what's set, so it can't pass for a heading.
  let { title, summary = '', hint = '', open = $bindable(false), controls, ontoggle = () => {} } = $props();
</script>

<button type="button" class="panel-toggle" aria-expanded={open} aria-controls={controls} onclick={() => { open = !open; ontoggle(open); }}>
  <span class="panel-toggle-text"><strong>{title}</strong><small class:set={summary}>{summary || hint}</small></span>
  <svg class="panel-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
</button>
