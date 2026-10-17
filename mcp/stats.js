import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildBrief } from "../server/brief.js";

// The private "stats" server: one tool, the morning brief. Every one of
// Frosty's sites exposes a server with this name and tool so one Claude
// session can read them all the same way. Served only at a secret URL.
export function createStatsServer() {
  const server = new McpServer({ name: "stats", version: "1.0.0" });
  server.registerTool(
    "morning_brief",
    {
      description:
        "What happened on this site in the last 24 hours and anything that needs a person: health, problems, people and usage, inbox, moderation queue, and the activity log. Call it once for the morning brief.",
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
