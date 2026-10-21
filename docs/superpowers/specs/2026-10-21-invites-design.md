# Invites: emailed credit codes and a hidden redeem page

## Why

Matthew is reaching out to recipe bloggers and coaches to try Macro Genie. He
promises free credits in a personal email. Today the only way to load them is
"reply with your username and I'll add them", which is slow for him and a chore
for them. He wants to send the invite from the admin page, with the credits
riding along as a one-time code the person redeems themselves.

Success: he writes a personal email in a minute from a template, it goes out
from his own Gmail, the person clicks the link, signs in, and the credits land.
He can see at a glance who he has emailed and whether each code was used.

## Goals

- An owner-only **Invites** tab in Admin to write and send an invite email.
- Emails go out **from Matthew's Gmail** (SMTP with an app password), so they
  look personal, show in his Sent folder, and replies come back to him.
- Every invite gets a **unique, single-use code** worth a set number of credits.
- A **hidden `/redeem` page**: open the link, sign in if needed, press Redeem,
  get the credits. A code works exactly once.
- **Templates**: as many as he likes, each a name + subject + body; pick one,
  tweak it, send.
- An **address book popup**: everyone he has emailed, with sent date, credits,
  and whether the code was used (✓ and the date).

## Non-goals

- No link between an invite (or its email address) and the account that
  redeemed it. Codes are deliberately not tied to emails: the mailbox he writes
  to may not be the person's own, and the site promises it never keeps a user's
  email.
- No mass mailing, scheduling, open tracking or click tracking.
- No HTML email. Plain text, like a person wrote it.
- Not shown in Help, the nav, or the sitemap.

## Anti-goals (it fails even if it "works" if…)

- An email goes out with an unfilled `[user]` or `[recipe…]` placeholder.
- A code can be redeemed twice (double-click, two tabs, a retry).
- Someone who isn't the owner can send mail as Matthew.
- The admin pages or logs end up showing "this email address = that username".

## Decided with Matthew

- Send from his Gmail via SMTP. The env vars are already in local `.env`:
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. They must be
  added to Netlify before the push.
- The code is a long random hash carried in the link
  (`https://macro-genie.com/redeem?code=…`). A paste box on the page is the
  fallback.
- The address book shows **used + date only**, never who used it.
- The address book is a **scrolling popup** opened by a 📖 button next to "To".
  It has a search box and lists newest first. Clicking a row fills "To".
- Layout as in the approved sketch:
  - Compose form: Template, To, Subject, Credits, Body. Under it, a "blanks still
    to fill" warning, then **Save as template** and **Send from your Gmail**.
  - Redeem page states:
    - signed out: code filled in, "Sign in with Google";
    - signed in: Redeem button;
    - done: "50 credits added, you now have N" and a link to the Recipe Builder;
    - bad code: "This code has already been used or isn't valid."

## Behaviour

### Placeholders

- `[credits]` is replaced with the invite's credit amount.
- `[redeem link]` is replaced with the full redeem URL.
- Matching is case-insensitive and ignores surrounding spaces inside the brackets.
- Any other `[...]` in the subject or body is a blank Matthew must fill in.
  - The form highlights blanks and lists them.
  - Send stays disabled while any remain.
  - The server re-checks this and refuses to send.
