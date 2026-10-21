import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fillInvite,
  findBlanks,
  normalizeCode,
} from "../src/lib/invite-text.js";

test("fillInvite fills credits and link in any case and spacing", () => {
  const out = fillInvite(
    "Take [Credits] credits: [ redeem link ] / [REDEEM LINK]",
    { credits: 50, link: "https://x/redeem?code=ab" },
  );
  assert.equal(
    out,
    "Take 50 credits: https://x/redeem?code=ab / https://x/redeem?code=ab",
  );
});

test("findBlanks lists the other brackets once each", () => {
  assert.deepEqual(
    findBlanks(
      'Hi [user], [user]! [credits] [One recipe, e.g. "x"] [redeem link]',
    ),
    ["[user]", '[One recipe, e.g. "x"]'],
  );
  assert.deepEqual(findBlanks("no blanks [credits]"), []);
});

test("normalizeCode", () => {
  const c = "a".repeat(32) + "0123456789abcdef".repeat(2);
  assert.equal(normalizeCode(` ${c.slice(0, 20)}-${c.slice(20)}\n`), c);
  assert.equal(
    normalizeCode(`https://macro-genie.com/redeem?code=${c.toUpperCase()}`),
    c,
  );
  assert.equal(normalizeCode("abc"), "");
  assert.equal(normalizeCode(""), "");
});
