# First-timer Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seven-step point-and-explain spotlight tour of the Recipe Builder, offered once to brand-new accounts and re-runnable from Help.

**Architecture:** Steps are plain data (`src/help/tour.js`). A tiny Svelte-runes store (`src/lib/tour.svelte.js`) holds `active/step/offer`. One component (`src/components/Tour.svelte`), mounted in `App.svelte`, renders the offer dialog and the overlay (dim + cutout window + card) and measures anchors from the live DOM. `Recipes.svelte` opens/closes its phone panel from the current step; `account.svelte.js` triggers the offer from the sign-in response's `isNew`.

**Tech Stack:** Svelte 5 runes, Vite, plain CSS in `src/style.css`, `node --test` for unit tests, Playwright MCP for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-17-first-timer-tour-design.md`

## Global Constraints

- No new dependencies.
- Copy lives only in `src/help/tour.js`; the component renders whatever is there.
- The tour spends no credits and types nothing into the page.
- Keyboard: Enter or → is Next, ← is Back, Esc is Skip. Card is `role="dialog"` with `aria-modal="true"`.
- Under `prefers-reduced-motion: reduce` nothing animates.
- Offer wording, exactly: title "Welcome, {name}." (or "Welcome." when the name is blank); body "Want a two-minute tour of the Recipe Builder? You can run it later from Help."; buttons **Show me** / **No thanks**.
- Help hub line, exactly: "New here? **Take the tour** of the Recipe Builder."
- Dev-server note: direct loads of `/help` or `/builder` on `npm run dev` serve a stale prerendered file. For browser checks always open `http://localhost:5173/` and move in-app (click tabs, or `history.pushState` + `dispatchEvent(new PopStateEvent('popstate'))`).
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not push.

## Review Focus

1. **Anchor not rendered yet** (Builder still says "Loading foods…"): the step must be skipped in the direction of travel, not hang. Pinned by the `direction` tests in Task 2 and the loading check in Task 6.
2. **Signed-out visitor on the Get ideas step**: the copy must tell them to sign in. Pinned by the `textSignedOut` test in Task 1.
3. **Enter pressed while a card button is focused**: must not advance twice. Pinned by the keyboard check in Task 6.
4. **User clicks a header tab mid-tour**: the overlay must disappear, not sit over the wrong page. Pinned by the route-change check in Task 6.
5. **Blank display name on the offer**: title must read "Welcome." with no dangling comma. Pinned by the `offerTour('')` test in Task 2.

---

### Task 1: The steps as data

**Files:**
- Create: `src/help/tour.js`
- Test: `tests/tour.test.js`

**Interfaces:**
- Produces: `export const STEPS` — array of `{ title: string, text: string, textSignedOut?: string, selector?: string | string[], panel?: 'open' | 'closed' }`.

- [ ] **Step 1: Write the failing test**

Create `tests/tour.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { STEPS } from "../src/help/tour.js";

test("the tour has seven steps with a title and text each", () => {
  assert.equal(STEPS.length, 7);
  for (const s of STEPS) {
    assert.ok(s.title && s.text, s.title);
    assert.ok(!("panel" in s) || s.panel === "open" || s.panel === "closed", s.title);
    if (s.selector) {
      const list = Array.isArray(s.selector) ? s.selector : [s.selector];
      assert.ok(list.length && list.every((x) => typeof x === "string" && x.trim()), s.title);
    }
  }
});

test("first and last steps are centred; the rest point at something", () => {
  assert.equal(STEPS[0].selector, undefined);
  assert.equal(STEPS[6].selector, undefined);
  for (const s of STEPS.slice(1, 6)) assert.ok(s.selector, s.title);
});

test("only the Get ideas step has signed-out copy, and it says to sign in", () => {
  const withAlt = STEPS.filter((s) => s.textSignedOut);
  assert.equal(withAlt.length, 1);
  assert.match(withAlt[0].title, /Get ideas/);
  assert.match(withAlt[0].textSignedOut, /Sign in/);
});

test("phone panel opens for the targets steps and closes after", () => {
  assert.equal(STEPS[1].panel, "open");
  assert.equal(STEPS[2].panel, "open");
  assert.equal(STEPS[3].panel, "closed");
  assert.equal(STEPS[4].panel, "closed");
  assert.equal(STEPS[5].panel, "closed");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/tour.test.js`
