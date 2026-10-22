// The invite address book: people imported from a JSON file (name, channel,
// email, a short site description), joined by email to the invites sent.
// Shared by the admin page (preview, the book) and the server (import).
export const CONTACT_LIMITS = { rows: 2000, email: 200, name: 120, channel: 300, description: 600 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Field names as a generator might write them, compared without case,
// spaces, dashes or underscores.
const FIELDS = {
  email: ["email", "emailaddress", "mail", "contactemail"],
  name: ["name", "fullname", "creator", "creatorname", "author", "displayname", "username", "user"],
  channel: ["channel", "channelurl", "platform", "url", "site", "siteurl", "website", "link", "handle"],
  description: ["description", "sitedescription", "shortdescription", "about", "summary", "bio", "desc", "notes"],
};
const time = (iso) => new Date(iso).getTime();
const squash = (key) => key.toLowerCase().replace(/[\s_-]/g, "");

function field(entry, kind) {
  const names = FIELDS[kind].map(squash);
  for (const [key, value] of Object.entries(entry))
    if (names.includes(squash(key)) && value != null && typeof value !== "object")
      return String(value).trim().slice(0, CONTACT_LIMITS[kind]);
  return "";
}

// The list in whatever came in: a list itself, the first list inside a
// wrapper object ({ creators: [...] }), or a single person.
function listIn(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const inner = Object.values(data).find(Array.isArray);
    if (inner) return inner;
    if (field(data, "email")) return [data];
  }
  throw new Error("That file isn't a list of people.");
}

// { contacts, skipped }: the people to add (email lowercased, one each) and
// the rows left out, numbered from 1, with why.
export function parseContacts(data) {
  const list = listIn(data);
  if (list.length > CONTACT_LIMITS.rows)
    throw new Error(`That's ${list.length} people; import at most ${CONTACT_LIMITS.rows} at a time.`);
  const contacts = [];
  const skipped = [];
  const seen = new Set();
  list.forEach((entry, i) => {
    const row = i + 1;
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return skipped.push({ row, label: "", reason: "not a person" });
    const email = field(entry, "email").toLowerCase();
    const name = field(entry, "name");
    const label = name || email;
    if (!email) return skipped.push({ row, label, reason: "no email" });
    if (!EMAIL.test(email)) return skipped.push({ row, label, reason: "email doesn't look right" });
    if (seen.has(email)) return skipped.push({ row, label, reason: "listed twice" });
    seen.add(email);
    contacts.push({ email, name, channel: field(entry, "channel"), description: field(entry, "description") });
  });
  return { contacts, skipped };
}

// [user] or [name] becomes the person's name; left as a blank without one.
export function fillName(text, name) {
  if (!name) return text;
  return String(text ?? "").replace(/\[\s*(user|name)\s*\]/gi, () => name);
}

// A channel that's a web address, as a safe link; null for "YouTube" etc.
export function channelLink(channel) {
  const text = String(channel ?? "").trim();
  if (!text || /\s/.test(text)) return null;
  if (!/^https?:\/\//i.test(text) && !/^[\w-]+(\.[\w-]+)+(\/|$)/.test(text)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

// One row per person: imported contacts plus anyone emailed without being
// imported. status: "new" (not invited yet), "invited", "used", "canceled".
// `invite` is the latest one sent, the one Resend and Cancel act on. Not
// invited comes first, in import order; then the rest, latest sent first.
export function addressBook(contacts, invites) {
  const byEmail = new Map();
  for (const c of contacts)
    byEmail.set(c.email.toLowerCase(), {
      email: c.email, name: c.name, channel: c.channel, description: c.description,
      contactId: c.id, invites: [],
    });
  for (const i of invites) {
    const key = i.email.toLowerCase();
    if (!byEmail.has(key))
      byEmail.set(key, { email: i.email, name: "", channel: "", description: "", contactId: null, invites: [] });
    byEmail.get(key).invites.push(i);
  }
  const people = [...byEmail.values()].map((p) => {
    const sorted = p.invites.toSorted((a, b) => time(b.sentAt) - time(a.sentAt) || b.id - a.id);
    const used = sorted.find((i) => i.usedAt);
    const invite = sorted[0] ?? null;
    const status = used ? "used" : !invite ? "new" : invite.canceledAt ? "canceled" : "invited";
    const { invites: _, ...rest } = p;
    return { ...rest, invite, status, usedAt: used?.usedAt ?? null };
  });
  const fresh = people.filter((p) => !p.invite).sort((a, b) => a.contactId - b.contactId);
  const rest = people
    .filter((p) => p.invite)
    .sort((a, b) => time(b.invite.sentAt) - time(a.invite.sentAt) || b.invite.id - a.invite.id);
  return [...fresh, ...rest];
}
