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

globalThis.$state = (v) => v;
const state = await import("../src/lib/tour.svelte.js").catch(() => ({}));
const skip = !state.tour && "needs the Svelte compiler";

test("start, next, back and stop stay in bounds", { skip }, () => {
  const { tour, startTour, nextStep, backStep, stopTour } = state;
  startTour();
  assert.equal(tour.active, true);
  assert.equal(tour.step, 0);
  backStep();
  assert.equal(tour.step, 0, "back from the first step stays put");
  assert.equal(tour.direction, -1);
  nextStep();
  assert.equal(tour.step, 1);
  assert.equal(tour.direction, 1);
  for (let i = 0; i < 5; i++) nextStep();
  assert.equal(tour.step, 6);
  assert.equal(tour.active, true);
  nextStep();
  assert.equal(tour.active, false, "next from the last step ends the tour");
  startTour();
  stopTour();
  assert.equal(tour.active, false);
});

test("the offer opens with a name, or without one, and closes on start", { skip }, () => {
  const { tour, offerTour, dismissOffer, startTour } = state;
  offerTour("Sam");
  assert.equal(tour.offer, true);
  assert.equal(tour.offerName, "Sam");
  dismissOffer();
  assert.equal(tour.offer, false);
  offerTour("");
  assert.equal(tour.offerName, "");
  startTour();
  assert.equal(tour.offer, false);
  assert.equal(tour.active, true);
});

test("panelFor reads the current step", { skip }, () => {
  const { tour, startTour, nextStep, panelFor } = state;
  startTour();
  assert.equal(panelFor(), null);
  nextStep();
  assert.equal(panelFor(), "open");
  assert.equal(panelFor(3), "closed");
  assert.equal(panelFor(99), null);
});
