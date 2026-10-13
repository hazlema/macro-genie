import { test } from "node:test";
import assert from "node:assert/strict";

// route.svelte.js needs a browser; parse and pathFor are checked through a
// copy-free import by stubbing the two globals it touches.
globalThis.location = { pathname: "/" };
globalThis.addEventListener = () => {};
globalThis.$state = (v) => v;
const { parse, pathFor } = await import("../src/lib/route.svelte.js").catch(
  () => ({}),
);

test(
  "addresses map to tabs and back",
  { skip: !parse && "needs the Svelte compiler" },
  () => {
    assert.deepEqual(parse("/"), {
      tab: "home",
      postId: null,
      recipeId: null,
    });
    assert.equal(parse("/foods").tab, "foods");
    assert.deepEqual(parse("/community/42"), {
      tab: "community",
      postId: 42,
      recipeId: null,
    });
    assert.deepEqual(parse("/recipes/abc-123"), {
      tab: "saved",
      postId: null,
      recipeId: "abc-123",
    });
    assert.deepEqual(parse("/builder"), {
      tab: "recipes",
      postId: null,
      recipeId: null,
    });
    assert.equal(parse("/community/not-a-number").postId, null);
    assert.equal(parse("/nonsense").tab, "community");
    assert.equal(pathFor({ tab: "community", postId: 7 }), "/community/7");
    assert.equal(pathFor({ tab: "home" }), "/");
    assert.equal(pathFor({ tab: "saved", recipeId: "a b" }), "/recipes/a%20b");
    assert.equal(pathFor({ tab: "recipes" }), "/builder");
    assert.deepEqual(parse("/admin"), {
      tab: "admin",
      postId: null,
      recipeId: null,
      adminTab: "reviews",
    });
    assert.equal(parse("/admin/users").adminTab, "users");
    assert.equal(parse("/admin/log").adminTab, "log");
    assert.equal(parse("/admin/whatever").adminTab, "reviews");
    assert.equal(pathFor({ tab: "admin" }), "/admin");
    assert.equal(pathFor({ tab: "admin", adminTab: "reviews" }), "/admin");
    assert.equal(pathFor({ tab: "admin", adminTab: "log" }), "/admin/log");
    assert.deepEqual(parse("/help"), {
      tab: "help",
      postId: null,
      recipeId: null,
      helpSlug: null,
    });
    assert.equal(parse("/help/mcp").helpSlug, "mcp");
    assert.equal(parse("/help/").helpSlug, null);
    assert.equal(parse("/help/Not-A-Guide!").helpSlug, null);
    assert.deepEqual(parse("/terms"), {
      tab: "page",
      postId: null,
      recipeId: null,
      page: "terms",
    });
    for (const p of ["refunds", "privacy", "contact"])
      assert.equal(parse(`/${p}`).page, p);
    assert.equal(pathFor({ tab: "help" }), "/help");
    assert.equal(
      pathFor({ tab: "help", helpSlug: "cronometer" }),
      "/help/cronometer",
    );
    assert.equal(pathFor({ tab: "page", page: "privacy" }), "/privacy");
  },
);
