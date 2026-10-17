import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createStatsServer } from "../mcp/stats.js";
import handler, { tokenMatches } from "../netlify/functions/mcp-stats.js";
import { useDatabase } from "../server/db.js";

const TOKEN = "a".repeat(48);

test("tokenMatches accepts only the exact configured token", () => {
  assert.equal(tokenMatches(`/mcp/stats/${TOKEN}`, TOKEN), true);
  assert.equal(tokenMatches(`/mcp/stats/${TOKEN}/`, TOKEN), true, "trailing slash");
  assert.equal(tokenMatches(`/mcp/stats/${"b".repeat(48)}`, TOKEN), false, "wrong token");
  assert.equal(tokenMatches(`/mcp/stats/${TOKEN.slice(1)}`, TOKEN), false, "wrong length");
  assert.equal(tokenMatches("/mcp/stats/", TOKEN), false, "no token segment");
  assert.equal(tokenMatches("/mcp/stats", TOKEN), false, "no token segment, no slash");
  assert.equal(tokenMatches(`/mcp/stats/${TOKEN}/extra`, TOKEN), false, "extra segment");
  assert.equal(tokenMatches(`/mcp/stats/${TOKEN}`, ""), false, "no token configured");
  assert.equal(tokenMatches(`/mcp/stats/${TOKEN}`, undefined), false, "no token configured");
});

test("the stats function is a plain 404 without the right token", async () => {
  delete process.env.STATS_TOKEN;
  for (const path of [`/mcp/stats/${TOKEN}`, "/mcp/stats/", "/mcp/stats/anything"]) {
    const res = await handler(new Request(`https://example.com${path}`, { method: "POST" }));
    assert.equal(res.status, 404, `${path} with no STATS_TOKEN`);
  }
  process.env.STATS_TOKEN = TOKEN;
  const wrong = await handler(new Request("https://example.com/mcp/stats/nope", { method: "POST" }));
  assert.equal(wrong.status, 404);
  const options = await handler(new Request(`https://example.com/mcp/stats/${TOKEN}`, { method: "OPTIONS" }));
  assert.equal(options.status, 204);
  const get = await handler(new Request(`https://example.com/mcp/stats/${TOKEN}`, { method: "GET" }));
  assert.equal(get.status, 405);
});

test("with the token, the stats server lists exactly get_stats over HTTP", async () => {
  process.env.STATS_TOKEN = TOKEN;
  const client = new Client({ name: "stats-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`https://example.com/mcp/stats/${TOKEN}`), {
    fetch: (url, options) => handler(new Request(url, options)),
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((t) => t.name), ["get_stats"]);
  } finally {
    await client.close();
  }
});

test("get_stats answers even with no database, and says so first", async () => {
  delete process.env.DATABASE_URL;
  useDatabase(null);
  const server = createStatsServer();
  const client = new Client({ name: "stats-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const result = await client.callTool({ name: "get_stats", arguments: {} });
    assert.ok(!result.isError);
    const brief = JSON.parse(result.content[0].text);
    assert.equal(brief.site, "Macro Genie");
    assert.equal(brief.status, "attention");
    assert.equal(brief.attention[0], "Database unreachable");
    assert.equal(brief.metrics, null);
  } finally {
    await client.close();
    await server.close();
  }
});
