import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { UserFacingError } from "./chef.js";
import { database, transaction } from "./db.js";
import { requireActive, requireOwner } from "./roles.js";
import {
  INVITE_LIMITS,
  fillInvite,
  findBlanks,
  normalizeCode,
} from "../src/lib/invite-text.js";

// Invites: the owner emails someone from Admin → Invites, from their own
// Gmail, with a one-time code worth some credits. The person redeems it on
// /redeem once signed in. An invite row never records who redeemed it, so
// the address book can't tie an email to an account.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const BAD_CODE = "This code has already been used or isn't valid.";

// Sends one plain-text email: { to, subject, text }. Tests swap in their
// own; null goes back to Gmail over SMTP with the SMTP_ settings.
let mailer = null;
export function useMailer(fn) {
  mailer = fn;
}
// Short timeouts: a stalled Gmail fails with a message (and the invite is
// taken back out) instead of Netlify cutting the function off mid-send.
export function smtpOptions({ SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS }) {
  const port = Number(SMTP_PORT) || 465;
  return {
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 6000,
    greetingTimeout: 6000,
    socketTimeout: 8000,
  };
}
function smtpMailer() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS)
    throw new UserFacingError("Email isn't set up yet: add the SMTP_ settings.", 503);
  const transport = nodemailer.createTransport(smtpOptions(process.env));
  return (mail) => transport.sendMail({ from: SMTP_FROM || SMTP_USER, ...mail });
}
async function deliver(mail) {
  const send = mailer ?? smtpMailer();
  try {
    await send(mail);
  } catch (error) {
    throw new UserFacingError(`Gmail didn't take the email: ${error.message}`, 502);
  }
}

const shapeInvite = (r) => ({
  id: Number(r.id),
  email: r.email,
  credits: Number(r.credits),
  sentAt: r.sent_at,
  usedAt: r.used_at,
  canceledAt: r.canceled_at,
});
const shapeTemplate = (r) => ({
  id: Number(r.id),
  name: r.name,
  subject: r.subject,
  body: r.body,
});

export async function listInvites(actorId) {
  await requireOwner(actorId);
  const db = database();
  const invites = await db.sql`
    SELECT id, email, credits, sent_at, used_at, canceled_at
      FROM invites ORDER BY sent_at DESC, id DESC LIMIT 1000`;
  const templates = await db.sql`
    SELECT id, name, subject, body FROM invite_templates ORDER BY name`;
  return { invites: invites.map(shapeInvite), templates: templates.map(shapeTemplate) };
}

function checkInvite({ to, subject, body, credits }) {
  const email = String(to ?? "").trim();
  const title = String(subject ?? "").trim();
  const text = String(body ?? "").replace(/\r\n/g, "\n").trim();
  const amount = Number(credits);
  if (!EMAIL.test(email) || email.length > 200)
    throw new UserFacingError("That email address doesn't look right.");
  if (!Number.isInteger(amount) || amount < INVITE_LIMITS.minCredits || amount > INVITE_LIMITS.maxCredits)
    throw new UserFacingError(
      `Credits are a whole number from ${INVITE_LIMITS.minCredits} to ${INVITE_LIMITS.maxCredits}.`,
    );
  if (!title || title.length > INVITE_LIMITS.subject)
    throw new UserFacingError(`Subjects are 1 to ${INVITE_LIMITS.subject} characters.`);
  if (!text || text.length > INVITE_LIMITS.body)
    throw new UserFacingError("The message is empty or too long.");
  const blanks = [...findBlanks(title), ...findBlanks(text)];
  if (blanks.length)
    throw new UserFacingError(`Fill in the blanks first: ${[...new Set(blanks)].join(", ")}`);
  if (!/\[\s*redeem\s+link\s*\]/i.test(text))
    throw new UserFacingError("Add [redeem link] so they can claim the credits.");
  return { email, subject: title, body: text, credits: amount };
}

