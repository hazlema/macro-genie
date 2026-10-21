import { decide, reviewQueue } from "../../server/admin.js";
import { listActivity } from "../../server/activity.js";
import { addCost, deleteCost, updateCost } from "../../server/costs.js";
import {
  cancelInvite,
  deleteTemplate,
  forgetInvite,
  listInvites,
  resendInvite,
  saveTemplate,
  sendInvite,
} from "../../server/invites.js";
import { listMessages, setMessageStatus } from "../../server/messages.js";
import { moneyOverview } from "../../server/money.js";
import { UserFacingError } from "../../server/chef.js";
import { fail } from "../../server/http.js";
import { requireMod } from "../../server/roles.js";
import { readSession } from "../../server/session.js";
import {
  adjustCredits,
  deleteAccount,
  listUsers,
  removeCommunityContent,
  setRoles,
  setSuspended,
} from "../../server/users.js";
import { withTiming } from "../../server/timing.js";

// The admin page's API. Each case (or the users.js function it calls)
// checks whether the signed-in account is a mod or an admin.
export const config = {
  path: "/api/admin/*",
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};

const noStore = { headers: { "Cache-Control": "no-store" } };

function signedIn(request) {
  const id = process.env.SESSION_SECRET ? readSession(request) : null;
  if (!id) throw new UserFacingError("Sign in first.", 401);
  return id;
}

const idFrom = (value) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1)
    throw new UserFacingError("That item wasn't found.", 404);
  return id;
};

const json = (request) =>
  request.json().catch(() => {
    throw new UserFacingError("Send the request as JSON.");
  });

async function handler(request) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean).slice(2); // after "api/admin"
  const route = `${request.method} ${parts.map((p) => (/^\d+$/.test(p) ? ":id" : p)).join("/")}`;
  const id = parts.find((p) => /^\d+$/.test(p));
  try {
    const actor = signedIn(request);
    switch (route) {
      case "GET queue":
        await requireMod(actor);
        return Response.json({ items: await reviewQueue() }, noStore);
      case "POST decide": {
        await requireMod(actor);
        const body = await json(request);
        return Response.json(
          await decide(body.type, idFrom(body.id), body.action, actor),
        );
      }
      case "GET users":
        return Response.json(
          await listUsers(actor, {
            query: url.searchParams.get("q") ?? "",
            offset: url.searchParams.get("offset") ?? 0,
          }),
          noStore,
        );
      case "POST users/:id/suspend": {
        const body = await json(request);
        return Response.json(
          await setSuspended(actor, idFrom(id), body.on === true),
        );
      }
      case "POST users/:id/remove-content":
        return Response.json(await removeCommunityContent(actor, idFrom(id)));
      case "POST users/:id/credits": {
        const body = await json(request);
        return Response.json(
          await adjustCredits(actor, idFrom(id), body.amount, body.reason),
        );
      }
      case "POST users/:id/roles": {
        const body = await json(request);
        return Response.json(
          await setRoles(actor, idFrom(id), {
            admin: body.admin,
            mod: body.mod,
          }),
        );
      }
      case "POST users/:id/delete": {
        const body = await json(request);
        return Response.json(
          await deleteAccount(actor, idFrom(id), body.confirm, { ban: body.ban !== false }),
        );
      }
      case "GET log":
        await requireMod(actor);
        return Response.json(
          await listActivity({
            chip: url.searchParams.get("chip") || "all",
            before: url.searchParams.get("before"),
          }),
          noStore,
        );
      case "GET messages":
        return Response.json(
          await listMessages(actor, {
            status: url.searchParams.get("status") || "new",
          }),
          noStore,
        );
      case "POST messages/:id/status": {
        const body = await json(request);
        return Response.json(
          await setMessageStatus(actor, idFrom(id), body.status),
        );
      }
      case "GET money":
        return Response.json(await moneyOverview(actor), noStore);
      case "POST money/costs":
        return Response.json(await addCost(actor, await json(request)));
      case "PATCH money/costs/:id":
        return Response.json(
          await updateCost(actor, idFrom(id), await json(request)),
        );
      case "DELETE money/costs/:id":
        return Response.json(await deleteCost(actor, idFrom(id)));
      // Invites (owner only; server/invites.js checks).
      case "GET invites":
        return Response.json(await listInvites(actor), noStore);
      case "POST invites":
        return Response.json(
          await sendInvite(actor, await json(request), url.origin),
        );
      case "POST invites/:id/resend":
        return Response.json(await resendInvite(actor, idFrom(id)));
      case "POST invites/:id/cancel":
        return Response.json(await cancelInvite(actor, idFrom(id)));
      case "POST invites/:id/forget":
        return Response.json(await forgetInvite(actor, idFrom(id)));
      case "POST templates":
        return Response.json(await saveTemplate(actor, await json(request)));
      case "POST templates/:id/delete":
        return Response.json(await deleteTemplate(actor, idFrom(id)));
      default:
        return Response.json({ error: "Not found." }, { status: 404 });
    }
  } catch (error) {
    return fail(error);
  }
}

// Server-Timing header and a "timing" log line for every response.
export default withTiming(handler);
