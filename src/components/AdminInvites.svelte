<script>
  import { onMount } from 'svelte';
  import InviteBook from './InviteBook.svelte';
  import { api } from '../lib/account.svelte.js';
  import { findBlanks, inviteParts } from '../lib/invite-text.js';
  import { addressBook, channelLink, fillName } from '../lib/invite-contacts.js';

  // Invite emails, sent from the owner's Gmail with a one-time credit code.
  // [credits] and [redeem link] fill themselves in; any other [bracket] is a
  // blank, and Send waits until none are left.
  let invites = $state([]);
  let contacts = $state([]);
  let templates = $state([]);
  let templateId = $state(null);
  let to = $state('');
  let subject = $state('');
  let credits = $state(50);
  let body = $state('');
  let sending = $state(false);
  let notice = $state('');
  let error = $state('');
  let bookOpen = $state(false);
  let naming = $state(false);
  let name = $state('');
  let loaded = $state(false);
  // A template just loaded (or an invite just went out): the yellow marks in
  // the preview show what to fill, but the warnings wait until you edit.
  let fresh = $state(true);
  // The subject and message are still the template's (bar a filled-in name).
  let untouched = true;

  const template = $derived(templates.find((t) => t.id === templateId));
  const blanks = $derived([...new Set([...findBlanks(subject), ...findBlanks(body)])]);
  const hasLink = $derived(/\[\s*redeem\s+link\s*\]/i.test(body));
  const amountOk = $derived(Number.isInteger(credits) && credits >= 1 && credits <= 500);
  const canSend = $derived(!!to.trim() && !!subject.trim() && hasLink && amountOk && !blanks.length && !sending);
  const people = $derived(addressBook(contacts, invites));
  // The person in "To", if they're in the book, and the next one to invite.
  const person = $derived(people.find((p) => p.email.toLowerCase() === to.trim().toLowerCase()));
  const next = $derived(people.find((p) => p.status === 'new'));
  const personLink = $derived(channelLink(person?.channel));
  const preview = $derived(inviteParts(body, { credits: amountOk ? credits : '[credits]', link: `${location.origin}/redeem?code=…` }));

  // The book shows a cancel or forget at once, then re-reads the list: on the
  // live site that second request can take a moment while the function wakes.
  function changed(action, who) {
    const same = (x) => x.email.toLowerCase() === who?.email.toLowerCase();
    if (action === 'forget') { invites = invites.filter((i) => !same(i)); contacts = contacts.filter((c) => !same(c)); }
    if (action === 'cancel') invites = invites.map((i) => (i.id === who.invite.id ? { ...i, canceledAt: new Date().toISOString() } : i));
    return load();
  }

  // Their email goes in "To" and their name in [user]. An unedited message
  // starts again from the template, so picking someone else swaps the name;
  // after edits, only a [user] still there is filled.
  function pick(p) {
    if (untouched && template) { subject = template.subject; body = template.body; }
    to = p.email;
    subject = fillName(subject, p.name);
    body = fillName(body, p.name);
    notice = ''; error = '';
  }

  async function load() {
    const res = await api('/api/admin/invites');
    loaded = true;
    if (!res.ok) { error = res.error; return; }
    ({ invites, contacts, templates } = res.body);
  }

  function useTemplate(id) {
    templateId = id;
    const t = templates.find((x) => x.id === id);
    subject = t?.subject ?? '';
    body = t?.body ?? '';
    naming = false;
    fresh = true;
    untouched = true;
  }

  onMount(async () => {
    await load();
    if (templates.length) useTemplate(templates[0].id);
  });

  async function send(e) {
    e.preventDefault();
    if (!canSend) return;
    sending = true; error = ''; notice = '';
    const res = await api('/api/admin/invites', { method: 'POST', body: { to: to.trim(), subject, body, credits } });
    sending = false;
    if (!res.ok) { error = res.error; return; }
    notice = `Sent to ${to.trim()}.`;
    to = '';
    useTemplate(templateId);
    await load();
  }

  async function saveTemplate() {
    const label = name.trim();
    if (!label) return;
    error = ''; notice = '';
    const res = await api('/api/admin/templates', { method: 'POST', body: { name: label, subject, body } });
    if (!res.ok) { error = res.error; return; }
    await load();
    templateId = res.body.id;
    naming = false;
    notice = `Saved the “${label}” template.`;
  }

  async function deleteTemplate() {
    if (!template || !confirm(`Delete the “${template.name}” template?`)) return;
    const res = await api(`/api/admin/templates/${template.id}/delete`, { method: 'POST', body: {} });
    if (!res.ok) { error = res.error; return; }
    await load();
    useTemplate(templates[0]?.id ?? null);
  }
