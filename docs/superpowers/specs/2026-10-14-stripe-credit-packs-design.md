# Buying credits with Stripe — design

Date: 2026-10-14. Status: approved in chat, awaiting spec review.

## Goal

Signed-in people can buy more credits with a one-time payment. No subscriptions, no customer portal, nothing locked behind a paywall: AI jobs keep costing 1 credit each, and this adds the way to get more once the 10 welcome credits run out.

## Decisions

- **Packs:** 20 credits for $3, 50 for $6, 120 for $12 (USD). Defined once in code (`server/packs.js`); nothing is configured as Products/Prices in the Stripe dashboard.
  - Why these prices: production logs (2026-10-13) show a real cost of 2.9–4.3¢ per idea and 2.7–3.1¢ per written recipe on Opus 5.5, so at worst about 4.5¢ per credit. Stripe's fixed 30¢ per sale is the bigger cost, which is why there's no pack under $3. Even assuming every credit runs at worst-case cost, each pack keeps 60–70% after AI and Stripe fees.
- **Stripe Checkout, hosted.** The Buy button redirects to Stripe's payment page, and Stripe redirects back afterwards. Card details never touch our site. Stripe sends the receipt email.
- **Minimal data.** No Stripe Customer object is created (payment mode creates one only if asked). Stripe collects the payer's email for its receipt; we never store it. Our side keeps only ledger rows holding the Checkout session id, the pack and the amounts. `accounts.stripe_customer` stays unused.
- **Refunds stay manual,** issued by the owner from the Stripe dashboard. The policy (unused credits refundable within 30 days) is unchanged. A webhook takes back the matching credits automatically.
- **Test mode first.** Everything is built and tested locally against Stripe test mode. Live keys go in only for the single production push.

## Packs

```js
// server/packs.js
export const PACKS = [
  { id: "small",  credits: 20,  cents: 300 },
  { id: "medium", credits: 50,  cents: 600 },
  { id: "large",  credits: 120, cents: 1200 },
];
export const packById = (id) => PACKS.find((p) => p.id === id) ?? null;
```

The client fetches the list from `GET /api/credits/packs`, so the prices exist only on the server.

## Server

New function `netlify/functions/credits.js`, wrapped in `withTiming` like the others, with these routes:

| Route | What it does |
|---|---|
| `GET /api/credits/packs` | The pack list. Public. |
| `POST /api/credits/checkout` `{ pack }` | Requires a signed-in account that passes `requireActive` (exists, not suspended, not banned). Unknown pack gives 400. Creates a Checkout session and returns `{ url }`. |
| `POST /api/credits/confirm` `{ sessionId }` | Called by the return page. Runs `fulfill(sessionId)`, then returns `{ added, credits }`. Only the account that started the session may confirm it (403 otherwise). |
| `POST /api/stripe/webhook` | Verifies `Stripe-Signature` against the raw body using `STRIPE_WEBHOOK_SECRET`; a bad signature returns 400. Handles the events below and returns 200 for any other event type. |

**The Checkout session** is created with:
- `mode: "payment"`
- one line item using inline `price_data`: a USD amount, and a product name such as "50 Macro Genie credits"
- `client_reference_id: accountId`
- `metadata: { accountId, pack, credits }`
- `payment_intent_data.metadata`: the same three fields, so refunds can find them
- `success_url: <origin>/credits?session={CHECKOUT_SESSION_ID}` and `cancel_url: <origin>/credits?cancelled=1`

`<origin>` comes from the request URL, so local dev returns to localhost.

**`fulfill(sessionId)`** lives in `server/payments.js` and is the only place purchase credits are added.
1. Retrieve the session from Stripe. Only the Stripe server copy is trusted; client-sent amounts are never used.
2. If `payment_status !== "paid"`, return `{ added: 0 }`.
3. Read `accountId` and `credits` from the session metadata. Check that the pack still matches the amount Stripe actually charged (`amount_total`); otherwise log a problem and add nothing.
4. Call `addCredits(accountId, credits, "purchase", session.id)`. The ledger's `UNIQUE (reason, ref)` makes repeats no-ops, so the webhook and the return page can both call it safely.
5. When it actually added credits, write activity `credits_purchase` ("bought 50 credits ($6)").

