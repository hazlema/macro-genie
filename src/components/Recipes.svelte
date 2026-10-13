<script>
  import FooterLinks from './FooterLinks.svelte';
  import RangeTable from './RangeTable.svelte';
  import RecipeCard from './RecipeCard.svelte';
  import DislikeSummary from './DislikeSummary.svelte';
  import PanelToggle from './PanelToggle.svelte';
  import { panelStartsOpen, rememberPanelUsed, showResults } from '../lib/panel.js';
  import { NUTRIENTS, PRESETS, emptyRanges, formatAmount, rangeSummary, swapOptions } from '../lib/foods.js';
  import { solveRecipe, isDisliked, expandDislikes, splitFoodList, missingRequests } from '../lib/recipe.js';
  import { structuredText } from '../lib/scale.js';
  import { prefs, save, saveRecipe } from '../lib/prefs.svelte.js';
  import { printRecipe } from '../lib/print.svelte.js';
  import { account, noteResponse } from '../lib/account.svelte.js';

  let { foods, oneditdislikes, onviewsaved } = $props();

  // Matches the four variations the server asks for, in order.
  const ANGLES = ['A bake or gratin', 'A skillet dish', 'A soup or stew', 'Something unexpected'];
  // How well the ingredients go together, as Claude judged the idea.
  const PAIRING = {
    great: 'Sounds delicious!',
    mixed: 'Warning: Some ingredients might not work well together',
    clashes: 'Warning: These ingredients don’t typically work well together',
  };

  const draft = prefs.draft ?? {};
  const byId = $derived(new Map(foods.map(f => [f.id, f])));
  let servings = $state(Number.isInteger(draft.servings) && draft.servings >= 1 && draft.servings <= 50 ? draft.servings : 4);
  let ranges = $state({ ...emptyRanges(), ...(draft.ranges ?? {}) });
  let wantText = $state(typeof draft.wantText === 'string' ? draft.wantText : '');
  let note = $state(typeof draft.note === 'string' ? draft.note : '');
  let ideas = $state(Array.isArray(draft.ideas) ? draft.ideas.filter(i => i?.status === 'ready' && Array.isArray(i.idea?.ingredients)) : []);
  let chosen = $state(Array.isArray(draft.chosen?.items) ? draft.chosen : null);
  // The written recipe: structured (version 2), so it can be shown for any servings.
  let written = $state(draft.written?.version === 2 ? draft.written : null);
  // How many ideas a run makes; each one uses a credit.
  let ideaCount = $state(Number.isInteger(draft.ideaCount) && draft.ideaCount >= 1 && draft.ideaCount <= 4 ? draft.ideaCount : 4);
  let viewServings = $state(draft.written?.version === 2 ? (draft.viewServings ?? draft.written.servings) : 4);
  // Which amounts the written recipe was for, and whether it's been saved.
  let methodFor = $state(typeof draft.methodFor === 'string' ? draft.methodFor : '');
  let savedId = $state(typeof draft.savedId === 'string' ? draft.savedId : null);
  let saveError = $state('');
  let writing = $state(false);
  let methodError = $state('');
  let activePreset = $state('');
  // Phones: open for a first-time visitor with no targets saved yet.
  let mobileOpen = $state(panelStartsOpen(Object.values(draft.ranges ?? {}).filter((r) => r?.min != null || r?.max != null).length));
  let copied = $state(false);
  // Swapping one recipe ingredient for another food, e.g. feta for cheddar.
  let swapping = $state(null);
  let swapQuery = $state('');
  let batch = 0;

  $effect(() => {
    prefs.draft = $state.snapshot({ servings, ranges, wantText, note, ideas: ideas.filter(i => i.status === 'ready'), chosen, written, viewServings, methodFor, savedId, ideaCount });
    save();
  });

  const activeCount = $derived(Object.values(ranges).filter(r => r.min != null || r.max != null).length);
  const want = $derived(splitFoodList(wantText));
  const wantDisliked = $derived(want.filter(w => isDisliked({ name: w }, prefs.dislikes)));
  const generating = $derived(ideas.some(i => i.status === 'pending'));
  const readyIdeas = $derived(ideas.filter(i => i.status === 'ready'));

  // Ideas are re-sized against the current targets, so cards stay honest when targets change.
  function size(list) {
    try {
      const items = list.filter(i => byId.has(i.id)).map(i => ({ food: byId.get(i.id), grams: i.grams, required: i.required }));
      return solveRecipe(items.filter(i => !isDisliked(i.food, prefs.dislikes)), { servings, ranges });
    } catch { return null; }
  }
  const sizedIdeas = $derived(ideas.map(i => i.status === 'ready' ? size(i.idea.ingredients.map(x => ({ id: x.id, grams: x.suggested, required: x.required }))) : null));
  const fitCount = $derived(sizedIdeas.filter(s => s?.fits).length);

  const recipe = $derived.by(() => {
    if (!chosen) return { solved: null, error: '' };
    try {
      const items = chosen.items.filter(i => byId.has(i.id) && !isDisliked(byId.get(i.id), prefs.dislikes)).map(i => ({ food: byId.get(i.id), grams: i.grams, required: i.required }));
      return { solved: solveRecipe(items, { servings, ranges }), error: '' };
    } catch (error) { return { solved: null, error: error.message }; }
  });
  // Similar foods first ("Beef, ground, …" for ground beef); typing searches everything.
  const swapMatches = $derived(!swapping || !byId.get(swapping) ? [] :
    swapOptions(foods, byId.get(swapping), swapQuery, { exclude: expandDislikes(prefs.dislikes), limit: 48 })
      .filter(f => !chosen?.items.some(i => i.id === f.id)).slice(0, 40));
  function startSwap(item) {
    swapping = item.id;
    swapQuery = '';
  }
  function swapTo(item, food) {
    item.id = food.id;
    swapping = null;
    // A written recipe would now name the old food; rewrite it to match
    // (one credit). Without a credit it's marked out of date instead.
    if (written && !writing && account.signedIn && account.credits >= 1) writeRecipe();
  }
  const focusOnMount = (node) => { node.focus(); node.select(); };

  const solvedById = $derived(new Map((recipe.solved?.amounts ?? []).map(a => [a.food.id, a])));

  function applyPreset(preset) { ranges = { ...emptyRanges(), ...structuredClone(preset.ranges) }; activePreset = preset.name; }
  function startOver() { batch++; wantText = ''; note = ''; ideas = []; chosen = null; written = null; savedId = null; ranges = emptyRanges(); servings = 4; activePreset = ''; }

  function activeRanges() {
    return Object.fromEntries(Object.entries($state.snapshot(ranges)).flatMap(([k, r]) => {
      const out = {};
      if (r.min != null) out.min = r.min;
      if (r.max != null) out.max = r.max;
      return Object.keys(out).length ? [[k, out]] : [];
    }));
  }

  // For replies without our own error message: Netlify's rate limit page,
  // a function cut off at its time limit, or the service missing locally.
  const unreachable = (status) =>
    status === 404 ? 'The recipe service isn’t running here. Use npm run dev with a key in .env to try it locally.'
    : status === 429 ? 'You’re making requests faster than the site allows. Wait a minute, then try again.'
    : status === 502 || status === 504 ? 'This took too long. Try again.'
    : 'The recipe service had a problem. Try again.';

  async function requestIdea(angle, token) {
    const asked = want;
    ideas[angle] = { status: 'pending' };
    try {
      const res = await fetch('/api/idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servings, ranges: activeRanges(), want: asked, note: note.trim(), dislikes: $state.snapshot(prefs.dislikes), angle }),
      });
      const body = await res.json().catch(() => null);
      noteResponse(res, body);
      if (token !== batch) return;
      ideas[angle] = !res.ok || !body || body.error
        ? { status: 'error', error: body?.error ?? unreachable(res.status) }
        : { status: 'ready', idea: body, want: asked };
    } catch {
      if (token === batch) ideas[angle] = { status: 'error', error: 'Couldn’t reach the recipe service. Check your connection and try again.' };
    }
  }
  function getIdeas() {
    const token = ++batch;
    if (!account.signedIn) { account.loginOpen = true; return; }
    ideas = ANGLES.slice(0, ideaCount).map(() => ({ status: 'pending' }));
    ideas.forEach((_, angle) => requestIdea(angle, token));
  }

  function choose(idea) {
    chosen = { name: idea.name, description: idea.description, seasonings: idea.seasonings, items: idea.ingredients.map(i => ({ id: i.id, grams: i.suggested, required: i.required })) };
    written = null;
    methodError = '';
    savedId = null;
    requestAnimationFrame(() => document.getElementById('your-recipe')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  }

  async function writeRecipe() {
    const s = recipe.solved;
    if (!s || writing) return;
    writing = true; methodError = ''; savedId = null; saveError = '';
    const key = amountsKey;
    try {
      const res = await fetch('/api/recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: chosen.name, description: chosen.description ?? '', servings, seasonings: chosen.seasonings ?? [], dislikes: $state.snapshot(prefs.dislikes), ingredients: s.amounts.filter(a => a.grams > 0).map(a => ({ id: a.food.id, grams: a.grams })) }),
      });
      const body = await res.json().catch(() => null);
      noteResponse(res, body);
      if (!res.ok || body?.version !== 2) {
        methodError = body?.error ?? unreachable(res.status);
        return;
      }
      const { usage, ...fresh } = body;
      written = fresh;
      viewServings = fresh.servings;
      methodFor = key;
      // A swap can make the old name wrong ("…and Feta"); Claude renames it then.
      chosen.name = fresh.name;
      chosen.description = fresh.description;
    } catch {
      methodError = 'The connection dropped while writing. Try again.';
    } finally { writing = false; }
  }

  // The amounts the recipe would be written for; a change makes a written recipe stale.
  const amountsKey = $derived(recipe.solved ? JSON.stringify([servings, recipe.solved.amounts.filter(a => a.grams > 0).map(a => [a.food.id, a.grams])]) : '');
  const stale = $derived(!!written && !writing && methodFor !== amountsKey);
  // While the steps are being written, the card shows the ingredients by weight.
  const draftCard = $derived(chosen && recipe.solved ? {
    version: 2,
    name: chosen.name,
    description: chosen.description ?? '',
    servings,
    gramsPerServing: recipe.solved.totalGrams / servings,
    perServing: recipe.solved.perServing,
    ingredients: recipe.solved.amounts.filter(a => a.grams > 0).map(a => ({ id: a.food.id, name: a.food.name, label: a.food.name, grams: a.grams, qty: null, unit: '', prep: '' })),
    seasonings: chosen.seasonings ?? [],
    steps: [],
    tip: '',
  } : null);
  const card = $derived(writing || !written ? draftCard : written);

  async function copyRecipe() {
    try { await navigator.clipboard.writeText(structuredText(written, viewServings, NUTRIENTS)); copied = true; setTimeout(() => copied = false, 2000); } catch { copied = false; }
  }
  function saveCard() {
    savedId = saveRecipe({ ...$state.snapshot(written), shownServings: viewServings });
    saveError = savedId ? '' : 'This browser wouldn’t store the recipe. Private browsing can block saving; copy or print it instead.';
  }

  function kitchen(food, grams) {
    const m = food.serving.label.match(/^(\d*\.?\d+)\s+(.+)$/);
    if (!m || !grams) return '';
    const qty = (grams / food.serving.grams) * Number(m[1]);
    const shown = qty >= 10 ? Math.round(qty) : Math.round(qty * 4) / 4;
    return shown ? `about ${formatAmount(shown)} ${m[2].replace(/\s+/g, ' ')}` : '';
  }
  function describe(miss) {
    const n = NUTRIENTS.find(x => x.key === miss.key);
    const gap = Math.abs(miss.value - miss.limit);
    return `${n.label.toLocaleLowerCase()} ${formatAmount(gap)} ${n.unit} ${miss.bound === 'max' ? 'over' : 'under'}`;
  }
  function meter(key) {
    const { min, max } = ranges[key];
    const limit = max ?? min;
    if (limit == null || limit === 0) return null;
    const value = recipe.solved.perServing[key];
    const shown = Math.round(value * 10) / 10;
    const over = (max != null && shown > max) || (min != null && shown < min);
    return { fill: Math.min(value / (limit * 1.25), 1), over, label: max != null ? `max ${formatAmount(max)}` : `min ${formatAmount(min)}` };
  }
