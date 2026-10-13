import { logActivity } from "./activity.js";
import { UserFacingError } from "./chef.js";
import { database } from "./db.js";
import { requireMod } from "./roles.js";

// Contact-form messages. The owner's address never appears on the site;
// messages are read in Admin → Inbox.
export const TOPICS = ["Question", "Refund", "Delete my data", "Bug", "Other"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkMessage({ topic, body, email, signedIn }) {
  const text = String(body ?? "").trim();
  const address = String(email ?? "").trim();
  if (!TOPICS.includes(topic)) throw new UserFacingError("Pick a topic.");
  if (text.length < 10 || text.length > 3000)
    throw new UserFacingError("Messages are 10 to 3,000 characters.");
  if (!signedIn && !address)
    throw new UserFacingError("Add your email so we can reply.");
  if (address && (address.length > 200 || !EMAIL.test(address)))
    throw new UserFacingError("That email doesn't look right.");
  return { topic, body: text, email: address };
}

// The same text from the same sender within a minute is a double tap:
// stored once.
export async function saveMessage({
  accountId = null,
  name,
  email = "",
  topic,
  body,
}) {
  const db = database();
  const recent = await db.sql`
    SELECT id FROM messages
     WHERE body = ${body} AND email = ${email}
       AND account_id IS NOT DISTINCT FROM ${accountId}::bigint
       AND created_at > now() - interval '1 minute'
     LIMIT 1`;
  if (recent[0]) return { id: Number(recent[0].id), duplicate: true };
  const rows = await db.sql`
    INSERT INTO messages (account_id, name, email, topic, body)
    VALUES (${accountId}, ${name}, ${email}, ${topic}, ${body}) RETURNING id`;
  const id = Number(rows[0].id);
  await logActivity({
    kind: "message",
    accountId,
    actorName: name,
    text: `sent a message: ${topic}`,
  });
  return { id, duplicate: false };
}

export async function listMessages(actorId, { status = "new" } = {}) {
  await requireMod(actorId);
  const rows = await database().sql`
    SELECT id, created_at, account_id, name, email, topic, body, status
      FROM messages WHERE status = ${status === "done" ? "done" : "new"}
     ORDER BY id DESC LIMIT 200`;
  return {
    messages: rows.map((r) => ({
      id: Number(r.id),
      at: new Date(r.created_at).toISOString(),
      accountId: r.account_id == null ? null : Number(r.account_id),
      name: r.name,
      email: r.email,
      topic: r.topic,
      body: r.body,
      status: r.status,
    })),
  };
}

export async function setMessageStatus(actorId, id, status) {
  await requireMod(actorId);
  if (!["new", "done"].includes(status))
    throw new UserFacingError("Status is new or done.");
  const rows = await database()
    .sql`UPDATE messages SET status = ${status} WHERE id = ${id} RETURNING status`;
  if (!rows[0]) throw new UserFacingError("That message wasn't found.", 404);
  return { status };
}
