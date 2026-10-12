# Admin Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `/admin` page for mods and admins with three tabs — Reviews (the existing queue), Users (suspend, remove posts, credits, roles, delete & ban), and Log (contributions, sign-ins, credits, problems) — backed by database roles, suspension, a ban list, and an activity log.

**Architecture:** One migration adds `is_admin`/`is_mod`/`suspended_at` to `accounts` plus `banned_subs` and `activity_log`. Small server modules each own one job: `roles.js` (who may do what), `activity.js` (write/read the log), `users.js` (admin actions). Existing community/credit/sign-in code calls `requireActive` and `logActivity`. A new Netlify function serves `/api/admin/*`. The client adds an `/admin` route with `Admin.svelte` hosting `ReviewQueue`, `AdminUsers`, `AdminLog`.

**Tech Stack:** Svelte 5 (runes), Netlify Functions (Node), Postgres via `pg` (Neon in production, `@netlify/database-dev` in tests), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-13-admin-area-design.md`

## Global Constraints

- Mods: Reviews, Log, Users with suspend/unsuspend and "remove their community posts". Admins: all of that plus credits, delete & ban, and setting mod/admin roles.
- `ADMIN_SUBS` (comma-separated Google subs) = owners: always admin; can't be suspended, banned, or have roles changed from the UI.
- Suspended = read-only. Server refuses posting, commenting, liking, reporting, and spending credits with exactly "Your account is suspended." (status 403).
- Delete & ban erases the account and everything it owns; only its Google sub is kept in `banned_subs`. A banned sub can't sign in: "This Google account can't sign in here." (403).
- Log kinds: `recipe_post`, `joined`, `sign_in`, `credits_purchase`, `credits_adjust`, `held`, `blocked`, `report`, `admin_action`. Chips: Posts, Sign-ins, Credits, Problems. Not logged: posts/comments that go live normally (except recipe posts), likes, credit spends. Kept 90 days.
- Logging never blocks or fails the action it describes.
- Every admin endpoint is guarded on the server; the UI only hides what you can't do.
- Server code style: Prettier (`npx prettier --write <file>`), comments explain why. Svelte files follow the existing one-line-markup style.
- Don't drop `accounts.banned` in this release (old functions may still run during the deploy); it simply stops being used.
- No push until the user OKs it. Commit locally per task.
- Phones: no sideways overflow at 360/390 px; form fields 16 px (already global).

## Review Focus

- A user's likes and live comments on *other people's* posts must come off those posts' counters when they're deleted or their content removed (cascade alone leaves stale counts). → tests in Task 5.
- User search with `%` or `_` in the query must match literally, not as wildcards. → test in Task 5.
- A moderator must not be able to suspend, or remove the posts of, another moderator or an admin; nobody can act on themselves or the owner. → test in Task 5.
- An admin credit removal that would go below zero must be refused with a clear message, not a database error. → test in Task 5.
- Paging the log must not repeat or skip entries when new events arrive between pages (page by id, not offset). → test in Task 3.

---

## File Structure

- Create `db/migrations/20261013120000_admin.sql` — roles, suspension, ban list, activity log.
- Create `server/roles.js` — `roleOf`, `requireMod`, `requireAdmin`, `requireActive`, `isOwnerSub`, `SUSPENDED`.
- Create `server/activity.js` — `logActivity`, `listActivity`, `pruneActivity`, `heldText`, `CHIPS`, `KINDS`.
- Create `server/users.js` — `listUsers`, `setSuspended`, `removeCommunityContent`, `adjustCredits`, `setRoles`, `deleteAndBan`.
- Create `netlify/functions/admin.js` — `/api/admin/*`.
- Modify `server/admin.js` — drop `isAdmin`/`requireAdmin`; "ban" → "suspend"; log suspensions.
- Modify `server/community.js` — `poster()` uses `requireActive`; log recipe posts, held/blocked items, reports.
- Modify `server/credits.js` — `withCredit` calls `requireActive`.
- Modify `server/accounts.js` — `isBannedSub`.
- Modify `netlify/functions/account.js` — ban check + sign-in logging; `/api/me` role fields.
- Modify `netlify/functions/community.js` — roles from `roleOf`; admin routes move out.
- Modify `src/lib/route.svelte.js`, `src/lib/account.svelte.js`, `src/App.svelte`, `src/components/Community.svelte`, `src/components/PostCard.svelte`, `src/components/ReviewQueue.svelte`, `src/style.css`.
- Create `src/components/Admin.svelte`, `src/components/AdminUsers.svelte`, `src/components/AdminLog.svelte`.
- Tests: create `tests/admin.test.js`; modify `tests/community.test.js`, `tests/accounts.test.js`, `tests/route.test.js`.

---

### Task 1: Migration and roles

**Files:**
- Create: `db/migrations/20261013120000_admin.sql`, `server/roles.js`
- Test: `tests/admin.test.js` (new)

**Interfaces:**
- Produces: `roleOf(accountId) → Promise<{ exists, owner, admin, mod, suspended, displayName }>`; `requireMod(id)`, `requireAdmin(id)`, `requireActive(id)` each resolve to that role object or throw `UserFacingError`; `isOwnerSub(sub) → boolean`; `SUSPENDED = "Your account is suspended."`.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/20261013120000_admin.sql
-- Roles, suspension, a ban list, and the admin activity log.
ALTER TABLE accounts ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN is_mod BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN suspended_at TIMESTAMPTZ;

-- The review queue's old "ban" stopped someone posting: that's a suspension
-- now. The banned column stays until the next release, because the previous
-- deploy's functions may still read it while this one builds.
UPDATE accounts SET suspended_at = now() WHERE banned;

-- Google accounts that were deleted and banned; nothing else about them is kept.
CREATE TABLE banned_subs (
  google_sub TEXT PRIMARY KEY,
  banned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL DEFAULT ''
);

-- What the admin Log tab shows. The name is copied in so entries still read
-- right after someone renames or is deleted.
CREATE TABLE activity_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,
  account_id BIGINT REFERENCES accounts (id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  text TEXT NOT NULL,
  link TEXT
);
CREATE INDEX activity_log_kind ON activity_log (kind, id DESC);
CREATE INDEX activity_log_created ON activity_log (created_at);
```

- [ ] **Step 2: Write the failing tests**

```js
// tests/admin.test.js
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
import { connect, useDatabase } from "../server/db.js";
import { findOrCreateAccount } from "../server/accounts.js";
import {
  requireActive,
  requireAdmin,
  requireMod,
  roleOf,
} from "../server/roles.js";

let server;
let db;

before(async () => {
  server = new NetlifyDB();
  const connectionString = await server.start();
  await server.applyMigrations("./db/migrations");
  db = connect(connectionString);
  useDatabase(db);
  process.env.SESSION_SECRET = "z".repeat(40);
});
after(async () => {
  await db?.pool.end();
  await server?.stop();
});

let n = 0;
const person = (displayName = "Ada", sub = `adm-${++n}`) =>
  findOrCreateAccount({ sub, displayName });
const pick = ({ owner, admin, mod, suspended }) => ({
  owner,
  admin,
  mod,
  suspended,
});

test("roles: owners come from ADMIN_SUBS, admins and mods from the database", async () => {
  const owner = await person("Owner", "owner-sub");
  const admin = await person("Ann");
  const mod = await person("Mo");
  const plain = await person("Pat");
  await db.sql`UPDATE accounts SET is_admin = true WHERE id = ${admin.id}`;
  await db.sql`UPDATE accounts SET is_mod = true WHERE id = ${mod.id}`;
  process.env.ADMIN_SUBS = "someone-else, owner-sub";
  try {
    assert.deepEqual(pick(await roleOf(owner.id)), {
      owner: true,
      admin: true,
      mod: true,
      suspended: false,
    });
    assert.deepEqual(pick(await roleOf(admin.id)), {
      owner: false,
      admin: true,
      mod: true,
      suspended: false,
    });
    assert.deepEqual(pick(await roleOf(mod.id)), {
      owner: false,
      admin: false,
      mod: true,
      suspended: false,
    });
    assert.deepEqual(pick(await roleOf(plain.id)), {
      owner: false,
      admin: false,
      mod: false,
      suspended: false,
    });
    assert.equal((await roleOf(admin.id)).displayName, "Ann");
    assert.equal((await roleOf(null)).exists, false);
    assert.equal((await roleOf(999999)).exists, false);
    await assert.rejects(requireMod(plain.id), /Only moderators/);
    await assert.rejects(requireAdmin(mod.id), /Only admins/);
    assert.equal((await requireMod(mod.id)).mod, true);
    assert.equal((await requireAdmin(admin.id)).admin, true);
  } finally {
    delete process.env.ADMIN_SUBS;
  }
  assert.equal((await roleOf(owner.id)).admin, false, "no longer listed");
});

test("a suspended account can't act, unless it's an owner", async () => {
  const sue = await person("Sue");
  await db.sql`UPDATE accounts SET suspended_at = now() WHERE id = ${sue.id}`;
  await assert.rejects(
    requireActive(sue.id),
    (e) => e.status === 403 && e.message === "Your account is suspended.",
  );
  await assert.rejects(requireActive(424242), (e) => e.status === 401);
  const oz = await person("Oz", "owner-oz");
  await db.sql`UPDATE accounts SET suspended_at = now() WHERE id = ${oz.id}`;
  process.env.ADMIN_SUBS = "owner-oz";
  try {
    assert.equal((await requireActive(oz.id)).suspended, false);
  } finally {
    delete process.env.ADMIN_SUBS;
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/admin.test.js`
Expected: FAIL with `Cannot find module '.../server/roles.js'`.

- [ ] **Step 4: Write `server/roles.js`**

```js
// server/roles.js
import { UserFacingError } from "./chef.js";
import { database } from "./db.js";

// Who may do what. Owners are the Google accounts listed in ADMIN_SUBS:
// always admin, so no one can lock the site's owner out from the admin page.
// Everyone else's roles live on their account row.
export const SUSPENDED = "Your account is suspended.";

const ownerSubs = () =>
  (process.env.ADMIN_SUBS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
export const isOwnerSub = (sub) => !!sub && ownerSubs().includes(sub);

const NOBODY = {
  exists: false,
  owner: false,
  admin: false,
  mod: false,
  suspended: false,
  displayName: "",
};

export async function roleOf(accountId) {
  if (!accountId) return NOBODY;
  const rows = await database().sql`
    SELECT google_sub, display_name, is_admin, is_mod, suspended_at
      FROM accounts WHERE id = ${accountId}`;
  const row = rows[0];
  if (!row) return NOBODY;
  const owner = isOwnerSub(row.google_sub);
  const admin = owner || row.is_admin;
  return {
    exists: true,
    owner,
    admin,
    mod: admin || row.is_mod,
    suspended: !owner && !!row.suspended_at,
    displayName: row.display_name,
  };
}

export async function requireMod(accountId) {
  const role = await roleOf(accountId);
  if (!role.mod) throw new UserFacingError("Only moderators can do that.", 403);
  return role;
}

export async function requireAdmin(accountId) {
  const role = await roleOf(accountId);
  if (!role.admin) throw new UserFacingError("Only admins can do that.", 403);
  return role;
}

// For anything that changes the community or spends credits.
export async function requireActive(accountId) {
  const role = await roleOf(accountId);
  if (!role.exists)
    throw new UserFacingError("Your account wasn't found. Sign in again.", 401);
  if (role.suspended) throw new UserFacingError(SUSPENDED, 403);
  return role;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/admin.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
npx prettier --write server/roles.js tests/admin.test.js
git add db/migrations/20261013120000_admin.sql server/roles.js tests/admin.test.js
git commit -m "Admin: roles, suspension, ban list, and activity log tables"
```

---

### Task 2: Enforce roles and suspension everywhere

**Files:**
- Modify: `server/admin.js` (drop `isAdmin`/`requireAdmin`, ban → suspend), `server/community.js:123-131` (`poster`), `server/credits.js`, `netlify/functions/community.js`, `netlify/functions/account.js`
- Test: `tests/community.test.js:25, 368-390`, `tests/accounts.test.js:131-136`

**Interfaces:**
- Consumes: `roleOf`, `requireMod`, `requireActive`, `SUSPENDED` (Task 1).
- Produces: `decide(type, id, action, actorId = null)` with actions `"approve" | "remove" | "suspend"`; review items carry `authorSuspended: boolean`; `/api/me` account adds `isMod`, `suspended`.

- [ ] **Step 1: Update the tests first**

In `tests/community.test.js`:
- Line 25: change `import { decide, isAdmin, reviewQueue } from "../server/admin.js";` to `import { decide, reviewQueue } from "../server/admin.js";`
- Replace the block from `  await decide("post", post.id, "ban");` through the end of that test (`});`) with:

```js
  await decide("post", post.id, "suspend");
  await assert.rejects(
    createPost(hal.id, recipe(), { mealType: "dinner" }, haiku("fine")),
    /Your account is suspended/,
  );
  await assert.rejects(toggleLike(hal.id, post.id), /Your account is suspended/);
  await assert.rejects(
    addComment(hal.id, post.id, "hi", haiku("fine")),
    /Your account is suspended/,
  );
  await assert.rejects(report(hal.id, "post", post.id), /suspended/);
  assert.ok(
    (await listPosts()).posts.length >= 0,
    "a suspended account can still browse",
  );
  const queued = (await reviewQueue()).find((i) => i.author === "Hal");
  if (queued) assert.equal(queued.authorSuspended, true);
});
```

- Replace the whole test `test("moderators come from ADMIN_SUBS, not the database", …)` with:

```js
test("moderators can be set in the database as well as ADMIN_SUBS", async () => {
  const { roleOf } = await import("../server/roles.js");
  const mod = await person("Mona");
  assert.equal((await roleOf(mod.id)).mod, false);
  await db.sql`UPDATE accounts SET is_mod = true WHERE id = ${mod.id}`;
  assert.equal((await roleOf(mod.id)).mod, true);
});
```


In `tests/accounts.test.js`, change the expected `/api/me` body:

```js
    account: {
      displayName: "Matthew",
      credits: 10,
      isAdmin: false,
      isMod: false,
      suspended: false,
    },
```

And add this test at the end of `tests/accounts.test.js`:

```js
test("a suspended account can't spend credits", async () => {
  const { id } = await findOrCreateAccount({ sub: "g-susp", displayName: "Sy" });
  await db.sql`UPDATE accounts SET suspended_at = now() WHERE id = ${id}`;
  process.env.SESSION_SECRET ??= "x".repeat(40);
  const cookie = sessionCookie(id, req("/")).split(";")[0];
  await assert.rejects(
    withCredit(req("/", { headers: { cookie } }), "idea", async () => ({})),
    /Your account is suspended/,
  );
  assert.equal((await getAccount(id)).credits, 10, "nothing was taken");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/community.test.js tests/accounts.test.js`
Expected: FAIL — `Unknown action.` for `"suspend"`, the `/api/me` shape mismatch, and the credits test resolving instead of rejecting.

- [ ] **Step 3: Update `server/admin.js`**

Delete the `isAdmin` and `requireAdmin` functions (and their comment). In `reviewQueue`, replace both `a.banned` selections with `a.suspended_at IS NOT NULL AS suspended` and the shaping line `authorBanned: r.banned,` with `authorSuspended: r.suspended,`. Replace `decide` with:

```js
// approve: make it live (and clear its reports); remove: take it down;
// suspend: take it down and make its author read-only.
export async function decide(type, id, action, actorId = null) {
  if (!["post", "comment"].includes(type))
    throw new UserFacingError("Unknown item.");
  if (!["approve", "remove", "suspend"].includes(action))
    throw new UserFacingError("Unknown action.");
  const table = type === "post" ? "posts" : "comments";
  return transaction(async (c) => {
    const found = await c.query(
      `SELECT status, account_id${type === "comment" ? ", post_id" : ""} FROM ${table} WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = found.rows[0];
    if (!row) throw new UserFacingError("That item wasn't found.", 404);
    const next = action === "approve" ? "live" : "removed";
    await c.query(
      `UPDATE ${table} SET status = $2, moderation_note = $3 WHERE id = $1`,
      [
        id,
        next,
        action === "approve"
          ? "Approved by a moderator"
          : "Removed by a moderator",
      ],
    );
    if (action === "approve")
      await c.query(
        `DELETE FROM reports WHERE target_type = $1 AND target_id = $2`,
        [type, id],
      );
    if (
      type === "comment" &&
      row.status !== next &&
      (row.status === "live" || next === "live")
    )
      await c.query(
        `UPDATE posts SET comment_count = comment_count + $2 WHERE id = $1`,
        [row.post_id, next === "live" ? 1 : -1],
      );
    if (action === "suspend")
      await c.query(
        `UPDATE accounts SET suspended_at = COALESCE(suspended_at, now()) WHERE id = $1`,
        [row.account_id],
      );
    return { status: next, authorId: Number(row.account_id) };
  });
}
```

(`actorId` is used for logging in Task 4.)

- [ ] **Step 4: `poster()` and `withCredit` use `requireActive`**

In `server/community.js`, add `import { requireActive } from "./roles.js";` with the other imports and replace `poster`:

```js
async function poster(accountId) {
  const role = await requireActive(accountId);
  return { id: accountId, display_name: role.displayName };
}
```

In `server/credits.js`, add `import { requireActive } from "./roles.js";` and, right after the `if (!accountId) throw …` block in `withCredit`, add:

```js
  await requireActive(accountId);
```

- [ ] **Step 5: Functions use `roleOf`**

In `netlify/functions/community.js`:
- Replace the `../../server/admin.js` import with `import { decide, queueCount, reviewQueue } from "../../server/admin.js";` and add `import { requireMod, roleOf } from "../../server/roles.js";`.
- Replace both `const moderator = await isAdmin(viewer);` with `const moderator = (await roleOf(viewer)).mod;`.
- Replace `await isAdmin(viewerOf(request))` with `(await roleOf(viewerOf(request))).mod`.
- In the two admin cases, replace `await requireAdmin(signedIn(request));` with `await requireMod(signedIn(request));` (these move to their own function in Task 6) and pass the actor to decide: `await decide(body.type, idFrom(body.id), body.action, signedIn(request))`.

In `netlify/functions/account.js`, replace `import { isAdmin } from "../../server/admin.js";` with `import { roleOf } from "../../server/roles.js";` and in `/api/me` replace `isAdmin: await isAdmin(account.id),` with:

```js
            ...(await roleOf(account.id).then((r) => ({
              isAdmin: r.admin,
              isMod: r.mod,
              suspended: r.suspended,
            }))),
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pass. If any test still references `isAdmin` from `server/admin.js` or the `"ban"` action, update it the same way.

- [ ] **Step 7: Commit**

```bash
npx prettier --write server/admin.js server/community.js server/credits.js netlify/functions/community.js netlify/functions/account.js tests/community.test.js tests/accounts.test.js
git add server netlify tests
git commit -m "Admin: roles from the database, suspended accounts are read-only"
```

---

### Task 3: Activity log module

**Files:**
- Create: `server/activity.js`
- Test: `tests/admin.test.js` (append)

**Interfaces:**
- Produces: `logActivity({ kind, accountId?, actorName, text, link? }) → Promise<void>` (never rejects); `listActivity({ chip = "all", before = null, limit = 50 }) → Promise<{ entries: Array<{ id, at, kind, name, text, link }>, more }>`; `pruneActivity() → Promise<void>`; `heldText(what, status, reason) → string`; `CHIPS`, `KINDS`.

- [ ] **Step 1: Write the failing tests** — add to the imports at the top of `tests/admin.test.js`:

```js
import {
  heldText,
  listActivity,
  logActivity,
  pruneActivity,
} from "../server/activity.js";
```

and append:

```js
test("the log lists entries newest first, filtered by chip, paged by id", async () => {
  await db.sql`DELETE FROM activity_log`;
  for (const name of ["S0", "S1", "S2"])
    await logActivity({ kind: "sign_in", actorName: name, text: "signed in" });
  await logActivity({
    kind: "recipe_post",
    actorName: "Ada",
    text: 'posted a recipe to the community: "Gratin"',
    link: "/community/5",
  });
  await logActivity({
    kind: "held",
    actorName: "Bo",
    text: heldText("posted in General", "held", "Might be an ad."),
    link: "/community/6",
  });
  const all = await listActivity();
  assert.deepEqual(
    all.entries.map((e) => e.name),
    ["Bo", "Ada", "S2", "S1", "S0"],
  );
  assert.equal(all.more, false);
  assert.equal(all.entries[1].link, "/community/5");
  assert.equal(
    all.entries[0].text,
    "posted in General but it was held for review: Might be an ad.",
  );
  assert.ok(!Number.isNaN(Date.parse(all.entries[0].at)));
  assert.deepEqual(
    (await listActivity({ chip: "problems" })).entries.map((e) => e.name),
    ["Bo"],
  );
  assert.equal((await listActivity({ chip: "signins" })).entries.length, 3);

  const page1 = await listActivity({ limit: 2 });
  assert.deepEqual(page1.entries.map((e) => e.name), ["Bo", "Ada"]);
  assert.equal(page1.more, true);
  // Something new arrives between pages; the next page still continues.
  await logActivity({ kind: "sign_in", actorName: "New", text: "signed in" });
  const page2 = await listActivity({ limit: 2, before: page1.entries[1].id });
  assert.deepEqual(page2.entries.map((e) => e.name), ["S2", "S1"]);
  await assert.rejects(listActivity({ chip: "nope" }), /Unknown filter/);
});

test("logging never throws, and entries older than 90 days are pruned", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    await logActivity({ kind: "not-a-kind", actorName: "X", text: "x" });
  } finally {
    console.error = quiet;
  }
  await db.sql`INSERT INTO activity_log (created_at, kind, actor_name, text)
    VALUES (now() - interval '91 days', 'sign_in', 'Old', 'signed in')`;
  await pruneActivity();
  const names = (await listActivity({ chip: "signins", limit: 200 })).entries.map(
    (e) => e.name,
  );
  assert.ok(!names.includes("Old"));
  assert.equal(heldText("commented", "blocked", ""), "commented but it was blocked");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/admin.test.js`
Expected: FAIL with `Cannot find module '.../server/activity.js'`.

- [ ] **Step 3: Write `server/activity.js`**

```js
// server/activity.js
import { UserFacingError } from "./chef.js";
import { database } from "./db.js";

// The admin Log tab: contributions, sign-ins, credits, and problems. Ordinary
// live forum posts, likes, and credit spends aren't logged on purpose.
export const CHIPS = {
  posts: ["recipe_post"],
  signins: ["joined", "sign_in"],
  credits: ["credits_purchase", "credits_adjust"],
  problems: ["held", "blocked", "report", "admin_action"],
};
export const KINDS = Object.values(CHIPS).flat();

const KEEP_DAYS = 90;
const HOUR = 3_600_000;
let lastPrune = 0;

// "posted in General but it was held for review: <reason>"
export const heldText = (what, status, reason) =>
  `${what} but it was ${status === "blocked" ? "blocked" : "held for review"}${reason ? `: ${reason}` : ""}`;

export async function pruneActivity() {
  await database()
    .sql`DELETE FROM activity_log WHERE created_at < now() - make_interval(days => ${KEEP_DAYS})`;
}

// Never throws: a failed log line must not undo or block what it describes.
export async function logActivity({
  kind,
  accountId = null,
  actorName,
  text,
  link = null,
}) {
  try {
    if (!KINDS.includes(kind)) throw new Error(`Unknown activity kind: ${kind}`);
    await database().sql`
      INSERT INTO activity_log (kind, account_id, actor_name, text, link)
      VALUES (${kind}, ${accountId}, ${String(actorName ?? "").slice(0, 80)},
              ${String(text).slice(0, 500)}, ${link})`;
    if (Date.now() - lastPrune > HOUR) {
      lastPrune = Date.now();
      await pruneActivity();
    }
  } catch (error) {
    console.error("activity log:", error);
  }
}

// Pages by id ("before" = the last id you have), so entries that arrive
// between pages never shift what comes next.
export async function listActivity({ chip = "all", before = null, limit = 50 } = {}) {
  const kinds = chip === "all" ? KINDS : CHIPS[chip];
  if (!kinds) throw new UserFacingError("Unknown filter.");
  const beforeId = Number(before) > 0 ? Number(before) : null;
  const take = Math.min(Math.max(1, Number(limit) || 50), 200);
  const rows = await database().sql`
    SELECT id, created_at, kind, actor_name, text, link
      FROM activity_log
     WHERE kind = ANY(${kinds}::text[])
       AND (${beforeId}::bigint IS NULL OR id < ${beforeId}::bigint)
     ORDER BY id DESC
     LIMIT ${take + 1}`;
  return {
    entries: rows.slice(0, take).map((r) => ({
      id: Number(r.id),
      at: new Date(r.created_at).toISOString(),
      kind: r.kind,
      name: r.actor_name,
      text: r.text,
      link: r.link,
    })),
    more: rows.length > take,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/admin.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
npx prettier --write server/activity.js tests/admin.test.js
git add server/activity.js tests/admin.test.js
git commit -m "Admin: activity log (write, list by chip, page by id, 90-day prune)"
```

---

### Task 4: Log the events, and refuse banned sign-ins

**Files:**
- Modify: `server/accounts.js` (add `isBannedSub`), `netlify/functions/account.js` (sign-in), `server/community.js` (`createPost`, `createThread`, `addComment`, `report`), `server/admin.js` (`decide` suspend)
- Test: `tests/accounts.test.js`, `tests/community.test.js` (append)

**Interfaces:**
- Consumes: `logActivity`, `heldText`, `listActivity` (Task 3); `roleOf` (Task 1).
- Produces: `isBannedSub(sub) → Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/accounts.test.js` (add `import { listActivity } from "../server/activity.js";` to its imports):

```js
test("sign-ins are logged (first time as joined), and banned Google accounts can't sign in", async () => {
  const signIn = async (sub, given_name) =>
    account(
      req("/api/auth/google", {
        method: "POST",
        body: JSON.stringify({ credential: await signer({ sub, given_name }) }),
      }),
    );
  assert.equal((await signIn("g-log", "Logan")).status, 200);
  assert.equal((await signIn("g-log", "Logan")).status, 200);
  const mine = (await listActivity({ chip: "signins", limit: 200 })).entries
    .filter((e) => e.name === "Logan")
    .map((e) => e.kind);
  assert.deepEqual(mine, ["sign_in", "joined"]);

  await db.sql`INSERT INTO banned_subs (google_sub) VALUES ('g-banned')`;
  const refused = await signIn("g-banned", "Bad");
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, "This Google account can't sign in here.");
  const rows = await db.sql`SELECT id FROM accounts WHERE google_sub = 'g-banned'`;
  assert.equal(rows.length, 0, "no account was created");
});
```

Append to `tests/community.test.js` (add `import { listActivity } from "../server/activity.js";` to its imports):

```js
test("recipe posts and problems reach the admin log; ordinary forum posts don't", async () => {
  const lia = await person("Lia");
  const logged = async () =>
    (await listActivity({ limit: 200 })).entries.filter((e) => e.name === "Lia");

  const shared = await createPost(lia.id, recipe(), { mealType: "dinner" }, haiku("fine"));
  await createThread(lia.id, { board: "general", title: "Hello all", body: "Hi" }, haiku("fine"));
  const held = await createThread(
    lia.id,
    { board: "support", title: "Buy this", body: "link in bio" },
    haiku("unsure", { reason: "Might be an ad." }),
  );
  await addComment(lia.id, shared.id, "rude words", haiku("blocked", { reason: "Abusive." }));
  const other = await person("Oli");
  await report(other.id, "post", shared.id, "Spam or advertising");

  const mine = await logged();
  assert.deepEqual(
    mine.map((e) => e.kind),
    ["blocked", "held", "recipe_post"],
    "the live forum thread isn't logged",
  );
  assert.equal(mine[2].text, 'posted a recipe to the community: "Pumpkin Gruyère Gratin"');
  assert.equal(mine[2].link, `/community/${shared.id}`);
  assert.equal(mine[1].text, "posted in Support but it was held for review: Might be an ad.");
  assert.equal(mine[1].link, `/community/${held.id}`);
  assert.match(mine[0].text, /^commented on "Pumpkin Gruyère Gratin" but it was blocked: Abusive\.$/);
  const reportEntry = (await listActivity({ chip: "problems", limit: 200 })).entries.find(
    (e) => e.name === "Oli",
  );
  assert.equal(reportEntry.kind, "report");
  assert.equal(reportEntry.text, "reported a post: Spam or advertising");
  assert.equal(reportEntry.link, `/community/${shared.id}`);
});
```


- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/accounts.test.js tests/community.test.js`
Expected: FAIL — no log entries (`[]` vs expected kinds) and the banned sign-in returns 200.

- [ ] **Step 3: `isBannedSub` and sign-in**

Append to `server/accounts.js`:

```js
// A Google account that was deleted and banned from the admin page.
export async function isBannedSub(sub) {
  const rows = await database()
    .sql`SELECT 1 FROM banned_subs WHERE google_sub = ${sub}`;
  return rows.length > 0;
}
```

In `netlify/functions/account.js`, import `isBannedSub` and `WELCOME_CREDITS` from `../../server/accounts.js` and `logActivity` from `../../server/activity.js`, then replace

```js
    const person = await verifyGoogleToken(body?.credential);
    const account = await findOrCreateAccount(person);
```

with

```js
    const person = await verifyGoogleToken(body?.credential);
    if (await isBannedSub(person.sub))
      throw new UserFacingError("This Google account can't sign in here.", 403);
    const account = await findOrCreateAccount(person);
    await logActivity({
      kind: account.isNew ? "joined" : "sign_in",
      accountId: account.id,
      actorName: account.displayName,
      text: account.isNew
        ? `joined (new account, ${WELCOME_CREDITS} credits)`
        : "signed in",
    });
```

- [ ] **Step 4: Community events**

In `server/community.js`, add `import { heldText, logActivity } from "./activity.js";`.

`createPost`: change `await poster(accountId);` to `const who = await poster(accountId);` and replace its `return { … }` with:

```js
  const id = Number(rows[0].id);
  const status = rows[0].status;
  await logActivity(
    status === "live"
      ? {
          kind: "recipe_post",
          accountId,
          actorName: who.display_name,
          text: `posted a recipe to the community: "${recipe.name}"`,
          link: `/community/${id}`,
        }
      : {
          kind: status,
          accountId,
          actorName: who.display_name,
          text: heldText(`posted the recipe "${recipe.name}"`, status, review.reason),
          link: `/community/${id}`,
        },
  );
  return { id, status, reason: review.reason };
```

`createThread`: change `await poster(accountId);` to `const who = await poster(accountId);` and replace its `return { … }` with:

```js
  const id = Number(rows[0].id);
  const status = rows[0].status;
  if (status !== "live")
    await logActivity({
      kind: status,
      accountId,
      actorName: who.display_name,
      text: heldText(
        `posted in ${board === "support" ? "Support" : "General"}`,
        status,
        review.reason,
      ),
      link: `/community/${id}`,
    });
  return { id, status, reason: review.reason };
```

`addComment`: change `await poster(accountId);` to `const who = await poster(accountId);`; change the post lookup to select the name — `SELECT status, name FROM posts WHERE id = ${postId}` — and after the transaction that inserts the comment (keep its return value in a variable `result` instead of returning directly), add:

```js
  if (result.status !== "live")
    await logActivity({
      kind: result.status,
      accountId,
      actorName: who.display_name,
      text: heldText(`commented on "${post[0].name}"`, result.status, result.reason),
      link: `/community/${postId}`,
    });
  return result;
```

`report`: change `await poster(accountId);` to `const who = await poster(accountId);`, keep the transaction's value in `const result = await transaction(…)`, then:

```js
  const postId =
    type === "post"
      ? targetId
      : Number(
          (await database().sql`SELECT post_id FROM comments WHERE id = ${targetId}`)[0]
            ?.post_id ?? 0,
        );
  await logActivity({
    kind: "report",
    accountId,
    actorName: who.display_name,
    text: `reported a ${type}${result.hidden ? " (now hidden for review)" : ""}${reason ? `: ${String(reason).slice(0, 300)}` : ""}`,
    link: postId ? `/community/${postId}` : null,
  });
  return result;
```

- [ ] **Step 5: Log suspensions from the review queue**

In `server/admin.js`, add `import { logActivity } from "./activity.js";` and `import { roleOf } from "./roles.js";`. Rename the existing `decide` body's `return transaction(…)` to `const result = await transaction(…)`, then after it:

```js
  if (action === "suspend") {
    const [actor, author] = await Promise.all([roleOf(actorId), roleOf(result.authorId)]);
    await logActivity({
      kind: "admin_action",
      accountId: actorId,
      actorName: actor.displayName || "A moderator",
      text: `suspended ${author.displayName} from the review queue`,
    });
  }
  return { status: result.status };
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
npx prettier --write server netlify/functions/account.js tests/accounts.test.js tests/community.test.js
git add server netlify/functions/account.js tests
git commit -m "Admin: log sign-ins, recipe posts, held/blocked items, reports, suspensions; refuse banned sign-ins"
```

---

### Task 5: User actions

**Files:**
- Create: `server/users.js`
- Test: `tests/admin.test.js` (append)

**Interfaces:**
- Consumes: `requireMod`, `requireAdmin`, `isOwnerSub` (Task 1); `logActivity`, `listActivity` (Task 3); `addCredits` (`server/accounts.js`).
- Produces (all take the acting account id first and check its role):
  - `listUsers(actorId, { query = "", offset = 0 }) → { users: User[], more }`
  - `setSuspended(actorId, id, on: boolean) → User`
  - `removeCommunityContent(actorId, id) → { posts: number, comments: number }`
  - `adjustCredits(actorId, id, amount: number, reason: string) → { credits }`
  - `setRoles(actorId, id, { admin?: boolean, mod?: boolean }) → User`
  - `deleteAndBan(actorId, id, confirm: string) → { deleted: true }`
  - `User = { id, displayName, credits, joinedAt (ISO), posts, suspended, owner, admin, mod }` where `admin` = owner or `is_admin`, `mod` = the raw `is_mod` flag.

- [ ] **Step 1: Write the failing tests** — add to the top imports of `tests/admin.test.js`:

```js
import { getAccount } from "../server/accounts.js";
import { addComment, createThread, toggleLike } from "../server/community.js";
import {
  adjustCredits,
  deleteAndBan,
  listUsers,
  removeCommunityContent,
  setRoles,
  setSuspended,
} from "../server/users.js";
```

and add this helper below `pick`:

```js
// Haiku stand-in: every review comes back "fine".
const fine = {
  messages: {
    create: async () => ({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          name: "submit_review",
          input: { verdict: "fine", reason: "Fine.", meal_type: "dinner" },
        },
      ],
    }),
  },
};
const staff = async () => {
  const admin = await person("Adele");
  const mod = await person("Moe");
  await db.sql`UPDATE accounts SET is_admin = true WHERE id = ${admin.id}`;
  await db.sql`UPDATE accounts SET is_mod = true WHERE id = ${mod.id}`;
  return { admin, mod };
};
```

then append:

```js
test("user search: newest first, by name, with % and _ matched literally", async () => {
  const { mod } = await staff();
  await person("Percent%Pat");
  await person("Under_Ursula");
  await person("Plainly");
  const named = (r) => r.users.map((u) => u.displayName);
  assert.deepEqual(named(await listUsers(mod.id, { query: "%" })), ["Percent%Pat"]);
  assert.deepEqual(named(await listUsers(mod.id, { query: "_" })), ["Under_Ursula"]);
  assert.equal((await listUsers(mod.id)).users[0].displayName, "Plainly");
  const pat = await person("Pat Plain");
  await assert.rejects(listUsers(pat.id), /Only moderators/);
});

test("mods suspend and remove posts, but not other staff, themselves, or the owner", async () => {
  const { admin, mod } = await staff();
  const kid = await person("Kid");
  const suspended = await setSuspended(mod.id, kid.id, true);
  assert.equal(suspended.suspended, true);
  assert.equal((await setSuspended(mod.id, kid.id, false)).suspended, false);
  await assert.rejects(setSuspended(mod.id, admin.id, true), /Only admins can do that to a moderator/);
  await assert.rejects(setSuspended(mod.id, mod.id, true), /your own account/);
  const own = await person("Own", "owner-x");
  process.env.ADMIN_SUBS = "owner-x";
  try {
    await assert.rejects(setSuspended(admin.id, own.id, true), /site owner/);
  } finally {
    delete process.env.ADMIN_SUBS;
  }
  const log = (await listActivity({ chip: "problems", limit: 200 })).entries;
  assert.ok(log.some((e) => e.name === "Moe" && e.text === "suspended Kid"));
  assert.ok(log.some((e) => e.name === "Moe" && e.text === "unsuspended Kid"));
});

test("removing someone's community content keeps other posts' comment counts right", async () => {
  const { mod } = await staff();
  const host = await person("Host");
  const troll = await person("Troll");
  const thread = await createThread(host.id, { board: "general", title: "Hello there", body: "Hi" }, fine);
  await addComment(troll.id, thread.id, "first", fine);
  await addComment(troll.id, thread.id, "second", fine);
  await createThread(troll.id, { board: "general", title: "Troll post", body: "x" }, fine);
  const before = await db.sql`SELECT comment_count FROM posts WHERE id = ${thread.id}`;
  assert.equal(before[0].comment_count, 2);
  assert.deepEqual(await removeCommunityContent(mod.id, troll.id), { posts: 1, comments: 2 });
  const after = await db.sql`SELECT comment_count FROM posts WHERE id = ${thread.id}`;
  assert.equal(after[0].comment_count, 0);
  const left = await db.sql`SELECT count(*)::int AS n FROM posts WHERE account_id = ${troll.id} AND status <> 'removed'`;
  assert.equal(left[0].n, 0);
});

test("credits: admins only, a reason is required, and never below zero", async () => {
  const { admin, mod } = await staff();
  const cy = await person("Cy");
  await assert.rejects(adjustCredits(mod.id, cy.id, 5, "thanks"), /Only admins/);
  await assert.rejects(adjustCredits(admin.id, cy.id, 5, "  "), /Add a reason/);
  await assert.rejects(adjustCredits(admin.id, cy.id, 1.5, "x"), /whole number/);
  assert.deepEqual(await adjustCredits(admin.id, cy.id, 50, "beta tester thanks"), { credits: 60 });
  await assert.rejects(
    adjustCredits(admin.id, cy.id, -61, "oops"),
    /below 0 credits \(they have 60\)/,
  );
  assert.deepEqual(await adjustCredits(admin.id, cy.id, -60, "reset"), { credits: 0 });
  const ledger = await db.sql`SELECT change, reason FROM credit_ledger WHERE account_id = ${cy.id} ORDER BY id`;
  assert.deepEqual(
    ledger.map((r) => [r.change, r.reason]),
    [[10, "welcome"], [50, "admin:beta tester thanks"], [-60, "admin:reset"]],
  );
  const entry = (await listActivity({ chip: "credits", limit: 200 })).entries.find(
    (e) => e.name === "Cy" && e.text.startsWith("got +50"),
  );
  assert.equal(entry.text, 'got +50 credits from Adele: "beta tester thanks"');
});

test("roles: admins set them, can't drop their own admin, can't touch the owner", async () => {
  const { admin, mod } = await staff();
  const dee = await person("Dee");
  await assert.rejects(setRoles(mod.id, dee.id, { mod: true }), /Only admins/);
  assert.equal((await setRoles(admin.id, dee.id, { mod: true })).mod, true);
  assert.equal((await setRoles(admin.id, dee.id, { admin: true })).admin, true);
  await assert.rejects(setRoles(admin.id, admin.id, { admin: false }), /your own admin role/);
  const log = (await listActivity({ chip: "problems", limit: 200 })).entries;
  assert.ok(log.some((e) => e.text === "changed Dee's roles: made them a moderator"));
});

test("delete & ban erases everything, fixes counts on others' posts, and blocks that Google account", async () => {
  const { admin } = await staff();
  const host = await person("Hosta");
  const gone = await person("Gone", "gone-sub");
  const thread = await createThread(host.id, { board: "general", title: "Popular one", body: "Hi" }, fine);
  await toggleLike(gone.id, thread.id);
  await addComment(gone.id, thread.id, "hello", fine);
  await assert.rejects(deleteAndBan(admin.id, gone.id, "gone"), /Type their display name/);
  assert.deepEqual(await deleteAndBan(admin.id, gone.id, " Gone "), { deleted: true });
  assert.equal(await getAccount(gone.id), null);
  const post = await db.sql`SELECT like_count, comment_count FROM posts WHERE id = ${thread.id}`;
  assert.deepEqual(post[0], { like_count: 0, comment_count: 0 });
  const banned = await db.sql`SELECT google_sub FROM banned_subs WHERE google_sub = 'gone-sub'`;
  assert.equal(banned.length, 1);
  await assert.rejects(setSuspended(admin.id, gone.id, true), /no longer exists/);
  const log = (await listActivity({ chip: "problems", limit: 200 })).entries;
  assert.ok(log.some((e) => e.name === "Adele" && e.text === "deleted and banned Gone"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/admin.test.js`
Expected: FAIL with `Cannot find module '.../server/users.js'`.

- [ ] **Step 3: Write `server/users.js`**

```js
// server/users.js
import { addCredits } from "./accounts.js";
import { logActivity } from "./activity.js";
import { UserFacingError } from "./chef.js";
import { database, transaction } from "./db.js";
import { isOwnerSub, requireAdmin, requireMod } from "./roles.js";

// What mods and admins can do to an account from the Users tab. Every action
// checks the actor's role here, whatever the page showed them.
const PAGE = 25;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const COLUMNS = `a.id, a.google_sub, a.display_name, a.credits, a.is_admin,
  a.is_mod, a.suspended_at, a.created_at,
  (SELECT count(*)::int FROM posts p WHERE p.account_id = a.id AND p.status <> 'removed') AS posts`;

function shape(r) {
  const owner = isOwnerSub(r.google_sub);
  return {
    id: Number(r.id),
    displayName: r.display_name,
    credits: Number(r.credits),
    joinedAt: new Date(r.created_at).toISOString(),
    posts: Number(r.posts ?? 0),
    suspended: !owner && !!r.suspended_at,
    owner,
    admin: owner || r.is_admin,
    mod: r.is_mod,
  };
}

async function target(id) {
  const { rows } = await database().pool.query(
    `SELECT ${COLUMNS} FROM accounts a WHERE a.id = $1`,
    [id],
  );
  if (!rows[0]) throw new UserFacingError("That user no longer exists.", 404);
  return rows[0];
}

// Nobody acts on the owner or on themselves; only admins act on staff.
function guard(actor, actorId, t) {
  if (isOwnerSub(t.google_sub))
    throw new UserFacingError("The site owner's account can't be changed here.", 403);
  if (Number(t.id) === Number(actorId))
    throw new UserFacingError("You can't do that to your own account.", 403);
  if ((t.is_admin || t.is_mod) && !actor.admin)
    throw new UserFacingError("Only admins can do that to a moderator or admin.", 403);
}

const note = (actorId, actor, text) =>
  logActivity({ kind: "admin_action", accountId: actorId, actorName: actor.displayName, text });

export async function listUsers(actorId, { query = "", offset = 0 } = {}) {
  await requireMod(actorId);
  // % and _ are wildcards in ILIKE; escape them so names match literally.
  const q = String(query ?? "").trim().slice(0, 60).replace(/[\\%_]/g, "\\$&");
  const from = Math.max(0, Math.floor(Number(offset) || 0));
  const { rows } = await database().pool.query(
    `SELECT ${COLUMNS} FROM accounts a
      WHERE $1::text = '' OR a.display_name ILIKE '%' || $1::text || '%'
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $2 OFFSET $3`,
    [q, PAGE + 1, from],
  );
  return { users: rows.slice(0, PAGE).map(shape), more: rows.length > PAGE };
}

export async function setSuspended(actorId, id, on) {
  const actor = await requireMod(actorId);
  const t = await target(id);
  guard(actor, actorId, t);
  await database()
    .sql`UPDATE accounts SET suspended_at = ${on ? new Date() : null} WHERE id = ${id}`;
  await note(actorId, actor, `${on ? "suspended" : "unsuspended"} ${t.display_name}`);
  return shape(await target(id));
}

export async function removeCommunityContent(actorId, id) {
  const actor = await requireMod(actorId);
  const t = await target(id);
  guard(actor, actorId, t);
  const counts = await transaction(async (c) => {
    const posts = await c.query(
      `UPDATE posts SET status = 'removed', moderation_note = 'Removed by a moderator'
        WHERE account_id = $1 AND status <> 'removed' RETURNING id`,
      [id],
    );
    // Their live comments are counted on other people's posts too.
    const comments = await c.query(
      `WITH gone AS (
         SELECT id, post_id, status FROM comments
          WHERE account_id = $1 AND status <> 'removed' FOR UPDATE
       ), done AS (
         UPDATE comments c SET status = 'removed', moderation_note = 'Removed by a moderator'
           FROM gone WHERE c.id = gone.id
         RETURNING gone.post_id, gone.status
       )
       SELECT post_id, count(*)::int AS n,
              (count(*) FILTER (WHERE status = 'live'))::int AS live
         FROM done GROUP BY post_id`,
      [id],
    );
    for (const r of comments.rows)
      if (r.live)
        await c.query(
          `UPDATE posts SET comment_count = GREATEST(comment_count - $2, 0) WHERE id = $1`,
          [r.post_id, r.live],
        );
    return {
      posts: posts.rowCount,
      comments: comments.rows.reduce((sum, r) => sum + r.n, 0),
    };
  });
  await note(
    actorId,
    actor,
    `removed ${t.display_name}'s community posts (${plural(counts.posts, "post")}, ${plural(counts.comments, "comment")})`,
  );
  return counts;
}

export async function adjustCredits(actorId, id, amount, reason) {
  const actor = await requireAdmin(actorId);
  const change = Number(amount);
  if (!Number.isInteger(change) || change === 0 || Math.abs(change) > 10000)
    throw new UserFacingError("Enter a whole number of credits, like 20 or -5.");
  const why = String(reason ?? "").trim().slice(0, 200);
  if (!why) throw new UserFacingError("Add a reason; it goes in their credit history.");
  const t = await target(id);
  if (Number(t.credits) + change < 0)
    throw new UserFacingError(
      `That would take ${t.display_name} below 0 credits (they have ${t.credits}).`,
    );
  const credits = await addCredits(Number(id), change, `admin:${why}`);
  await logActivity({
    kind: "credits_adjust",
    accountId: Number(id),
    actorName: t.display_name,
    text: `got ${change > 0 ? "+" : ""}${change} credits from ${actor.displayName}: "${why}"`,
  });
  return { credits };
}

export async function setRoles(actorId, id, { admin, mod } = {}) {
  const actor = await requireAdmin(actorId);
  const t = await target(id);
  if (isOwnerSub(t.google_sub))
    throw new UserFacingError("The site owner's account can't be changed here.", 403);
  const next = { admin: admin ?? t.is_admin, mod: mod ?? t.is_mod };
  if (typeof next.admin !== "boolean" || typeof next.mod !== "boolean")
    throw new UserFacingError("Roles are either on or off.");
  if (Number(id) === Number(actorId) && !next.admin)
    throw new UserFacingError("You can't remove your own admin role.", 403);
  await database()
    .sql`UPDATE accounts SET is_admin = ${next.admin}, is_mod = ${next.mod} WHERE id = ${id}`;
  const changes = [];
  if (next.admin !== t.is_admin)
    changes.push(next.admin ? "made them an admin" : "removed their admin role");
  if (next.mod !== t.is_mod)
    changes.push(next.mod ? "made them a moderator" : "removed their moderator role");
  if (changes.length)
    await note(actorId, actor, `changed ${t.display_name}'s roles: ${changes.join(", ")}`);
  return shape(await target(id));
}

export async function deleteAndBan(actorId, id, confirm) {
  const actor = await requireAdmin(actorId);
  const t = await target(id);
  guard(actor, actorId, t);
  if (String(confirm ?? "").trim() !== t.display_name)
    throw new UserFacingError("Type their display name exactly to confirm.");
  await transaction(async (c) => {
    // Cascading deletes would leave their likes and live comments counted on
    // other people's posts, so take those off first.
    await c.query(
      `UPDATE posts p SET like_count = GREATEST(p.like_count - 1, 0)
         FROM post_likes l WHERE l.post_id = p.id AND l.account_id = $1`,
      [id],
    );
    await c.query(
      `UPDATE posts p SET comment_count = GREATEST(p.comment_count - x.n, 0)
         FROM (SELECT post_id, count(*)::int AS n FROM comments
                WHERE account_id = $1 AND status = 'live' GROUP BY post_id) x
        WHERE p.id = x.post_id`,
      [id],
    );
    await c.query(
      `INSERT INTO banned_subs (google_sub, reason) VALUES ($1, $2)
       ON CONFLICT (google_sub) DO NOTHING`,
      [t.google_sub, `deleted by ${actor.displayName}`],
    );
    await c.query(`DELETE FROM accounts WHERE id = $1`, [id]);
  });
  await note(actorId, actor, `deleted and banned ${t.display_name}`);
  return { deleted: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/admin.test.js`
Expected: PASS (all tests in the file). Then `npm test` — all pass.

- [ ] **Step 5: Commit**

```bash
npx prettier --write server/users.js tests/admin.test.js
git add server/users.js tests/admin.test.js
git commit -m "Admin: user actions (search, suspend, remove posts, credits, roles, delete & ban)"
```

---

### Task 6: Admin endpoints

**Files:**
- Create: `netlify/functions/admin.js`
- Modify: `netlify/functions/community.js` (drop `/api/admin/*` from `config.path`, drop the two admin cases and unused imports)
- Test: `tests/admin.test.js` (append)

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: `GET /api/admin/queue → { items }`, `POST /api/admin/decide {type,id,action}`, `GET /api/admin/users?q=&offset= → { users, more }`, `POST /api/admin/users/:id/suspend {on}`, `POST /api/admin/users/:id/remove-content`, `POST /api/admin/users/:id/credits {amount, reason}`, `POST /api/admin/users/:id/roles {admin?, mod?}`, `POST /api/admin/users/:id/delete {confirm}`, `GET /api/admin/log?chip=&before= → { entries, more }`.

- [ ] **Step 1: Write the failing test** — append to `tests/admin.test.js`:

```js
test("admin endpoints: sign-in required, mods vs admins enforced by the server", async () => {
  const { default: handler } = await import("../netlify/functions/admin.js");
  const { sessionCookie } = await import("../server/session.js");
  const { admin, mod } = await staff();
  const plain = await person("Plain Jane");
  const as = (who) => ({
    cookie: sessionCookie(who.id, new Request("https://example.com/")).split(";")[0],
  });
  const call = (path, who, body) =>
    handler(
      new Request(`https://example.com${path}`, {
        method: body ? "POST" : "GET",
        headers: { ...(who ? as(who) : {}), "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );

  assert.equal((await call("/api/admin/users")).status, 401);
  assert.equal((await call("/api/admin/users", plain)).status, 403);
  const users = await call("/api/admin/users?q=Plain", mod);
  assert.equal(users.status, 200);
  assert.equal((await users.json()).users[0].displayName, "Plain Jane");
  assert.equal((await call("/api/admin/log?chip=problems", mod)).status, 200);
  assert.equal((await call("/api/admin/log?chip=bad", mod)).status, 400);
  assert.equal((await call("/api/admin/queue", mod)).status, 200);
  assert.equal(
    (await call(`/api/admin/users/${plain.id}/credits`, mod, { amount: 5, reason: "x" })).status,
    403,
  );
  const credited = await call(`/api/admin/users/${plain.id}/credits`, admin, { amount: 5, reason: "welcome back" });
  assert.equal(credited.status, 200);
  assert.deepEqual(await credited.json(), { credits: 15 });
  const suspended = await call(`/api/admin/users/${plain.id}/suspend`, mod, { on: true });
  assert.equal((await suspended.json()).suspended, true);
  assert.equal((await call(`/api/admin/users/999999/suspend`, mod, { on: true })).status, 404);
  assert.equal((await call("/api/admin/nope", mod)).status, 404);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/admin.test.js`
Expected: FAIL with `Cannot find module '.../netlify/functions/admin.js'`.

- [ ] **Step 3: Write `netlify/functions/admin.js`**

```js
// netlify/functions/admin.js
import { decide, reviewQueue } from "../../server/admin.js";
import { listActivity } from "../../server/activity.js";
import { UserFacingError } from "../../server/chef.js";
import { fail } from "../../server/http.js";
import { requireMod } from "../../server/roles.js";
import { readSession } from "../../server/session.js";
import {
  adjustCredits,
  deleteAndBan,
  listUsers,
  removeCommunityContent,
  setRoles,
  setSuspended,
} from "../../server/users.js";

// The admin page's API. Each case (or the users.js function it calls)
// checks whether the signed-in account is a mod or an admin.
export const config = {
  path: "/api/admin/*",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

const noStore = { headers: { "Cache-Control": "no-store" } };

function signedIn(request) {
  const id = process.env.SESSION_SECRET ? readSession(request) : null;
  if (!id) throw new UserFacingError("Sign in first.", 401);
  return id;
}

const idFrom = (value) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1)
    throw new UserFacingError("That item wasn't found.", 404);
  return id;
};

const json = (request) =>
  request.json().catch(() => {
    throw new UserFacingError("Send the request as JSON.");
  });

export default async function handler(request) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean).slice(2); // after "api/admin"
  const route = `${request.method} ${parts.map((p) => (/^\d+$/.test(p) ? ":id" : p)).join("/")}`;
  const id = parts.find((p) => /^\d+$/.test(p));
  try {
    const actor = signedIn(request);
    switch (route) {
      case "GET queue":
        await requireMod(actor);
        return Response.json({ items: await reviewQueue() }, noStore);
      case "POST decide": {
        await requireMod(actor);
        const body = await json(request);
        return Response.json(await decide(body.type, idFrom(body.id), body.action, actor));
      }
      case "GET users":
        return Response.json(
          await listUsers(actor, {
            query: url.searchParams.get("q") ?? "",
            offset: url.searchParams.get("offset") ?? 0,
          }),
          noStore,
        );
      case "POST users/:id/suspend": {
        const body = await json(request);
        return Response.json(await setSuspended(actor, idFrom(id), body.on === true));
      }
      case "POST users/:id/remove-content":
        return Response.json(await removeCommunityContent(actor, idFrom(id)));
      case "POST users/:id/credits": {
        const body = await json(request);
        return Response.json(await adjustCredits(actor, idFrom(id), body.amount, body.reason));
      }
      case "POST users/:id/roles": {
        const body = await json(request);
        return Response.json(await setRoles(actor, idFrom(id), { admin: body.admin, mod: body.mod }));
      }
      case "POST users/:id/delete": {
        const body = await json(request);
        return Response.json(await deleteAndBan(actor, idFrom(id), body.confirm));
      }
      case "GET log":
        await requireMod(actor);
        return Response.json(
          await listActivity({
            chip: url.searchParams.get("chip") || "all",
            before: url.searchParams.get("before"),
          }),
          noStore,
        );
      default:
        return Response.json({ error: "Not found." }, { status: 404 });
    }
  } catch (error) {
    return fail(error);
  }
}
```

- [ ] **Step 4: Remove the admin routes from the community function**

In `netlify/functions/community.js`: change `path: ["/api/community", "/api/community/*", "/api/admin/*"]` to `path: ["/api/community", "/api/community/*"]`; delete the `case "GET admin/queue":` and `case "POST admin/decide": { … }` blocks; change the admin import to `import { queueCount } from "../../server/admin.js";` and the roles import to `import { roleOf } from "../../server/roles.js";`. Update the header comment ("the review queue needs a moderator") to "moderators see what's waiting for review".

In `tests/community.test.js`, the endpoints test calls `/api/admin/queue` through the community handler; change those two lines to use the admin handler:

```js
  const { default: adminHandler } = await import("../netlify/functions/admin.js");
  const queue = await adminHandler(
    new Request("https://example.com/api/admin/queue", { headers: { cookie } }),
  );
  assert.equal(queue.status, 403, "signed in but not a moderator");
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
npx prettier --write netlify/functions/admin.js netlify/functions/community.js tests/admin.test.js tests/community.test.js
git add netlify/functions tests
git commit -m "Admin: /api/admin endpoints for the queue, users, and log"
```

---

### Task 7: Client wiring — route, roles, header link, suspended banner, Admin page with Reviews

**Files:**
- Modify: `src/lib/route.svelte.js`, `src/lib/account.svelte.js`, `src/App.svelte`, `src/components/Community.svelte`, `src/components/PostCard.svelte`, `src/components/ReviewQueue.svelte`, `src/style.css`
- Create: `src/components/Admin.svelte`
- Test: `tests/route.test.js`

**Interfaces:**
- Consumes: `/api/me` `isAdmin`, `isMod`, `suspended` (Task 2); `/api/admin/queue`, `/api/admin/decide` (Task 6).
- Produces: `parse("/admin/users") → { tab: "admin", postId: null, recipeId: null, adminTab: "users" }`; `pathFor({ tab: "admin", adminTab })`; `account.isMod`, `account.suspended`; `<Admin adminTab />`; `<ReviewQueue onchange={(count) => …} />` (optional `onclose`).

- [ ] **Step 1: Write the failing route test** — append inside the existing test's body in `tests/route.test.js`, before its closing `},`:

```js
    assert.deepEqual(parse("/admin"), {
      tab: "admin",
      postId: null,
      recipeId: null,
      adminTab: "reviews",
    });
    assert.equal(parse("/admin/users").adminTab, "users");
    assert.equal(parse("/admin/log").adminTab, "log");
    assert.equal(parse("/admin/whatever").adminTab, "reviews");
    assert.equal(pathFor({ tab: "admin" }), "/admin");
    assert.equal(pathFor({ tab: "admin", adminTab: "reviews" }), "/admin");
    assert.equal(pathFor({ tab: "admin", adminTab: "log" }), "/admin/log");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/route.test.js`
Expected: FAIL (`/admin` parses as `community`). If the test is skipped ("needs the Svelte compiler"), note that and verify the route by hand in Step 7.

- [ ] **Step 3: Route**

In `src/lib/route.svelte.js`, add `//   /admin  Admin (Reviews); /admin/users, /admin/log` to the header comment, then:

```js
const ADMIN_TABS = ["reviews", "users", "log"];

export function parse(pathname) {
  const [section = "", id = ""] = pathname.split("/").filter(Boolean);
  const tab =
    section === "admin"
      ? "admin"
      : section
        ? (TABS[section] ?? "community")
        : "home";
  return {
    tab,
    postId: tab === "community" && /^\d+$/.test(id) ? Number(id) : null,
    recipeId: tab === "saved" && id ? decodeURIComponent(id) : null,
    ...(tab === "admin"
      ? { adminTab: ADMIN_TABS.includes(id) ? id : "reviews" }
      : {}),
  };
}

export function pathFor({ tab, postId = null, recipeId = null, adminTab = null }) {
  if (tab === "admin")
    return adminTab && adminTab !== "reviews" ? `/admin/${adminTab}` : "/admin";
  if (tab === "community" && postId) return `/community/${postId}`;
  if (tab === "saved" && recipeId)
    return `/recipes/${encodeURIComponent(recipeId)}`;
  return PATHS[tab] ?? "/";
}
```

Run `node --test tests/route.test.js` — PASS.

- [ ] **Step 4: Account flags**

In `src/lib/account.svelte.js`, add `isMod: false,` and `suspended: false,` to the `account` state object next to `isAdmin`, and in `apply` add:

```js
  account.isMod = !!body?.account?.isMod;
  account.suspended = !!body?.account?.suspended;
```

In `src/components/Community.svelte` and `src/components/PostCard.svelte`, replace every `account.isAdmin` with `account.isMod` (moderation tools are for mods and admins).

- [ ] **Step 5: ReviewQueue becomes a tab body**

In `src/components/ReviewQueue.svelte`:
- `let { onclose } = $props();` → `let { onclose = null, onchange = () => {} } = $props();`
- In `load`, after setting `items`, call `onchange(items.length);`; in `decide`, after the `items = items.filter(…)` line, call `onchange(items.length);`.
- Root element: `<main id="results" tabindex="-1" class="review">` → `<section class="review">`, and the closing `</main>` → `</section>`.
- In the head: `<h1>Review queue</h1>` → `<h2>Review queue</h2>`; wrap the back button: `{#if onclose}<button class="outline-button" onclick={onclose}>Back to the community</button>{/if}`.
- `{item.authorBanned ? ' (banned)' : ''}` → `{item.authorSuspended ? ' (suspended)' : ''}`.
- The ban button → `<button class="danger-button" disabled={busy || item.authorSuspended} onclick={() => decide(item, 'suspend')}>Remove and suspend {item.author}</button>`.

In `src/style.css`, change `.review-head h1 {` to `.review-head h2 {` (keeping its `margin: 0 0 6px;`).

- [ ] **Step 6: Admin page shell, Community link, header, banner**

Create `src/components/Admin.svelte`:

```svelte
<script>
  import ReviewQueue from './ReviewQueue.svelte';
  import { account, api } from '../lib/account.svelte.js';
  import { navigate } from '../lib/route.svelte.js';

  // The admin page. The server checks every request; this only hides what
  // the signed-in person can't use.
  let { adminTab = 'reviews' } = $props();
  let queue = $state(0);
  const TABS = [['reviews', 'Reviews']];
  $effect(() => {
    if (!account.isMod) return;
    api('/api/community/counts').then((res) => { if (res.ok) queue = res.body.queue ?? 0; });
  });
</script>

<main id="results" tabindex="-1" class="admin">
  {#if !account.loaded}
    <p class="comments-empty">Loading…</p>
  {:else if !account.isMod}
    <div class="empty-state"><h2>Moderators only</h2><p>This page is for the site’s moderators and admins.</p></div>
  {:else}
    <h1>Admin</h1>
    <div class="admin-tabs" role="tablist" aria-label="Admin sections">
      {#each TABS as [id, label] (id)}
        <button role="tab" aria-selected={adminTab === id} class:current={adminTab === id} onclick={() => navigate({ tab: 'admin', adminTab: id })}>{label}{#if id === 'reviews' && queue}<span class="queue-count" aria-label={`${queue} waiting`}>{queue}</span>{/if}</button>
      {/each}
    </div>
    <ReviewQueue onchange={(count) => (queue = count)} />
  {/if}
</main>
```

In `src/components/Community.svelte`: remove `import ReviewQueue from './ReviewQueue.svelte';` and `let reviewing = $state(false);`; replace

```svelte
{#if reviewing}
  <ReviewQueue onclose={() => { reviewing = false; load(); loadCounts(); }} />
{:else}
  <div class="workspace">
```

with `<div class="workspace">`, and delete the final `{/if}` after the workspace's closing `</div>` at the end of the file. Change the queue button's `onclick={() => reviewing = true}` to `onclick={() => navigate({ tab: 'admin' })}`.

In `src/App.svelte`:
- `import Admin from './components/Admin.svelte';`
- In the signed-in `account-area`, before the credit pill: `{#if account.isMod}<button class="text-button account-wide" onclick={() => navigate({ tab: 'admin' })}>Admin</button>{/if}`
- In the phone `account-pop`, before the Sign out button: `{#if account.isMod}<button class="outline-button" onclick={() => { accountMenu = false; navigate({ tab: 'admin' }); }}>Admin</button>{/if}`
- Right after `</header>`: `{#if account.suspended}<p class="suspended-banner" role="status">Your account is suspended. You can browse, but not post, comment, like, or use credits.</p>{/if}`
- In the tab chain, before `{:else if tab === 'home'}`: `{:else if tab === 'admin'}\n  <Admin adminTab={route.adminTab} />`

Append to `src/style.css`:

```css
/* Admin page */
.admin {
  max-width: 1100px;
  margin: 0 auto;
  padding: 32px 24px 60px;
}
.admin > h1 {
  margin: 0 0 18px;
}
.admin .review {
  max-width: none;
  padding: 0;
}
.admin-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 5px;
  margin-bottom: 24px;
  border: 1px solid var(--line);
  border-radius: 40px;
}
.admin-tabs button {
  border: 0;
  border-radius: 30px;
  padding: 9px 18px;
  font-weight: 650;
  font-size: 14px;
}
.admin-tabs button.current {
  background: #e7eae3;
  color: #151819;
}
.admin-tabs .queue-count {
  margin-left: 6px;
}
.account-pop .outline-button + .outline-button {
  margin-top: 8px;
}
.suspended-banner {
  margin: 0;
  padding: 10px 20px;
  background: #ffab9614;
  border-bottom: 1px solid #ffab9640;
  color: var(--coral);
  font-size: 14px;
  text-align: center;
}
@media (max-width: 760px) {
  .admin {
    padding: 22px 20px 48px;
  }
  .admin-tabs {
    display: flex;
  }
  .admin-tabs button {
    flex: 1;
    padding: 9px 6px;
  }
}
```

- [ ] **Step 7: Verify**

Run: `npm run check && npm test && npm run build`
Expected: 0 errors, all tests pass, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src tests/route.test.js
git commit -m "Admin page at /admin with the Reviews tab; Admin link, roles, and suspended banner in the app"
```

