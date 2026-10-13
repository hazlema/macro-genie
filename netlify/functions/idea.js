import {
  UserFacingError,
  generateIdea,
  ideaRequest,
} from "../../server/chef.js";
import { withCredit } from "../../server/credits.js";
import { fail } from "../../server/http.js";
import { withTiming } from "../../server/timing.js";

// Five of these run in parallel per "Get ideas" click, one idea each.
export const config = {
  path: "/api/idea",
  method: "POST",
  rateLimit: { windowLimit: 40, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

async function handler(request) {
  try {
    const body = await request.json().catch(() => {
      throw new UserFacingError("Send the request as JSON.");
    });
    // Check the request before taking a credit for it.
    ideaRequest.parse(body);
    return Response.json(
      await withCredit(request, "idea", () => generateIdea(body)),
    );
  } catch (error) {
    return fail(error);
  }
}

// Server-Timing header and a "timing" log line for every response.
export default withTiming(handler);
