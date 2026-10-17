import { test } from "node:test";
import assert from "node:assert/strict";
import { notableLines, plural } from "../server/notable.js";

// Seven daily counts, index 0 = yesterday, 6 = a week ago.
const labels = {
  messages: { count: (n) => plural(n, "contact message"), none: "no contact messages" },
  signIns: { count: (n) => plural(n, "sign-in"), none: "no sign-ins" },
  revenue: { count: (n) => `$${n.toFixed(2)} in packs`, none: "no pack sales" },
};

test("a boring week says nothing", () => {
  assert.deepEqual(notableLines({ messages: [2, 1, 3, 2, 2, 1, 2], signIns: [0, 0, 0, 0, 0, 0, 0] }, labels), []);
});

test("first in a week", () => {
  assert.deepEqual(notableLines({ messages: [3, 0, 0, 0, 0, 0, 0] }, labels), [
    "3 contact messages yesterday, first in a week",
  ]);
  assert.deepEqual(notableLines({ revenue: [6, 0, 0, 0, 0, 0, 0] }, labels), ["$6.00 in packs yesterday, first in a week"]);
});

test("the most in a week needs at least 3 and a real history", () => {
  assert.deepEqual(notableLines({ signIns: [5, 2, 4, 1, 3, 2, 2] }, labels), ["5 sign-ins yesterday, the most in a week"]);
  assert.deepEqual(notableLines({ signIns: [2, 1, 1, 1, 1, 1, 1] }, labels), [], "2 is too small to call");
  assert.deepEqual(notableLines({ signIns: [4, 4, 1, 1, 1, 1, 1] }, labels), [], "a tie isn't the most");
});

test("none, after six days with some", () => {
  assert.deepEqual(notableLines({ signIns: [0, 3, 2, 4, 1, 2, 5] }, labels), ["no sign-ins yesterday, after six days with some"]);
  assert.deepEqual(notableLines({ signIns: [0, 3, 2, 0, 1, 2, 5] }, labels), [], "a zero in the history disarms it");
});

test("well above the week's average", () => {
  // 10 yesterday against 10+2*6=22 over seven days: avg 3.1, more than double.
  assert.deepEqual(notableLines({ messages: [10, 2, 2, 2, 2, 2, 2] }, labels), [
    "10 contact messages yesterday, well above the week's average of 3.1",
  ]);
  assert.deepEqual(notableLines({ messages: [2, 1, 1, 1, 1, 1, 1] }, labels), [], "fewer than 5 isn't called out");
});

test("one line per metric, the strongest rule wins, in metric order", () => {
  const lines = notableLines({ signIns: [5, 4, 4, 4, 4, 4, 4], messages: [1, 0, 0, 0, 0, 0, 0] }, labels);
  assert.deepEqual(lines, [
    "5 sign-ins yesterday, the most in a week",
    "1 contact message yesterday, first in a week",
  ]);
});

test("metrics without a label or without seven days are skipped", () => {
  assert.deepEqual(notableLines({ mystery: [3, 0, 0, 0, 0, 0, 0], messages: [3, 0] }, labels), []);
});