---

### Task 8: Users tab

**Files:**
- Create: `src/components/AdminUsers.svelte`
- Modify: `src/components/Admin.svelte`, `src/style.css`

**Interfaces:**
- Consumes: `GET /api/admin/users`, `POST /api/admin/users/:id/{suspend,remove-content,credits,roles,delete}` (Task 6), `account.isAdmin` (Task 7). `User` shape from Task 5.

- [ ] **Step 1: Create `src/components/AdminUsers.svelte`**

```svelte
<script>
  import { account, api } from '../lib/account.svelte.js';

  // Find a user and act on them. The buttons follow your role; the server
  // checks every action again.
  let query = $state('');
  let users = $state(null);
  let more = $state(false);
  let error = $state('');
  let open = $state(null);
  let note = $state('');
  let busy = $state(false);
  let credit = $state({ amount: '', reason: '' });
  let confirm = $state('');
  let confirmName = $state('');
  let timer;

  const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  // Mods can act on regular users; admins on anyone but the owner.
  const canTouch = (u) => !u.owner && (account.isAdmin || !(u.admin || u.mod));

  async function load(append = false) {
    const params = new URLSearchParams({ q: query.trim(), offset: String(append ? users.length : 0) });
    const res = await api(`/api/admin/users?${params}`);
    if (!res.ok) { error = res.error; users ??= []; return; }
    error = '';
    users = append ? [...users, ...res.body.users] : res.body.users;
    more = res.body.more;
  }
  load();

  function search() {
    clearTimeout(timer);
    timer = setTimeout(() => load(), 300);
  }
  function toggle(u) {
    open = open === u.id ? null : u.id;
    note = ''; confirm = ''; confirmName = '';
    credit = { amount: '', reason: '' };
  }
  function update(changed) {
    users = users.map((u) => (u.id === changed.id ? { ...u, ...changed } : u));
  }
  async function act(u, path, body, done) {
    busy = true; note = '';
    const res = await api(`/api/admin/users/${u.id}/${path}`, { method: 'POST', body: body ?? {} });
    busy = false;
    if (!res.ok) { note = res.error; return; }
    done(res.body);
  }
</script>

<section class="admin-users">
  <input type="search" class="admin-search" placeholder="Find a user by name" aria-label="Find a user by name" bind:value={query} oninput={search} />
  {#if error}<p class="method-error" role="alert">{error}</p>{/if}
  {#if users === null}
    <p class="comments-empty">Loading…</p>
  {:else if !users.length}
    <p class="comments-empty">{query.trim() ? `No users match “${query.trim()}”.` : 'No users yet.'}</p>
  {:else}
    <ul class="user-list">
      {#each users as u (u.id)}
        <li class="user-row" class:open={open === u.id}>
          <button class="user-summary" aria-expanded={open === u.id} onclick={() => toggle(u)}>
            <strong>{u.displayName}</strong>
            {#if u.owner}<span class="role-tag">Owner</span>{:else if u.admin}<span class="role-tag">Admin</span>{:else if u.mod}<span class="role-tag">Mod</span>{/if}
            {#if u.suspended}<span class="role-tag suspended">Suspended</span>{/if}
            <span class="user-facts">{u.credits} credits, {u.posts} {u.posts === 1 ? 'post' : 'posts'}, joined {day(u.joinedAt)}</span>
          </button>
          {#if open === u.id}
            <div class="user-panel">
              {#if canTouch(u)}
                <div class="user-actions">
                  <button class="outline-button" disabled={busy} onclick={() => act(u, 'suspend', { on: !u.suspended }, (b) => { update(b); note = b.suspended ? `${u.displayName} is suspended.` : `${u.displayName} can take part again.`; })}>{u.suspended ? 'Unsuspend' : 'Suspend'}</button>
                  {#if confirm === 'remove'}
                    <span class="confirm-delete">Remove all of {u.displayName}’s posts and comments?
                      <button class="danger-button" disabled={busy} onclick={() => act(u, 'remove-content', {}, (b) => { note = `Removed ${b.posts} ${b.posts === 1 ? 'post' : 'posts'} and ${b.comments} ${b.comments === 1 ? 'comment' : 'comments'}.`; confirm = ''; update({ id: u.id, posts: 0 }); })}>Remove</button>
                      <button class="text-button" onclick={() => (confirm = '')}>Cancel</button>
                    </span>
                  {:else}
                    <button class="outline-button" onclick={() => (confirm = 'remove')}>Remove their community posts</button>
                  {/if}
                </div>
              {:else if u.owner}
                <p class="user-note">The site owner’s account can’t be changed here.</p>
              {:else}
                <p class="user-note">Only admins can act on moderators and admins.</p>
              {/if}

              {#if account.isAdmin}
                <form class="credit-form" onsubmit={(e) => { e.preventDefault(); act(u, 'credits', { amount: Number(credit.amount), reason: credit.reason }, (b) => { update({ id: u.id, credits: b.credits }); note = `${u.displayName} now has ${b.credits} credits.`; credit = { amount: '', reason: '' }; }); }}>
                  <label><span>Credits</span><input type="number" step="1" placeholder="20 or -5" bind:value={credit.amount} required /></label>
                  <label class="grow"><span>Reason</span><input placeholder="Goes in their credit history" maxlength="200" bind:value={credit.reason} required /></label>
                  <button class="primary-button" disabled={busy}>Apply</button>
                </form>
                {#if !u.owner}
                  <div class="user-actions">
                    <label class="dislike-toggle"><input type="checkbox" checked={u.mod} disabled={busy} onchange={(e) => act(u, 'roles', { mod: e.currentTarget.checked }, update)} /> Moderator</label>
                    <label class="dislike-toggle"><input type="checkbox" checked={u.admin} disabled={busy} onchange={(e) => act(u, 'roles', { admin: e.currentTarget.checked }, update)} /> Admin</label>
                  </div>
                  {#if confirm === 'delete'}
                    <div class="delete-confirm">
                      <p>This erases {u.displayName}’s account, posts, comments, likes, and credits, and stops that Google account signing in again. Type <strong>{u.displayName}</strong> to confirm.</p>
                      <input bind:value={confirmName} aria-label="Type their display name to confirm" />
                      <div class="user-actions">
                        <button class="danger-button" disabled={busy || confirmName.trim() !== u.displayName} onclick={() => act(u, 'delete', { confirm: confirmName }, () => { users = users.filter((x) => x.id !== u.id); open = null; })}>Delete and ban</button>
                        <button class="text-button" onclick={() => (confirm = '')}>Cancel</button>
                      </div>
                    </div>
                  {:else}
                    <button class="danger-button" onclick={() => { confirm = 'delete'; confirmName = ''; }}>Delete and ban</button>
                  {/if}
                {/if}
              {/if}
              {#if note}<p class="post-note" role="status">{note}</p>{/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if more}<button class="outline-button" onclick={() => load(true)}>Show more</button>{/if}
  {/if}
</section>
```

