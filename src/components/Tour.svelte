<script>
  import { tick } from 'svelte';
  import { STEPS } from '../help/tour.js';
  import { tour, startTour, nextStep, backStep, stopTour, dismissOffer } from '../lib/tour.svelte.js';
  import { account } from '../lib/account.svelte.js';
  import { route, navigate } from '../lib/route.svelte.js';

  const PAD = 8;          // space between the anchor and the window edge
  const GAP = 12;         // space between the window and the card
  const CARD_ROOM = 220;  // room below the window before the card flips above

  let offerDialog;
  let card = $state();
  // The window around the current anchor, in viewport pixels; null = centred step.
  let box = $state(null);
  let below = $state(true);
  let anchors = [];
  let returnTo = null;

  const step = $derived(STEPS[tour.step]);
  const text = $derived(step && !account.signedIn && step.textSignedOut ? step.textSignedOut : step?.text);
  const last = $derived(tour.step === STEPS.length - 1);
  // Phones: the card drops to the bottom when the window is in the top half.
  const drop = $derived(!!box && box.top + box.height / 2 < innerHeight / 2);
  const cardStyle = $derived.by(() => {
    if (!box) return '';
    const width = Math.min(340, innerWidth - 24);
    const left = Math.max(12, Math.min(box.left, innerWidth - width - 12));
    return below
      ? `top:${box.top + box.height + GAP}px;left:${left}px;width:${width}px`
      : `bottom:${innerHeight - box.top + GAP}px;left:${left}px;width:${width}px`;
  });

  // The offer dialog follows tour.offer.
  $effect(() => {
    if (!offerDialog) return;
    if (tour.offer && !offerDialog.open) offerDialog.showModal();
    else if (!tour.offer && offerDialog.open) offerDialog.close();
  });

  function accept() {
    navigate({ tab: 'recipes' });
    scrollTo(0, 0);
    startTour();
  }

  // Leaving the Builder ends the tour.
  $effect(() => {
    if (tour.active && route.tab !== 'recipes') stopTour();
  });

  // Focus moves to the card while the tour runs, and back afterwards.
  $effect(() => {
    if (tour.active) returnTo = document.activeElement;
    else { returnTo?.focus?.(); returnTo = null; }
  });

  function elements(selector) {
    const list = Array.isArray(selector) ? selector : [selector];
    return list.flatMap((sel) => [...document.querySelectorAll(sel)]);
  }

  // The Builder renders after the food dataset arrives; wait up to 3 s.
  async function waitFor(selector) {
    for (let tries = 0; tries < 30; tries++) {
      const found = elements(selector);
      if (found.length) return found;
      await new Promise((r) => setTimeout(r, 100));
    }
    return [];
  }

  function measure() {
    if (!anchors.length) return;
    const rects = anchors.map((el) => el.getBoundingClientRect());
    const top = Math.min(...rects.map((r) => r.top)) - PAD;
    const left = Math.min(...rects.map((r) => r.left)) - PAD;
    const bottom = Math.max(...rects.map((r) => r.bottom)) + PAD;
    const right = Math.max(...rects.map((r) => r.right)) + PAD;
    box = { top, left, width: right - left, height: bottom - top };
    below = innerHeight - bottom >= CARD_ROOM;
  }

  // Each step: find its anchor, bring it on screen, measure, focus the card.
  $effect(() => {
    if (!tour.active) { anchors = []; box = null; return; }
    const s = STEPS[tour.step];
    let cancelled = false;
    anchors = [];
    box = null;
    (async () => {
      if (s.selector) {
        const found = await waitFor(s.selector);
        if (cancelled) return;
        if (!found.length) { tour.direction < 0 ? backStep() : nextStep(); return; }
        anchors = found;
        found[0].scrollIntoView({ block: 'center', behavior: 'auto' });
        await tick();
        requestAnimationFrame(() => { if (!cancelled) measure(); });
      }
      await tick();
      if (!cancelled) card?.focus();
    })();
    return () => { cancelled = true; };
  });

  // The window follows the anchor through resizes and scrolling.
  $effect(() => {
    if (!tour.active) return;
    addEventListener('resize', measure);
    addEventListener('scroll', measure, { passive: true });
    return () => {
      removeEventListener('resize', measure);
      removeEventListener('scroll', measure);
    };
  });

  function onKey(e) {
    if (!tour.active) return;
    if (e.key === 'Escape') { e.preventDefault(); stopTour(); }
    else if (e.key === 'ArrowRight' || (e.key === 'Enter' && e.target.tagName !== 'BUTTON')) { e.preventDefault(); nextStep(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); backStep(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<dialog class="dislikes login tour-offer" bind:this={offerDialog} onclose={dismissOffer} onclick={(e) => { if (e.target === offerDialog) dismissOffer(); }} aria-labelledby="tour-offer-title">
  <div class="dislikes-body">
    <div class="dislikes-head">
      <h2 id="tour-offer-title">Welcome{tour.offerName ? `, ${tour.offerName}` : ''}.</h2>
      <button class="dialog-close" aria-label="Close" onclick={dismissOffer}>×</button>
    </div>
    <p class="dislikes-intro">Want a two-minute tour of the Recipe Builder? You can run it later from Help.</p>
    <div class="tour-offer-actions">
      <button class="primary-button" onclick={accept}>Show me</button>
      <button class="outline-button" onclick={dismissOffer}>No thanks</button>
    </div>
  </div>
</dialog>

{#if tour.active && step}
  <div class="tour-dim" class:clear={!!box} aria-hidden="true"></div>
  {#if box}
    <div class="tour-window" style="top:{box.top}px;left:{box.left}px;width:{box.width}px;height:{box.height}px" aria-hidden="true"></div>
  {/if}
  <div class="tour-card" class:anchored={!!box} class:phone-bottom={drop} class:phone-top={!!box && !drop} style={cardStyle} role="dialog" aria-modal="true" aria-labelledby="tour-title" tabindex="-1" bind:this={card}>
    <p class="tour-step">{tour.step + 1} of {STEPS.length}</p>
    <h2 id="tour-title">{step.title}</h2>
    <p>{text}</p>
    <div class="tour-actions">
      {#if tour.step > 0}<button class="outline-button" onclick={backStep}>Back</button>{/if}
      <button class="primary-button" onclick={nextStep}>{last ? 'Start building' : 'Next'}</button>
      {#if !last}<button class="text-button" onclick={stopTour}>Skip</button>{/if}
    </div>
  </div>
{/if}
