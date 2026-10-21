<script>
  import { tick } from 'svelte';
  import { api } from '../lib/account.svelte.js';

  // Admin → Money: is the site paying for itself? The current month is live;
  // past months were saved when they ended. Amounts are cents from the server.
  let data = $state(null);
  let error = $state('');
  let actionError = $state(''); // save/delete failures, shown beside the form's buttons
  let formEl = $state(null);
  let busy = $state(false);
  let editing = $state(null); // a cost being edited, or a blank one being added

  const usd = (cents) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
  const signed = (cents) => `${cents >= 0 ? '+' : '−'}$${(Math.abs(cents) / 100).toFixed(2)}`;
  const cents = (n) => (n === null ? '—' : `${n.toFixed(2)}¢`);
  const label = (key) => new Date(`${key}-01T00:00:00Z`).toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const PERIOD = { monthly: 'monthly', yearly: 'yearly (counted in the month paid)', once: 'one-off' };
  const thisMonth = () => new Date().toISOString().slice(0, 7);

  async function load() {
    const res = await api('/api/admin/money');
    if (res.ok) { data = res.body; error = ''; }
    else error = res.error;
  }
  load();

  async function edit(cost) {
    actionError = '';
    editing = cost
      ? { ...cost, dollars: (cost.cents / 100).toFixed(2), ends: cost.ends ?? '' }
      : { id: null, name: '', dollars: '', period: 'monthly', starts: thisMonth(), ends: '' };
    await tick();
    formEl?.scrollIntoView({ block: 'nearest' });
    formEl?.querySelector('input')?.focus();
  }

  async function save(e) {
    e.preventDefault();
    busy = true;
    actionError = '';
    const body = {
      name: editing.name,
      cents: Math.round(Number(editing.dollars) * 100),
      period: editing.period,
      starts: editing.starts,
      ends: editing.period === 'once' ? null : editing.ends || null,
    };
    const res = editing.id
      ? await api(`/api/admin/money/costs/${editing.id}`, { method: 'PATCH', body })
      : await api('/api/admin/money/costs', { method: 'POST', body });
    busy = false;
    if (!res.ok) { actionError = res.error; return; }
    editing = null;
    await load();
  }

  async function remove(cost) {
    if (!confirm(`Delete “${cost.name}”? It comes off every month it covered, past ones too. To stop a bill from now on, set its end month instead.`)) return;
    actionError = '';
    const res = await api(`/api/admin/money/costs/${cost.id}`, { method: 'DELETE' });
    if (!res.ok) { actionError = res.error; return; }
    await load();
  }
</script>

