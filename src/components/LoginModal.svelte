<script>
  import { account, signInWithGoogle } from '../lib/account.svelte.js';

  let dialog;
  let buttonSlot = $state();
  let error = $state('');
  let loading = $state(false);

  $effect(() => {
    if (account.loginOpen && !dialog.open) { error = ''; dialog.showModal(); }
    else if (!account.loginOpen && dialog.open) dialog.close();
  });

  // Google's script draws its own "Sign in with Google" button into the slot.
  let script;
  function loadGoogle() {
    script ??= new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = 'https://accounts.google.com/gsi/client';
      tag.async = true;
      tag.onload = resolve;
      tag.onerror = () => { script = null; reject(); };
      document.head.append(tag);
    });
    return script;
  }
  $effect(() => {
    if (!account.loginOpen || !buttonSlot) return;
    if (!account.googleClientId) { error = 'Sign-in isn’t set up on this site yet.'; return; }
    loading = true;
    loadGoogle().then(() => {
      window.google.accounts.id.initialize({
        client_id: account.googleClientId,
        callback: async ({ credential }) => { error = await signInWithGoogle(credential); },
      });
      window.google.accounts.id.renderButton(buttonSlot, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 280 });
    }).catch(() => {
      error = 'Google sign-in couldn’t load. Check your connection or ad blocker, then try again.';
    }).finally(() => { loading = false; });
  });
</script>

<dialog class="dislikes login" bind:this={dialog} onclose={() => account.loginOpen = false} onclick={(e) => { if (e.target === dialog) account.loginOpen = false; }} aria-labelledby="login-title">
  <div class="dislikes-body">
    <div class="dislikes-head">
      <h2 id="login-title">Login / Create Account</h2>
      <button class="dialog-close" aria-label="Close" onclick={() => account.loginOpen = false}>×</button>
    </div>
    <p class="dislikes-intro">The Recipe Builder runs on credits: each idea or written recipe uses one. New accounts start with 10 free.</p>
    <div class="google-slot" bind:this={buttonSlot} aria-busy={loading}></div>
    {#if error}<p class="method-error" role="alert">{error}</p>{/if}
    <p class="dislike-warning">We keep only your first name and your credit balance. No email, no password. Food search stays free without an account.</p>
  </div>
</dialog>
