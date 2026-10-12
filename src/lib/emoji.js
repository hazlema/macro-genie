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
      // Unicode 16+ (2024 on) shows as an empty box on many devices.
      !(e.version > 15.1) &&
      !e.name.startsWith("regional_indicator_"),
  )
  // No fallbackImage: Tiptap would show a large picture whenever its support
  // check fails, while posts show the device's own emoji.
  .map((e) => ({
    ...e,
    emoji: colorGlyph(e.emoji),
    emoticons: [],
    fallbackImage: undefined,
  }));

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

// Emoji people reach for most in food chat; they win ties in search.
const POPULAR = [
  "fire",
  "heart",
  "yum",
  "+1",
  "joy",
  "smile",
  "heart_eyes",
  "drooling_face",
  "star_struck",
  "clap",
  "raised_hands",
  "pray",
  "muscle",
  "thinking",
  "sweat_smile",
  "wink",
  "slightly_smiling_face",
  "laughing",
  "cry",
  "ok_hand",
  "100",
  "sparkles",
  "tada",
  "hot_pepper",
  "avocado",
  "egg",
  "fork_and_knife",
  "plate_with_cutlery",
  "cook",
  "green_salad",
  "pizza",
];
const popularity = new Map(POPULAR.map((name, i) => [name, i]));

// Best first: exact shortcode, shortcode prefix, a word inside a shortcode,
// then a tag. Ties go to popular emoji, then shorter names.
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
  const tieBreak = (e) => [
    popularity.get(e.name) ?? POPULAR.length,
    Math.min(...e.shortcodes.map((s) => s.length)),
  ];
  return EMOJI.map((e) => [rank(e), ...tieBreak(e), e])
    .filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    .slice(0, limit)
    .map((row) => row[3]);
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