- [ ] **Step 2: Add the tab** — in `src/components/Admin.svelte` add `import AdminUsers from './AdminUsers.svelte';`, change `TABS` to `[['reviews', 'Reviews'], ['users', 'Users']]`, and replace `<ReviewQueue onchange={(count) => (queue = count)} />` with:

```svelte
    {#if adminTab === 'users'}
      <AdminUsers />
    {:else}
      <ReviewQueue onchange={(count) => (queue = count)} />
    {/if}
```

- [ ] **Step 3: Styles** — append to `src/style.css`:

```css
.admin-search {
  width: 100%;
  max-width: 420px;
  margin-bottom: 18px;
  padding: 11px 16px;
  border-radius: 30px;
  background: var(--panel);
  color: inherit;
  font: inherit;
}
.user-list {
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}
.user-row {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
}
.user-row.open {
  border-color: #4a5356;
}
.user-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  width: 100%;
  padding: 14px 18px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.user-facts {
  flex-basis: 100%;
  color: var(--muted);
  font-size: 13px;
}
.role-tag {
  padding: 2px 8px;
  border: 1px solid #c2db7560;
  border-radius: 10px;
  color: var(--lime);
  font-size: 11px;
  font-weight: 650;
}
.role-tag.suspended {
  border-color: #ffab9660;
  color: var(--coral);
}
.user-panel {
  display: grid;
  gap: 14px;
  padding: 0 18px 18px;
}
.user-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.user-note {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
.credit-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}
.credit-form label {
  display: grid;
  gap: 5px;
  font-size: 12px;
  color: var(--muted);
}
.credit-form label.grow {
  flex: 1;
  min-width: 180px;
}
.credit-form input {
  width: 100%;
  min-width: 0;
  padding: 9px 12px;
  border-radius: 10px;
  background: #111415;
  color: inherit;
  font: inherit;
  font-size: 14px;
}
.credit-form label:first-child input {
  width: 110px;
}
.delete-confirm {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid #ffab9660;
  border-radius: 12px;
}
.delete-confirm p {
  margin: 0;
  font-size: 13px;
}
.delete-confirm input {
  padding: 9px 12px;
  border-radius: 10px;
  background: #111415;
  color: inherit;
  font: inherit;
}
```

