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
    throw new UserFacingError(
      "The site owner's account can't be changed here.",
      403,
    );
  if (Number(t.id) === Number(actorId))
    throw new UserFacingError("You can't do that to your own account.", 403);
  if ((t.is_admin || t.is_mod) && !actor.admin)
    throw new UserFacingError(
      "Only admins can do that to a moderator or admin.",
      403,
    );
}

const note = (actorId, actor, text) =>
  logActivity({
    kind: "admin_action",
    accountId: actorId,
    actorName: actor.displayName,
    text,
  });

export async function listUsers(actorId, { query = "", offset = 0 } = {}) {
  await requireMod(actorId);
  // % and _ are wildcards in ILIKE; escape them so names match literally.
  const q = String(query ?? "")
    .trim()
    .slice(0, 60)
    .replace(/[\\%_]/g, "\\$&");
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
  await note(
    actorId,
    actor,
    `${on ? "suspended" : "unsuspended"} ${t.display_name}`,
  );
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
    throw new UserFacingError(
      "Enter a whole number of credits, like 20 or -5.",
    );
  const why = String(reason ?? "")
    .trim()
    .slice(0, 200);
  if (!why)
    throw new UserFacingError("Add a reason; it goes in their credit history.");
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
    throw new UserFacingError(
      "The site owner's account can't be changed here.",
      403,
    );
  const next = { admin: admin ?? t.is_admin, mod: mod ?? t.is_mod };
  if (typeof next.admin !== "boolean" || typeof next.mod !== "boolean")
    throw new UserFacingError("Roles are either on or off.");
  if (Number(id) === Number(actorId) && !next.admin)
    throw new UserFacingError("You can't remove your own admin role.", 403);
  await database()
    .sql`UPDATE accounts SET is_admin = ${next.admin}, is_mod = ${next.mod} WHERE id = ${id}`;
  const changes = [];
  if (next.admin !== t.is_admin)
    changes.push(
      next.admin ? "made them an admin" : "removed their admin role",
    );
  if (next.mod !== t.is_mod)
    changes.push(
      next.mod ? "made them a moderator" : "removed their moderator role",
    );
  if (changes.length)
    await note(
      actorId,
      actor,
      `changed ${t.display_name}'s roles: ${changes.join(", ")}`,
    );
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
