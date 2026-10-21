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

// A code as typed or pasted: the whole link, spaces, dashes and line breaks
// all come off. "" when what's left isn't a code.
export function normalizeCode(input) {
  let text = String(input ?? "");
  const fromLink = text.match(/code=([^&\s#]+)/i);
  if (fromLink) text = fromLink[1];
  const code = text.toLowerCase().replace(/[^0-9a-f]/g, "");
  return code.length === 64 ? code : "";
}
