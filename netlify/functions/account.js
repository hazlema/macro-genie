import {
  WELCOME_CREDITS,
  findOrCreateAccount,
  getAccount,
  isBannedSub,
} from "../../server/accounts.js";
import { logActivity } from "../../server/activity.js";
import { roleOf } from "../../server/roles.js";
import { setDisplayName } from "../../server/community.js";
import { UserFacingError } from "../../server/chef.js";
import { fail } from "../../server/http.js";
import { isDatabaseDown, reportDatabaseDown } from "../../server/db.js";
import {
  clearCookie,
  readSession,
  sessionCookie,
  verifyGoogleToken,
} from "../../server/session.js";
import { withTiming } from "../../server/timing.js";

// /api/me: who's signed in and their credits, plus the Google client id the
//   page needs to show the sign-in button.
// /api/auth/google: sign in (or create an account) with a Google ID token.
// /api/me/name: change the display name shown on community posts.
// /api/auth/logout: sign out.
export const config = {
  path: ["/api/me", "/api/me/name", "/api/auth/google", "/api/auth/logout"],
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

const publicAccount = (a) => ({
  displayName: a.displayName,
  credits: a.credits,
});

async function handler(request) {
  const { pathname } = new URL(request.url);
  try {
    if (pathname === "/api/me") {
      const googleClientId = process.env.GOOGLE_CLIENT_ID ?? null;
      const id = process.env.SESSION_SECRET ? readSession(request) : null;
      // With the database down, the page still loads, just signed out.
      let account = null;
      let role = null;
      try {
        account = id ? await getAccount(id) : null;
        role = account && (await roleOf(account.id));
      } catch (error) {
        if (!isDatabaseDown(error)) throw error;
        reportDatabaseDown(error);
        account = null;
      }
      return Response.json(
        {
          signedIn: !!account,
          account: account && {
            ...publicAccount(account),
            isAdmin: role.admin,
            isMod: role.mod,
            suspended: role.suspended,
          },
          googleClientId,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (request.method !== "POST")
      return new Response("Use POST.", {
        status: 405,
        headers: { Allow: "POST" },
      });
    if (pathname === "/api/me/name") {
      const id = readSession(request);
      if (!id) throw new UserFacingError("Sign in to change your name.", 401);
      const body = await request.json().catch(() => ({}));
      return Response.json({
        displayName: await setDisplayName(id, body.displayName),
      });
    }
    if (pathname === "/api/auth/logout")
      return Response.json(
        { signedIn: false },
        { headers: { "Set-Cookie": clearCookie } },
      );

    const body = await request.json().catch(() => {
      throw new UserFacingError("Send the request as JSON.");
    });
    const person = await verifyGoogleToken(body?.credential);
    if (await isBannedSub(person.sub))
      throw new UserFacingError("This Google account can't sign in here.", 403);
    const account = await findOrCreateAccount(person);
    await logActivity({
      kind: account.isNew ? "joined" : "sign_in",
      accountId: account.id,
      actorName: account.displayName,
      text: account.isNew
        ? `joined (new account, ${WELCOME_CREDITS} credits)`
        : "signed in",
    });
    return Response.json(
      { signedIn: true, account: publicAccount(account), isNew: account.isNew },
      { headers: { "Set-Cookie": sessionCookie(account.id, request) } },
    );
  } catch (error) {
    return fail(error);
  }
}

// Server-Timing header and a "timing" log line for every response.
export default withTiming(handler);