Expected: FAIL — `Cannot find module '../src/help/tour.js'`.

- [ ] **Step 3: Write the steps**

Create `src/help/tour.js`:

```js
// The first-timer tour of the Recipe Builder: point-and-explain, no input.
// `selector` is where the spotlight goes (one selector or several, boxed
// together); none means a centred card. `panel` opens or closes the phone
// targets panel so the anchor is on screen. `textSignedOut` replaces `text`
// for visitors without an account.
export const STEPS = [
  {
    title: "Welcome to the Recipe Builder.",
    text: "It makes a recipe from your numbers. Seven quick stops.",
  },
  {
    title: "Set targets per serving.",
    text: "Blank means no limit, and one or two is plenty: try at least 30 g protein and under 600 calories.",
    selector: ".range-table",
    panel: "open",
  },
  {
    title: "Not sure where to start?",
    text: "A preset fills the table for you. Change any number afterwards.",
    selector: ".presets",
    panel: "open",
  },
  {
    title: "Say what you'd like.",
    text: "Name foods you want in it, and anything else that matters: “comfort food, no oven”. Both are optional.",
    selector: ".brief .note-field",
    panel: "closed",
  },
  {
    title: "Get ideas.",
    text: "Each idea costs one credit; new accounts get 10. Ideas arrive within about half a minute, with every gram worked out from USDA data.",
    textSignedOut:
      "Sign in first; it's free. Each idea costs one credit; new accounts get 10. Ideas arrive within about half a minute, with every gram worked out from USDA data.",
    selector: ".brief-actions .primary-button",
    panel: "closed",
  },
  {
    title: "Then cook, keep, share.",
    text: "Choose an idea with Cook this one, then Write the recipe for the steps. Save it to your Recipe Book, and share it in the Community if it worked.",
    selector: [".tabs button:nth-child(2)", ".tabs button:nth-child(3)"],
    panel: "closed",
  },
  {
    title: "That's it.",
    text: "Run this again any time from Help.",
  },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/tour.test.js`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/help/tour.js tests/tour.test.js
git commit -m "$(cat <<'EOF'
Tour steps as data

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Tour state

**Files:**
- Create: `src/lib/tour.svelte.js`
- Test: `tests/tour.test.js` (append)

**Interfaces:**
- Consumes: `STEPS` from Task 1.
- Produces: `export const tour` = `$state({ active, step, direction, offer, offerName })`; `offerTour(name)`, `dismissOffer()`, `startTour()`, `nextStep()`, `backStep()`, `stopTour()`, `panelFor(step = tour.step)` → `'open' | 'closed' | null`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tour.test.js`. Svelte runes need the compiler, so `$state` is stubbed the same way `tests/route.test.js` does it:

```js
globalThis.$state = (v) => v;
const state = await import("../src/lib/tour.svelte.js").catch(() => ({}));
const skip = !state.tour && "needs the Svelte compiler";

test("start, next, back and stop stay in bounds", { skip }, () => {
  const { tour, startTour, nextStep, backStep, stopTour } = state;
  startTour();
  assert.equal(tour.active, true);
  assert.equal(tour.step, 0);
  backStep();
  assert.equal(tour.step, 0, "back from the first step stays put");
  assert.equal(tour.direction, -1);
  nextStep();
  assert.equal(tour.step, 1);
  assert.equal(tour.direction, 1);
  for (let i = 0; i < 5; i++) nextStep();
  assert.equal(tour.step, 6);
  assert.equal(tour.active, true);
  nextStep();
  assert.equal(tour.active, false, "next from the last step ends the tour");
  startTour();
  stopTour();
  assert.equal(tour.active, false);
});

