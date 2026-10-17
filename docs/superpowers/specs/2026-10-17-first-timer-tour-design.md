# First-timer tour — design

Date: 2026-10-17

## Goal

A point-and-explain tour of the Recipe Builder so a first-time visitor can make one recipe on their own. It is offered once, the moment someone creates an account, and can be run again from Help by anyone, signed in or not. It types nothing, spends no credits, and works on phones.

## What the user sees

### The offer

Right after Google sign-in completes on a brand-new account, the login dialog closes and a small dialog opens:

> **Welcome, {first name}.**
> Want a two-minute tour of the Recipe Builder? You can run it later from Help.
> [Show me] [No thanks]

**Show me** navigates to `/builder` and starts the tour. **No thanks** closes the dialog. Nothing is stored: the server's `isNew` flag is only ever true in that one sign-in response, so the offer cannot repeat.

### The Help entry

Under the lede on the Help hub (`/help`): "New here? **Take the tour** of the Recipe Builder." The link navigates to `/builder` and starts the tour. It works logged out.

### The steps

Each step dims the page, cuts a rounded window around its anchor, and shows a card with the text and **Back** / **Next** / **Skip** (last step: **Start building**). Steps 1 and 7 have no anchor and are centred.

| # | Anchor | Phone panel | Copy |
|---|---|---|---|
| 1 | — | — | **Welcome to the Recipe Builder.** It makes a recipe from your numbers. Seven quick stops. |
| 2 | `.range-table` | open | **Set targets per serving.** Blank means no limit, and one or two is plenty: try at least 30 g protein and under 600 calories. |
| 3 | `.presets` | open | **Not sure where to start?** A preset fills the table for you. Change any number afterwards. |
| 4 | `.brief .note-field` (both fields, as one box) | closed | **Say what you'd like.** Name foods you want in it, and anything else that matters: "comfort food, no oven". Both are optional. |
| 5 | `.brief-actions .primary-button` | closed | **Get ideas.** Each idea costs one credit; new accounts get 10. Ideas arrive within about half a minute, with every gram worked out from USDA data. *Signed out, the copy adds: "Sign in first; it's free."* |
| 6 | The Recipe Book and Community tabs in the header, as one box | closed | **Then cook, keep, share.** Choose an idea with Cook this one, then Write the recipe for the steps. Save it to your Recipe Book, and share it in the Community if it worked. |
| 7 | — | — | **That's it.** Run this again any time from Help. |

Keyboard: Enter or → is Next, ← is Back, Esc is Skip. Focus moves to the card when it opens and returns to where it was when the tour ends. The card is `role="dialog"` with `aria-modal`. Under `prefers-reduced-motion` nothing animates.

## Pieces

### `src/help/tour.js` — the steps as data

Exports `STEPS`: an array of `{ title, text, textSignedOut?, selector?, panel? }`. `selector` may be a string or an array of strings (the window covers the union of the matched boxes). `panel` is `'open'`, `'closed'`, or absent. Copy edits touch only this file.

### `src/lib/tour.svelte.js` — state

```js
export const tour = $state({ active: false, step: 0, offer: false, offerName: '' });
export function offerTour(name)   // opens the offer dialog
export function startTour()       // active = true, step = 0; closes the offer
export function nextStep()        // step + 1, or stopTour() past the end
export function backStep()        // step - 1, floored at 0
export function stopTour()        // active = false
```

`panelFor(step)` returns the current step's `panel` value, for Recipes.svelte.

### `src/components/Tour.svelte` — the offer dialog and the overlay

Mounted once in `App.svelte`, after `LoginModal`.

- **Offer**: a `<dialog>` in the house style (same classes as the login modal), opened when `tour.offer` is true.
- **Overlay**: rendered when `tour.active`. A fixed `div.tour-window` positioned at the anchor's bounding box plus 8 px padding, with `border-radius: 14px` and `box-shadow: 0 0 0 100vmax rgba(0,0,0,.62)` for the dim. The card `div.tour-card` sits 12 px below the window, or above it when fewer than 220 px remain below; its left edge is clamped to the viewport with 12 px margin. Centred steps use a plain dim and a centred card.
- **Measuring**: on each step the component finds the anchor(s), calls `scrollIntoView({ block: 'center' })`, waits a frame, measures with `getBoundingClientRect()`, and stores the box in state. It re-measures on `resize` and `scroll` (passive listeners, removed on unmount) and on any step change.
- **Anchor missing**: polls every 100 ms for up to 3 s (the Builder shows "Loading foods…" until the dataset arrives). If still missing, the step is skipped in the direction of travel.
- **Route change**: an `$effect` on `route.tab` and `route.recipeId` stops the tour when the tab is no longer `recipes`.
- **Click shield**: the dim blocks pointer events; the card's buttons are the only controls. Clicking the dim does nothing (Esc skips).

### `src/components/Recipes.svelte` — the phone panel

One `$effect`: when `tour.active` and the current step's `panel` is `'open'`, set `mobileOpen = true`; when `'closed'`, set it `false`. Desktop ignores `mobileOpen`, so this is harmless there.

### `src/lib/account.svelte.js` — the trigger

`signInWithGoogle` reads `body.isNew`; when true, it calls `offerTour(account.displayName)` after closing the login dialog. The server already returns `isNew` (server/accounts.js, netlify/functions/account.js); no server change.

### `src/components/Help.svelte` — the Help entry

A paragraph under `.help-lede`: `New here? <button class="text-button">Take the tour</button> of the Recipe Builder.` The handler navigates to the Builder, scrolls to top, and calls `startTour()`.

### Styles

In `style.css` under a `/* Tour */` heading: `.tour-dim`, `.tour-window`, `.tour-card` (panel background, `--line` border, 16 px radius, max-width 340 px), `.tour-step` ("2 of 7", muted), the button row, and the phone variant (`max-width: 520px`: card full-width with 12 px side margins, fixed to the bottom when the window is in the top half of the screen).

## Error handling

- Anchor never appears: step skipped (above). If every anchored step is skipped, the user still sees steps 1 and 7.
- Tour started while the Builder is on its "Food data unavailable" screen: all anchored steps skip; the tour ends on step 7.
- The offer dialog on a page other than the Builder: Show me navigates first; the tour's own missing-anchor wait covers the render.

## Testing

- `tests/tour.test.js`: every step has `title` and `text`; `panel` is `'open'`, `'closed'`, or absent; anchored steps have a non-empty selector; `textSignedOut` only on step 5. State: `nextStep` from the last step stops the tour; `backStep` from step 0 stays at 0; `startTour` clears `offer`.
- Browser (short Playwright passes, per the testing rule): start from Help at 1280 px and 390 px, logged out; walk every step with Next and Back; Esc stops; the phone panel opens for steps 2–3 and closes for 4–6; no sideways scroll.
- Live site, after deploy: sign in with a fresh Google account and confirm the offer appears and Show me lands on the Builder with step 1 open.

## Out of scope

Interactive steps that wait for input, tours of other tabs, server-side "tour seen" flags, and analytics.