// Stored first so the code works the moment the email lands; taken back
// out if Gmail refuses it, so the book only lists emails that went out.
export async function sendInvite(actorId, input, origin) {
  await requireOwner(actorId);
  const invite = checkInvite(input);
  if (!mailer) smtpMailer(); // says so now if email isn't set up
  const code = randomBytes(32).toString("hex");
  const link = `${origin}/redeem?code=${code}`;
  const subject = fillInvite(invite.subject, { credits: invite.credits, link });
  const body = fillInvite(invite.body, { credits: invite.credits, link });
  const db = database();
  const [row] = await db.sql`
    INSERT INTO invites (code, email, subject, body, credits)
    VALUES (${code}, ${invite.email}, ${subject}, ${body}, ${invite.credits})
    RETURNING id`;
  try {
    await deliver({ to: invite.email, subject, text: body });
  } catch (error) {
    await db.sql`DELETE FROM invites WHERE id = ${row.id}`;
    throw error;
  }
  return { id: Number(row.id) };
}

async function unusedInvite(id) {
  const [row] = await database().sql`
    SELECT * FROM invites WHERE id = ${id}`;
  if (!row) throw new UserFacingError("That invite wasn't found.", 404);
  if (row.used_at || row.canceled_at)
    throw new UserFacingError("That invite was already used or canceled.", 409);
  return row;
}

export async function resendInvite(actorId, id) {
  await requireOwner(actorId);
  const row = await unusedInvite(id);
  await deliver({ to: row.email, subject: row.subject, text: row.body });
  await database().sql`UPDATE invites SET sent_at = now() WHERE id = ${id}`;
  return { ok: true };
}

export async function cancelInvite(actorId, id) {
  await requireOwner(actorId);
  await unusedInvite(id);
  await database().sql`
    UPDATE invites SET canceled_at = now()
     WHERE id = ${id} AND used_at IS NULL AND canceled_at IS NULL`;
  return { ok: true };
}

// Takes the address out of the book entirely (say, someone asked to be
// removed). An unused code goes with it.
export async function forgetInvite(actorId, id) {
  await requireOwner(actorId);
  await database().sql`DELETE FROM invites WHERE id = ${id}`;
  return { ok: true };
}

export async function saveTemplate(actorId, { name, subject, body } = {}) {
  await requireOwner(actorId);
  const label = String(name ?? "").trim();
  const title = String(subject ?? "").trim();
  const text = String(body ?? "").replace(/\r\n/g, "\n").trim();
  if (!label || label.length > 60)
    throw new UserFacingError("Template names are 1 to 60 characters.");
  if (title.length > INVITE_LIMITS.subject || !text || text.length > INVITE_LIMITS.body)
    throw new UserFacingError("The subject or message is empty or too long.");
  const [row] = await database().sql`
    INSERT INTO invite_templates (name, subject, body)
    VALUES (${label}, ${title}, ${text})
    ON CONFLICT (name) DO UPDATE
      SET subject = EXCLUDED.subject, body = EXCLUDED.body, updated_at = now()
    RETURNING id`;
  return { id: Number(row.id) };
}

export async function deleteTemplate(actorId, id) {
  await requireOwner(actorId);
  await database().sql`DELETE FROM invite_templates WHERE id = ${id}`;
  return { ok: true };
}

// One transaction: the code is marked used only if it still wasn't, so a
// double click or two tabs add the credits once. The ledger row has no ref
// and the invite keeps only the day (UTC) it was used, so nothing joins the
// two back together, by id or by timestamp.
export async function redeemInvite(accountId, rawCode) {
  if (!accountId) throw new UserFacingError("Sign in to redeem your credits.", 401);
  await requireActive(accountId);
  const code = normalizeCode(rawCode);
  if (!code) throw new UserFacingError(BAD_CODE, 404);
  return transaction(async (client) => {
    const used = await client.query(
      `UPDATE invites SET used_at = date_trunc('day', now())
        WHERE code = $1 AND used_at IS NULL AND canceled_at IS NULL
        RETURNING credits`,
      [code],
    );
    if (!used.rows[0]) throw new UserFacingError(BAD_CODE, 404);
    const added = Number(used.rows[0].credits);
    await client.query(
      `INSERT INTO credit_ledger (account_id, change, reason, ref, paid)
       VALUES ($1, $2, 'invite', NULL, false)`,
      [accountId, added],
    );
    const updated = await client.query(
      `UPDATE accounts SET credits = credits + $2 WHERE id = $1 RETURNING credits`,
      [accountId, added],
    );
    return { added, credits: Number(updated.rows[0].credits) };
  });
}
