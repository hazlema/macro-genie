import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Tiptap needs a DOM; give Node one before loading it.
const dom = new JSDOM("<!doctype html><div id=e></div>");
for (const k of [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "getComputedStyle",
  "MutationObserver",
  "DOMParser",
  "Element",
  "Text",
])
  globalThis[k] ??= dom.window[k];
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);

const { Editor } = await import("@tiptap/core");
const { editorExtensions, normalizeUrl } = await import("../src/lib/editor.js");

const make = (opts = {}) =>
  new Editor({
    element: document.createElement("div"),
    extensions: editorExtensions(opts),
  });

// Types like a person: each character goes through the input rules.
function type(editor, text) {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (f) =>
      f(editor.view, from, to, ch),
    );
    if (!handled)
      editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
}

test("formatting and emoji come out as Markdown with the real emoji character", () => {
  const editor = make();
  editor.commands.setContent(
    '<p><strong>Loved it</strong> try <em>smoked</em> 2*3 <a href="https://a.com">site</a></p><ul><li>one</li><li>two</li></ul><p>a<br>b</p>',
  );
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.setEmoji("yum");
  assert.equal(
    editor.getMarkdown(),
    "**Loved it** try *smoked* 2\\*3 [site](https://a.com)\n\n- one\n- two\n\na  \nb😋",
  );
});

test("pasted headings, code, quotes, images, scripts and bad links lose their formatting", () => {
  const editor = make();
  editor.commands.setContent(
    '<h1>Title</h1><script>alert(1)</script><pre><code>c</code></pre><blockquote>q</blockquote><img src=x onerror=alert(1)><p>a <s>b</s> <u>u</u> <a href="javascript:alert(1)">js</a></p>',
  );
  assert.equal(editor.getMarkdown(), "Title\n\nc\n\nq\n\na b u js");
});

test("emoticons and :shortcodes: convert as you type; ordinary text doesn't", () => {
  const editor = make();
  type(editor, ":) hi :D step 8) Plan D: xo ok :fire: <3 x");
  assert.equal(editor.getMarkdown(), "🙂 hi 😄 step 8) Plan D: xo ok 🔥 ❤️ x");
});

test("Markdown loads back into the editor unchanged", () => {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: editorExtensions(),
    content: "**hi** 😋 there\n\n1. a\n2. b",
    contentType: "markdown",
  });
  assert.equal(editor.getMarkdown(), "**hi** 😋 there\n\n1. a\n2. b");
  editor.commands.setContent("", { contentType: "markdown" });
  assert.equal(editor.getMarkdown(), "");
});

test("the emoji suggestion keeps Tiptap's ':' trigger and uses our items", () => {
  const items = () => [];
  const editor = make({ suggestion: { items } });
  const emoji = editor.extensionManager.extensions.find(
    (e) => e.name === "emoji",
  );
  assert.equal(emoji.options.suggestion.char, ":");
  assert.equal(emoji.options.suggestion.items, items);
  assert.equal(typeof emoji.options.suggestion.command, "function");
});

test("Mod-Enter submits and Mod-k opens the link box", () => {
  let submitted = 0;
  let linked = 0;
  const editor = make({ onSubmit: () => submitted++, onLink: () => linked++ });
  const press = (key) =>
    editor.view.someProp("handleKeyDown", (f) =>
      f(
        editor.view,
        new dom.window.KeyboardEvent("keydown", { key, ctrlKey: true }),
      ),
    );
  press("Enter");
  press("k");
  assert.equal(submitted, 1);
  assert.equal(linked, 1);
});

test("link addresses are cleaned up or refused", () => {
  assert.equal(normalizeUrl("  https://a.com/x "), "https://a.com/x");
  assert.equal(normalizeUrl("HTTP://a.com"), "HTTP://a.com");
  assert.equal(
    normalizeUrl("example.com/recipe"),
    "https://example.com/recipe",
  );
  assert.equal(normalizeUrl("www.example.com"), "https://www.example.com");
  assert.equal(normalizeUrl(""), "");
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("mailto:a@b.com"), null);
  assert.equal(normalizeUrl("not a url"), null);
});
