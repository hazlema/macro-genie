import { UserFacingError } from "./chef.js";
import { database, transaction } from "./db.js";

// Everything waiting for a decision: held and blocked posts and comments,
// plus live items someone has reported.
export async function reviewQueue() {
  const db = database();
  const posts = await db.sql`
    SELECT p.id, p.name, p.recipe, p.kind, p.board, p.body, p.status, p.moderation_note, p.created_at,
           a.display_name AS author, a.suspended_at IS NOT NULL AS suspended,
           (SELECT count(*)::int FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id) AS reports
      FROM posts p JOIN accounts a ON a.id = p.account_id
     WHERE p.status IN ('held', 'blocked')
        OR (p.status = 'live' AND EXISTS (SELECT 1 FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id))
     ORDER BY p.created_at`;
  const comments = await db.sql`
    SELECT c.id, c.body, c.status, c.moderation_note, c.created_at, c.post_id,
           p.name AS post_name, a.display_name AS author, a.suspended_at IS NOT NULL AS suspended,
           (SELECT count(*)::int FROM reports r WHERE r.target_type = 'comment' AND r.target_id = c.id) AS reports
      FROM comments c JOIN accounts a ON a.id = c.account_id JOIN posts p ON p.id = c.post_id
     WHERE c.status IN ('held', 'blocked')
        OR (c.status = 'live' AND EXISTS (SELECT 1 FROM reports r WHERE r.target_type = 'comment' AND r.target_id = c.id))
     ORDER BY c.created_at`;
  const item = (type) => (r) => ({
    type,
    id: Number(r.id),
    status: r.status,
    reason: r.moderation_note,
    reports: r.reports,
    author: r.author,
    authorSuspended: r.suspended,
    createdAt: r.created_at,
    ...(type === "post"
      ? {
          name: r.name,
          recipe: r.recipe,
          kind: r.kind,
          board: r.board,
          body: r.body,
        }
      : { body: r.body, postId: Number(r.post_id), postName: r.post_name }),
  });
  return [...posts.map(item("post")), ...comments.map(item("comment"))];
}

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

// How many items wait for a decision, for the badge on the queue button.
export async function queueCount() {
  return (await reviewQueue()).length;
}
