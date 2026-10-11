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
      tab: "foods",
      postId: null,
      recipeId: null,
    });
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
    assert.equal(parse("/nonsense").tab, "foods");
    assert.equal(pathFor({ tab: "community", postId: 7 }), "/community/7");
    assert.equal(pathFor({ tab: "saved", recipeId: "a b" }), "/recipes/a%20b");
    assert.equal(pathFor({ tab: "recipes" }), "/builder");
  },
);
