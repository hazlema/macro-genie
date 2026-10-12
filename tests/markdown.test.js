import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/lib/markdown.js";

test("bold, italic, line breaks, and emoji render", () => {
  assert.equal(
    renderMarkdown("**Loved it** 😋 try *smoked*  \npaprika"),
    "<p><strong>Loved it</strong> 😋 try <em>smoked</em><br>paprika</p>",
  );
});

test("lists render, keeping an ordered list's start number", () => {
  assert.equal(
    renderMarkdown("- one\n- two\n\n3. c\n4. d"),
    '<ul><li>one</li><li>two</li></ul><ol start="3"><li>c</li><li>d</li></ol>',
  );
  assert.equal(renderMarkdown("1. a\n2. b"), "<ol><li>a</li><li>b</li></ol>");
  assert.equal(
    renderMarkdown("- a\n  - nested"),
    "<ul><li>a<ul><li>nested</li></ul></li></ul>",
  );
});

test("http(s) links open in a new tab and are marked as user content", () => {
  assert.equal(
    renderMarkdown("[site](https://a.com/x?y=1&z=2)"),
    '<p><a href="https://a.com/x?y=1&amp;z=2" target="_blank" rel="nofollow noopener noreferrer ugc">site</a></p>',
  );
  assert.match(
    renderMarkdown("see https://bare.com now"),
    /<a href="https:\/\/bare\.com"/,
  );
});

test("other link schemes show only their text", () => {
  assert.equal(renderMarkdown("[x](javascript:alert(1))"), "<p>x</p>");
  assert.equal(renderMarkdown("[x](data:text/html,hi)"), "<p>x</p>");
  assert.equal(renderMarkdown("[x]( JAVASCRIPT:alert(1))"), "<p>x</p>");
  assert.doesNotMatch(renderMarkdown("mail a@b.com"), /<a /);
});

test("HTML and everything outside the subset show as text", () => {
  assert.equal(
    renderMarkdown("<script>alert(1)</script>"),
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
  );
  assert.equal(
    renderMarkdown('hi <img src=x onerror="alert(1)">'),
    "<p>hi &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>",
  );
  assert.equal(renderMarkdown("# Title"), "<p># Title</p>");
  assert.equal(renderMarkdown("`code`"), "<p>`code`</p>");
  assert.equal(
    renderMarkdown("![pic](https://x/y.png)"),
    "<p>![pic](https://x/y.png)</p>",
  );
  assert.equal(renderMarkdown("> quote"), "<p>&gt; quote</p>");
  assert.equal(renderMarkdown("~~gone~~"), "<p>~~gone~~</p>");
});

test("old plain-text posts stay readable", () => {
  assert.equal(
    renderMarkdown("Line one\nLine two\n\nNew para & more"),
    "<p>Line one<br>Line two</p><p>New para &amp; more</p>",
  );
  assert.equal(
    renderMarkdown("#hashtag and 50% off"),
    "<p>#hashtag and 50% off</p>",
  );
  assert.equal(renderMarkdown(""), "");
  assert.equal(renderMarkdown(null), "");
});

test("editor output with escapes round-trips", () => {
  // What the editor writes when someone types 2*3 [x] literally.
  assert.equal(renderMarkdown("2\\*3 \\[x\\]"), "<p>2*3 [x]</p>");
});

test("entities the editor writes aren't encoded twice, and stay inert", () => {
  assert.equal(renderMarkdown("Salt &amp; pepper"), "<p>Salt &amp; pepper</p>");
  assert.equal(renderMarkdown("&lt;script&gt;"), "<p>&lt;script&gt;</p>");
  assert.equal(renderMarkdown("Tom & Jerry"), "<p>Tom &amp; Jerry</p>");
  assert.equal(
    renderMarkdown('[x](https://a.com/?q="&amp;)'),
    '<p><a href="https://a.com/?q=&quot;&amp;" target="_blank" rel="nofollow noopener noreferrer ugc">x</a></p>',
  );
});