</script>

<section class="admin-invites">
  {#if !loaded}<p class="comments-empty">Loading…</p>{:else}
  <form class="contact-form invite-form" onsubmit={send} oninput={() => (fresh = false)}>
    <label class="note-field"><span>Template</span>
      <select value={templateId} onchange={(e) => useTemplate(Number(e.currentTarget.value))}>
        {#each templates as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
        {#if !templates.length}<option value={null}>No templates yet</option>{/if}
      </select>
    </label>
    <div class="note-field"><label for="invite-to">To</label>
      <div class="invite-to">
        <input id="invite-to" type="email" bind:value={to} maxlength="200" autocomplete="off" placeholder="name@example.com" />
        <button type="button" class="outline-button" onclick={() => (bookOpen = true)}>📖 Address book</button>
        {#if !to.trim() && next}<button type="button" class="outline-button" onclick={() => pick(next)}>Next: {next.name || next.email}</button>{/if}
      </div>
    </div>
    {#if person && (person.name || person.channel || person.description || person.status !== 'new')}
      <div class="invite-person" aria-label="Writing to">
        <p class="board-label">Writing to</p>
        <p><strong>{person.name || person.email}</strong>{#if person.channel}{' · '}{#if personLink}<a href={personLink} target="_blank" rel="noopener noreferrer">{person.channel}</a>{:else}{person.channel}{/if}{/if}</p>
        {#if person.description}<p>{person.description}</p>{/if}
        {#if person.status === 'used'}<p class="invite-warn">They already used an invite.</p>
        {:else if person.status === 'invited'}<p class="invite-warn">Already invited on {new Date(person.invite.sentAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.</p>{/if}
      </div>
    {/if}
    <label class="note-field"><span>Subject</span>
      <input bind:value={subject} maxlength="200" oninput={() => (untouched = false)} />
    </label>
    <label class="note-field"><span>Credits <small>1 to 500</small></span>
      <input class="invite-credits" type="number" min="1" max="500" step="1" bind:value={credits} />
    </label>
    <label class="note-field"><span>Message</span>
      <textarea bind:value={body} rows="16" oninput={() => (untouched = false)}></textarea>
    </label>

    <p class="note-field invite-preview-label">Preview <small>Yellow: fill these in. Green: filled in for you.</small></p>
    <div class="invite-preview">
      {#each preview as part, i (i)}{#if part.kind === 'plain'}{part.text}{:else}<mark class={`invite-${part.kind}`}>{part.text}</mark>{/if}{/each}
    </div>
    {#if blanks.length && !fresh}<p class="invite-warn" role="status">{blanks.length} {blanks.length === 1 ? 'blank' : 'blanks'} still to fill: {blanks.join(', ')}</p>{/if}
    {#if !hasLink && !fresh}<p class="invite-warn" role="status">Add [redeem link] so they can claim the credits.</p>{/if}

    {#if error}<p class="method-error" role="alert">{error}</p>{/if}
    {#if notice}<p class="post-note" role="status">{notice}</p>{/if}

    {#if naming}
      <div class="invite-to">
        <input aria-label="Template name" bind:value={name} maxlength="60" placeholder="Template name" />
        <button type="button" class="outline-button" disabled={!name.trim()} onclick={saveTemplate}>{templates.some((t) => t.name === name.trim()) ? 'Replace' : 'Save'}</button>
        <button type="button" class="text-button" onclick={() => (naming = false)}>Cancel</button>
      </div>
    {/if}
    <div class="invite-buttons">
      {#if template}<button type="button" class="text-button" onclick={deleteTemplate}>Delete template</button>{/if}
      <button type="button" class="outline-button" onclick={() => { naming = true; name = template?.name ?? ''; }}>Save as template</button>
      <button class="primary-button" disabled={!canSend}>{sending ? 'Sending…' : 'Send from your Gmail'}</button>
    </div>
  </form>
  {/if}
  <InviteBook bind:open={bookOpen} {people} onpick={pick} onchanged={changed} />
</section>
