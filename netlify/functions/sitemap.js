import { NO_STORE, cacheHeaders, liveRecipes, recordPageBuild, sitemapXml } from "../../server/seo.js";
import { withTiming } from "../../server/timing.js";

// /sitemap.xml: the fixed pages plus every live community recipe.
export const config = { path: "/sitemap.xml", method: ["GET", "HEAD"] };

async function handler() {
  const started = performance.now();
  try {
    const xml = sitemapXml(await liveRecipes());
    await recordPageBuild(performance.now() - started);
    return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", ...cacheHeaders(["sitemap"]) } });
  } catch (error) {
    console.error("sitemap:", error);
    return new Response("Try again in a moment.", { status: 503, headers: NO_STORE });
  }
}

export default withTiming(handler);
