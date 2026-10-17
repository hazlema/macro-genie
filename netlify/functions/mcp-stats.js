import { timingSafeEqual } from "node:crypto";
import { createStatsServer } from "../../mcp/stats.js";
import { serveMcp } from "../../mcp/http.js";

export const config = { path: "/mcp/stats/*" };

// The secret is the last path segment: /mcp/stats/<token>. Anything else,
// or no STATS_TOKEN configured, is a plain 404 that gives nothing away.
export function tokenMatches(pathname, expected = process.env.STATS_TOKEN) {
  if (!expected) return false;
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "mcp" || parts[1] !== "stats") return false;
  const given = Buffer.from(parts[2]);
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

export default function handler(request) {
  if (!tokenMatches(new URL(request.url).pathname))
    return new Response("Not Found", { status: 404 });
  return serveMcp(request, createStatsServer);
}
