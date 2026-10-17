import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildBrief } from "../server/brief.js";

// The private "stats" server: one tool, get_stats. Every one of
// Frosty's sites exposes a server with this name and tool so one Claude
// session can read them all the same way. Served only at a secret URL.
export function createStatsServer() {
  const server = new McpServer({ name: "stats", version: "1.0.0" });
  server.registerTool(
    "get_stats",
    {
      description:
        "This site's stats for a morning brief: yesterday's numbers against the trailing week, what's notable, and what needs a person. One call, no arguments. Same shape on every site (see docs/stats-mcp.md).",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(await buildBrief()) }],
    }),
  );
  return server;
}