- [ ] **Step 4: Verify**

Run: `npm run check && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "Admin: Users tab (search, suspend, remove posts, credits, roles, delete & ban)"
```

---

### Task 9: Log tab

**Files:**
- Create: `src/components/AdminLog.svelte`
- Modify: `src/components/Admin.svelte`, `src/style.css`

**Interfaces:**
- Consumes: `GET /api/admin/log?chip=&before=` → `{ entries: [{ id, at, kind, name, text, link }], more }` (Task 6).

- [ ] **Step 1: Create `src/components/AdminLog.svelte`**

```svelte
<script>
  import { untrack } from 'svelte';
  import { api } from '../lib/account.svelte.js';
  import { navigate } from '../lib/route.svelte.js';

  // Contributions, sign-ins, credits, and problems, newest first.
  const CHIPS = [['all', 'All'], ['posts', 'Posts'], ['signins', 'Sign-ins'], ['credits', 'Credits'], ['problems', 'Problems']];
  const PROBLEMS = ['held', 'blocked', 'report', 'admin_action'];
  let chip = $state('all');
  let entries = $state(null);
  let more = $state(false);
  let error = $state('');

  const today = new Date().toDateString();
  function when(iso) {
    const d = new Date(iso);
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === today ? time : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
  }

  async function load(append = false) {
    const params = new URLSearchParams({ chip });
    if (append && entries?.length) params.set('before', String(entries.at(-1).id));
    const res = await api(`/api/admin/log?${params}`);
    if (!res.ok) { error = res.error; entries ??= []; return; }
    error = '';
    entries = append ? [...entries, ...res.body.entries] : res.body.entries;
    more = res.body.more;
  }
  $effect(() => { chip; untrack(() => load()); });

  function openLink(event, link) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    event.preventDefault();
    navigate({ tab: 'community', postId: Number(link.split('/').pop()) });
  }
</script>

<section class="admin-log">
  <div class="board-chips" role="group" aria-label="Filter the log">
    {#each CHIPS as [id, label] (id)}<button class:chosen={chip === id} aria-pressed={chip === id} onclick={() => (chip = id)}>{label}</button>{/each}
  </div>
  {#if error}<p class="method-error" role="alert">{error}</p>{/if}
  {#if entries === null}
    <p class="comments-empty">Loading…</p>
  {:else if !entries.length}
    <p class="comments-empty">Nothing {chip === 'all' ? 'logged' : 'here'} in the last 90 days.</p>
  {:else}
    <ol class="log-list">
      {#each entries as e (e.id)}
        <li class="log-entry" class:problem={PROBLEMS.includes(e.kind)}>
          <time datetime={e.at}>{when(e.at)}</time>
          <p><strong>{e.name}</strong> {e.text}{#if e.link} <a href={e.link} onclick={(ev) => openLink(ev, e.link)}>Open</a>{/if}</p>
        </li>
      {/each}
    </ol>
    {#if more}<button class="outline-button" onclick={() => load(true)}>Load more</button>{/if}
  {/if}
</section>
```

