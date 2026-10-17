<script>
  import FooterLinks from './FooterLinks.svelte';
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
            <div class="help-card-text">
              <p class="help-card-meta"><span class={`help-category ${g.category.toLowerCase()}`}>{g.category}</span>{#if g.startHere}<span class="help-start">Start here</span>{/if}</p>
              <strong>{g.cardTitle ?? g.title}</strong>
              <span class="help-card-summary">{g.summary}</span>
            </div>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
  <footer><p>Food by your numbers. <span>Nutrition from the USDA SR Legacy database.</span></p><FooterLinks /></footer>
</main>
