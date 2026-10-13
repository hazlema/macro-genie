import { queueCount } from "../../server/admin.js";
import { roleOf } from "../../server/roles.js";
import { UserFacingError } from "../../server/chef.js";
import {
  addComment,
  checkPost,
  boardCounts,
  createPost,
  createThread,
  getPost,
  listComments,
  listPosts,
  removeOwnComment,
  removeOwnPost,
  report,
  toggleLike,
} from "../../server/community.js";
import { fail } from "../../server/http.js";
import { readSession } from "../../server/session.js";
import { withTiming } from "../../server/timing.js";

// Anyone can browse; taking part (posting, liking, commenting, reporting)
// needs an account; moderators also see what is waiting for review.
export const config = {
  path: ["/api/community", "/api/community/*"],
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};

const viewerOf = (request) =>
  process.env.SESSION_SECRET ? readSession(request) : null;

function signedIn(request) {
  const viewer = viewerOf(request);
  if (!viewer)
    throw new UserFacingError("Sign in to take part. Browsing is free.", 401);
  return viewer;
}

const idFrom = (value) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1)
    throw new UserFacingError("That item wasn't found.", 404);
  return id;
};

async function json(request) {
  return request.json().catch(() => {
    throw new UserFacingError("Send the request as JSON.");
  });
}

async function handler(request) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // after "api"
  const method = request.method;
  const route = `${method} ${parts.map((p) => (/^\d+$/.test(p) ? ":id" : p)).join("/")}`;
  const id = parts.find((p) => /^\d+$/.test(p));
  try {
    switch (route) {
      case "GET community": {
        let ranges = {};
        try {
          ranges = JSON.parse(url.searchParams.get("ranges") || "{}");
        } catch {
          throw new UserFacingError("Ranges weren't readable.");
        }
        const viewer = viewerOf(request);
        const moderator = (await roleOf(viewer)).mod;
        return Response.json(
          await listPosts({
            viewer,
            moderator,
            needsReview: moderator && url.searchParams.get("review") === "1",
            board: url.searchParams.get("board") || null,
            meal: url.searchParams.get("meal") || "all",
            sort: url.searchParams.get("sort") || "new",
            offset: url.searchParams.get("offset") || 0,
            ranges,
          }),
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      case "GET community/counts": {
        const viewer = viewerOf(request);
        const moderator = (await roleOf(viewer)).mod;
        return Response.json(
          {
            counts: await boardCounts(),
            ...(moderator ? { queue: await queueCount() } : {}),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      case "POST community/threads": {
        const viewer = signedIn(request);
        return Response.json(await createThread(viewer, await json(request)));
      }
      case "POST community/check": {
        signedIn(request);
        return Response.json(await checkPost((await json(request)).recipe));
      }
      case "POST community/posts": {
        const viewer = signedIn(request);
        const body = await json(request);
        return Response.json(
          await createPost(viewer, body.recipe, {
            mealType: body.mealType,
            token: body.token,
          }),
        );
      }
      case "GET community/posts/:id": {
        const viewer = viewerOf(request);
        return Response.json(
          {
            post: await getPost(idFrom(id), viewer, (await roleOf(viewer)).mod),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      case "DELETE community/posts/:id":
        await removeOwnPost(signedIn(request), idFrom(id));
        return Response.json({ removed: true });
      case "POST community/posts/:id/like":
        return Response.json(await toggleLike(signedIn(request), idFrom(id)));
      case "GET community/posts/:id/comments":
        return Response.json(
          {
            comments: await listComments(
              idFrom(id),
              viewerOf(request),
              (await roleOf(viewerOf(request))).mod,
            ),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      case "POST community/posts/:id/comments": {
        const viewer = signedIn(request);
        return Response.json(
          await addComment(viewer, idFrom(id), (await json(request)).body),
        );
      }
      case "DELETE community/comments/:id":
        await removeOwnComment(signedIn(request), idFrom(id));
        return Response.json({ removed: true });
      case "POST community/report": {
        const viewer = signedIn(request);
        const body = await json(request);
        return Response.json(
          await report(viewer, body.type, idFrom(body.id), body.reason),
        );
      }
      default:
        return Response.json({ error: "Not found." }, { status: 404 });
    }
  } catch (error) {
    return fail(error);
  }
}

// Server-Timing header and a "timing" log line for every response.
export default withTiming(handler);