**Webhook events:**
- `checkout.session.completed` and `checkout.session.async_payment_succeeded` call `fulfill(session.id)`.
- `charge.refunded`:
  1. Get the pack metadata from the charge's PaymentIntent.
  2. Work out `target = round(credits × amount_refunded / amount)`. `amount_refunded` is the cumulative total.
  3. Subtract the credits already taken back for this PaymentIntent (the sum of its `refund_purchase` ledger rows, `ref LIKE '<payment_intent>:%'`).
  4. Take back the difference, but never more than the current balance (credits can't go below 0).
  5. The ledger row uses reason `refund_purchase` and ref `<payment_intent>:<amount_refunded>`, so a replayed event is a no-op.
  6. Write activity `credits_refund` ("refunded $3.60, removed 30 credits"). If the clamp kicked in, say so ("…removed 12 of 30; balance was 12").

The `credits` chip gets the new kind `credits_refund`.

**Stripe client:** `server/stripe.js` exports `stripe()`. It's lazy, reads `STRIPE_SECRET_KEY` and throws a clear error if the key is missing. It also exports `useStripe(fake)` so tests can inject a fake, the same pattern as `useDatabase`. Dependency: the `stripe` npm package.

**Errors** go through the existing `fail()`/`UserFacingError` path. If Stripe is unreachable when starting checkout, the person sees "Payments are unavailable right now. Try again in a few minutes."

## Client

- **Route `/credits`** (tab `credits` in `route.svelte.js`), titled "Get more credits":
  - **Signed in:** a balance line ("You have 4 credits"), three tappable pack cards (credits, price, per-credit price), and a short note: "1 credit = 1 idea or 1 written recipe. Credits don't expire. Unused credits from a pack can be refunded within 30 days." with links to Refunds and Terms.
  - **Signed out:** the cards plus "Sign in to buy credits" (opens the login).
  - **Buying:** the Buy button shows "Opening checkout…" and goes to the returned URL. On error the message is shown inline.
  - **`?session=…` on return:** shows "Confirming your payment…", calls `/api/credits/confirm`, then shows "Added 50 credits. You now have 54." and updates the account's credit count. If the payment isn't settled yet, it says "Your payment is processing; credits appear as soon as Stripe confirms it." Then the query string is cleaned from the URL.
  - **`?cancelled=1`:** "Checkout cancelled. You weren't charged."
  - **Phones:** whole-card tap targets, a single column, no sideways scroll with large text.
  - **Suspended accounts:** see the cards with Buy disabled and the existing suspended note.
- **Entry points:**
  - "Get more credits" in the account menu (desktop and phone).
  - The "Not enough credits" line in the Recipe Builder: "…Buying credits is coming soon." becomes a "Get more credits" link (`src/components/Recipes.svelte:268`). The same applies to the other short-credit messages in that file (:414, :424, :433 disable buttons; add the link where a message shows).
  - `src/help/credits.js`: replace "Buying more credits is coming soon." with a short "Buying more" step that links to /credits and lists the packs.

## netlify.toml

Add 200 rewrites to `/index.html` for:
- `/credits`
- the existing app paths that 404 today on a direct load or refresh: `/help`, `/help/*`, `/admin`, `/admin/*`, `/terms`, `/refunds`, `/privacy`, `/contact`

Verified 2026-10-14: `/help`, `/refunds` and `/admin` currently return 404 on production.

## Environment

| Variable | Where | Value |
|---|---|---|
| `STRIPE_SECRET_KEY` | `.env` (test: `sk_test_…`); Netlify production secret (live: `sk_live_…`) | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | `.env` (from `stripe listen`); Netlify production secret (from the dashboard webhook endpoint) | `whsec_…` |

Without `STRIPE_SECRET_KEY`, the /credits page still renders, and Buy returns "Payments are unavailable right now."

## Owner setup checklist

1. Log into dashboard.stripe.com (the agentArcade account) and switch to **Test mode**. Copy the test secret key into `.env` as `STRIPE_SECRET_KEY`.
2. Install the Stripe CLI, run `stripe login`, then `stripe listen --forward-to localhost:8888/api/stripe/webhook`. Put the printed `whsec_…` into `.env` as `STRIPE_WEBHOOK_SECRET`.
3. Optional: change the account's public business name to "Macro Genie" so the checkout page and receipts show it rather than agentArcade, and set the support email and URL to macro-genie.com/contact.
4. Before going live:
   - finish account activation (business details, bank, identity);
   - add a live webhook endpoint `https://macro-genie.com/api/stripe/webhook` for the three events above;
   - set both live values as Netlify production secrets.

## Testing

**Unit tests** (`tests/payments.test.js`, `node:test`, ephemeral Postgres via `@netlify/database-dev`, fake Stripe via `useStripe`):
- Checkout:
  - an unknown pack gives 400;
  - signed out gives 401;
  - a suspended account is refused;
  - the created session carries the right amount, metadata and URLs.
- Fulfil:
  - a paid session adds credits once; calling it again (return page plus webhook) adds nothing;
  - an unpaid session adds nothing;
  - a pack/amount mismatch adds nothing and logs a problem;
  - confirm by a different account gives 403.
- Webhook:
  - a bad signature gives 400 (real `constructEvent` with a test secret);
  - `checkout.session.completed` fulfils;
  - an unknown event type gives 200.
- Refunds:
  - a full refund removes the pack's credits;
  - two partial refunds remove credits proportionally, in total;
  - a replayed event does nothing;
  - the clamp works when the balance is lower.
- Activity rows are written for purchase and refund.

**Local end-to-end** (owner, short checklist): with `npm run dev` and `stripe listen` running:
- buy each pack with card `4242 4242 4242 4242`, and check the balance and the admin log;
- cancel a checkout;
- buy with the card that requires authentication (`4000 0025 0000 3155`);
- refund part of a purchase from the dashboard and see the credits go down.

**Production:** one push after the owner OKs it. Then one real live purchase of the $3 pack, refunded from the dashboard.

## Out of scope

- Sales tax / Stripe Tax.
- Subscriptions, the customer portal, coupons and gift credits.
- Non-USD prices.
- Changing which model writes ideas. Production uses Opus 5.5 because `IDEA_MODEL`/`RECIPE_MODEL` aren't set there; that's a separate decision.
