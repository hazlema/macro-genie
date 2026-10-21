// Invite emails, shared by the admin form and the server. Square brackets
// mark the parts to change: [credits] and [redeem link] fill themselves in,
// and anything else in brackets ([user], [a recipe you liked]) is a blank
// the sender has to fill before it can go out.
export const INVITE_LIMITS = { minCredits: 1, maxCredits: 500, subject: 200, body: 20000 };

const BRACKET = /\[\s*([^\][]+?)\s*\]/g;
const nameOf = (inner) => inner.toLowerCase().replace(/\s+/g, " ");
const AUTO = new Set(["credits", "redeem link"]);

export function fillInvite(text, { credits, link }) {
  return String(text ?? "").replace(BRACKET, (whole, inner) => {
    const name = nameOf(inner);
    if (name === "credits") return String(credits);
    if (name === "redeem link") return link;
    return whole;
  });
}

export function findBlanks(text) {
  const blanks = [];
  for (const [whole, inner] of String(text ?? "").matchAll(BRACKET))
    if (!AUTO.has(nameOf(inner)) && !blanks.includes(whole)) blanks.push(whole);
  return blanks;
}

// The text cut into runs for the admin preview: plain words, the filled-in
// [credits] and [redeem link] ("auto"), and blanks still to fill.
export function inviteParts(text, { credits, link }) {
  const source = String(text ?? "");
  const parts = [];
  let at = 0;
  for (const match of source.matchAll(BRACKET)) {
    if (match.index > at) parts.push({ text: source.slice(at, match.index), kind: "plain" });
    const name = nameOf(match[1]);
    if (AUTO.has(name))
      parts.push({ text: name === "credits" ? String(credits) : link, kind: "auto" });
    else parts.push({ text: match[0], kind: "blank" });
    at = match.index + match[0].length;
  }
  if (at < source.length) parts.push({ text: source.slice(at), kind: "plain" });
  return parts;
}

// A code as typed or pasted: the whole link (even one a mail client broke
// across lines, or Gmail's own redirect copy of it), spaces, dashes and line
// breaks all come off. "" when what's left isn't a code.
export function normalizeCode(input) {
  let text = String(input ?? "");
  try {
    text = decodeURIComponent(text);
  } catch {
    // Not URL-encoded; use it as typed.
  }
  const at = text.search(/code=/i);
  if (at >= 0) text = text.slice(at + 5);
  const hex = text.toLowerCase().replace(/[\s-]/g, "").match(/^[0-9a-f]{64}/);
  if (hex) return hex[0];
  // No link: a bare code, possibly with stray characters around it.
  const code = text.toLowerCase().replace(/[^0-9a-f]/g, "");
  return code.length === 64 ? code : "";
}
