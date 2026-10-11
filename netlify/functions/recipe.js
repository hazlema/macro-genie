import {
  UserFacingError,
  methodRequest,
  writeRecipe,
} from "../../server/chef.js";
import { withCredit } from "../../server/credits.js";
import { fail } from "../../server/http.js";

// Writes a structured recipe (version 2) for fixed ingredients and amounts.
export const config = {
  path: "/api/recipe",
  method: "POST",
  rateLimit: { windowLimit: 12, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

export default async function handler(request) {
  try {
    const body = await request.json().catch(() => {
      throw new UserFacingError("Send the request as JSON.");
    });
    methodRequest.parse(body);
    return Response.json(
      await withCredit(request, "recipe", () => writeRecipe(body)),
    );
  } catch (error) {
    return fail(error);
  }
}
