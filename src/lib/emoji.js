import { emojis } from "@tiptap/extension-emoji";

// The emoji the Community editor offers, from the list that ships with
// Tiptap's emoji extension, so the picker, :shortcodes:, and emoticons agree.

// Symbols like ❤ (U+2764) show as black text unless followed by U+FE0F.
const colorGlyph = (s) =>
  [...s].length === 1 && s.codePointAt(0) < 0x1f000 ? s + "️" : s;

export const EMOJI = emojis
  .filter(
    (e) =>
      e.emoji &&
      e.group !== "components" &&
      !e.name.startsWith("regional_indicator_"),
  )
  .map((e) => ({ ...e, emoji: colorGlyph(e.emoji), emoticons: [] }));

const byName = new Map(EMOJI.map((e) => [e.name, e]));
export const glyphFor = (name) => byName.get(name)?.emoji ?? "";

// Typed and followed by a space, these become emoji. Deliberately short:
// "8)", "D:", "xo", ":/" and friends turn up in ordinary writing.
export const EMOTICONS = {
  ":)": "slightly_smiling_face",
  ":(": "frowning_face",
  ";)": "wink",
  ":D": "smile",
  ":P": "stuck_out_tongue",
  ":p": "stuck_out_tongue",
  "<3": "heart",
  "</3": "broken_heart",
  ":'(": "cry",
  XD: "laughing",
  ":O": "astonished",
  ":o": "astonished",
  ":|": "neutral_face",
};

// Tiptap's list leaves the smileys' group name empty.
const GROUPS = [
  ["", "smileys", "Smileys", "😀"],
  ["people & body", "people", "People", "👋"],
  ["animals & nature", "nature", "Animals & nature", "🐻"],
  ["food & drink", "food", "Food & drink", "🍔"],
  ["activities", "activities", "Activities", "⚽"],
  ["travel & places", "travel", "Travel & places", "🚗"],
  ["objects", "objects", "Objects", "💡"],
  ["symbols", "symbols", "Symbols", "❤️"],
  ["flags", "flags", "Flags", "🏁"],
];
export const EMOJI_GROUPS = GROUPS.map(([group, id, label, icon]) => ({
  id,
  label,
  icon,
  items: EMOJI.filter((e) => e.group === group),
}));

// Best first: exact shortcode, shortcode prefix, a word inside a shortcode,
// then a tag. Ties keep the list's order.
export function searchEmoji(query, limit = 8) {
  const q = String(query ?? "")
    .trim()
    .toLowerCase()
    .replace(/^:|:$/g, "");
  if (!q) return [];
  const rank = (e) => {
    if (e.shortcodes.includes(q)) return 0;
    if (e.shortcodes.some((s) => s.startsWith(q))) return 1;
    if (e.shortcodes.some((s) => s.split("_").some((w) => w.startsWith(q))))
      return 2;
    if (e.tags.some((t) => t.startsWith(q))) return 3;
    return -1;
  };
  return EMOJI.map((e) => [rank(e), e])
    .filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0])
    .slice(0, limit)
    .map(([, e]) => e);
}

// What the ":" popup shows. Needs two characters so "Note:" or "2:1" stay quiet.
export const suggestionItems = (query) =>
  String(query ?? "").length < 2 ? [] : searchEmoji(query, 8);

const RECENT_KEY = "macro-genie:recent-emoji:v1";

export function recentEmoji(storage = globalThis.localStorage) {
  try {
    const names = JSON.parse(storage?.getItem(RECENT_KEY) ?? "[]");
    return names.map((n) => byName.get(n)).filter(Boolean);
  } catch {
    return [];
  }
}

export function rememberEmoji(name, storage = globalThis.localStorage) {
  try {
    const names = JSON.parse(storage.getItem(RECENT_KEY) ?? "[]");
    const next = [name, ...names.filter((n) => n !== name)].slice(0, 24);
    storage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // No storage (private mode, tests): recent emoji just aren't kept.
  }
}