- [ ] **Step 2: Add the tab** — in `src/components/Admin.svelte` add `import AdminLog from './AdminLog.svelte';`, set `TABS` to `[['reviews', 'Reviews'], ['users', 'Users'], ['log', 'Log']]`, and extend the body:

```svelte
    {#if adminTab === 'users'}
      <AdminUsers />
    {:else if adminTab === 'log'}
      <AdminLog />
    {:else}
      <ReviewQueue onchange={(count) => (queue = count)} />
    {/if}
```

- [ ] **Step 3: Styles** — append to `src/style.css`:

```css
.admin-log .board-chips {
  margin-bottom: 18px;
}
.log-list {
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
}
.log-entry {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 14px;
  padding: 11px 0 11px 12px;
  border-bottom: 1px solid var(--line);
  border-left: 3px solid transparent;
}
.log-entry.problem {
  border-left-color: var(--coral);
}
.log-entry time {
  color: var(--muted);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.log-entry p {
  margin: 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.log-entry a {
  color: var(--lime);
}
@media (max-width: 760px) {
  .log-entry {
    grid-template-columns: minmax(0, 1fr);
    gap: 3px;
  }
}
```

- [ ] **Step 4: Verify**

Run: `npm run check && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "Admin: Log tab with filter chips and paging"
```

