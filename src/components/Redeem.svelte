<script>
  import FooterLinks from './FooterLinks.svelte';
  import { onMount } from 'svelte';
  import { account, api } from '../lib/account.svelte.js';
  import { navigate } from '../lib/route.svelte.js';
  import { normalizeCode } from '../lib/invite-text.js';

  // Redeem an invite code. Only reached from the link in an invite email,
  // which carries ?code=…; the address keeps it through sign-in.
  let code = $state('');
  let working = $state(false);
  let error = $state('');
  let done = $state(null);

  onMount(() => {
    code = new URLSearchParams(location.search).get('code') ?? '';
  });

  async function redeem(e) {
    e.preventDefault();
    working = true; error = '';
    const res = await api('/api/credits/redeem', { method: 'POST', body: { code } });
    working = false;
    if (!res.ok) { error = res.error; return; }
    history.replaceState({}, '', '/redeem');
    account.credits = res.body.credits;
    done = res.body;
  }

  function go(e, to) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    navigate(to);
    scrollTo(0, 0);
  }
</script>

<main id="results" tabindex="-1" class="help redeem-page">
  <h1>Redeem your credits</h1>
  {#if done}
    <p class="help-lede"><strong>{done.added} credits added.</strong> You now have {done.credits}.</p>
    <p><a href="/builder" onclick={(e) => go(e, { tab: 'recipes' })}>Try the Recipe Builder →</a></p>
  {:else}
    <form class="contact-form" onsubmit={redeem}>
      <label class="note-field"><span>Your invite code</span>
        <input bind:value={code} autocomplete="off" spellcheck="false" placeholder="Paste the code or link from your email" />
      </label>
      {#if !account.loaded}
        <p class="post-note">Checking your sign-in…</p>
      {:else if !account.signedIn}
        <p>First, sign in or make an account. It's free and only takes your Google sign-in.</p>
        <p><button type="button" class="primary-button" onclick={() => (account.loginOpen = true)}>Sign in with Google</button></p>
      {:else}
        <p><button class="primary-button" disabled={working || !normalizeCode(code)}>{working ? 'Redeeming…' : 'Redeem'}</button></p>
      {/if}
      {#if error}<p class="method-error" role="alert">{error}</p>{/if}
    </form>
  {/if}
  <footer><p>Food by your numbers. <span>Nutrition from the USDA SR Legacy database.</span></p><FooterLinks /></footer>
</main>
