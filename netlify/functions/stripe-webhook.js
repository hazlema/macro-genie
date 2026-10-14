import { fail } from "../../server/http.js";
import { handleWebhook } from "../../server/payments.js";
import { withTiming } from "../../server/timing.js";

// Stripe tells us about paid checkouts and refunds here. No rate limit: Stripe
// retries anything that isn't a 2xx, so a refused call would only come back.
export const config = { path: "/api/stripe/webhook", method: "POST" };

async function handler(request) {
  try {
    const raw = await request.text();
    return Response.json(
      await handleWebhook(raw, request.headers.get("stripe-signature")),
    );
  } catch (error) {
    return fail(error);
  }
}

export default withTiming(handler);