---

### Task 10: Browser check, migration check, docs, TODO

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Apply the migration to the local dev database**

Run: `npm run db:migrate`
Expected: `migrate: applied 20261013120000_admin.sql` (it uses the Neon **dev** branch from `.env`; confirm `.env`'s `DATABASE_URL` is the dev branch before running — never the production one).

- [ ] **Step 2: Browser check (short, time-limited steps; narrate each)**

With `npm run dev`, signed in as the owner (your `ADMIN_SUBS` account):
1. Header shows **Admin**; `/admin` opens on Reviews with the queue.
2. Users tab: search a name; open a user; Suspend → tag shows "Suspended"; Unsuspend.
3. Add 5 credits with a reason → their credits update.
4. Log tab: the suspend/unsuspend and the credit change appear; filter chips work; "Open" links go to posts.
5. Phone width (390 px): tabs fit, user rows and the credit form wrap, no sideways overflow (element scan).
6. As a non-mod account (or signed out), `/admin` shows "Moderators only".
If a step needs a second real account, hand the user a checklist for it instead.

- [ ] **Step 3: README** — in `README.md`, after the "Writing in the Community" bullet, add:

```markdown
- **Admin page (`/admin`):** for moderators and admins. Reviews (the moderation queue), Users (find someone; mods can suspend and remove their community posts, admins can also add or remove credits with a reason, set roles, and delete and ban), and Log (recipe posts, sign-ins, credit changes, and problems such as held posts, reports, and admin actions; kept 90 days). Roles live on the account (`is_admin`, `is_mod`); accounts listed in `ADMIN_SUBS` are owners, always admins, and can't be changed from the page. Suspended accounts can browse but not post, comment, like, report, or use credits. Delete and ban erases the account and keeps only its Google id on a ban list.
```

- [ ] **Step 4: Final verification**

Run: `npm run check && npm test && npm run build`
Expected: 0 errors, all pass, build succeeds.

- [ ] **Step 5: Commit, TODO, ask before pushing**

```bash
git add README.md
git commit -m "README: admin page"
```

Update the Project TODO's admin item (built locally, date, not pushed). Ask the user before pushing; the production migration runs during the Netlify build.
