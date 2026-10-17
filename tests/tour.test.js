import { test } from "node:test";
import assert from "node:assert/strict";
import { STEPS } from "../src/help/tour.js";

test("the tour has seven steps with a title and text each", () => {
  assert.equal(STEPS.length, 7);
  for (const s of STEPS) {
    assert.ok(s.title && s.text, s.title);
    assert.ok(!("panel" in s) || s.panel === "open" || s.panel === "closed", s.title);
    if (s.selector) {
      const list = Array.isArray(s.selector) ? s.selector : [s.selector];
      assert.ok(list.length && list.every((x) => typeof x === "string" && x.trim()), s.title);
    }
  }
});

test("first and last steps are centred; the rest point at something", () => {
  assert.equal(STEPS[0].selector, undefined);
  assert.equal(STEPS[6].selector, undefined);
  for (const s of STEPS.slice(1, 6)) assert.ok(s.selector, s.title);
});

test("only the Get ideas step has signed-out copy, and it says to sign in", () => {
  const withAlt = STEPS.filter((s) => s.textSignedOut);
  assert.equal(withAlt.length, 1);
  assert.match(withAlt[0].title, /Get ideas/);
  assert.match(withAlt[0].textSignedOut, /Sign in/);
});

test("phone panel opens for the targets steps and closes after", () => {
  assert.equal(STEPS[1].panel, "open");
  assert.equal(STEPS[2].panel, "open");
  assert.equal(STEPS[3].panel, "closed");
  assert.equal(STEPS[4].panel, "closed");
  assert.equal(STEPS[5].panel, "closed");
});
