# Admin area — design

Date: 2026-10-13. Status: approved in chat, awaiting spec review.

## Goal

One place to look after the community: review what moderation held, manage users, and see at a glance when something needs attention (a problem, a sign-in, a contribution, a purchase), without wading through ordinary posts.

## Decisions

- New page at `/admin`, reached from the header (and the phone account menu) for mods and admins only. Three tabs: **Reviews**, **Users**, **Log**.
- Roles live in the database: `accounts.is_admin` and `accounts.is_mod`. The `ADMIN_SUBS` env var stays as an owner backstop: those Google accounts are always admin and can't be demoted or banned from the UI.
- **Moderators**: Reviews tab, Log tab, Users tab with suspend/unsuspend and "remove their community posts". **Admins**: everything mods can, plus add/remove credits, delete & ban, and setting mod/admin roles.
- **Suspended** = read-only: can sign in, browse, search foods, use their Recipe Book; the server refuses posting, commenting, liking, reporting, and spending credits with "Your account is suspended."
- **Delete & ban**: the account and everything it owns are erased (existing `ON DELETE CASCADE`); only its Google `sub` goes on a ban list so it can't sign in again.
- **Log**: its own table, written when events happen, kept 90 days. Not logged: posts/comments that go live normally, likes, credit spends.
- Contribution points are a separate later project that will build on the log (added to the TODO).

## Data (one new migration)

- `accounts`: add `is_admin BOOLEAN NOT NULL DEFAULT false`, `is_mod BOOLEAN NOT NULL DEFAULT false`, `suspended_at TIMESTAMPTZ`.
- `banned_subs (google_sub TEXT PRIMARY KEY, banned_at TIMESTAMPTZ NOT NULL DEFAULT now(), reason TEXT NOT NULL DEFAULT '')`.
- `activity_log (id BIGSERIAL PK, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), kind TEXT NOT NULL, account_id BIGINT NULL REFERENCES accounts ON DELETE SET NULL, actor_name TEXT NOT NULL, text TEXT NOT NULL, link TEXT)`, index on `created_at DESC`. The name is copied in so entries still read right after a rename or delete.

Log kinds and their filter chip:

| kind | chip | example text |
|---|---|---|
| `recipe_post` | Posts | posted a recipe to the community: "Skillet Apple Sauté" |
| `joined` | Sign-ins | joined (new account, 10 credits) |
| `sign_in` | Sign-ins | signed in |
| `credits_purchase` | Credits | purchased 30 credits (Stripe, later) |
| `credits_adjust` | Credits | got +50 credits from Matthew: "beta tester thanks" |
| `held` / `blocked` | Problems | posted in General but it was held for review / comment blocked: reason |
| `report` | Problems | reported a comment on "…": Spam or advertising |
| `admin_action` | Problems | Matthew suspended HappyBird45 / removed their posts (3) / deleted and banned |

Links go to `/community/<postId>` (comments link to their post). Entries older than 90 days are deleted opportunistically when the log is written (one cheap `DELETE … WHERE created_at < now() - interval '90 days'` at most once per function instance per hour).

## Server

- `server/roles.js`: `roleOf(accountId) → { admin, mod, suspended }` (admin = `is_admin` or sub in `ADMIN_SUBS`; mod = `is_mod` or admin); `requireMod`, `requireAdmin`, `requireActive` (throws `UserFacingError("Your account is suspended.", 403)`). Replaces `isAdmin`/`requireAdmin` in `server/admin.js`; existing callers move over.
- `server/activity.js`: `logActivity({ kind, accountId, actorName, text, link })` — never throws (failures are `console.error`ed); `listActivity({ chip, before, limit = 50 })`.
- `server/users.js` (admin/mod actions, each logs an `admin_action` or `credits_adjust`): `listUsers({ query, offset })` (name search, newest first, with post count), `setSuspended(actor, id, on)`, `removeCommunityContent(actor, id)` (deletes their posts and comments, fixes comment counts), `adjustCredits(actor, id, amount, reason)` (via `addCredits`/ledger; can't go below 0), `setRoles(actor, id, { admin, mod })`, `deleteAndBan(actor, id)`. Owner-backstop accounts can't be suspended, banned, or demoted.
- Enforcement points: sign-in (`/api/auth/google`) rejects banned subs ("This Google account can't sign in here.") and logs `joined`/`sign_in`; community post/comment/like/report and idea/recipe spends call `requireActive`; moderation outcomes held/blocked and reports log Problems; a live recipe post logs `recipe_post`.
- `netlify/functions/admin.js` at `/api/admin/*`: `GET queue`, `POST decide` (moved from community.js), `GET users`, `POST users/:id/suspend|unsuspend|remove-content|credits|roles|delete`, `GET log?chip=&before=`. Each checks the role it needs.
- `/api/me` adds `isMod`, `suspended`.

## Client

- `src/components/Admin.svelte` with tabs; `ReviewQueue.svelte` reused for Reviews; new `AdminUsers.svelte`, `AdminLog.svelte`. Route `/admin` (and `/admin/users`, `/admin/log`) in `lib/route.svelte.js`.
- Header: "Admin" link for mods/admins (desktop next to the account area; phones inside the account menu). Community's "Review queue" button links to `/admin`.
- Users tab: search box + list; a user's panel shows credits, joined date, posts, status, and the action buttons allowed for your role. Destructive actions confirm; delete & ban requires typing the display name.
- Suspended users see a banner: "Your account is suspended. You can browse, but not post, comment, like, or use credits."
- Mobile: tabs as a segmented control; lists stack; checked at 360/390 px with large text (no sideways overflow).

## Errors

- Every admin endpoint answers 403 for the wrong role; the UI hides what you can't do but the server is the guard.
- Logging never blocks or fails the action it describes.
- Acting on a user who no longer exists → 404 "That user no longer exists."

## Testing

- Server tests (local test database, like `tests/community.test.js`): roles and owner backstop; mod vs admin permissions per endpoint; suspended user refused on post/comment/like/report/spend but can still read; banned sub refused at sign-in; delete & ban erases content and keeps only the sub; credit adjust writes the ledger and can't go negative; each log kind is written by its event and normal live forum posts are not; 90-day cleanup; log filter chips and paging.
- Browser: short steps on the three tabs at desktop and phone width; banner for a suspended account.
