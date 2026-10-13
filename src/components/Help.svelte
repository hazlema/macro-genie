<script>
  import HelpGuide from './HelpGuide.svelte';
  import { GUIDES, guideBySlug } from '../help/index.js';
  import { navigate } from '../lib/route.svelte.js';

  // /help: the hub, or one guide. An unknown guide shows the hub.
  let { slug = null } = $props();
  const guide = $derived(slug ? guideBySlug(slug) : undefined);
  function go(e, to) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    navigate(to);
    scrollTo(0, 0);
  }
</script>

<main id="results" tabindex="-1" class="help">
  {#if guide}
    {#key guide.slug}<HelpGuide {guide} />{/key}
  {:else}
    <h1>Help</h1>
    <p class="help-lede">Short, step-by-step guides with pictures. Start anywhere.</p>
    <ul class="help-cards">
      {#each GUIDES as g (g.slug)}
        <li>
          <a class="help-card" href={`/help/${g.slug}`} onclick={(e) => go(e, { tab: 'help', helpSlug: g.slug })}>
            <img src={g.thumb} alt="" loading="lazy" />
            <strong>{g.title}</strong>
            <span>{g.summary}</span>
          </a>
        </li>
      {/each}
    </ul>
    <p class="help-policies">
      <a href="/terms" onclick={(e) => go(e, { tab: 'page', page: 'terms' })}>Terms</a>
      <a href="/refunds" onclick={(e) => go(e, { tab: 'page', page: 'refunds' })}>Refunds</a>
      <a href="/privacy" onclick={(e) => go(e, { tab: 'page', page: 'privacy' })}>Privacy</a>
      <a href="/contact" onclick={(e) => go(e, { tab: 'page', page: 'contact' })}>Contact us</a>
    </p>
  {/if}
</main>
