import Stripe from "stripe";
import { UserFacingError } from "./errors.js";

export const UNAVAILABLE =
  "Payments are unavailable right now. Try again in a few minutes.";

let client = null;

// The Stripe client, made on first use. Tests swap in a fake with useStripe.
export function stripe() {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("stripe: STRIPE_SECRET_KEY is not set");
    throw new UserFacingError(UNAVAILABLE, 503);
  }
  client = new Stripe(key, { maxNetworkRetries: 2, timeout: 15_000 });
  return client;
}

export function useStripe(fake) {
  client = fake;
}
