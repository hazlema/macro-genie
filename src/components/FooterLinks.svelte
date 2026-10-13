<script>
  import { navigate } from '../lib/route.svelte.js';
  const LINKS = [['Help', { tab: 'help' }, '/help'], ['Terms', { tab: 'page', page: 'terms' }, '/terms'], ['Refunds', { tab: 'page', page: 'refunds' }, '/refunds'], ['Privacy', { tab: 'page', page: 'privacy' }, '/privacy'], ['Contact', { tab: 'page', page: 'contact' }, '/contact']];
  function go(e, to) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    navigate(to);
    scrollTo(0, 0);
  }
</script>

<nav class="footer-links" aria-label="Help and policies">
  {#each LINKS as [label, to, href] (href)}<a {href} onclick={(e) => go(e, to)}>{label}</a>{/each}
</nav>
