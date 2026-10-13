<script>
  import { account } from '../lib/account.svelte.js';

  // The contact form. There's no public address; messages go to Admin → Inbox.
  const TOPICS = ['Question', 'Refund', 'Delete my data', 'Bug', 'Other'];
  let topic = $state('Question');
  let body = $state('');
  let email = $state('');
  let website = $state('');
  let sending = $state(false);
  let error = $state('');
  let sent = $state(false);
  let sentWithEmail = $state(false);

  async function send(e) {
    e.preventDefault();
    if (sending) return;
    sending = true; error = '';
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, body, email, website }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        error = res.status === 429
          ? 'You’ve sent a few messages already. Try again in a few minutes.'
          : (data?.error ?? 'Something went wrong. Try again.');
        return;
      }
      sentWithEmail = !!email.trim();
      sent = true;
    } catch {
      error = 'Couldn’t send. Check your connection and try again.';
    } finally {
      sending = false;
    }
  }
</script>

<main id="results" tabindex="-1" class="help contact">
  <h1>Contact us</h1>
  {#if sent}
    <p class="post-note" role="status">Thanks, your message was sent.{sentWithEmail ? ' We’ll reply by email.' : ''}</p>
  {:else}
    <p class="help-lede">Questions, refunds, deleting your data, or something broken: tell us here.</p>
    <form class="contact-form" onsubmit={send}>
      <label class="note-field"><span>Topic</span>
        <select bind:value={topic}>{#each TOPICS as t (t)}<option>{t}</option>{/each}</select>
      </label>
      <label class="note-field"><span>Message</span>
        <textarea bind:value={body} rows="6" minlength="10" maxlength="3000" required></textarea>
      </label>
      <label class="note-field"><span>Your email {#if account.signedIn}<small>Optional</small>{/if}</span>
        <input type="email" bind:value={email} maxlength="200" required={!account.signedIn} autocomplete="email" />
        {#if account.signedIn && !email.trim()}<small class="contact-hint">Without an email we can’t reply.</small>{/if}
      </label>
      <label class="contact-trap" aria-hidden="true">Website <input tabindex="-1" autocomplete="off" bind:value={website} /></label>
      {#if error}<p class="method-error" role="alert">{error}</p>{/if}
      <button class="primary-button" disabled={sending}>{sending ? 'Sending…' : 'Send message'}</button>
    </form>
  {/if}
</main>
