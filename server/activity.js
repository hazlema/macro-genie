import { UserFacingError } from "./chef.js";
import { database } from "./db.js";

// The admin Log tab: contributions, sign-ins, credits, and problems. Ordinary
// live forum posts, likes, and credit spends aren't logged on purpose.
export const CHIPS = {
  posts: ["recipe_post"],
  signins: ["joined", "sign_in"],
  credits: ["credits_purchase", "credits_adjust"],
  problems: ["held", "blocked", "report", "admin_action"],
  messages: ["message"],
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
    if (!KINDS.includes(kind))
      throw new Error(`Unknown activity kind: ${kind}`);
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
export async function listActivity({
  chip = "all",
  before = null,
  limit = 50,
} = {}) {
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
