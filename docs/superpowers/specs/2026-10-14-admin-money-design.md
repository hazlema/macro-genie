# Admin Money tab — design

Date: 2026-10-14. Status: approved in chat, awaiting spec review.

## Goal

The site should pay for itself. An admin-only **Money** tab shows, for the current month and up to 12 past months, an itemized list of money in (credit pack sales) and money out (Stripe fees, refunds, AI, hosting and other bills), and the net. It also shows two numbers for judging prices and the free credits: what a spent credit costs in AI, and how much of the AI spend went to free credits versus paid ones.

## Decisions

- **Approach:** the current month is worked out live each time the tab opens. When a month ends, its totals are worked out once more and saved, so past months load instantly and don't change later.
- **Admins only.** Moderators don't see the tab, and the server refuses its requests from them (`requireAdmin`).
- **AI costs, shown two ways side by side:**
  - **Estimate:** the cost the app already calculates for each job (`server/usage.js`), now saved to the database. It can be split by feature (ideas, recipes, moderation) and by free versus paid credits.
  - **Actual:** Anthropic's own cost report for the month, read with a new `ANTHROPIC_ADMIN_KEY` (an `sk-ant-admin…` key from the Anthropic Console). The production API key is used only by this app. The actual figure will also include local testing whenever `.env` uses the same key, so a gap between the two is expected and useful to see.
- **Fixed costs are typed in** by the admin: Netlify plan, domain, and later Neon or anything else. Nothing is pulled from Netlify.
- **Free credits are used first.** A purchase adds to the account's paid credits, and every spend uses free credits before paid ones. Ledger rows from before this change count as free. That's accurate because no live purchases exist yet.
- **Money is in US cents** as integers throughout. AI estimates are kept in fractions of a dollar per job (as `usage.js` does) and rounded to cents only for display.

## What gets recorded

### Free and paid credits

- New column `accounts.paid_credits INTEGER NOT NULL DEFAULT 0`, always between 0 and `credits`.
- New column `credit_ledger.paid BOOLEAN`. It is set on spend rows: true when the credit came from paid credits.
- **Spend** (`spendCredit`): one statement takes the credit, and takes it from free credits while any are left (`credits - paid_credits > 0`), otherwise from paid credits. The ledger row records which.
- **Failed-job refund** (`refundCredit`): the credit goes back to the pool it came from. If the spend was paid, `paid_credits` goes up by one.
- **Purchase** (`fulfill`): `paid_credits` goes up by the credits bought, in the same transaction as the balance.
- **Stripe refund** (`applyRefund`): `paid_credits` goes down by the credits removed, never below 0.
- **Admin grants and welcome credits** are free. An admin removing credits takes free credits first, then paid ones.

### AI usage

New table `ai_usage`, one row per AI job, written where `logUsage` runs today:

| column | meaning |
|---|---|
| `created_at` | when the job finished |
| `step` | `idea`, `recipe` or `moderation` |
| `model` | the model that answered |
| `input`, `output`, `cache_read`, `cache_write` | token counts |
| `cost_usd` | `NUMERIC(10,4)`, the estimate from `costOf` |
| `ledger_id` | the credit spend that paid for it; null for moderation |
| `failed` | true when the job failed (the credit was given back but the AI cost was still paid) |

Saving a usage row must never break the user's job. If the insert fails, it is logged and the job carries on. Local `npm run dev` jobs are recorded in the dev database as usual.

### Fixed costs

New table `fixed_costs`: `id`, `name`, `cents`, `period` (`monthly`, `yearly`, `once`), `starts` (first day of a month), `ends` (first day of a month, nullable, inclusive), `created_at`.

- A monthly cost counts in full in each month from `starts` to `ends`.
- A yearly cost counts as `cents / 12` in each month. The remainder goes to the month of `starts`, so a year adds up exactly.
- A one-off cost counts only in its `starts` month.

### Saved months

New table `money_months`: `month` (first day, primary key), `totals JSONB` (the same shape the page shows), `saved_at`. A month is saved only once all its parts loaded (Stripe, and Anthropic when a key is set). It is never overwritten automatically.

