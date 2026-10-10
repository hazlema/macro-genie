import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpServer } from "../mcp/server.js";
import handler from "../netlify/functions/mcp.js";

test("MCP exposes searchable serving values and retrievable food details", async () => {
  const server = createMcpServer();
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((t) => t.name).sort(), [
      "get_food_details",
      "list_food_categories",
      "search_foods",
      "size_recipe",
    ]);
    const found = await client.callTool({
      name: "search_foods",
      arguments: {
        query: "chicken",
        ranges: { protein: { min: 20 }, calories: { max: 300 } },
        limit: 3,
      },
    });
    assert.ok(!found.isError);
    const data = JSON.parse(found.content[0].text);
    assert.equal(data.basis, "per serving");
    assert.equal(data.foods.length, 3);
    assert.ok(data.total > 3);
    for (const food of data.foods) {
      assert.ok(food.serving.grams > 0);
      assert.ok(food.nutrients.protein >= 20);
      assert.ok(food.nutrients.calories <= 300);
    }
    const detail = await client.callTool({
      name: "get_food_details",
      arguments: { id: data.foods[0].id },
    });
    assert.deepEqual(JSON.parse(detail.content[0].text).food, data.foods[0]);
    assert.equal(data.foods[0].per100g, undefined);
    const per100 = await client.callTool({
      name: "search_foods",
      arguments: {
        query: "chicken",
        basis: "100g",
        ranges: { protein: { min: 25 } },
        limit: 3,
      },
    });
    assert.ok(!per100.isError);
    const per100Data = JSON.parse(per100.content[0].text);
    assert.equal(per100Data.basis, "per 100 g");
    for (const food of per100Data.foods) {
      assert.ok(food.nutrients.protein >= 25);
      assert.equal(food.per100g, undefined);
    }
    const per100Detail = await client.callTool({
      name: "get_food_details",
      arguments: { id: per100Data.foods[0].id, basis: "100g" },
    });
    assert.deepEqual(
      JSON.parse(per100Detail.content[0].text).food,
      per100Data.foods[0],
    );
    const excluded = await client.callTool({
      name: "search_foods",
      arguments: { query: "chicken", exclude: ["breast"], limit: 100 },
    });
    const excludedData = JSON.parse(excluded.content[0].text);
    assert.ok(excludedData.total > 0);
    assert.ok(excludedData.foods.every((f) => !/\bbreast/i.test(f.name)));
    const sized = await client.callTool({
      name: "size_recipe",
      arguments: {
        servings: 2,
        ingredients: [
          { id: data.foods[0].id, grams: 300, required: true },
          { id: data.foods[1].id, grams: 200 },
        ],
        ranges: { calories: { max: 250 } },
      },
    });
    assert.ok(!sized.isError);
    const sizedData = JSON.parse(sized.content[0].text);
    assert.equal(sizedData.basis, "per serving");
    assert.equal(sizedData.ingredients.length, 2);
    assert.ok(sizedData.ingredients[0].grams >= 75);
    assert.ok(sizedData.fits ? sizedData.perServing.calories <= 250.05 : true);
    const missing = await client.callTool({
      name: "size_recipe",
      arguments: { ingredients: [{ id: "nope", grams: 10 }] },
    });
    assert.equal(missing.isError, true);
    const invalid = await client.callTool({
      name: "search_foods",
      arguments: { ranges: { protein: { min: 30, max: 2 } } },
    });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("Netlify MCP supports independent, stateless HTTP clients", async () => {
  for (let i = 0; i < 2; i++) {
    const client = new Client({ name: "http-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://example.com/mcp"),
      {
        fetch: (url, options) => handler(new Request(url, options)),
      },
    );
    try {
      await client.connect(transport);
      assert.equal(transport.sessionId, undefined);
      const result = await client.callTool({
        name: "search_foods",
        arguments: { query: "lentils", limit: 2 },
      });
      assert.ok(!result.isError);
      const data = JSON.parse(result.content[0].text);
      assert.equal(data.foods.length, 2);
      assert.equal(data.basis, "per serving");
    } finally {
      await client.close();
    }
  }
});
