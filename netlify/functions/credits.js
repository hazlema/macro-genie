import { UserFacingError } from "../../server/chef.js";
import { fail } from "../../server/http.js";
import { PACKS } from "../../server/packs.js";
import { confirmPurchase, startCheckout } from "../../server/payments.js";
import { readSession } from "../../server/session.js";
import { withTiming } from "../../server/timing.js";

// /api/credits/packs: the packs for sale.
// /api/credits/checkout: start a Stripe Checkout for one pack.
// /api/credits/confirm: the return page asks for its credits.
export const config = {
  path: ["/api/credits/packs", "/api/credits/checkout", "/api/credits/confirm"],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

async function handler(request) {
  const { pathname, origin } = new URL(request.url);
  try {
    // Without a Stripe key (before launch) the page shows "opens soon".
    if (pathname === "/api/credits/packs")
      return Response.json({ packs: PACKS, open: !!process.env.STRIPE_SECRET_KEY });
    if (request.method !== "POST")
      return new Response("Use POST.", { status: 405, headers: { Allow: "POST" } });
    const body = await request.json().catch(() => {
      throw new UserFacingError("Send the request as JSON.");
    });
    const accountId = process.env.SESSION_SECRET ? readSession(request) : null;
    if (pathname === "/api/credits/checkout")
      return Response.json(await startCheckout(accountId, body?.pack, origin));
    return Response.json(await confirmPurchase(accountId, body?.sessionId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}

// Server-Timing header and a "timing" log line for every response.
export default withTiming(handler);