## How a month is worked out

`server/money.js` builds one month's totals from four sources:

1. **Stripe:** balance transactions created in that month (UTC), for charges and refunds that belong to Macro Genie credit checkouts, matched against `credit_ledger` purchase refs and the payment metadata. This gives:
   - **Sales:** the gross amount, plus the number of packs sold by pack id.
   - **Stripe fees:** the sum of `fee`.
   - **Refunds:** the amount refunded.
2. **AI estimate:** sums from `ai_usage` for the month:
   - the total
   - by step
   - free versus paid (through `ledger_id`, then `credit_ledger.paid`)
   - the number of credits spent, from ledger spend rows minus failed-job refunds
3. **Anthropic actual:** the Admin API cost report for the month, summed, if `ANTHROPIC_ADMIN_KEY` is set.
4. **Fixed costs:** each active row's share for the month.

The derived figures:
- **Net** = sales − Stripe fees − refunds − AI estimate − fixed costs. The estimate is used because it covers the whole month so far. The actual sits beside it for comparison.
- **AI cost per credit spent** = the AI estimate for credit-spending jobs (ideas and recipes, failed ones included) ÷ credits spent.
- **Earned per paid credit** = (sales − Stripe fees − refunds) ÷ paid credits sold, net of refunded credits.

Months run on UTC calendar months. Stripe and Anthropic both report in UTC.

## The page

`GET /api/admin/money` returns the current month (live) plus saved months, newest first, up to 13 entries in all. Before answering, it saves any finished month that isn't saved yet: last month, and any month back to the first month with data, at most 12. The fixed-cost form uses `POST`, `PATCH` and `DELETE` on `/api/admin/money/costs`.

The **Money** tab sits after Inbox, under `/admin/money`. It contains:
- One card per month, the current one first and open, past ones collapsed with the net shown in the summary. This follows the mobile rule of tappable panels with a summary.
- In each card:
  - the itemized lines
  - the Anthropic actual next to the estimate
  - cost per credit next to earned per paid credit
  - free versus paid credits spent, with their AI cost
  - packs sold by size
- Below the cards, a **Fixed costs** list with add, edit and end (set an end month). Editing a cost changes the current and future months only; saved months keep their numbers.

## When something can't be reached

- If Stripe or Anthropic fails or times out (10 s), the page still loads. That line reads "Couldn't reach Stripe; try again", and the month's net is labeled **incomplete**. Incomplete months are never saved.
- If `ANTHROPIC_ADMIN_KEY` isn't set, the actual line reads "Add ANTHROPIC_ADMIN_KEY to compare". Such a month still counts as complete and can be saved, without an actual figure.
- Stripe or Anthropic errors are logged with `console.error`. The admin sees only the plain message.

## Testing

The node tests run with fake Stripe and Anthropic clients, like `tests/payments.test.js`. They cover:
- free credits being used before paid ones, failed-job refunds going back to the right pool, purchases and Stripe refunds changing `paid_credits`, and admin grants and removals;
- `ai_usage` rows being written for ideas, recipes and moderation, and a failed insert not breaking the job;
- the month totals: sales, fees, refunds, AI by step and by free/paid, cost per credit, earned per paid credit, fixed costs (monthly, a yearly split adding up exactly, one-off, ended);
- incomplete months: a Stripe failure, an Anthropic failure, and no admin key;
- a finished month being saved once and not changing when fixed costs are edited later;
- moderators and signed-out visitors being refused.

After that, a manual check on `npm run dev` using the existing sandbox purchase and refund. Production gets `ANTHROPIC_ADMIN_KEY` as a Netlify secret at the next push.

## Out of scope

- Pulling the Netlify bill automatically.
- Charts. Numbers only for now.
- Exporting to a spreadsheet.
- Taxes and Managed Payments. Turning on Managed Payments means revisiting the Stripe lines: sales tax Stripe collects and pays isn't income, and its fee may be reported differently. That is part of the Managed Payments work, not this.
