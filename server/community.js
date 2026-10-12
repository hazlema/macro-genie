import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { NUTRIENTS } from "../src/lib/foods.js";
import { solveRecipe } from "../src/lib/recipe.js";
import { UserFacingError, foodById } from "./chef.js";
import { database, transaction } from "./db.js";
import { MEAL_TYPES, moderate, recipeForReview } from "./moderate.js";
import { requireActive } from "./roles.js";

// ---------------------------------------------------------------- recipes

const text = (max) => z.string().trim().max(max);
const postedRecipe = z.object({
  version: z.literal(2),
  name: text(120).min(1),
  description: text(400).default(""),
  servings: z.number().int().min(1).max(50),
  ingredients: z
    .array(
      z.object({
        id: z.string().max(40),
        grams: z.number().positive().max(5000),
        label: text(60).default(""),
        qty: z.number().positive().max(10_000).nullable().default(null),
        unit: text(30).default(""),
        prep: text(80).default(""),
      }),
    )
    .min(1)
    .max(20),
  seasonings: z.array(text(60)).max(10).default([]),
  steps: z.array(text(500).min(1)).min(1).max(20),
  tip: text(300).default(""),
});

// A recipe as the community stores it: checked, with foods resolved and the
// per-serving nutrition recomputed from USDA data, so a post can't claim
// numbers it doesn't have.
export function normalizeRecipe(input) {
  const parsed = postedRecipe.safeParse(input);
  if (!parsed.success)
    throw new UserFacingError(
      "Only recipes written in the Recipe Builder can be posted.",
    );
  const r = parsed.data;
  const items = r.ingredients.map((i) => {
    const food = foodById(i.id);
    if (!food)
      throw new UserFacingError(
        "This recipe uses a food that's no longer in the data.",
      );
    return { food, grams: Math.round(i.grams), ingredient: i };
  });
  const solved = solveRecipe(items, { servings: r.servings });
  return {
    version: 2,
    name: r.name,
    description: r.description,
    servings: r.servings,
    perServing: solved.perServing,
    gramsPerServing: solved.totalGrams / r.servings,
    ingredients: items.map(({ food, grams, ingredient }) => ({
      id: food.id,
      name: food.name,
      label: ingredient.label || food.name,
      grams,
      qty: ingredient.unit ? ingredient.qty : null,
      unit: ingredient.qty ? ingredient.unit : "",
      prep: ingredient.prep,
    })),
    seasonings: r.seasonings.filter(Boolean),
    steps: r.steps,
    tip: r.tip,
  };
}

// --------------------------------------------- checking before posting

// The pre-post check returns Haiku's review with a signed token for exactly
// that recipe, so posting it right after doesn't pay for a second review.
const digest = (recipe) =>
  createHash("sha256").update(JSON.stringify(recipe)).digest("base64url");
const sign = (value) =>
  createHmac("sha256", process.env.SESSION_SECRET ?? "")
    .update(value)
    .digest("base64url");

export async function checkPost(input, api) {
  const recipe = normalizeRecipe(input);
  const review = await moderate("post", recipeForReview(recipe), api);
  const body = Buffer.from(
    JSON.stringify({
      d: digest(recipe),
      v: review.verdict,
      r: review.reason,
      e: Date.now() + 30 * 60_000,
    }),
  ).toString("base64url");
  return {
    verdict: review.verdict,
    reason: review.reason,
    mealType: review.mealType,
    token: `${body}.${sign(body)}`,
  };
}

