import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { GUIDES, guideBySlug } from "../src/help/index.js";

const SLUGS = [
  "start",
  "basics",
  "macros",
  "builder",
  "credits",
  "book",
  "community",
  "mcp",
  "cronometer",
  "faq",
];

test("the hub lists the ten guides in order, each findable by slug", () => {
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
    for (const s of g.steps) {
      for (const m of s.markersPhone ?? [])
        assert.ok(
          m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 100,
          `${g.slug} phone marker ${m.n}`,
        );
      if (s.markersPhone)
        assert.ok(s.imagePhone, `${g.slug}: phone markers need a phone image`);
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

test("the policy pages say what the owner decided", async () => {
  const { POLICIES } = await import("../src/help/policies.js");
  assert.deepEqual(Object.keys(POLICIES).sort(), [
    "privacy",
    "refunds",
    "terms",
  ]);
  for (const p of Object.values(POLICIES))
    assert.equal(p.updated, "October 21, 2026");
  assert.match(POLICIES.refunds.body, /unused credits/i);
  assert.match(POLICIES.refunds.body, /30 days/);
  assert.match(POLICIES.refunds.body, /refunded automatically/i);
  for (const word of ["Netlify", "Neon", "Anthropic", "Google", "Stripe"])
    assert.match(POLICIES.privacy.body, new RegExp(word));
  assert.match(POLICIES.privacy.body, /no ads or trackers/i);
  assert.match(POLICIES.privacy.body, /account doesn't hold your email/i);
  assert.match(POLICIES.terms.body, /not medical advice/i);
  assert.match(POLICIES.terms.body, /no cash value/i);
  for (const p of Object.values(POLICIES))
    assert.doesNotMatch(
      p.body,
      /@[a-z0-9-]+\.[a-z]/i,
      "no email address on the site",
    );
});

test("steps with a phone screenshot and markers have phone markers too", () => {
  for (const g of GUIDES)
    for (const s of g.steps)
      if (s.imagePhone && s.markers)
        assert.ok(s.markersPhone, `${g.slug}: "${s.title}" needs markersPhone`);
});

test("the privacy page is honest about emails sent with the contact form", async () => {
  const { POLICIES } = await import("../src/help/policies.js");
  assert.doesNotMatch(POLICIES.privacy.body, /We don't store your email/);
  assert.match(POLICIES.privacy.body, /contact form/i);
  assert.match(POLICIES.privacy.body, /email you type/i);
});