</script>

<div class="workspace">
  <aside class:mobile-open={mobileOpen}>
    <PanelToggle title="Set your macros" summary={activeCount ? `Serves ${servings}: ${rangeSummary(ranges)}` : ''} hint={`Serves ${servings}. Protein, carbs, calories and more`} bind:open={mobileOpen} controls="dish-content" ontoggle={(open) => { if (!open) rememberPanelUsed(); }} />
    <div class="filter-content" id="dish-content">
      <div class="filter-heading">
        <h1>Your targets</h1>
        <div class="servings" role="group" aria-label="Servings">
          <button aria-label="Fewer servings" disabled={servings <= 1} onclick={() => servings--}>−</button>
          <span aria-live="polite">Serves {servings}</span>
          <button aria-label="More servings" disabled={servings >= 50} onclick={() => servings++}>+</button>
        </div>
      </div>
      <p class="filter-intro">For each serving. Leave blank for no limit.</p>
      <RangeTable bind:ranges error={recipe.error} onchange={() => activePreset = ''} />
      <p class="presets-label">A starting point</p>
      <div class="presets">
        {#each PRESETS as preset}<button class:chosen={activePreset === preset.name} aria-pressed={activePreset === preset.name} onclick={() => applyPreset(preset)}>{preset.name}</button>{/each}
      </div>
      <DislikeSummary onedit={oneditdislikes} />
      <button class="clear-button" onclick={startOver}>↺ <span>Start over</span></button>
      <button class="primary-button panel-done" onclick={() => { mobileOpen = false; showResults(); }}>Done</button>
      <div class="serving-note"><span class="note-icon" aria-hidden="true">i</span><p>Claude invents the dishes. Every amount and nutrition number is worked out from USDA data, never by the AI.</p></div>
    </div>
  </aside>

  <main id="results" tabindex="-1" class="dish">
    <section class="brief" aria-labelledby="brief-title">
      <h2 id="brief-title">What do you want to eat?</h2>
      <label class="note-field"><span>Foods you want in it <small>Optional</small></span><input bind:value={wantText} maxlength="300" placeholder="Eggs, pumpkin, onions" /></label>
      {#if wantDisliked.length}<p class="want-warning">{wantDisliked.join(', ')} {wantDisliked.length === 1 ? 'is' : 'are'} on your list of foods you won’t eat, so {wantDisliked.length === 1 ? 'it' : 'they'} won’t be used.</p>{/if}
      <label class="note-field"><span>Anything else? <small>Optional</small></span><input bind:value={note} maxlength="300" placeholder="Comfort food, ready in 30 minutes, no oven" /></label>
      <div class="brief-actions">
        {#if account.signedIn}
          <label class="idea-count"><span>Ideas</span><input type="range" min="1" max="4" step="1" bind:value={ideaCount} aria-valuetext={`${ideaCount} ideas, ${ideaCount} credits`} /><strong>{ideaCount}</strong></label>
          <button class="primary-button" onclick={getIdeas} disabled={generating || !!recipe.error || account.credits < ideaCount}>{generating ? 'Thinking up ideas…' : `Get ${ideaCount} ${readyIdeas.length ? 'new ' : ''}${ideaCount === 1 ? 'idea' : 'ideas'} · ${ideaCount} ${ideaCount === 1 ? 'credit' : 'credits'}`}</button>
          {#if account.credits < ideaCount}
            <span class="credit-short">Not enough credits: you have {account.credits}. {account.credits ? 'Try fewer ideas, or b' : 'B'}uying credits is coming soon.</span>
          {:else}
            <span>Ideas appear one by one, usually within half a minute.</span>
          {/if}
        {:else}
          <button class="primary-button" onclick={() => account.loginOpen = true}>Sign in to get ideas</button>
          <span>New accounts get 10 free credits: one per idea or written recipe.</span>
        {/if}
      </div>
    </section>

    {#if ideas.length}
      <section class="ideas" aria-labelledby="ideas-title">
        <div class="results-top">
          <div class="result-count" aria-live="polite" aria-atomic="true">
            <strong class:short={readyIdeas.length > 0 && activeCount > 0 && !fitCount}>{!readyIdeas.length ? '…' : activeCount ? fitCount : readyIdeas.length}</strong><span id="ideas-title">{activeCount ? `of ${ideas.length} ${ideas.length === 1 ? 'idea fits' : 'ideas fit'} your targets` : `${readyIdeas.length === 1 ? 'idea' : 'ideas'} ready`}</span>
          </div>
        </div>
        <ul class="idea-grid">
          {#each ideas as entry, i}
            {@const s = sizedIdeas[i]}
            <li class="idea" class:pending={entry.status === 'pending'} class:picked={entry.status === 'ready' && chosen?.name === entry.idea.name} aria-busy={entry.status === 'pending'}>
              {#if entry.status === 'pending'}
                <p class="idea-angle">{ANGLES[i]}</p>
                <div class="idea-shimmer" aria-hidden="true"><span></span><span></span><span></span></div>
                <p class="sr-only">Thinking up {ANGLES[i].toLocaleLowerCase()}</p>
              {:else if entry.status === 'error'}
                <p class="idea-angle">{ANGLES[i]}</p>
                <p class="idea-error">{entry.error}</p>
                <button class="outline-button" onclick={() => requestIdea(i, batch)}>Try again</button>
              {:else}
                <h3>{entry.idea.name}</h3>
                <p class="idea-description">{entry.idea.description}</p>
                {#if entry.idea.pairing}
                  <div class="pairing {entry.idea.pairing}">
                    <p class="pairing-label"><span class="pairing-dot" aria-hidden="true"></span>{PAIRING[entry.idea.pairing]}</p>
                    {#if entry.idea.pairingNote}<p class="pairing-note">{entry.idea.pairingNote}</p>{/if}
                  </div>
                {/if}
                {#if s}
                  {@const missing = missingRequests([...entry.idea.ingredients.map(x => x.name), ...entry.idea.ingredients.map(x => x.fulfills).filter(Boolean), ...(entry.idea.seasonings ?? [])], (entry.want ?? want).filter(w => !isDisliked({ name: w }, prefs.dislikes)))}
                  {#if missing.length}<p class="idea-fit short">Leaves out {missing.join(', ')}</p>{/if}
                  <p class="idea-fit" class:short={activeCount > 0 && !s.fits}>{!activeCount ? 'No targets set' : s.fits ? (activeCount === 1 ? 'Fits your target' : `Fits all ${activeCount} targets`) : `Close: ${s.misses.map(describe).join(', ')}`}</p>
                  <p class="idea-macros"><strong>{formatAmount(s.perServing.calories)}</strong> kcal<span class="separator">·</span><strong>{formatAmount(s.perServing.protein)}</strong> g protein<span class="separator">·</span><strong>{formatAmount(s.perServing.netCarbs)}</strong> g net carbs<span class="separator">·</span><strong>{formatAmount(s.perServing.fat)}</strong> g fat</p>
                  <ul class="idea-ingredients">
                    {#each s.amounts.filter(a => a.grams > 0) as a}<li><span>{a.grams} g</span> {a.food.name}</li>{/each}
                  </ul>
                {/if}
                <button class="outline-button" onclick={() => choose(entry.idea)}>{chosen?.name === entry.idea.name ? 'Chosen' : 'Cook this one'}</button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if chosen}
      <section class="your-recipe" id="your-recipe" aria-labelledby="recipe-title">
        <h2 id="recipe-title">{chosen.name}</h2>
        {#if chosen.description}<p class="recipe-description">{chosen.description}</p>{/if}
        <div class="results-context"><span>Amounts for the whole dish, serves {servings}</span><span class="hide-narrow">Change what you’d like; the fitted amount follows</span></div>
        <ul class="ingredients">
          {#each chosen.items as item, i (item.id)}
            {@const food = byId.get(item.id)}
            {@const solved = solvedById.get(item.id)}
            {@const changed = solved && solved.grams !== item.grams}
            {#if food}
              <li class="ingredient" class:dropped={solved?.grams === 0} class:blocked={isDisliked(food, prefs.dislikes)}>
                <div class="ingredient-name">
                  <h3>{food.name}</h3>
                  <p>{isDisliked(food, prefs.dislikes) ? 'On your list of foods you won’t eat. Left out.' : food.categoryName}<button class="swap-link" aria-expanded={swapping === item.id} onclick={() => swapping === item.id ? swapping = null : startSwap(item)}>{swapping === item.id ? 'Cancel swap' : 'Swap'}</button></p>
                </div>
                <label class="want"><span>You’d like</span><span class="gram-input"><input type="number" min="1" max="5000" step="1" inputmode="numeric" bind:value={item.grams} aria-label={`Grams of ${food.name} you'd like`} />g</span></label>
                <label class="must"><input type="checkbox" bind:checked={item.required} /> Must use</label>
                <div class="fitted">
                  {#if solved}
                    {#if changed}<s aria-hidden="true">{item.grams} g</s>{/if}
                    <strong class:cut={solved.grams < item.grams} class:raised={solved.grams > item.grams}>{solved.grams === 0 ? 'Left out' : `${solved.grams} g`}</strong>
                    <span>{kitchen(food, solved.grams)}</span>
                  {:else}
                    <strong class="idle">—</strong>
                  {/if}
                </div>
                <button class="remove" aria-label={`Remove ${food.name}`} onclick={() => chosen.items.splice(i, 1)}>×</button>
              </li>
              {#if swapping === item.id}
                <li class="swap-panel">
                  <label><span>Swap {food.name} for</span><input use:focusOnMount bind:value={swapQuery} placeholder="Pick a similar food below, or search all foods" onkeydown={(e) => { if (e.key === 'Escape') swapping = null; if (e.key === 'Enter' && swapMatches.length) swapTo(item, swapMatches[0]); }} /></label>
                  {#if swapMatches.length}
                    <p class="swap-heading">{swapQuery.trim().length >= 2 ? `Foods matching “${swapQuery.trim()}”` : 'Similar foods'}</p>
                    <ul class="swap-options" aria-label="Foods to swap in">
                      {#each swapMatches as option (option.id)}
                        <li><button onclick={() => swapTo(item, option)}>
                          <span class="swap-name">{option.name}</span>
                          <span class="swap-facts">Per 100 g: {formatAmount(option.per100g.calories)} kcal, {formatAmount(option.per100g.protein)} g protein, {formatAmount(option.per100g.netCarbs)} g net carbs, {formatAmount(option.per100g.fat)} g fat</span>
                        </button></li>
                      {/each}
                    </ul>
                  {:else if swapQuery.trim().length >= 2}
                    <p class="swap-none">No foods match “{swapQuery.trim()}”. Try a shorter word.</p>
                  {/if}
                  <p class="swap-hint">Keeps the amount; the dish is re-fitted to your targets.{written ? ' A written recipe is rewritten to match, using 1 credit.' : ''}</p>
                </li>
              {/if}
            {/if}
          {/each}
        </ul>
        {#if chosen.seasonings?.length}<p class="seasonings">Season with {chosen.seasonings.join(', ')}.</p>{/if}

        {#if recipe.solved}
          {@const s = recipe.solved}
          {#if !s.fits}
            <div class="verdict short" role="status">
              <h3>Closest match</h3>
              <p>Every target can’t be met with these foods. This version misses by the least: {s.misses.map(describe).join('; ')}.</p>
              <p class="verdict-help">Loosen that target, untick “Must use” on a food, or try another idea.</p>
            </div>
          {/if}
          <div class="per-serving">
            <h3>Each serving <span>{Math.round(s.totalGrams / s.servings).toLocaleString()} g each, {s.totalGrams.toLocaleString()} g in all</span></h3>
            <dl>
              {#each NUTRIENTS as n}
                {@const m = meter(n.key)}
                <div class:over={m?.over}>
                  <dt>{n.label}</dt>
                  <dd><strong>{formatAmount(s.perServing[n.key])}</strong> {n.unit}</dd>
                  {#if m}
                    <div class="meter" aria-hidden="true"><span style:width={`${m.fill * 100}%`}></span><i></i></div>
                    <small>{m.over ? 'Misses ' : ''}{m.label}</small>
                  {:else}
                    <small>No target</small>
                  {/if}
                </div>
              {/each}
            </dl>
          </div>

          <div class="method">
            {#if !written && !writing}
              <div class="write-recipe">
                <div>
                  <h3>Write the full recipe</h3>
                  <p>Claude writes the steps using exactly these amounts.</p>
                </div>
                {#if account.signedIn}
                  <button class="primary-button" onclick={writeRecipe} disabled={account.credits < 1}>Write the recipe · 1 credit</button>
                {:else}
                  <button class="primary-button" onclick={() => account.loginOpen = true}>Sign in to write it</button>
                {/if}
              </div>
            {:else}
              <RecipeCard recipe={card} bind:servings={viewServings} {writing} {stale} scalable={!stale}>
                {#if !writing}
                  {#if stale}
                    <p class="stale-note">You changed the recipe since this was written, so the steps below are out of date.</p>
                    <button class="primary-button" onclick={writeRecipe} disabled={!account.signedIn || account.credits < 1}>Write it again · 1 credit</button>
                  {:else}
                    {#if savedId}
                      <button class="primary-button" onclick={onviewsaved}>Saved. View in Recipe Book</button>
                    {:else}
                      <button class="primary-button" onclick={saveCard}>Save recipe</button>
                    {/if}
                    <button class="outline-button" onclick={() => printRecipe($state.snapshot(written), viewServings)}>Print</button>
                    <button class="outline-button" onclick={copyRecipe}>{copied ? 'Copied' : 'Copy'}</button>
                    <button class="text-button" onclick={writeRecipe} disabled={!account.signedIn || account.credits < 1}>Write it again · 1 credit</button>
                  {/if}
                {/if}
              </RecipeCard>
              {#if saveError}<p class="method-error" role="alert">{saveError}</p>{/if}
            {/if}
            {#if methodError}<p class="method-error" role="alert">{methodError}</p>{/if}
          </div>
        {:else if recipe.error}
          <div class="empty-state"><h2>Check your targets</h2><p>{recipe.error}</p></div>
        {/if}
      </section>
    {/if}
    <footer><p>Food by your numbers. <span>Food search is free, no account needed.</span></p><p>Ideas come from Claude; amounts are sized to your targets from USDA data and rounded to the gram. Ingredients can shrink to nothing or grow to double what was suggested; “Must use” keeps at least a quarter.</p><FooterLinks /></footer>
  </main>
</div>
