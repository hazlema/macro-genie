import { UserFacingError } from "../../server/chef.js";
import { fail } from "../../server/http.js";
import { checkMessage, saveMessage } from "../../server/messages.js";
import { roleOf } from "../../server/roles.js";
import { readSession } from "../../server/session.js";

// The contact form. Works signed out; a hidden "website" field catches bots
// (they get a normal-looking reply and nothing is stored). Netlify's limiter
// allows at most a 3-minute window, so: 3 messages per 3 minutes per IP.
export const config = {
  path: "/api/contact",
  method: "POST",
  rateLimit: { windowLimit: 3, windowSize: 180, aggregateBy: ["ip", "domain"] },
};

export default async function handler(request) {
  try {
    const input = await request.json().catch(() => {
      throw new UserFacingError("Send the request as JSON.");
    });
    if (String(input?.website ?? "").trim())
      return Response.json({ sent: true });
    const accountId = process.env.SESSION_SECRET ? readSession(request) : null;
    const role = await roleOf(accountId);
    const clean = checkMessage({ ...input, signedIn: role.exists });
    await saveMessage({
      accountId: role.exists ? accountId : null,
      name: role.exists ? role.displayName : "Visitor",
      ...clean,
    });
    return Response.json({ sent: true });
  } catch (error) {
    return fail(error);
  }
}