function reviewFromToken(token, recipe) {
  const [body, mac] = String(token ?? "").split(".");
  if (!body || !mac || sign(body) !== mac) return null;
  try {
    const { d, v, r, e } = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    );
    return d === digest(recipe) && e > Date.now()
      ? { verdict: v, reason: r }
      : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- accounts

async function poster(accountId) {
  const role = await requireActive(accountId);
  return { id: accountId, display_name: role.displayName };
}

const STATUS = { fine: "live", unsure: "held", blocked: "blocked" };

// Display names are checked like comments; anything unsure isn't accepted.
export async function setDisplayName(accountId, name, api) {
  const clean = String(name ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/^[\p{L}\p{N} ._'-]{2,30}$/u.test(clean))
    throw new UserFacingError(
      "Use 2 to 30 letters, numbers, spaces, or . _ ' -",
    );
  await poster(accountId);
  const review = await moderate("name", clean, api);
  if (review.verdict !== "fine")
    throw new UserFacingError("Please pick a different name.");
  await database()
    .sql`UPDATE accounts SET display_name = ${clean} WHERE id = ${accountId}`;
  return clean;
}

// ----------------------------------------------------------------- posts

const POSTS_PER_DAY = 10;
const COMMENTS_PER_HOUR = 30;

export async function createPost(
  accountId,
  input,
  { mealType, token } = {},
  api,
) {
  await poster(accountId);
  if (!MEAL_TYPES.includes(mealType))
    throw new UserFacingError("Pick a meal type for this recipe.");
  const recipe = normalizeRecipe(input);
  const recent = await database()
    .sql`SELECT count(*)::int AS n FROM posts WHERE account_id = ${accountId} AND created_at > now() - interval '1 day'`;
  if (recent[0].n >= POSTS_PER_DAY)
    throw new UserFacingError(
      "That's the most posts for one day. Try again tomorrow.",
      429,
    );
  const review =
    reviewFromToken(token, recipe) ??
    (await moderate("post", recipeForReview(recipe), api));
  const p = recipe.perServing;
  const rows = await database().sql`
    INSERT INTO posts (account_id, recipe, name, meal_type, calories, protein,
      net_carbs, fat, sugar, sodium, status, moderation_note)
    VALUES (${accountId}, ${JSON.stringify(recipe)}::jsonb, ${recipe.name},
      ${mealType}, ${p.calories}, ${p.protein}, ${p.netCarbs}, ${p.fat},
      ${p.sugar}, ${p.sodium}, ${STATUS[review.verdict]}, ${review.reason})
    RETURNING id, status`;
  return {
    id: Number(rows[0].id),
    status: rows[0].status,
    reason: review.reason,
  };
}

const COLUMNS = {
  calories: "p.calories",
  protein: "p.protein",
  netCarbs: "p.net_carbs",
  fat: "p.fat",
  sugar: "p.sugar",
  sodium: "p.sodium",
};

const shapePost = (row) => ({
  id: Number(row.id),
  name: row.name,
  mealType: row.meal_type,
  author: row.author,
  createdAt: row.created_at,
  recipe: row.recipe,
  kind: row.kind,
  board: row.board,
  body: row.body,
  likes: Number(row.like_count),
  comments: Number(row.comment_count),
  likedByMe: !!row.liked,
  mine: !!row.mine,
  status: row.status,
  reason: row.mine || row.moderator ? row.moderation_note : undefined,
  // Moderators: comments waiting on this post, and reports against it.
  waitingComments: row.moderator ? Number(row.waiting_comments) : undefined,
  reports: row.moderator ? Number(row.reports) : undefined,
});

// Live posts, filtered by meal type and per-serving ranges. A signed-in
// viewer also sees their own posts that are waiting for review.
export async function listPosts({
  viewer = null,
  meal = "all",
  board = null,
  ranges = {},
  sort = "new",
  offset = 0,
  moderator = false,
  needsReview = false,
} = {}) {
  // Moderators see everyone's waiting and blocked posts, marked; others see
  // only their own. "Needs review" narrows a moderator's list to posts that
  // are waiting, blocked, reported, or have comments waiting.
  const where = [
    moderator
      ? `p.status <> 'removed'`
      : `(p.status = 'live' OR (p.account_id = $1 AND p.status IN ('held', 'blocked')))`,
  ];
  if (moderator && needsReview)
    where.push(`(p.status IN ('held', 'blocked')
      OR EXISTS (SELECT 1 FROM comments c WHERE c.post_id = p.id AND c.status IN ('held', 'blocked'))
      OR EXISTS (SELECT 1 FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id))`);
  const params = [viewer ?? 0];
  // A forum board lists its threads; otherwise recipes, by meal and macros.
  if (board) {
    if (!BOARDS.includes(board)) throw new UserFacingError("Unknown board.");
    params.push(board);
    where.push(`p.kind = 'thread' AND p.board = $${params.length}`);
    ranges = {};
  } else where.push(`p.kind = 'recipe'`);
  if (!board && meal !== "all") {
    if (!MEAL_TYPES.includes(meal))
      throw new UserFacingError("Unknown meal type.");
    params.push(meal);
    where.push(`p.meal_type = $${params.length}`);
  }
  for (const [key, range] of Object.entries(ranges ?? {})) {
    const column = COLUMNS[key];
    if (!column) throw new UserFacingError("Unknown nutrient range.");
    for (const [bound, op] of [
      ["min", ">="],
      ["max", "<="],
    ]) {
      const value = range?.[bound];
      if (value == null) continue;
      if (!(Number(value) >= 0))
        throw new UserFacingError("Ranges must be zero or more.");
      params.push(Number(value));
      where.push(`${column} ${op} $${params.length}`);
    }
  }
  params.push(Math.max(0, Math.min(Number(offset) || 0, 10_000)));
  const order =
    sort === "liked"
      ? "p.like_count DESC, p.created_at DESC"
      : "p.created_at DESC";
  const { rows } = await database().pool.query(
    `SELECT p.id, p.name, p.meal_type, p.recipe, p.kind, p.board, p.body, p.like_count, p.comment_count,
            p.status, p.moderation_note, p.created_at, a.display_name AS author,
            (p.account_id = $1) AS mine, ${moderator ? "true" : "false"} AS moderator,
            EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.account_id = $1) AS liked,
            (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND c.status IN ('held', 'blocked')) AS waiting_comments,
            (SELECT count(*) FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id) AS reports
       FROM posts p JOIN accounts a ON a.id = p.account_id
      WHERE ${where.join(" AND ")}
      ORDER BY ${order}
      LIMIT 21 OFFSET $${params.length}`,
    params,
  );
  return { posts: rows.slice(0, 20).map(shapePost), more: rows.length > 20 };
}

// One post by id, with the same visibility rules as the list: live posts
// for everyone, waiting ones for their author and moderators.
export async function getPost(postId, viewer = null, moderator = false) {
  const { rows } = await database().pool.query(
    `SELECT p.id, p.name, p.meal_type, p.recipe, p.kind, p.board, p.body, p.like_count, p.comment_count,
            p.status, p.moderation_note, p.created_at, a.display_name AS author,
            (p.account_id = $2) AS mine, $3::boolean AS moderator,
            EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.account_id = $2) AS liked,
            (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND c.status IN ('held', 'blocked')) AS waiting_comments,
            (SELECT count(*) FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id) AS reports
       FROM posts p JOIN accounts a ON a.id = p.account_id
      WHERE p.id = $1
        AND (p.status = 'live'
          OR (p.status IN ('held', 'blocked') AND ($3 OR p.account_id = $2)))`,
    [postId, viewer ?? 0, !!moderator],
  );
  if (!rows[0])
    throw new UserFacingError("That recipe isn't in the community.", 404);
  return shapePost(rows[0]);
}

export const BOARDS = ["general", "support"];
const THREADS_PER_DAY = 20;

// Starts a forum thread: a title and a message, moderated like a recipe.
export async function createThread(
  accountId,
  { board, title, body } = {},
  api,
) {
  await poster(accountId);
  if (!BOARDS.includes(board)) throw new UserFacingError("Pick a board.");
  const cleanTitle = String(title ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const cleanBody = String(body ?? "").trim();
  if (cleanTitle.length < 3 || cleanTitle.length > 120)
    throw new UserFacingError("Titles are 3 to 120 characters.");
  if (!cleanBody || cleanBody.length > 5000)
    throw new UserFacingError("Messages are 1 to 5,000 characters.");
  const recent = await database()
    .sql`SELECT count(*)::int AS n FROM posts WHERE account_id = ${accountId} AND kind = 'thread' AND created_at > now() - interval '1 day'`;
  if (recent[0].n >= THREADS_PER_DAY)
    throw new UserFacingError(
      "That's the most threads for one day. Try again tomorrow.",
      429,
    );
  const review = await moderate(
    "thread",
    `Title: ${cleanTitle}\n\n${cleanBody}`,
    api,
  );
  const rows = await database().sql`
    INSERT INTO posts (account_id, kind, board, name, body, status, moderation_note)
    VALUES (${accountId}, 'thread', ${board}, ${cleanTitle}, ${cleanBody},
      ${STATUS[review.verdict]}, ${review.reason})
    RETURNING id, status`;
  return {
    id: Number(rows[0].id),
    status: rows[0].status,
    reason: review.reason,
  };
}

// Live items on each board, for the counts on the filter chips.
export async function boardCounts() {
  const rows = await database().sql`
    SELECT kind, board, meal_type, count(*)::int AS n
      FROM posts WHERE status = 'live'
     GROUP BY kind, board, meal_type`;
  const counts = Object.fromEntries(
    [...BOARDS, "all", ...MEAL_TYPES].map((k) => [k, 0]),
  );
  for (const r of rows) {
    if (r.kind === "thread") counts[r.board] += r.n;
    else {
      counts.all += r.n;
      counts[r.meal_type] += r.n;
    }
  }
  return counts;
}

export async function removeOwnPost(accountId, postId) {
  const rows = await database()
    .sql`UPDATE posts SET status = 'removed' WHERE id = ${postId} AND account_id = ${accountId} AND status <> 'removed' RETURNING id`;
  if (!rows[0]) throw new UserFacingError("That post wasn't found.", 404);
}

// Likes toggle. Only live posts can be liked.
export async function toggleLike(accountId, postId) {
  await poster(accountId);
  return transaction(async (c) => {
    const post = await c.query(
      `SELECT status FROM posts WHERE id = $1 FOR UPDATE`,
      [postId],
    );
    if (post.rows[0]?.status !== "live")
      throw new UserFacingError("That post wasn't found.", 404);
    const added = await c.query(
      `INSERT INTO post_likes (post_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING post_id`,
      [postId, accountId],
    );
    if (!added.rows[0])
      await c.query(
        `DELETE FROM post_likes WHERE post_id = $1 AND account_id = $2`,
        [postId, accountId],
      );
    const updated = await c.query(
      `UPDATE posts SET like_count = like_count + $2 WHERE id = $1 RETURNING like_count`,
      [postId, added.rows[0] ? 1 : -1],
    );
    return {
      liked: !!added.rows[0],
      likes: Number(updated.rows[0].like_count),
    };
  });
}

// -------------------------------------------------------------- comments

// Live comments; their authors also see their own waiting ones, and
// moderators see everyone's waiting and blocked ones with the reason.
export async function listComments(postId, viewer = null, moderator = false) {
  const rows = await database().sql`
    SELECT c.id, c.body, c.status, c.moderation_note, c.created_at,
           a.display_name AS author, (c.account_id = ${viewer ?? 0}) AS mine,
           (SELECT count(*) FROM reports r WHERE r.target_type = 'comment' AND r.target_id = c.id) AS reports
      FROM comments c JOIN accounts a ON a.id = c.account_id
     WHERE c.post_id = ${postId}
       AND (c.status = 'live'
         OR (c.status IN ('held', 'blocked') AND (${moderator} OR c.account_id = ${viewer ?? 0})))
     ORDER BY c.created_at`;
  return rows.map((r) => ({
    id: Number(r.id),
    body: r.body,
    author: r.author,
    createdAt: r.created_at,
    mine: !!r.mine,
    status: r.status,
    ...(moderator
      ? { reason: r.moderation_note, reports: Number(r.reports) }
      : {}),
  }));
}

export async function addComment(accountId, postId, body, api) {
  await poster(accountId);
  const clean = String(body ?? "").trim();
  if (!clean || clean.length > 1000)
    throw new UserFacingError("Comments are 1 to 1,000 characters.");
  const post = await database()
    .sql`SELECT status FROM posts WHERE id = ${postId}`;
  if (post[0]?.status !== "live")
    throw new UserFacingError("That post wasn't found.", 404);
  const recent = await database()
    .sql`SELECT count(*)::int AS n FROM comments WHERE account_id = ${accountId} AND created_at > now() - interval '1 hour'`;
  if (recent[0].n >= COMMENTS_PER_HOUR)
    throw new UserFacingError(
      "That's a lot of comments. Take a break and try again later.",
      429,
    );
  const review = await moderate("comment", clean, api);
  const status = STATUS[review.verdict];
  return transaction(async (c) => {
    const row = await c.query(
      `INSERT INTO comments (post_id, account_id, body, status, moderation_note)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [postId, accountId, clean, status, review.reason],
    );
    if (status === "live")
      await c.query(
        `UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1`,
        [postId],
      );
    return { id: Number(row.rows[0].id), status, reason: review.reason };
  });
}

export async function removeOwnComment(accountId, commentId) {
  return transaction(async (c) => {
    const row = await c.query(
      `UPDATE comments SET status = 'removed'
        WHERE id = $1 AND account_id = $2 AND status <> 'removed'
        RETURNING post_id, (SELECT status FROM comments WHERE id = $1) AS was`,
      [commentId, accountId],
    );
    if (!row.rows[0])
      throw new UserFacingError("That comment wasn't found.", 404);
    if (row.rows[0].was === "live")
      await c.query(
        `UPDATE posts SET comment_count = comment_count - 1 WHERE id = $1`,
        [row.rows[0].post_id],
      );
  });
}

// --------------------------------------------------------------- reports

export const REPORTS_TO_HIDE = 3;

// A report from a signed-in account. Enough distinct reports hide a live
// item until a moderator looks at it.
export async function report(accountId, type, targetId, reason = "") {
  if (!["post", "comment"].includes(type))
    throw new UserFacingError("Unknown item.");
  await poster(accountId);
  return transaction(async (c) => {
    await c.query(
      `INSERT INTO reports (target_type, target_id, account_id, reason)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [type, targetId, accountId, String(reason).slice(0, 300)],
    );
    const count = await c.query(
      `SELECT count(*)::int AS n FROM reports WHERE target_type = $1 AND target_id = $2`,
      [type, targetId],
    );
    if (count.rows[0].n < REPORTS_TO_HIDE) return { hidden: false };
    const table = type === "post" ? "posts" : "comments";
    const hidden = await c.query(
      `UPDATE ${table} SET status = 'held',
         moderation_note = 'Hidden after ' || $2 || ' reports'
       WHERE id = $1 AND status = 'live' RETURNING id${type === "comment" ? ", post_id" : ""}`,
      [targetId, count.rows[0].n],
    );
    if (type === "comment" && hidden.rows[0])
      await c.query(
        `UPDATE posts SET comment_count = comment_count - 1 WHERE id = $1`,
        [hidden.rows[0].post_id],
      );
    return { hidden: !!hidden.rows[0] };
  });
}

export const nutrientKeys = NUTRIENTS.map((n) => n.key);
