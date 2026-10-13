# Help section, policy pages, and contact form — design

Date: 2026-10-13. Status: approved in chat, awaiting spec review.

## Goal

People (like the friend who asked "is it available now?") can learn the site without being shown in person: short illustrated step-by-step guides, a guide to using Macro Genie from an AI chat over MCP, and a guide to logging recipes in Cronometer. Add the pages Stripe expects (terms, refunds, privacy, contact) before payments go live. Stripe itself is a separate, later project.

## Decisions

- **Hub + guide pages.** `/help` is a hub of cards; each guide has its own address. Policy pages live at `/terms`, `/refunds`, `/privacy`, `/contact`.
- **Real screenshots**, captured by a script against the local site with fake data, with numbered markers matching step numbers. Shots only the owner can take (AI chats, Cronometer's diary) get a placeholder image of the right size labelled "Screenshot needed: <what>", plus a TODO item naming the file to replace.
- **Refunds:** unused credits refundable within 30 days of purchase; used credits aren't; failed AI jobs are refunded automatically (already true).
- **Contact form**, not a public address (spam). Messages are stored and read in a new Admin → Inbox tab. No email service.
- **"Copy ingredients" button** copies only the ingredient lines, the exact format Cronometer's "Paste Ingredients" import accepts (verified by the owner on 2026-10-13: salmon matched USDA, the rest matched NCCDB, grams kept, seasonings became dashes).
- Policy pages are plain-language drafts for the owner to review; not legal advice.

## Pages and routes

| Route | Content |
|---|---|
| `/help` | Hub: one card per guide (title, one-line summary, thumbnail) + links to policies and contact |
| `/help/start` | Getting started: what Macro Genie does, free vs credits, sign in |
| `/help/macros` | Set your macros (the macro panel, min/max, per serving vs per 100 g, presets) |
| `/help/builder` | Recipe Builder: targets, foods you want, ideas, pairing rating, pick one, write the recipe, servings |
| `/help/credits` | Credits: 10 free, 1 per idea/recipe, refunds on failure, buying more (filled in by the Stripe project) |
| `/help/book` | Recipe Book: saving, copy/print, it lives in this browser (publish to get it on another device) |
| `/help/community` | Community: browse, filter by macros, post a recipe, comment (rich text, emoji), report |
| `/help/mcp` | Chat with your AI: what MCP is, setup per app, the four tools, example prompts |
| `/help/cronometer` | Log it in Cronometer: Copy ingredients → Custom Recipes → Import → paste → save → diary |
| `/help/faq` | Short answers (accuracy of numbers, USDA data, private browsing, deleting your data, phones) |
| `/terms`, `/refunds`, `/privacy`, `/contact` | Policies and the contact form |

Unknown `/help/<x>` shows the hub. Links: **Help** in the desktop header and the phone account menu (signed in or out; for signed-out phones, next to Log in); every footer gets "Help · Terms · Refunds · Privacy · Contact".

## Guide content format

- One file per guide in `src/help/<slug>.js` exporting `{ slug, title, summary, intro, steps: [{ title, text, image?, imagePhone?, markers?: [{ n, x, y }] }], outro }`. Text fields are Markdown rendered with the existing `renderMarkdown` (so links work and HTML can't sneak in); markers are percentage positions on the image.
- `src/help/index.js` lists guides in hub order.
- Images in `public/help/<slug>-<n>.png` (desktop) and `-<n>-phone.png` where the phone layout differs. Width 1280 (desktop) / 390 (phone) at 2× pixel density, compressed PNG.
- `HelpGuide.svelte` renders: title, intro, numbered steps (number badge, title, text, image with absolutely positioned numbered marker dots, `<picture>` switching to the phone image under 760 px), outro, and "Next guide" link. Images lazy-load with width/height set (no layout shift) and alt text = step title.

## Screenshots

- `npm run screenshots` → `scripts/screenshots.js` (Playwright, dev dependency only). Starts from the running dev server URL (`HELP_BASE_URL`, default `http://localhost:5173`), routes `/api/me`, `/api/community*`, `/api/idea`, `/api/recipe` to **fixtures** (signed-in "Sam" with 10 credits, two sample community posts, canned ideas and a written recipe), so no real data, accounts, credits, or AI calls are involved.
- A shot list in the script maps each guide step to: path, viewport (desktop/phone), actions (click, type), and output file. Re-running overwrites.
- Placeholder generator (`scripts/placeholders.js`) writes an SVG placeholder: a `.svg` file at the expected size with a dashed border and "Screenshot needed: <what>"; `HelpGuide` accepts `.svg` or `.png`. Each placeholder gets a TODO doc item.
- Cronometer guide uses the owner's four screenshots (copied from the T3 attachments folder into `public/help/cronometer-1..4.png`); step 5 (diary) is a placeholder. MCP guide chat screenshots are placeholders.

## MCP guide

- What it is in one paragraph: connect an AI assistant (Claude, Fable, others) to Macro Genie and ask it things like a person; it searches 8,490 USDA foods and sizes recipes, read-only and free, no account.
- The server URL shown is `${location.origin}/mcp` (follows the real domain automatically, e.g. macro-genie.com), with a Copy button.
- Setup steps for: Claude on the web/desktop (custom connector with the URL), Claude Code (`claude mcp add --transport http macro-genie <url>`), and "other MCP apps" (Streamable HTTP endpoint, no auth). Each app's current menu names are checked when writing the guide.
- The four tools in plain words; 5–6 copyable example prompts.
- Note: community recipes aren't searchable over MCP yet (separate TODO).

## Policy pages

- **Terms:** what the service is; accounts via Google; credits have no cash value and don't expire; acceptable use (community rules, no abuse/spam); AI output and nutrition numbers are estimates, not medical advice; we can suspend accounts that break the rules; changes to terms; contact.
- **Refunds:** unused credits within 30 days of purchase, via the contact form (topic "Refund"); used credits aren't refundable; failed AI jobs are refunded automatically; refunds go back to the original payment method.
- **Privacy:** stored on our servers: Google account id, display name, credits and credit history, community posts/comments/likes/reports, contact messages; not stored: email, password; stays in your browser: Recipe Book, dislikes, recipe in progress; processors: Netlify (hosting), Neon (database), Anthropic (AI requests: the ingredients and targets you send), Google (sign-in), Stripe (payments, later); no ads or trackers; deleting your data via the contact form (topic "Delete my data").
- Business name "Macro Genie"; last-updated date on each page.

## Contact form

- `/contact` form: topic (Question, Refund, Delete my data, Bug, Other), message (10–3,000 chars), reply email (required when signed out, optional when signed in), hidden honeypot field. Signed-in messages attach the account.
- `POST /api/contact` (new function): validates; silently accepts and drops honeypot hits; per-IP rate limit (Netlify `rateLimit`, 5 per 10 minutes); stores in a new `messages` table (`id, created_at, account_id NULL → accounts ON DELETE SET NULL, name, email, topic, body, status 'new'|'done'`); logs a `message` activity entry ("sent a message: Refund") under a new **Messages** log chip.
- Admin → **Inbox** tab (mods and admins): newest first, filter New/Done, mark done/reopen; shows topic, sender name/email, account link, time, body (escaped, preserves line breaks).
- We store no email on accounts, so a reply needs the email typed into the form. Signed-in users who leave it blank see "Without an email we can't reply." under the field. Success message: "Thanks, your message was sent." plus "We'll reply by email." when an email was given.

## Copy ingredients

- In the written-recipe card (Builder, Recipe Book, Community post recipe): a **Copy ingredients** button next to Copy. It copies the rendered ingredient lines for the current servings, one per line, plus the seasonings line ("salt, black pepper, … to taste"), exactly as displayed. Button label flips to "Copied" for 2 s.

## Errors

- Missing image → the step still renders (alt text visible); the screenshot test catches it.
- Contact: validation messages inline; rate-limited → "You've sent a few messages already. Try again in a few minutes."; server error → message kept in the form.

## Testing

- Route tests for `/help`, `/help/<slug>`, unknown slug, and the four policy routes.
- Guide data test: every guide in `src/help/index.js` has a unique slug, a title, and steps; every referenced image file exists in `public/help/`.
- Contact: endpoint tests (validation, honeypot accepted-but-dropped, signed-in attaches account, stored row, log entry), admin inbox tests (mod can list/mark done, regular user 403).
- `ingredientLines(recipe, servings)` unit test (the function behind Copy ingredients).
- Browser: hub and two guides on desktop and 390 px phone (no sideways overflow), contact form send, Inbox shows it.
