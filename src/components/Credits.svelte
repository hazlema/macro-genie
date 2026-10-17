<script>
  import FooterLinks from './FooterLinks.svelte';
  import { onMount } from 'svelte';
  import { account, api, refreshAccount } from '../lib/account.svelte.js';
  import { navigate } from '../lib/route.svelte.js';

  // Get more credits. Buying goes to Stripe's checkout page, which sends people
  // back here with ?session=… (paid) or ?cancelled=1.
  let packs = $state([]);
  let open = $state(true);
  let buying = $state('');
  let confirming = $state(false);
  let notice = $state('');
  let error = $state('');
  let notAdded = $state(false);

  const price = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
  const each = (p) => `${Math.round(p.cents / p.credits)}¢ per credit`;

  onMount(async () => {
    const query = new URLSearchParams(location.search);
    const session = query.get('session');
    if (session || query.has('cancelled')) history.replaceState({}, '', '/credits');
    if (query.has('cancelled')) notice = 'Checkout cancelled. You weren’t charged.';
    const list = await api('/api/credits/packs');
    if (list.ok) ({ packs, open } = list.body);
    else error = list.error;
    if (session) await confirm(session);
  });

  async function confirm(sessionId) {
    confirming = true;
    const res = await api('/api/credits/confirm', { method: 'POST', body: { sessionId } });
    confirming = false;
    if (!res.ok) { error = res.error; return; }
    await refreshAccount();
    if (res.body.paid && !res.body.purchased) { notAdded = true; return; }
    notice = res.body.paid
      ? `Added ${res.body.purchased} credits. You now have ${account.credits}.`
      : 'Your payment is processing. Credits appear as soon as Stripe confirms it.';
  }

  async function buy(pack) {
    if (!account.signedIn) { account.loginOpen = true; return; }
    buying = pack.id; error = ''; notice = ''; notAdded = false;
    const res = await api('/api/credits/checkout', { method: 'POST', body: { pack: pack.id } });
    if (!res.ok) { buying = ''; error = res.error; return; }
    location.assign(res.body.url);
  }

  function go(e, to) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    navigate(to);
    scrollTo(0, 0);
  }
</script>

<!-- Back from Stripe restores this page from the browser's cache; reset the buttons. -->
<svelte:window onpageshow={() => (buying = '')} />

<main id="results" tabindex="-1" class="help credits-page">
  <h1>Get more credits</h1>
  {#if account.signedIn}
    <p class="help-lede">You have <strong>{account.credits}</strong> {account.credits === 1 ? 'credit' : 'credits'}.</p>
  {:else}
    <p class="help-lede">Credits pay for recipe ideas and written recipes. Sign in to buy them.</p>
  {/if}
  {#if confirming}<p class="post-note" role="status">Confirming your payment…</p>{/if}
  {#if notice}<p class="post-note" role="status">{notice}</p>{/if}
  {#if error}<p class="method-error" role="alert">{error}</p>{/if}
  {#if notAdded}<p class="method-error" role="alert">We got your payment but couldn’t add the credits automatically. <a href="/contact" onclick={(e) => go(e, { tab: 'page', page: 'contact' })}>Contact us</a> and we’ll sort it out.</p>{/if}
  {#if account.suspended}<p class="method-error">Your account is suspended, so you can’t buy credits.</p>{/if}
  {#if !open}<p class="post-note" role="status">Buying credits opens soon. Until then, these are the packs and prices.</p>{/if}
  <ul class="pack-list">
    {#each packs as pack (pack.id)}
      <li>
        <button class="pack-card" onclick={() => buy(pack)} disabled={!open || !!buying || account.suspended}>
          <strong>{pack.credits} credits</strong>
          <span class="pack-price">{price(pack.cents)}</span>
          <span class="pack-each">{each(pack)}</span>
          <span class="pack-action">{!open ? 'Opens soon' : buying === pack.id ? 'Opening checkout…' : account.signedIn ? 'Buy' : 'Sign in to buy'}</span>
        </button>
      </li>
    {/each}
  </ul>
  <p class="credits-note">1 credit = 1 recipe idea or 1 written recipe. Credits don’t expire. Unused credits from a pack can be refunded within 30 days: see <a href="/refunds" onclick={(e) => go(e, { tab: 'page', page: 'refunds' })}>Refunds</a> and <a href="/terms" onclick={(e) => go(e, { tab: 'page', page: 'terms' })}>Terms</a>. Payment is by card through Stripe; we never see your card.</p>
  <footer><p>Food by your numbers. <span>Nutrition from the USDA SR Legacy database.</span></p><FooterLinks /></footer>
</main>
