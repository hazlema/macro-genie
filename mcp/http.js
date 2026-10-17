import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, MCP-Protocol-Version, Last-Event-ID",
  "Cache-Control": "no-store",
};

// Serves one MCP request over Streamable HTTP with a fresh server and
// transport: no session store or filesystem writes, so any function
// instance can answer any request.
export async function serveMcp(request, createServer) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== "POST")
    return new Response("Use MCP Streamable HTTP POST requests.", {
      status: 405,
      headers: { ...HEADERS, Allow: "POST, OPTIONS" },
    });
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const body = await response.text();
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(HEADERS)) headers.set(key, value);
    return new Response(body || null, { status: response.status, headers });
  } finally {
    await server.close();
  }
}
