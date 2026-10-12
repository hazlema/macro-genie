import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMOJI,
  EMOJI_GROUPS,
  EMOTICONS,
  glyphFor,
  recentEmoji,
  rememberEmoji,
  searchEmoji,
  suggestionItems,
} from "../src/lib/emoji.js";

const memory = () => {
  const data = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => (data[k] = v) };
};

test("the list drops letters and skin-tone swatches, and every emoji has a character", () => {
  assert.ok(EMOJI.length > 1500);
  assert.ok(EMOJI.every((e) => e.emoji));
  assert.ok(!EMOJI.some((e) => e.name.startsWith("regional_indicator_")));
  assert.ok(!EMOJI.some((e) => e.group === "components"));
});

test("text-style symbols are forced to show as color emoji", () => {
  assert.equal(glyphFor("heart"), "❤️");
  assert.equal(glyphFor("yum"), "😋");
  assert.equal(glyphFor("nope-not-real"), "");
});

test("every emoticon points at a real emoji", () => {
  for (const [face, name] of Object.entries(EMOTICONS))
    assert.ok(glyphFor(name), `${face} → ${name}`);
  for (const risky of ["8)", "D:", "xo", ":/", ":c", ":s"])
    assert.equal(EMOTICONS[risky], undefined, risky);
});

test("groups start with smileys and cover food", () => {
  assert.equal(EMOJI_GROUPS[0].label, "Smileys");
  assert.ok(EMOJI_GROUPS[0].items.some((e) => e.name === "yum"));
  assert.ok(
    EMOJI_GROUPS.find((g) => g.label === "Food & drink").items.some(
      (e) => e.name === "avocado",
    ),
  );
  assert.ok(EMOJI_GROUPS.every((g) => g.items.length > 0));
});

test("search ranks exact and prefix shortcode matches before tag matches", () => {
  assert.equal(searchEmoji("fire")[0].name, "fire");
  assert.equal(searchEmoji(":yum:")[0].name, "yum");
  const thumbs = searchEmoji("thumbs");
  assert.equal(thumbs[0].name, "+1");
  assert.ok(
    searchEmoji("tasty").some((e) => e.name === "yum"),
    "tags match",
  );
  assert.equal(searchEmoji("fi", 5).length, 5);
  assert.deepEqual(searchEmoji("   "), []);
});

test("a colon in ordinary writing doesn't open suggestions", () => {
  assert.deepEqual(suggestionItems(""), []);
  assert.deepEqual(suggestionItems("1"), []);
  assert.deepEqual(suggestionItems(")"), []);
  assert.ok(suggestionItems("fi").length > 0);
  assert.ok(suggestionItems("fi").length <= 8);
});

test("recent emoji are remembered newest first, without repeats, up to 24", () => {
  const store = memory();
  assert.deepEqual(recentEmoji(store), []);
  rememberEmoji("fire", store);
  rememberEmoji("yum", store);
  rememberEmoji("fire", store);
  assert.deepEqual(
    recentEmoji(store).map((e) => e.name),
    ["fire", "yum"],
  );
  for (const e of EMOJI.slice(0, 30)) rememberEmoji(e.name, store);
  assert.equal(recentEmoji(store).length, 24);
  assert.deepEqual(recentEmoji({ getItem: () => "not json" }), []);
  assert.doesNotThrow(() => rememberEmoji("fire", undefined));
});
