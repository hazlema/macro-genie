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
