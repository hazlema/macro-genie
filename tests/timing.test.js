import { test } from "node:test";
import assert from "node:assert/strict";
import { timed, withTiming } from "../server/timing.js";

const handler = withTiming(async () => {
  timed("db", 4);
  timed("db", 6);
  await new Promise((r) => setTimeout(r, 5));
  timed("ai", 120);
  return Response.json({ ok: true }, { headers: { "X-Kept": "yes" } });
});

test("API responses say where the time went (Server-Timing), first call marked cold", async () => {
  const quiet = console.log;
  const lines = [];
  console.log = (l) => lines.push(l);
  try {
    const first = await handler(new Request("https://example.com/api/x"));
    const header = first.headers.get("Server-Timing");
    assert.match(header, /db;dur=10;desc="2 queries"/);
    assert.match(header, /ai;dur=120/);
    assert.match(header, /total;dur=\d+/);
    assert.match(header, /cold/);
    assert.equal(first.headers.get("X-Kept"), "yes");
    assert.deepEqual(await first.json(), { ok: true });
    const second = await handler(new Request("https://example.com/api/x"));
    assert.doesNotMatch(second.headers.get("Server-Timing"), /cold/);
    const log = JSON.parse(lines[0]);
    assert.equal(log.event, "timing");
    assert.equal(log.path, "/api/x");
    assert.equal(log.db, 10);
    assert.equal(log.queries, 2);
    assert.equal(log.cold, true);
  } finally {
    console.log = quiet;
  }
});

test("timing outside a request is ignored, and concurrent requests don't mix", async () => {
  assert.doesNotThrow(() => timed("db", 5));
  const slow = withTiming(async () => {
    timed("db", 1);
    await new Promise((r) => setTimeout(r, 20));
    timed("db", 1);
    return new Response("a");
  });
  const fast = withTiming(async () => {
    timed("db", 50);
    return new Response("b");
  });
  const quiet = console.log;
  console.log = () => {};
  try {
    const [a, b] = await Promise.all([
      slow(new Request("https://example.com/a")),
      fast(new Request("https://example.com/b")),
    ]);
    assert.match(a.headers.get("Server-Timing"), /db;dur=2;desc="2 queries"/);
    assert.match(b.headers.get("Server-Timing"), /db;dur=50;desc="1 query"/);
  } finally {
    console.log = quiet;
  }
});

test("AI calls (moderation) show up as ai time", async () => {
  const { moderate } = await import("../server/moderate.js");
  const slowHaiku = {
    messages: {
      create: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              name: "submit_review",
              input: { verdict: "fine", reason: "ok", meal_type: "dinner" },
            },
          ],
        };
      },
    },
  };
  const quiet = console.log;
  console.log = () => {};
  try {
    const handler = withTiming(async () => {
      await moderate("comment", "hello", slowHaiku);
      return new Response("ok");
    });
    const header = (
      await handler(new Request("https://example.com/c"))
    ).headers.get("Server-Timing");
    const ai = Number(header.match(/ai;dur=(\d+)/)?.[1] ?? 0);
    assert.ok(ai >= 25, header);
  } finally {
    console.log = quiet;
  }
});