{#snippet month(m, live)}
  <details class="money-month" open={live}>
    <summary>
      <span class="money-month-name">{label(m.month)}{live ? ' (so far)' : ''}</span>
      <span class="money-net" class:loss={m.netCents < 0}>{signed(m.netCents)}{m.complete ? '' : ' · incomplete'}</span>
    </summary>
    <table class="money-lines">
      <tbody>
        {#if m.sales}
          <tr><th scope="row">Credit sales <span class="money-note">{m.sales.count} {m.sales.count === 1 ? 'pack' : 'packs'}{#each Object.entries(m.sales.packs) as [pack, n] (pack)}{` · ${n} ${pack}`}{/each}</span></th><td>{usd(m.sales.cents)}</td></tr>
          <tr><th scope="row">Stripe fees</th><td>{usd(-m.stripeFeeCents)}</td></tr>
          {#if m.salesTaxCents}
            <tr><th scope="row">Sales tax <span class="money-note">Stripe files it</span></th><td>{usd(-m.salesTaxCents)}</td></tr>
          {/if}
          <tr><th scope="row">Refunds and chargebacks</th><td>{usd(-m.refundCents)}</td></tr>
        {:else}
          <tr><th scope="row" colspan="2" class="method-error">Couldn’t reach Stripe; try again.</th></tr>
        {/if}
        <tr>
          <th scope="row">AI (estimate) <span class="money-note">{m.ai.byStep.idea.jobs} ideas · {m.ai.byStep.recipe.jobs} recipes · {m.ai.byStep.moderation.jobs} checks</span></th>
          <td>{usd(-m.ai.estimateCents)}</td>
        </tr>
        <tr class="money-compare">
          <th scope="row">Anthropic actual</th>
          <td>
            {#if m.anthropic.status === 'ok'}{usd(-m.anthropic.cents)}
            {:else if m.anthropic.status === 'no_key'}<span class="money-note">Add ANTHROPIC_ADMIN_KEY to compare</span>
            {:else}<span class="method-error">Couldn’t reach Anthropic</span>{/if}
          </td>
        </tr>
        {#each m.fixed as f}
          <tr><th scope="row">{f.name}</th><td>{usd(-f.cents)}</td></tr>
        {/each}
        {#if m.netlifyPages}
          <tr class="money-compare">
            <th scope="row">Netlify pages (estimate) <span class="money-note">{m.netlifyPages.builds} built · ≈ {m.netlifyPages.credits} credits · not in net</span></th>
            <td>{usd(-Math.round(m.netlifyPages.cents))}</td>
          </tr>
        {/if}
        <tr class="money-total"><th scope="row">Net <span class="money-note">{m.aiCountedIn === 'actual' ? 'AI counted from Anthropic’s bill' : 'AI counted from the estimate'}</span></th><td>{signed(m.netCents)}</td></tr>
      </tbody>
    </table>
    <p class="money-stats">
      AI per credit spent: <strong>{cents(m.perCredit.aiCents)}</strong> ·
      earned per paid credit: <strong>{cents(m.perCredit.earnedCents)}</strong>
    </p>
    <p class="money-stats">
      Credits spent: {m.ai.free.credits} free ({usd(m.ai.free.cents)} AI) ·
      {m.ai.paid.credits} paid ({usd(m.ai.paid.cents)} AI)
    </p>
  </details>
{/snippet}

<section class="admin-money">
  {#if error}<p class="method-error" role="alert">{error}</p>{/if}
  {#if data === null}
    <p class="comments-empty">{error ? '' : 'Loading…'}</p>
  {:else}
    {@render month(data.current, true)}
    {#each data.saved as m (m.month)}
      {@render month(m, false)}
    {/each}

    <h2>Fixed costs</h2>
    {#if data.costs.length}
      <ul class="money-costs">
        {#each data.costs as c (c.id)}
          <li>
            <span><strong>{c.name}</strong> {usd(c.cents)} {PERIOD[c.period]}, from {label(c.starts)}{c.ends ? ` to ${label(c.ends)}` : ''}</span>
            <span class="money-cost-actions">
              <button class="outline-button" onclick={() => edit(c)}>Edit</button>
              <button class="outline-button" onclick={() => remove(c)}>Delete</button>
            </span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="comments-empty">No fixed costs yet. Add hosting, the domain, and any other bills.</p>
    {/if}

    {#if editing}
      <form class="money-cost-form" bind:this={formEl} onsubmit={save}>
        <label>Name <input bind:value={editing.name} maxlength="80" required placeholder="Netlify Pro" /></label>
        <label>Amount ($) <input bind:value={editing.dollars} inputmode="decimal" required placeholder="19.00" /></label>
        <label>How often
          <select bind:value={editing.period}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="once">One-off</option>
          </select>
        </label>
        <label>Starts <input type="month" bind:value={editing.starts} required /></label>
        {#if editing.period !== 'once'}
          <label>Ends (optional) <input type="month" bind:value={editing.ends} /></label>
        {/if}
        {#if actionError}<p class="method-error" role="alert">{actionError}</p>{/if}
        <div class="money-cost-actions">
          <button class="primary-button" disabled={busy}>{editing.id ? 'Save' : 'Add cost'}</button>
          <button type="button" class="outline-button" onclick={() => (editing = null)}>Cancel</button>
        </div>
      </form>
    {:else}
      {#if actionError}<p class="method-error" role="alert">{actionError}</p>{/if}
      <button class="outline-button" onclick={() => edit(null)}>Add a cost</button>
    {/if}
  {/if}
</section>
