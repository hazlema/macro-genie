import { STEPS } from "../help/tour.js";

// The first-timer tour: whether it's running, which step shows, and whether
// the one-time offer dialog is open. `direction` lets the overlay skip a
// step whose anchor never renders without bouncing back and forth.
export const tour = $state({
  active: false,
  step: 0,
  direction: 1,
  offer: false,
  offerName: "",
});

export function offerTour(name = "") {
  tour.offerName = name;
  tour.offer = true;
}

export function dismissOffer() {
  tour.offer = false;
}

export function startTour() {
  tour.offer = false;
  tour.step = 0;
  tour.direction = 1;
  tour.active = true;
}

export function nextStep() {
  tour.direction = 1;
  if (tour.step >= STEPS.length - 1) stopTour();
  else tour.step += 1;
}

export function backStep() {
  tour.direction = -1;
  tour.step = Math.max(0, tour.step - 1);
}

export function stopTour() {
  tour.active = false;
}

// The phone-panel instruction for a step: "open", "closed", or null.
export function panelFor(step = tour.step) {
  return STEPS[step]?.panel ?? null;
}

// Where the card goes for an anchor window: just below it when the card
// fits there, else above, else beside it on the right, and always kept
// inside the viewport (overlapping the window beats being cut off on a
// short laptop screen).
export function placeCard(box, card, view, gap = 12, margin = 12) {
  const width = Math.min(card.width, view.width - margin * 2);
  let left = Math.max(margin, Math.min(box.left, view.width - width - margin));
  let top;
  if (view.height - (box.top + box.height) - gap - margin >= card.height) top = box.top + box.height + gap;
  else if (box.top - gap - margin >= card.height) top = box.top - gap - card.height;
  else if (box.left + box.width + gap + width <= view.width - margin) {
    left = box.left + box.width + gap;
    top = box.top;
  } else top = box.top - gap - card.height;
  top = Math.max(margin, Math.min(top, view.height - card.height - margin));
  return { top, left, width };
}

// The next button to focus when Tab (or Shift+Tab) is pressed inside the
// card: wraps at both ends; -1 means focus is on the card itself.
export function cycleIndex(length, index, backwards) {
  if (index < 0) return backwards ? length - 1 : 0;
  return (index + (backwards ? -1 : 1) + length) % length;
}
