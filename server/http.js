import { ZodError } from "zod";
import { UserFacingError } from "./chef.js";

// Turns any error into a JSON response a visitor can act on.
export const fail = (error) => {
  if (error instanceof ZodError)
    return Response.json(
      { error: "That request isn't valid." },
      { status: 400 },
    );
  if (error instanceof UserFacingError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error?.status === 401 || error?.status === 403)
    return Response.json(
      {
        error:
          "Recipe ideas aren't working: the site's Anthropic API key was rejected.",
      },
      { status: 503 },
    );
  if (error?.status === 429)
    return Response.json(
      { error: "Recipe ideas are busy right now. Try again in a minute." },
      { status: 429 },
    );
  console.error(error);
  return Response.json(
    { error: "Something went wrong making this idea. Try again." },
    { status: 502 },
  );
};
