import { NO_STORE, cacheHeaders, getTemplate, livePost, plainPage, postPage, recordPageBuild } from "../../server/seo.js";
import { withTiming } from "../../server/timing.js";

// /community/<id> as a real page for search engines and link previews.
// Live recipes get their content and preview tags; anything else gets the
// app with noindex. The app then loads over it as usual.
export const config = { path: "/community/:id", method: "GET" };

const html = (body, headers) =>
  new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });

async function handler(request) {
  const started = performance.now();
  const { origin, pathname } = new URL(request.url);
  const raw = pathname.split("/")[2] ?? "";
  const id = /^[1-9]\d{0,14}$/.test(raw) ? Number(raw) : null; // ≤ 15 digits: a safe integer
  let template;
  try {
    template = await getTemplate(origin);
  } catch (error) {
    console.error("seo-post: template", error);
    return new Response("Try again in a moment.", { status: 503, headers: NO_STORE });
  }
  try {
    const post = id ? await livePost(id) : null;
    const tags = id ? [`post-${id}`, "posts"] : ["posts"];
    const page = post ? postPage(template, post) : plainPage(template, { path: pathname });
    await recordPageBuild(performance.now() - started);
    return html(page, cacheHeaders(tags));
  } catch (error) {
    console.error("seo-post:", error);
    return html(plainPage(template, { path: pathname }), NO_STORE);
  }
}

export default withTiming(handler);
