<script>
  import Markdown from './Markdown.svelte';
  import { GUIDES } from '../help/index.js';
  import { navigate, parse } from '../lib/route.svelte.js';

  // One guide: numbered steps, each with its screenshot and numbered markers.
  let { guide } = $props();
  const mcpUrl = `${location.origin}/mcp`;
  const fill = (text) => (text ?? '').replaceAll('{{MCP_URL}}', mcpUrl);
  const next = $derived(GUIDES[GUIDES.indexOf(guide) + 1]);
  // Steps with a `copy` value show it in a box with a Copy button.
  let copied = $state(null);
  async function copyText(i, text) {
    try { await navigator.clipboard.writeText(text); copied = i; setTimeout(() => (copied = null), 2000); } catch { copied = null; }
  }
  function go(e, to) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    navigate(to);
    scrollTo(0, 0);
  }
  // The Markdown renderer opens links in a new tab; links to our own pages
  // (/help/…, /contact) should open here instead.
  function internal(e) {
    const a = e.target.closest?.('a[href^="/"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    navigate(parse(a.getAttribute('href')));
    scrollTo(0, 0);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article class="guide" onclick={internal}>
  <a class="back-link" href="/help" onclick={(e) => go(e, { tab: 'help' })}>← All help</a>
  <h1>{guide.title}</h1>
  <Markdown class="guide-intro" text={fill(guide.intro)} />
  <ol class="guide-steps">
    {#each guide.steps as step, i (step.title)}
      <li class="guide-step">
        <h2><span class="step-number" aria-hidden="true">{i + 1}</span>{step.title}</h2>
        <Markdown class="guide-text" text={fill(step.text)} />
        {#if step.copy}
          <p class="mcp-url"><code>{fill(step.copy)}</code> <button class="outline-button" onclick={() => copyText(i, fill(step.copy))}>{copied === i ? 'Copied' : 'Copy'}</button></p>
        {/if}
        {#if step.image}
          <figure class="guide-shot">
            <picture>
              {#if step.imagePhone}<source media="(max-width: 760px)" srcset={step.imagePhone} />{/if}
              <img src={step.image} alt={step.title} loading="lazy" />
            </picture>
            <!-- With a phone screenshot, desktop markers hide on phones and the
                 phone markers (positioned for that image) show instead. -->
            {#each step.markers ?? [] as m (m.n)}
              <span class="shot-marker" class:wide-marker={step.imagePhone} style:left="{m.x}%" style:top="{m.y}%" aria-hidden="true">{m.n}</span>
            {/each}
            {#each step.markersPhone ?? [] as m (m.n)}
              <span class="shot-marker narrow-marker" style:left="{m.x}%" style:top="{m.y}%" aria-hidden="true">{m.n}</span>
            {/each}
          </figure>
        {/if}
      </li>
    {/each}
  </ol>
  {#if guide.outro}<Markdown class="guide-outro" text={fill(guide.outro)} />{/if}
  {#if next}<a class="outline-button next-guide" href={`/help/${next.slug}`} onclick={(e) => go(e, { tab: 'help', helpSlug: next.slug })}>Next: {next.title}</a>{/if}
</article>
