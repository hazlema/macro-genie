import { test } from "node:test";
import assert from "node:assert/strict";
import { panelStartsOpen, rememberPanelUsed } from "../src/lib/panel.js";

const memory = () => {
  const data = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => (data[k] = v) };
};

test("the macro panel starts open only for someone who hasn't used it and has nothing set", () => {
  const store = memory();
  assert.equal(panelStartsOpen(0, store), true);
  assert.equal(
    panelStartsOpen(2, store),
    false,
    "ranges already set: show the summary",
  );
  rememberPanelUsed(store);
  assert.equal(panelStartsOpen(0, store), false);
  assert.equal(
    panelStartsOpen(0, {
      getItem: () => {
        throw new Error("blocked");
      },
    }),
    true,
  );
  assert.doesNotThrow(() => rememberPanelUsed(undefined));
});
