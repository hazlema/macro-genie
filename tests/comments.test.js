import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeLoaded, settleSent } from "../src/lib/comments.js";

const sending = { id: "sending-1", body: "hi", status: "sending" };

test("loading comments keeps one still being posted", () => {
  assert.deepEqual(mergeLoaded([{ id: 1 }], [sending]), [{ id: 1 }, sending]);
  assert.deepEqual(mergeLoaded([{ id: 1 }], null), [{ id: 1 }]);
  assert.deepEqual(mergeLoaded([], [{ id: 9, status: "live" }]), []);
});

test("a posted comment replaces its placeholder, or is added if the list was reloaded meanwhile", () => {
  const real = { id: 3, body: "hi", status: "live" };
  assert.deepEqual(settleSent([{ id: 1 }, sending], "sending-1", real), [
    { id: 1 },
    { ...sending, ...real },
  ]);
  assert.deepEqual(settleSent([{ id: 1 }], "sending-1", real), [
    { id: 1 },
    real,
  ]);
  assert.deepEqual(
    settleSent([{ id: 1 }, real], "sending-1", real),
    [{ id: 1 }, real],
    "already loaded from the server",
  );
  assert.deepEqual(settleSent(null, "sending-1", real), [real]);
});
