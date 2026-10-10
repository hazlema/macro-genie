import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../../mcp/server.js";

export const config = { path: "/mcp" };

export default async function handler(request) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Accept, MCP-Protocol-Version, Last-Event-ID",
    "Cache-Control": "no-store",
  };
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (request.method !== "POST")
    return new Response("Use MCP Streamable HTTP POST requests.", {
      status: 405,
      headers: { ...headers, Allow: "POST, OPTIONS" },
    });

  // A fresh server and transport for every request: no session store or filesystem writes.
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const body = await response.text();
    const combinedHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(headers))
      combinedHeaders.set(key, value);
    return new Response(body || null, {
      status: response.status,
      headers: combinedHeaders,
    });
  } finally {
    await server.close();
  }
}