- If the body has no `[redeem link]`, the server refuses ("Add [redeem link]
  so they can claim the credits"). An invite without the link is useless.

### Sending

- POST to the server with to, subject, credits and body (with placeholders
  still in place).
- The server:
  1. checks the caller is the owner and the input is valid;
  2. creates the code;
  3. substitutes the placeholders;
  4. sends via SMTP;
  5. stores the invite only if the send succeeded.

  If SMTP fails, nothing is stored, and the error is shown plainly, e.g. "Gmail
  refused the login: check SMTP_PASS".
- The "To" address must look like an email. Credits must be a whole number from
  1 to 500.

### Resend and cancel (unused codes only)

- **Resend** emails the same person again with the same code. It reuses that
  invite's stored subject and body, already filled in.
- **Cancel** voids the code. The row then shows "canceled".
- **Forget** works on any row, used or not, and deletes it from the book.
  Unused, its code dies with it. This is how an invitee who asks to be removed
  gets removed, matching the privacy page's promise to delete data on request.

### Redeeming

- The visitor must be signed in and not suspended. The usual sign-in modal is
  used and the page stays on `/redeem?code=…`.
- Redeeming is one database transaction:
  1. mark the invite used, only if it is unused and not canceled;
  2. add a credit-ledger row (`reason 'invite'`, `ref` NULL, unpaid). The
     `ref` stays empty on purpose: an invite id there would let one join link
     the email to the account. Single use comes from step 1 alone;
  3. raise the account's balance.

  A second attempt finds nothing to mark, so it adds nothing.
- The invite stores `used_at` only. It never stores an account id.
- The user sees their new balance.
- Any account can redeem any valid code, and one account may redeem more than
  one.
- "Not linked" means **not stored**. Someone could still guess who redeemed a
  code by matching a sign-up time to a used date. That's accepted and nothing
  extra is done about it.

## Data (new migration)

- `invites`:
  - `id`
  - `code` (unique)
  - `email`
  - `subject`
  - `body` (as sent)
  - `credits`
  - `sent_at`
  - `used_at` (null)
  - `canceled_at` (null)
- `invite_templates`:
  - `id`
  - `name` (unique)
  - `subject`
  - `body`
  - `updated_at`
- Credits come in through `credit_ledger` with reason `invite`, `ref` NULL,
  unpaid. They count as free credits, the same as the welcome bonus or an admin
  grant.

## Where it lives

- `server/invites.js`: templates, placeholders, sending (nodemailer), listing,
  resend, cancel and redeem.
- `netlify/functions/admin.js`: the owner-only invite and template routes.
- The redeem route sits with the signed-in account routes.
- `src/components/AdminInvites.svelte`: the tab, plus `InviteBook.svelte` for
  the popup.
- `src/components/Redeem.svelte`: the page.
- Router:
  - `/redeem` added to `route.svelte.js`;
  - an `/admin/invites` admin tab, shown only to the owner;
  - a `netlify.toml` rewrite for `/redeem`;
  - `noindex` on that page;
  - left out of `FIXED_PAGES` and the sitemap.
- New dependency: `nodemailer`.
- Privacy page: one sentence saying addresses Matthew emails invites to are
  kept in an admin-only address book and never linked to accounts.

## Builder's calls (Matthew can override)

- **Owner only.** Only the owner sees the tab and can use the routes, not other
  admins, because the mail goes out as him.
- **Code format.** 32 random bytes as 64 hex characters, stored as-is so Resend
  can reuse it. When a code is pasted, spaces and dashes are trimmed.
- **Resend, Cancel and Forget.** These were added beyond the request.
- **Owner means whoever is in `ADMIN_SUBS`.** That's Matthew today. Anyone
  added there later could also send invites as him.
- **Template editing.**
  - "Save as template" saves the current subject and body under a new name.
  - Choosing a template and saving again overwrites it.
  - Delete removes it.
  - There are no starter templates beyond Matthew's sample (below), which is
    seeded by the migration as "Recipe blogger".
- **No Log entries.** Nothing goes in the Log tab for sends or redeems, to keep
  emails and accounts apart.
- **Email size.** Plain-text email, about 20 KB at most.

## Testing

- Unit tests:
  - placeholder filling and blank detection;
  - send refused with blanks or no link;
  - single-use redeem, including two at once, cancel, and a bad code;
  - owner-only routes;
  - SMTP mocked.
- Local browser check against the dev database. Send one real invite to
  Matthew's own address before the push.

## The seed template, "Recipe blogger"

Subject: `A macro tool built for food like yours`.

This is Matthew's sample with three changes:
- the "reply with your username" sentence is gone;
- the redeem line is moved up next to the credits offer;
- typos are fixed.

```
Hi [user],

I've been browsing Real Balanced. [One specific recipe you liked, e.g. "your ___ is going into my rotation"]. Your recipes are exactly the kind of food I built my tool for, so I wanted to tell you about it.

It's called Macro Genie (macro-genie.com). You give it macro targets and it does two things:

- Finds foods that fit. Instead of a search ranked by popularity, you set ranges (say, under 3 g net carbs and over 10 g protein) and it returns every food that qualifies.
- Builds meals that actually taste good. Give it your targets and some ingredients, and it comes up with dishes using flavor-pairing logic, balancing sweet, heat, savory, acid, and richness, instead of random combos that happen to hit the numbers. It even explains why each dish works. One recent result: "Sweet caramelized onion tames the chipotle heat, browned mushrooms and chicken deepen the savory broth, and sour cream plus vinegar cut the richness." Then it sizes every ingredient so each serving lands on your macros, with all the nutrition math coming from USDA data, not AI guesswork.

There's also a free MCP server. If you use an AI assistant like Claude, you can connect Macro Genie to it and run food searches and recipe sizing right in the chat, at no cost.

There's no subscription. Searching is free. The AI features run on pay-as-you-go credits, and packs start at $3. Sign-in is through Google, and the only thing we store is your username. No emails, no card numbers.

I'd like to give you [credits] credits to try it out. Once you've made an account, redeem them here:
[redeem link]

If you end up liking it, a review or a mention would be wonderful. If not, no strings at all. Enjoy the credits either way.

Thanks for all the recipes,
Matthew
Macro Genie, macro-genie.com
```

"Real Balanced" is left as plain text for Matthew to change per person. Saving
a copy under another name ("Fitness coach") is the intended way to grow the
set.
