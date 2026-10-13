import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { GUIDES, guideBySlug } from "../src/help/index.js";

const SLUGS = [
  "start",
  "macros",
  "builder",
  "credits",
  "book",
  "community",
  "mcp",
  "cronometer",
  "faq",
];

test("the hub lists the nine guides in order, each findable by slug", () => {
  assert.deepEqual(
    GUIDES.map((g) => g.slug),
    SLUGS,
  );
  for (const slug of SLUGS) assert.equal(guideBySlug(slug).slug, slug);
  assert.equal(guideBySlug("nope"), undefined);
});

test("every guide has a title, summary, intro, and at least one step", () => {
  for (const g of GUIDES) {
    assert.ok(g.title && g.summary && g.intro, g.slug);
    assert.ok(g.steps.length >= 1, g.slug);
    for (const s of g.steps)
      assert.ok(s.title && s.text, `${g.slug}: ${s.title}`);
  }
});

test("every image a guide points to exists, and markers sit on the image", () => {
  for (const g of GUIDES) {
    for (const path of [
      g.thumb,
      ...g.steps.flatMap((s) => [s.image, s.imagePhone]),
    ].filter(Boolean)) {
      assert.ok(path.startsWith("/help/"), path);
      assert.ok(existsSync(`public${path}`), `missing public${path}`);
    }
    for (const s of g.steps)
      for (const m of s.markers ?? []) {
        assert.ok(
          m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 100,
          `${g.slug} marker ${m.n}`,
        );
        assert.ok(s.image, `${g.slug}: markers need an image`);
      }
  }
});

test("guide text has no code spans (the renderer shows backticks literally); commands use copy boxes", () => {
  for (const g of GUIDES)
    for (const text of [g.intro, g.outro, ...g.steps.map((s) => s.text)].filter(
      Boolean,
    ))
      assert.doesNotMatch(text, /`/, `${g.slug}: ${text.slice(0, 40)}`);
  const mcp = guideBySlug("mcp");
  assert.equal(mcp.steps[0].copy, "{{MCP_URL}}");
  assert.equal(
    mcp.steps[2].copy,
    "claude mcp add --transport http macro-genie {{MCP_URL}}",
  );
});
