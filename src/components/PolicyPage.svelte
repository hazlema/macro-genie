<script>
  import Markdown from './Markdown.svelte';
  import { POLICIES } from '../help/policies.js';

  import { navigate } from '../lib/route.svelte.js';

  let { page } = $props();
  const policy = $derived(POLICIES[page]);
  // Links to our own pages open here, not in a new tab.
  function internal(e) {
    const a = e.target.closest?.('a[href^="/"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    const [section, slug] = a.getAttribute('href').split('/').filter(Boolean);
    navigate(section === 'help' ? { tab: 'help', helpSlug: slug ?? null } : { tab: 'page', page: section });
    scrollTo(0, 0);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<main id="results" tabindex="-1" class="help policy" onclick={internal}>
  <h1>{policy.title}</h1>
  <p class="help-lede">Last updated {policy.updated}</p>
  <Markdown class="policy-body" text={policy.body} />
</main>
