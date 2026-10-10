import { UserFacingError, generateIdea } from "../../server/chef.js";
import { fail } from "../../server/http.js";

// Five of these run in parallel per "Get ideas" click, one idea each.
export const config = {
  path: "/api/idea",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

export default async function handler(request) {
  try {
    const body = await request.json().catch(() => {
      throw new UserFacingError("Send the request as JSON.");
    });
    return Response.json(await generateIdea(body));
  } catch (error) {
    return fail(error);
  }
}