test("the offer opens with a name, or without one, and closes on start", { skip }, () => {
  const { tour, offerTour, dismissOffer, startTour } = state;
  offerTour("Sam");
  assert.equal(tour.offer, true);
  assert.equal(tour.offerName, "Sam");
  dismissOffer();
  assert.equal(tour.offer, false);
  offerTour("");
  assert.equal(tour.offerName, "");
  startTour();
  assert.equal(tour.offer, false);
  assert.equal(tour.active, true);
});

test("panelFor reads the current step", { skip }, () => {
  const { tour, startTour, nextStep, panelFor } = state;
  startTour();
  assert.equal(panelFor(), null);
  nextStep();
  assert.equal(panelFor(), "open");
  assert.equal(panelFor(3), "closed");
  assert.equal(panelFor(99), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/tour.test.js`
Expected: the three new tests are reported as **skipped** with "needs the Svelte compiler", because the import of the not-yet-written module fails and the `.catch(() => ({}))` leaves `state.tour` undefined. (Once Step 3 exists they must run and pass, 0 skipped.)

- [ ] **Step 3: Write the store**

Create `src/lib/tour.svelte.js`:

```js
import { STEPS } from "../help/tour.js";

// The first-timer tour: whether it's running, which step shows, and whether
// the one-time offer dialog is open. `direction` lets the overlay skip a
// step whose anchor never renders without bouncing back and forth.
export const tour = $state({
  active: false,
  step: 0,
  direction: 1,
  offer: false,
  offerName: "",
});

export function offerTour(name = "") {
  tour.offerName = name;
  tour.offer = true;
}

export function dismissOffer() {
  tour.offer = false;
}

export function startTour() {
  tour.offer = false;
  tour.step = 0;
  tour.direction = 1;
  tour.active = true;
}

export function nextStep() {
  tour.direction = 1;
  if (tour.step >= STEPS.length - 1) stopTour();
  else tour.step += 1;
}

export function backStep() {
  tour.direction = -1;
  tour.step = Math.max(0, tour.step - 1);
}

export function stopTour() {
  tour.active = false;
}

// The phone-panel instruction for a step: "open", "closed", or null.
export function panelFor(step = tour.step) {
  return STEPS[step]?.panel ?? null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/tour.test.js`
Expected: 7 passing, 0 skipped.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tour.svelte.js tests/tour.test.js
git commit -m "$(cat <<'EOF'
Tour state: start, step, back, stop, and the one-time offer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Offer the tour to brand-new accounts

**Files:**
- Modify: `src/lib/account.svelte.js` (the `signInWithGoogle` function, lines 39–56)
- Test: `tests/tour.test.js` (append)

**Interfaces:**
- Consumes: `offerTour(name)` from Task 2.
- Produces: after a sign-in response with `isNew: true`, `tour.offer === true` and `tour.offerName` is the account's display name.

- [ ] **Step 1: Write the failing test**

Append to `tests/tour.test.js`:

```js
test("a brand-new account is offered the tour; a returning one is not", { skip }, async () => {
  const { account, signInWithGoogle } = await import("../src/lib/account.svelte.js");
  const { tour, dismissOffer } = state;
  const reply = (body) => async () => ({ ok: true, json: async () => body });
  dismissOffer();
  globalThis.fetch = reply({ signedIn: true, account: { displayName: "Sam", credits: 10 }, isNew: true });
  assert.equal(await signInWithGoogle("token"), "");
  assert.equal(account.signedIn, true);
  assert.equal(tour.offer, true);
  assert.equal(tour.offerName, "Sam");
  dismissOffer();
  globalThis.fetch = reply({ signedIn: true, account: { displayName: "Sam", credits: 4 }, isNew: false });
  await signInWithGoogle("token");
  assert.equal(tour.offer, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/tour.test.js`
Expected: the new test FAILS at `assert.equal(tour.offer, true)`.

- [ ] **Step 3: Trigger the offer**

In `src/lib/account.svelte.js`, add the import at the top:

```js
import { offerTour } from "./tour.svelte.js";
```

and change the success path of `signInWithGoogle` from

```js
    apply(body);
    account.loginOpen = false;
    return "";
```

to

```js
    apply(body);
    account.loginOpen = false;
    // A just-created account gets the one-time tour offer.
    if (body?.isNew) offerTour(account.displayName);
    return "";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/tour.test.js && node --test tests/route.test.js`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/account.svelte.js tests/tour.test.js
git commit -m "$(cat <<'EOF'
Offer the tour once, right after an account is created

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The Tour component, styles, and mounting

**Files:**
- Create: `src/components/Tour.svelte`
- Modify: `src/App.svelte` (imports at lines 2–26; mount after `<LoginModal />` at line 204)
- Modify: `src/style.css` (append a `/* Tour */` block at the end)

**Interfaces:**
- Consumes: `STEPS` (Task 1); `tour, startTour, nextStep, backStep, stopTour, dismissOffer` (Task 2); `account` from `src/lib/account.svelte.js`; `route, navigate` from `src/lib/route.svelte.js`.
- Produces: the visible tour. Nothing else imports it.

No unit test: it is DOM measurement in a Svelte component. Task 6 walks it in the browser.

- [ ] **Step 1: Write the component**

Create `src/components/Tour.svelte`:

```svelte
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
```

- [ ] **Step 2: Mount it in App.svelte**

In `src/App.svelte`, after the line `import LoginModal from './components/LoginModal.svelte';` add:

```js
  import Tour from './components/Tour.svelte';
```

and after `<LoginModal />` (line 204) add:

```svelte
<Tour />
```

- [ ] **Step 3: Add the styles**

Append to the end of `src/style.css`:

```css
/* Tour */
.tour-dim {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.62);
}
.tour-dim.clear {
  background: transparent;
}
.tour-window {
  position: fixed;
  z-index: 1001;
  border-radius: 14px;
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.62);
  pointer-events: none;
  transition: top 0.2s, left 0.2s, width 0.2s, height 0.2s;
}
.tour-card {
  position: fixed;
  z-index: 1002;
  max-width: 340px;
  padding: 18px 20px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  outline: none;
}
.tour-card:not(.anchored) {
  top: 50%;
  left: 50%;
  width: min(340px, calc(100vw - 24px));
  transform: translate(-50%, -50%);
}
.tour-step {
  margin: 0 0 6px;
  color: var(--muted);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.tour-card h2 {
  margin: 0 0 8px;
  font-size: 18px;
}
.tour-card p {
  margin: 0;
  color: #c6cfc3;
  font-size: 14px;
  line-height: 1.5;
}
.tour-actions,
.tour-offer-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}
@media (max-width: 520px) {
  .tour-card.anchored {
    left: 12px !important;
    right: 12px;
    width: auto !important;
    max-width: none;
  }
  .tour-card.anchored.phone-bottom {
    top: auto !important;
    bottom: 12px !important;
  }
  .tour-card.anchored.phone-top {
    top: 12px !important;
    bottom: auto !important;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tour-window {
    transition: none;
  }
}
```

- [ ] **Step 4: Build and smoke-check**

Run: `npm run build 2>&1 | grep -iE "error|built in"`
Expected: `✓ built in …` and no errors.

Then in the Playwright MCP browser: open `http://localhost:5173/`, run

```js
async () => { history.pushState({}, '', '/builder'); dispatchEvent(new PopStateEvent('popstate')); await new Promise(r => setTimeout(r, 1000)); const m = await import('/src/lib/tour.svelte.js'); m.startTour(); await new Promise(r => setTimeout(r, 500)); return document.querySelector('.tour-card h2')?.textContent; }
```

Expected: `Welcome to the Recipe Builder.` Take a screenshot (`.playwright-mcp/tour-step1.png`) and confirm a dimmed page with a centred card.

- [ ] **Step 5: Commit**

```bash
git add src/components/Tour.svelte src/App.svelte src/style.css
git commit -m "$(cat <<'EOF'
Tour overlay: offer dialog, spotlight window, step card

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Phone panel and the Help entry

**Files:**
- Modify: `src/components/Recipes.svelte` (imports lines 2–14; add an effect after the `mobileOpen` declaration at line 48)
- Modify: `src/components/Help.svelte` (script imports; markup under `.help-lede`)

**Interfaces:**
- Consumes: `tour, panelFor, startTour` from Task 2; `navigate` from `src/lib/route.svelte.js`.

- [ ] **Step 1: Open or close the phone panel per step**

In `src/components/Recipes.svelte`, add to the imports:

```js
  import { tour, panelFor } from '../lib/tour.svelte.js';
```

Directly after the line that declares `let mobileOpen = $state(panelStartsOpen(...));` add:

```js
  // The tour opens the panel for the targets steps and closes it after.
  $effect(() => {
    if (!tour.active) return;
    const panel = panelFor(tour.step);
    if (panel === 'open') mobileOpen = true;
    else if (panel === 'closed') mobileOpen = false;
  });
```

- [ ] **Step 2: Add the Help entry**

In `src/components/Help.svelte`, add to the imports:

```js
  import { startTour } from '../lib/tour.svelte.js';
```

add this function below `go`:

```js
  function takeTour() {
    navigate({ tab: 'recipes' });
    scrollTo(0, 0);
    startTour();
  }
```

and replace

```svelte
    <p class="help-lede">Short, step-by-step guides with pictures. Start anywhere.</p>
```

with

```svelte
    <p class="help-lede">Short, step-by-step guides with pictures. Start anywhere.</p>
    <p class="help-tour">New here? <button class="text-button" onclick={takeTour}>Take the tour</button> of the Recipe Builder.</p>
```

Append to `src/style.css`, inside the `/* Tour */` block:

```css
.help-tour {
  margin: -12px 0 24px;
  color: var(--muted);
}
.help-tour .text-button {
  color: var(--lime);
  font-weight: 600;
}
```

- [ ] **Step 3: Check tests and build**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)" && npm run build 2>&1 | grep -iE "error|built in"`
Expected: `fail 0`; `✓ built in …`.

- [ ] **Step 4: Commit**

```bash
git add src/components/Recipes.svelte src/components/Help.svelte src/style.css
git commit -m "$(cat <<'EOF'
Tour opens the phone targets panel per step; Help gets a Take the tour link

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Browser walkthrough

**Files:** none changed unless a check fails (fix in the file the check names, re-run, amend the Task 4/5 commit or add a fix commit).

Short Playwright MCP steps, one page at a time, narrated. Dev server: `npm run dev` on port 5173; always start at `http://localhost:5173/`.

- [ ] **Step 1: Desktop, from Help, logged out (1280×900)**

Resize to 1280×900, open `/`, then run:

```js
async () => { history.pushState({}, '', '/help'); dispatchEvent(new PopStateEvent('popstate')); await new Promise(r => setTimeout(r, 600)); [...document.querySelectorAll('.help-tour button')][0].click(); await new Promise(r => setTimeout(r, 1200)); return location.pathname + ' | ' + document.querySelector('.tour-card h2')?.textContent + ' | ' + document.querySelector('.tour-step')?.textContent; }
```

Expected: `/builder | Welcome to the Recipe Builder. | 1 of 7`. Screenshot `tour-d1.png`.

- [ ] **Step 2: Walk forward and check each anchor**

Run once per press, reading the result each time:

```js
async () => { document.querySelector('.tour-card .primary-button').click(); await new Promise(r => setTimeout(r, 700)); const w = document.querySelector('.tour-window')?.getBoundingClientRect(); return document.querySelector('.tour-step').textContent + ' | ' + document.querySelector('.tour-card h2').textContent + ' | window=' + (w ? [w.top, w.left, w.width, w.height].map(Math.round).join(',') : 'none'); }
```

Expected in order: `2 of 7 … window=…` (over the targets table), `3 of 7` (presets), `4 of 7` (both text fields in one box), `5 of 7` with the card text beginning `Sign in first; it's free.` (logged out), `6 of 7` (a box over the Recipe Book and Community tabs), `7 of 7 … window=none`. Screenshot steps 2, 5 and 6 (`tour-d2.png`, `tour-d5.png`, `tour-d6.png`) and look at them: the window must sit around the right element and the card must not cover it.

- [ ] **Step 3: Last step ends the tour; Back works**

Run: `() => { document.querySelector('.tour-card .primary-button').click(); return !!document.querySelector('.tour-card'); }` → expected `false` (Start building closes it).

Restart from Help (Step 1), press Next twice, then run `() => { [...document.querySelectorAll('.tour-card button')].find(b => b.textContent === 'Back').click(); return document.querySelector('.tour-step').textContent; }` → expected `2 of 7`.

- [ ] **Step 4: Keyboard**

With the tour on step 2: press `ArrowRight` (browser_press_key) → `.tour-step` reads `3 of 7`. Press `ArrowLeft` → `2 of 7`. Focus the Next button via `() => document.querySelector('.tour-card .primary-button').focus()`, press `Enter` → `3 of 7` exactly, not `4 of 7` (no double advance). Press `Escape` → `.tour-card` is gone.

- [ ] **Step 5: Leaving the Builder ends it**

Start the tour, then click the Community tab: `() => { document.querySelector('.tabs button:nth-child(3)').click(); return !!document.querySelector('.tour-card'); }` → expected `false`.

- [ ] **Step 6: Phone (390×844)**

Resize to 390×844, open `/`, go to `/help`, click **Take the tour**. Then step through with the Next click from Step 2 and check:
- step 2 and 3: `() => document.querySelector('aside').classList.contains('mobile-open')` → `true`, and the targets table / presets are visible in a screenshot (`tour-p2.png`, `tour-p3.png`);
- step 4: the same check → `false`, screenshot `tour-p4.png`;
- step 6: screenshot `tour-p6.png`; the window surrounds the Recipes and Community tabs in the pill;
- on every step: `() => document.documentElement.scrollWidth <= document.documentElement.clientWidth` → `true`;
- when the window is in the top half of the screen the card sits at the bottom; otherwise at the top. Check in the screenshots.

- [ ] **Step 7: Offer dialog**

On any page, run:

```js
async () => { const m = await import('/src/lib/tour.svelte.js'); m.offerTour('Sam'); await new Promise(r => setTimeout(r, 300)); return document.querySelector('.tour-offer[open] h2')?.textContent; }
```

Expected: `Welcome, Sam.` Screenshot `tour-offer.png`. Click **No thanks** → dialog closed. Call `m.offerTour('')` → title `Welcome.`. Click **Show me** → `location.pathname === '/builder'` and the step-1 card is showing.

- [ ] **Step 8: Anchor missing**

Open `/` and immediately, before the dataset loads, run:

```js
async () => { history.pushState({}, '', '/builder'); dispatchEvent(new PopStateEvent('popstate')); const m = await import('/src/lib/tour.svelte.js'); m.startTour(); m.nextStep(); await new Promise(r => setTimeout(r, 4000)); return document.querySelector('.tour-step')?.textContent; }
```

Expected: `2 of 7` with a window (the dataset arrives within 3 s and the anchor is found), or, if the dataset is slower than 3 s on this machine, a later step: never a card with no window stuck on step 2.

- [ ] **Step 9: Full test run and final commit check**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"; npm run build 2>&1 | grep -iE "error|built in"; git status --short`
Expected: `fail 0`, build OK, clean tree (everything committed in Tasks 1–5, plus any fix commits). Do not push.

---

## Post-deploy checklist (for Frosty, on the live site)

- Sign in with a Google account that has never used Macro Genie. The "Welcome, {name}." offer appears as the login dialog closes. **Show me** opens the Builder on step 1.
- Sign out and back in with the same account: no offer.
- Help → Take the tour, on a phone: the targets panel opens for steps 2–3 and closes for 4–6.
