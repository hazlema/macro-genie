# Community Rich Text + Emoji Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Community's plain textareas with a rich-text editor that saves Markdown and has full emoji support (picker, `:shortcode:` autocomplete, emoticons), and render posted Markdown safely.

**Architecture:** Tiptap v3 (headless, used from Svelte 5 without React) edits a restricted schema and serializes Markdown with Unicode emoji. Its configuration lives in plain JS modules (`src/lib/emoji.js`, `src/lib/editor.js`) so it is unit-testable in Node with jsdom; Svelte components only do UI. Viewing uses `marked`'s lexer plus our own allow-list renderer (`src/lib/markdown.js`). Server, database, and API are unchanged.

**Tech Stack:** Svelte 5.57 (runes), Vite 7, Tiptap 3.31 (`@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-emoji`, `@tiptap/markdown`, `@tiptap/extensions`, `@tiptap/suggestion`), `marked` 18, `node --test`, jsdom (dev only).

**Spec:** `docs/superpowers/specs/2026-10-12-rich-text-emoji-design.md`

## Global Constraints

- Plain JS + Svelte (no TypeScript in `src/`), 2-space indent, global styles in `src/style.css` (dark theme vars `--panel`, `--line`, `--muted`, `--lime`).
- Allowed formatting only: paragraph, hard break, bold, italic, bullet list, ordered list, link, emoji. No headings, code, blockquote, strike, underline, horizontal rule, images, HTML.
- Stored text is Markdown with Unicode emoji characters (😋), never `:yum:`.
- Links: only `http:`/`https:`; rendered with `target="_blank" rel="nofollow noopener noreferrer ugc"`.
- Limits unchanged and count the stored Markdown: thread message 5000, comment/reply 1000 (`server/community.js:335`, `:446`).
- Moderation flow unchanged; Haiku sees the raw Markdown (so link URLs are visible to it). Review queue keeps showing raw text on purpose.
- Tiptap is loaded only via dynamic import (separate chunk); browsing Community must not download it.
- No push to Netlify until the user OKs it (each deploy costs credits). Commit locally per task.
- Browser testing: short, time-limited Playwright steps, or hand the user a checklist; no long blind scripts.

## Review Focus

- Emoticon false positives: "step 8) ", "Plan D: ", "xo ", "http://x.com/ :/" must stay text; only the short `EMOTICONS` list converts. → test in Task 4.
- Typing a colon in prose ("Note: ", "ratio 2:1") must not pop up suggestions; suggestions need 2+ characters after `:`. → test in Task 3 (`suggestionItems`).
- Old plain-text posts (single newlines, blank-line paragraphs, "#hashtag", "&") stay readable and safe after switching to the renderer. → test in Task 1. (Accepted: an old post with paired `*` like "2*3 and 4*5" now shows italics.)
- Formatting can push Markdown past the limit; Ctrl/⌘+Enter calls `requestSubmit()`, which ignores the disabled button, so `send()`/`startThread()` must check length themselves. → Task 6.
- Text-style emoji (❤ U+2764, ☹ U+2639) must render in color, so they get U+FE0F appended. → test in Task 3.

---

## File Structure

- Create `src/lib/markdown.js` — `renderMarkdown(text) → string` (safe HTML). Pure.
- Create `src/components/Markdown.svelte` — renders `renderMarkdown` output in a `div`.
- Create `src/lib/emoji.js` — emoji list, groups, emoticon map, search, recent emoji. Pure (localStorage injected).
- Create `src/lib/editor.js` — `editorExtensions(options)`, `normalizeUrl(input)`. Tiptap config, no UI.
- Create `src/components/RichEditor.svelte` — the editor UI: toolbar, link box, suggestion popup, picker, counter.
- Create `src/components/EmojiPicker.svelte` — searchable, categorized grid with a recent row.
- Create `src/components/LazyEditor.svelte` — textarea now, RichEditor once loaded, textarea if loading fails.
- Modify `src/components/PostCard.svelte` — render thread body + comments with `Markdown`; comment form uses `LazyEditor`.
- Modify `src/components/Community.svelte` — thread form uses `LazyEditor`.
- Modify `server/moderate.js` — tell Haiku the text is Markdown.
- Modify `src/style.css` — markdown, editor, picker, suggestion styles.
- Tests: `tests/markdown.test.js`, `tests/emoji.test.js`, `tests/editor.test.js`; add one case to `tests/community.test.js`.

---

### Task 1: Safe Markdown renderer

**Files:**
- Create: `src/lib/markdown.js`
- Test: `tests/markdown.test.js`
- Modify: `package.json` (dependency `marked`)

**Interfaces:**
- Produces: `renderMarkdown(text: string) → string` (HTML using only `p, br, strong, em, ul, ol[start], li, a[href,target,rel]`).

- [ ] **Step 1: Install marked**

Run: `npm i marked@^18`
Expected: `marked` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing tests**

```js
// tests/markdown.test.js
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
  assert.match(renderMarkdown("see https://bare.com now"), /<a href="https:\/\/bare\.com"/);
});

test("other link schemes show only their text", () => {
  assert.equal(renderMarkdown("[x](javascript:alert(1))"), "<p>x</p>");
  assert.equal(renderMarkdown("[x](data:text/html,hi)"), "<p>x</p>");
  assert.equal(renderMarkdown("[x]( JAVASCRIPT:alert(1))"), "<p>x</p>");
  assert.doesNotMatch(renderMarkdown("mail a@b.com"), /<a /);
});

test("HTML and everything outside the subset show as text", () => {
  assert.equal(
    renderMarkdown('<script>alert(1)</script>'),
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
  );
  assert.equal(
    renderMarkdown('hi <img src=x onerror="alert(1)">'),
    "<p>hi &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>",
  );
  assert.equal(renderMarkdown("# Title"), "<p># Title</p>");
  assert.equal(renderMarkdown("`code`"), "<p>`code`</p>");
  assert.equal(renderMarkdown("![pic](https://x/y.png)"), "<p>![pic](https://x/y.png)</p>");
  assert.equal(renderMarkdown("> quote"), "<p>&gt; quote</p>");
  assert.equal(renderMarkdown("~~gone~~"), "<p>~~gone~~</p>");
});

test("old plain-text posts stay readable", () => {
  assert.equal(
    renderMarkdown("Line one\nLine two\n\nNew para & more"),
    "<p>Line one<br>Line two</p><p>New para &amp; more</p>",
  );
  assert.equal(renderMarkdown("#hashtag and 50% off"), "<p>#hashtag and 50% off</p>");
  assert.equal(renderMarkdown(""), "");
  assert.equal(renderMarkdown(null), "");
});

test("editor output with escapes round-trips", () => {
  // What the editor writes when someone types 2*3 [x] literally.
  assert.equal(renderMarkdown("2\\*3 \\[x\\]"), "<p>2*3 [x]</p>");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/markdown.test.js`
Expected: FAIL with `Cannot find module '.../src/lib/markdown.js'`.

- [ ] **Step 4: Write the renderer**

```js
// src/lib/markdown.js
import { Lexer } from "marked";

// Turns Community Markdown into HTML, allowing only what the editor can
// write: paragraphs, line breaks, bold, italic, lists, and http(s) links.
// Everything else (raw HTML, headings, code, images…) shows as plain text.
// Safe by construction: every piece of text is escaped, and only the tags
// below are ever produced.
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
const asText = (raw) => escape(String(raw ?? "").trim()).replace(/\n/g, "<br>");

const safeHref = (href) => {
  const url = String(href ?? "").trim();
  return /^https?:\/\//i.test(url) ? url : null;
};

function inline(tokens = []) {
  return tokens
    .map((t) => {
      switch (t.type) {
        case "text":
          return t.tokens ? inline(t.tokens) : escape(t.text);
        case "escape":
          return escape(t.text);
        case "strong":
          return `<strong>${inline(t.tokens)}</strong>`;
        case "em":
          return `<em>${inline(t.tokens)}</em>`;
        case "br":
          return "<br>";
        case "link": {
          const href = safeHref(t.href);
          return href
            ? `<a href="${escape(href)}" target="_blank" rel="nofollow noopener noreferrer ugc">${inline(t.tokens)}</a>`
            : inline(t.tokens);
        }
        default:
          return escape(t.raw ?? t.text);
      }
    })
    .join("");
}

function listItem(item) {
  const inner = item.tokens
    .map((t) => (t.type === "text" ? inline(t.tokens ?? [t]) : blocks([t])))
    .join("");
  return `<li>${inner}</li>`;
}

function blocks(tokens = []) {
  return tokens
    .map((t) => {
      switch (t.type) {
        case "paragraph":
          return `<p>${inline(t.tokens)}</p>`;
        case "list": {
          const tag = t.ordered ? "ol" : "ul";
          const start =
            t.ordered && Number.isInteger(t.start) && t.start !== 1
              ? ` start="${t.start}"`
              : "";
          return `<${tag}${start}>${t.items.map(listItem).join("")}</${tag}>`;
        }
        case "space":
          return "";
        default:
          return `<p>${asText(t.raw)}</p>`;
      }
    })
    .join("");
}

export function renderMarkdown(text) {
  if (!text) return "";
  return blocks(new Lexer({ gfm: true, breaks: true }).lex(String(text)));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/markdown.test.js`
Expected: PASS (7 tests). If a case fails because of marked's token shape (e.g. the `~~gone~~` `del` token or nested list `text`), adjust the renderer, never the expected HTML for the security cases (`<script>`, `onerror`, `javascript:`, `data:`).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/markdown.js tests/markdown.test.js
git commit -m "Safe Markdown renderer for Community text"
```

---

### Task 2: Show thread messages and comments as Markdown

**Files:**
- Create: `src/components/Markdown.svelte`
- Modify: `src/components/PostCard.svelte:141` (thread body), `:189` (comment body)
- Modify: `src/style.css` (`.thread-body` ~2735, `.comment-body` ~2411)

**Interfaces:**
- Consumes: `renderMarkdown(text)` from Task 1.
- Produces: `<Markdown text={string} class={string} />`.

- [ ] **Step 1: Create the component**

```svelte
<!-- src/components/Markdown.svelte -->
<script>
  import { renderMarkdown } from '../lib/markdown.js';

  // Community text (thread messages, comments). renderMarkdown escapes
  // everything and only emits a small allow-list of tags, so {@html} is safe.
  let { text = '', class: className = '' } = $props();
</script>

<div class="markdown {className}">{@html renderMarkdown(text)}</div>
```

- [ ] **Step 2: Use it in PostCard**

In `src/components/PostCard.svelte` add the import next to the others:

```js
  import Markdown from './Markdown.svelte';
```

Replace line 141:

```svelte
    <p class="thread-body" class:clamped={!startOpen}>{post.body}</p>
```

with:

```svelte
    <Markdown class="thread-body {startOpen ? '' : 'clamped'}" text={post.body} />
```

Replace line 189:

```svelte
            <p class="comment-body">{c.body}</p>
```

with:

```svelte
            <Markdown class="comment-body" text={c.body} />
```

Leave `post.recipe.description` (line 143) and `ReviewQueue.svelte` as plain text.

- [ ] **Step 3: Styles**

In `src/style.css`, remove `white-space: pre-wrap;` from both `.comment-body` and `.thread-body` (line breaks now come from `<br>`), and add after the `.thread-body.clamped` block:

```css
.markdown p {
  margin: 0;
}
.markdown p + p,
.markdown p + ul,
.markdown p + ol,
.markdown ul + p,
.markdown ol + p {
  margin-top: 0.6em;
}
.markdown ul,
.markdown ol {
  margin: 0;
  padding-left: 1.4em;
}
.markdown li + li {
  margin-top: 0.15em;
}
.markdown a {
  color: var(--lime);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.markdown strong {
  font-weight: 650;
}
```

- [ ] **Step 4: Verify**

Run: `npm run check && npm test`
Expected: svelte-check 0 errors; all tests pass.

Run `npm run dev`, open a thread and a recipe's comments: an existing multi-line post shows its line breaks; the clamped thread preview still cuts to 3 lines (if `-webkit-line-clamp` doesn't clamp across the `<p>` children, change `.thread-body.clamped` to `max-height: calc(1.6em * 3); overflow: hidden;` and keep the rest).

- [ ] **Step 5: Commit**

```bash
git add src/components/Markdown.svelte src/components/PostCard.svelte src/style.css
git commit -m "Render Community threads and comments as Markdown"
```

---

### Task 3: Emoji data, search, and recent emoji

**Files:**
- Create: `src/lib/emoji.js`
- Test: `tests/emoji.test.js`
- Modify: `package.json` (Tiptap dependencies)

**Interfaces:**
- Produces:
  - `EMOJI: Array<{ name, emoji, shortcodes: string[], tags: string[], group }>` (no regional indicators, no skin-tone components, text-style symbols get U+FE0F, `emoticons: []`).
  - `glyphFor(name: string) → string` (`''` if unknown).
  - `EMOTICONS: Record<string, string>` emoticon → emoji name.
  - `EMOJI_GROUPS: Array<{ id, label, icon, items: EMOJI[] }>`.
  - `searchEmoji(query: string, limit = 8) → EMOJI[]`.
  - `suggestionItems(query: string) → EMOJI[]` (`[]` under 2 chars, else top 8).
  - `recentEmoji(storage?) → EMOJI[]`, `rememberEmoji(name, storage?)`.

- [ ] **Step 1: Install Tiptap**

Run: `npm i @tiptap/core@^3.31 @tiptap/pm@^3.31 @tiptap/starter-kit@^3.31 @tiptap/extension-emoji@^3.31 @tiptap/markdown@^3.31 @tiptap/extensions@^3.31 @tiptap/suggestion@^3.31`
Expected: all seven under `dependencies`.

- [ ] **Step 2: Write the failing tests**

```js
// tests/emoji.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMOJI,
  EMOJI_GROUPS,
  EMOTICONS,
  glyphFor,
  recentEmoji,
  rememberEmoji,
  searchEmoji,
  suggestionItems,
} from "../src/lib/emoji.js";

const memory = () => {
  const data = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => (data[k] = v) };
};

test("the list drops letters and skin-tone swatches, and every emoji has a character", () => {
  assert.ok(EMOJI.length > 1500);
  assert.ok(EMOJI.every((e) => e.emoji));
  assert.ok(!EMOJI.some((e) => e.name.startsWith("regional_indicator_")));
  assert.ok(!EMOJI.some((e) => e.group === "components"));
});

test("text-style symbols are forced to show as color emoji", () => {
  assert.equal(glyphFor("heart"), "❤️");
  assert.equal(glyphFor("yum"), "😋");
  assert.equal(glyphFor("nope-not-real"), "");
});

test("every emoticon points at a real emoji", () => {
  for (const [face, name] of Object.entries(EMOTICONS))
    assert.ok(glyphFor(name), `${face} → ${name}`);
  for (const risky of ["8)", "D:", "xo", ":/", ":c", ":s"])
    assert.equal(EMOTICONS[risky], undefined, risky);
});

test("groups start with smileys and cover food", () => {
  assert.equal(EMOJI_GROUPS[0].label, "Smileys");
  assert.ok(EMOJI_GROUPS[0].items.some((e) => e.name === "yum"));
  assert.ok(EMOJI_GROUPS.find((g) => g.label === "Food & drink").items.some((e) => e.name === "avocado"));
  assert.ok(EMOJI_GROUPS.every((g) => g.items.length > 0));
});

test("search ranks exact and prefix shortcode matches before tag matches", () => {
  assert.equal(searchEmoji("fire")[0].name, "fire");
  assert.equal(searchEmoji(":yum:")[0].name, "yum");
  const thumbs = searchEmoji("thumbs");
  assert.equal(thumbs[0].name, "+1");
  assert.ok(searchEmoji("tasty").some((e) => e.name === "yum"), "tags match");
  assert.equal(searchEmoji("fi", 5).length, 5);
  assert.deepEqual(searchEmoji("   "), []);
});

test("a colon in ordinary writing doesn't open suggestions", () => {
  assert.deepEqual(suggestionItems(""), []);
  assert.deepEqual(suggestionItems("1"), []);
  assert.deepEqual(suggestionItems(")"), []);
  assert.ok(suggestionItems("fi").length > 0);
  assert.ok(suggestionItems("fi").length <= 8);
});

test("recent emoji are remembered newest first, without repeats, up to 24", () => {
  const store = memory();
  assert.deepEqual(recentEmoji(store), []);
  rememberEmoji("fire", store);
  rememberEmoji("yum", store);
  rememberEmoji("fire", store);
  assert.deepEqual(recentEmoji(store).map((e) => e.name), ["fire", "yum"]);
  for (const e of EMOJI.slice(0, 30)) rememberEmoji(e.name, store);
  assert.equal(recentEmoji(store).length, 24);
  assert.deepEqual(recentEmoji({ getItem: () => "not json" }), []);
  assert.doesNotThrow(() => rememberEmoji("fire", undefined));
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/emoji.test.js`
Expected: FAIL with `Cannot find module '.../src/lib/emoji.js'`.

- [ ] **Step 4: Write the module**

```js
// src/lib/emoji.js
import { emojis } from "@tiptap/extension-emoji";

// The emoji the Community editor offers, from the list that ships with
// Tiptap's emoji extension, so the picker, :shortcodes:, and emoticons agree.

// Symbols like ❤ (U+2764) show as black text unless followed by U+FE0F.
const colorGlyph = (s) =>
  [...s].length === 1 && s.codePointAt(0) < 0x1f000 ? s + "️" : s;

export const EMOJI = emojis
  .filter(
    (e) =>
      e.emoji &&
      e.group !== "components" &&
      !e.name.startsWith("regional_indicator_"),
  )
  .map((e) => ({ ...e, emoji: colorGlyph(e.emoji), emoticons: [] }));

const byName = new Map(EMOJI.map((e) => [e.name, e]));
export const glyphFor = (name) => byName.get(name)?.emoji ?? "";

// Typed and followed by a space, these become emoji. Deliberately short:
// "8)", "D:", "xo", ":/" and friends turn up in ordinary writing.
export const EMOTICONS = {
  ":)": "slightly_smiling_face",
  ":(": "frowning_face",
  ";)": "wink",
  ":D": "smile",
  ":P": "stuck_out_tongue",
  ":p": "stuck_out_tongue",
  "<3": "heart",
  "</3": "broken_heart",
  ":'(": "cry",
  XD: "laughing",
  ":O": "astonished",
  ":o": "astonished",
  ":|": "neutral_face",
};

// Tiptap's list leaves the smileys' group name empty.
const GROUPS = [
  ["", "smileys", "Smileys", "😀"],
  ["people & body", "people", "People", "👋"],
  ["animals & nature", "nature", "Animals & nature", "🐻"],
  ["food & drink", "food", "Food & drink", "🍔"],
  ["activities", "activities", "Activities", "⚽"],
  ["travel & places", "travel", "Travel & places", "🚗"],
  ["objects", "objects", "Objects", "💡"],
  ["symbols", "symbols", "Symbols", "❤️"],
  ["flags", "flags", "Flags", "🏁"],
];
export const EMOJI_GROUPS = GROUPS.map(([group, id, label, icon]) => ({
  id,
  label,
  icon,
  items: EMOJI.filter((e) => e.group === group),
}));

// Best first: exact shortcode, shortcode prefix, a word inside a shortcode,
// then a tag. Ties keep the list's order.
export function searchEmoji(query, limit = 8) {
  const q = String(query ?? "").trim().toLowerCase().replace(/^:|:$/g, "");
  if (!q) return [];
  const rank = (e) => {
    if (e.shortcodes.includes(q)) return 0;
    if (e.shortcodes.some((s) => s.startsWith(q))) return 1;
    if (e.shortcodes.some((s) => s.split("_").some((w) => w.startsWith(q))))
      return 2;
    if (e.tags.some((t) => t.startsWith(q))) return 3;
    return -1;
  };
  return EMOJI.map((e) => [rank(e), e])
    .filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0])
    .slice(0, limit)
    .map(([, e]) => e);
}

// What the ":" popup shows. Needs two characters so "Note:" or "2:1" stay quiet.
export const suggestionItems = (query) =>
  String(query ?? "").length < 2 ? [] : searchEmoji(query, 8);

const RECENT_KEY = "macro-genie:recent-emoji:v1";

export function recentEmoji(storage = globalThis.localStorage) {
  try {
    const names = JSON.parse(storage?.getItem(RECENT_KEY) ?? "[]");
    return names.map((n) => byName.get(n)).filter(Boolean);
  } catch {
    return [];
  }
}

export function rememberEmoji(name, storage = globalThis.localStorage) {
  try {
    const names = JSON.parse(storage.getItem(RECENT_KEY) ?? "[]");
    const next = [name, ...names.filter((n) => n !== name)].slice(0, 24);
    storage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // No storage (private mode, tests): recent emoji just aren't kept.
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/emoji.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/emoji.js tests/emoji.test.js
git commit -m "Emoji list, search, emoticons, and recent emoji for the editor"
```

---

### Task 4: Editor configuration (Tiptap, headless-tested)

**Files:**
- Create: `src/lib/editor.js`
- Test: `tests/editor.test.js`
- Modify: `package.json` (dev dependency `jsdom`)

**Interfaces:**
- Consumes: `EMOJI`, `EMOTICONS`, `glyphFor` (Task 3).
- Produces:
  - `editorExtensions({ placeholder?: string, suggestion?: { items, render }, onSubmit?: () => void, onLink?: () => void }) → Extension[]`
  - `normalizeUrl(input: string) → string | null` (`''` for empty, `null` for not a web address).
  - Editor built with these has `editor.getMarkdown()` and `editor.commands.setEmoji(name)`; accepts `content` + `contentType: 'markdown'`.

- [ ] **Step 1: Install jsdom**

Run: `npm i -D jsdom@^29`

- [ ] **Step 2: Write the failing tests**

```js
// tests/editor.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Tiptap needs a DOM; give Node one before loading it.
const dom = new JSDOM("<!doctype html><div id=e></div>");
for (const k of ["window", "document", "navigator", "Node", "HTMLElement", "getComputedStyle", "MutationObserver", "DOMParser", "Element", "Text"])
  globalThis[k] ??= dom.window[k];
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);

const { Editor } = await import("@tiptap/core");
const { editorExtensions, normalizeUrl } = await import("../src/lib/editor.js");

const make = (opts = {}) =>
  new Editor({ element: document.createElement("div"), extensions: editorExtensions(opts) });

// Types like a person: each character goes through the input rules.
function type(editor, text) {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, from, to, ch));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
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
  const emoji = editor.extensionManager.extensions.find((e) => e.name === "emoji");
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
      f(editor.view, new dom.window.KeyboardEvent("keydown", { key, ctrlKey: true })),
    );
  press("Enter");
  press("k");
  assert.equal(submitted, 1);
  assert.equal(linked, 1);
});

test("link addresses are cleaned up or refused", () => {
  assert.equal(normalizeUrl("  https://a.com/x "), "https://a.com/x");
  assert.equal(normalizeUrl("HTTP://a.com"), "HTTP://a.com");
  assert.equal(normalizeUrl("example.com/recipe"), "https://example.com/recipe");
  assert.equal(normalizeUrl("www.example.com"), "https://www.example.com");
  assert.equal(normalizeUrl(""), "");
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("mailto:a@b.com"), null);
  assert.equal(normalizeUrl("not a url"), null);
});
```

Note on the Mod-Enter test: ProseMirror's keymap maps `Mod` to Ctrl unless `navigator.platform` is a Mac; jsdom's platform is empty, so the test sends Ctrl. Modifiers must match exactly (Ctrl+Meta together does not fire).

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/editor.test.js`
Expected: FAIL with `Cannot find module '.../src/lib/editor.js'`.

- [ ] **Step 4: Write the module**

```js
// src/lib/editor.js
import { Extension, InputRule } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Emoji } from "@tiptap/extension-emoji";
import { Markdown } from "@tiptap/markdown";
import { Placeholder } from "@tiptap/extensions";
import { EMOJI, EMOTICONS, glyphFor } from "./emoji.js";

// Tiptap setup for the Community editor: the formatting people can use,
// emoji, and Markdown in and out. The Svelte component (RichEditor) only
// adds the toolbar and popups, so this part can be tested in Node.

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EMOTICON_RULE = new RegExp(
  `(?:^|\\s)(${Object.keys(EMOTICONS).map(escapeRegex).join("|")}) $`,
);

// ":)" then a space becomes 🙂 plus the space. Tiptap's own emoticon option
// knows "8)", "xo", "D:"… which turn up in ordinary writing, and it leaves a
// double space, so we use our short list instead.
const Emoticons = Extension.create({
  name: "emoticons",
  addInputRules() {
    return [
      new InputRule({
        find: EMOTICON_RULE,
        handler: ({ state, range, match }) => {
          const start = range.to - match[1].length - 1;
          state.tr.replaceWith(start, range.to, [
            state.schema.nodes.emoji.create({ name: EMOTICONS[match[1]] }),
            state.schema.text(" "),
          ]);
        },
      }),
    ];
  },
});

// Stored as the character people see (😋), not Tiptap's default ":yum:".
const EmojiNode = Emoji.extend({
  renderMarkdown: (node) => glyphFor(node.attrs?.name),
});

const shortcuts = (onSubmit, onLink) =>
  Extension.create({
    name: "communityShortcuts",
    addKeyboardShortcuts() {
      return {
        "Mod-Enter": () => {
          onSubmit();
          return true;
        },
        "Mod-k": () => {
          onLink();
          return true;
        },
      };
    },
  });

export function editorExtensions({
  placeholder = "",
  suggestion = {},
  onSubmit = () => {},
  onLink = () => {},
} = {}) {
  return [
    StarterKit.configure({
      heading: false,
      code: false,
      codeBlock: false,
      blockquote: false,
      strike: false,
      underline: false,
      horizontalRule: false,
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        isAllowedUri: (url, ctx) =>
          ctx.defaultValidate(url) && !/^(?!https?:)[a-z][a-z\d+.-]*:/i.test(url),
      },
    }),
    EmojiNode.configure({ emojis: EMOJI, enableEmoticons: false, suggestion }),
    Emoticons,
    Markdown,
    Placeholder.configure({ placeholder }),
    shortcuts(onSubmit, onLink),
  ];
}

// What someone typed into the link box → an address we'll link to.
// '' means "remove the link"; null means it isn't a web address.
export function normalizeUrl(input) {
  const url = String(input ?? "").trim();
  if (!url) return "";
  if (/^https?:\/\/\S+$/i.test(url)) return url;
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return null;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(url)) return `https://${url}`;
  return null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/editor.test.js`
Expected: PASS (7 tests). jsdom prints "Not implemented: HTMLCanvasElement's getContext()" from the emoji support check; that's harmless. If the emoticon test shows a missing or doubled space, fix `start` in the `Emoticons` handler (the expected string is the requirement). (These tests were run against Tiptap 3.31.4 and marked 18.1.1 while writing this plan and passed.)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/editor.js tests/editor.test.js
git commit -m "Tiptap editor setup: allowed formatting, emoji, emoticons, Markdown"
```

---

### Task 5: Editor UI — RichEditor, EmojiPicker, LazyEditor

**Files:**
- Create: `src/components/RichEditor.svelte`, `src/components/EmojiPicker.svelte`, `src/components/LazyEditor.svelte`
- Modify: `src/style.css` (append editor styles)

**Interfaces:**
- Consumes: `editorExtensions`, `normalizeUrl` (Task 4); `EMOJI_GROUPS`, `searchEmoji`, `suggestionItems`, `recentEmoji`, `rememberEmoji` (Task 3).
- Produces: `<LazyEditor bind:markdown maxlength={number} label={string} placeholder={string} rows={number} onsubmit={() => void} />` (Task 6 uses only this). `RichEditor` takes the same props minus `rows`.

There are no Svelte component tests in this repo; verification is `npm run check`, `npm run build`, and the browser check in Task 8.

- [ ] **Step 1: EmojiPicker**

```svelte
<!-- src/components/EmojiPicker.svelte -->
<script>
  import { EMOJI_GROUPS, recentEmoji, searchEmoji } from '../lib/emoji.js';

  // The 😊 button's popover: search, categories, and recently used.
  let { onpick, onclose } = $props();
  const recent = recentEmoji();
  let query = $state('');
  let group = $state(recent.length ? 'recent' : EMOJI_GROUPS[0].id);
  const shown = $derived(
    query.trim() ? searchEmoji(query, 160)
    : group === 'recent' ? recent
    : EMOJI_GROUPS.find((g) => g.id === group).items,
  );
  // Type-to-search on desktop; on phones, don't pop the keyboard over the grid.
  const focusOnDesktop = (el) => { if (matchMedia('(pointer: fine)').matches) el.focus(); };
  const pickGroup = (id) => { group = id; query = ''; };
</script>

<div class="emoji-picker" role="dialog" aria-label="Emoji" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onclose(); } }}>
  <input type="search" placeholder="Search emoji" aria-label="Search emoji" bind:value={query} {@attach focusOnDesktop} />
  <div class="emoji-tabs" role="tablist" aria-label="Emoji categories">
    {#if recent.length}
      <button type="button" role="tab" aria-selected={!query && group === 'recent'} title="Recently used" onclick={() => pickGroup('recent')}>🕘</button>
    {/if}
    {#each EMOJI_GROUPS as g (g.id)}
      <button type="button" role="tab" aria-selected={!query && group === g.id} title={g.label} onclick={() => pickGroup(g.id)}>{g.icon}</button>
    {/each}
  </div>
  <div class="emoji-grid">
    {#each shown as e (e.name)}
      <button type="button" title={`:${e.shortcodes[0]}:`} aria-label={e.name.replaceAll('_', ' ')} onclick={() => onpick(e)}>{e.emoji}</button>
    {:else}
      <p class="emoji-empty">No emoji found</p>
    {/each}
  </div>
</div>
```

- [ ] **Step 2: RichEditor**

```svelte
<!-- src/components/RichEditor.svelte -->
<script>
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { editorExtensions, normalizeUrl } from '../lib/editor.js';
  import { rememberEmoji, suggestionItems } from '../lib/emoji.js';
  import EmojiPicker from './EmojiPicker.svelte';

  // A rich-text box that reads and writes Markdown. The parent binds
  // markdown and clears it after posting; onsubmit runs on Ctrl/⌘+Enter.
  let { markdown = $bindable(''), maxlength = 1000, placeholder = '', label = '', onsubmit = () => {} } = $props();

  let root;
  let element;
  let editor = $state.raw(null);
  let tick = $state(0); // bumps on every change so the toolbar re-reads isActive
  let emitted = '';
  let suggest = $state(null); // { items, index, rect, command } while ":fi" is open
  let pickerOpen = $state(false);
  let linkOpen = $state(false);
  let linkUrl = $state('');
  let linkError = $state('');

  const length = $derived(markdown.length);
  const is = (name) => (tick, editor?.isActive(name) ?? false);
  const keep = (e) => e.preventDefault(); // toolbar clicks keep the text selected
  const run = (fn) => fn(editor.chain().focus()).run();

  const show = (p) => {
    suggest = p.items.length ? { items: p.items, index: 0, rect: p.clientRect?.(), command: p.command } : null;
  };
  function choose(item) {
    suggest.command({ name: item.name });
    rememberEmoji(item.name);
    suggest = null;
  }
  function suggestKey(event) {
    if (!suggest) return false;
    const n = suggest.items.length;
    if (event.key === 'ArrowDown') suggest.index = (suggest.index + 1) % n;
    else if (event.key === 'ArrowUp') suggest.index = (suggest.index + n - 1) % n;
    else if (event.key === 'Enter' || event.key === 'Tab') choose(suggest.items[suggest.index]);
    else if (event.key === 'Escape') suggest = null;
    else return false;
    return true;
  }

  function openLink() {
    linkUrl = editor.getAttributes('link').href ?? '';
    linkError = '';
    linkOpen = true;
  }
  function applyLink(event) {
    event?.preventDefault();
    const href = normalizeUrl(linkUrl);
    if (href === null) { linkError = 'Use a web address, like https://example.com'; return; }
    if (!href) run((c) => c.extendMarkRange('link').unsetLink());
    else if (editor.state.selection.empty && !editor.isActive('link'))
      run((c) => c.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }));
    else run((c) => c.extendMarkRange('link').setLink({ href }));
    linkOpen = false;
  }
  function removeLink() {
    run((c) => c.extendMarkRange('link').unsetLink());
    linkOpen = false;
  }
  function pick(item) {
    run((c) => c.setEmoji(item.name));
    rememberEmoji(item.name);
    pickerOpen = false;
  }
  const focusNow = (el) => { el.focus(); };

  onMount(() => {
    editor = new Editor({
      element,
      extensions: editorExtensions({
        placeholder,
        onSubmit: () => onsubmit(),
        onLink: () => openLink(),
        suggestion: {
          items: ({ query }) => suggestionItems(query),
          render: () => ({ onStart: show, onUpdate: show, onKeyDown: ({ event }) => suggestKey(event), onExit: () => { suggest = null; } }),
        },
      }),
      content: markdown,
      contentType: 'markdown',
      editorProps: { attributes: { class: 'rich-input', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label } },
      onTransaction: () => { tick++; },
      onUpdate: ({ editor }) => { emitted = editor.getMarkdown(); markdown = emitted; },
    });
    emitted = markdown;
    return () => editor.destroy();
  });

  // The parent changed the text (cleared it after posting).
  $effect(() => {
    if (editor && markdown !== emitted) {
      emitted = markdown;
      editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
    }
  });
</script>

<svelte:window onpointerdown={(e) => { if (pickerOpen && !root.contains(e.target)) pickerOpen = false; }} />

<div class="rich-editor" class:over={length > maxlength} bind:this={root}>
  <div class="rich-toolbar" role="toolbar" aria-label="Formatting">
    <button type="button" title="Bold (Ctrl+B)" aria-label="Bold" aria-pressed={is('bold')} onmousedown={keep} onclick={() => run((c) => c.toggleBold())}><strong>B</strong></button>
    <button type="button" title="Italic (Ctrl+I)" aria-label="Italic" aria-pressed={is('italic')} onmousedown={keep} onclick={() => run((c) => c.toggleItalic())}><em>I</em></button>
    <button type="button" title="Bulleted list" aria-label="Bulleted list" aria-pressed={is('bulletList')} onmousedown={keep} onclick={() => run((c) => c.toggleBulletList())}>•≡</button>
    <button type="button" title="Numbered list" aria-label="Numbered list" aria-pressed={is('orderedList')} onmousedown={keep} onclick={() => run((c) => c.toggleOrderedList())}>1≡</button>
    <button type="button" title="Link (Ctrl+K)" aria-label="Link" aria-pressed={is('link')} onmousedown={keep} onclick={openLink}>🔗</button>
    <button type="button" title="Emoji" aria-label="Emoji" aria-expanded={pickerOpen} onmousedown={keep} onclick={() => (pickerOpen = !pickerOpen)}>😊</button>
  </div>
  {#if linkOpen}
    <div class="rich-link">
      <input type="url" bind:value={linkUrl} placeholder="https://…" aria-label="Link address" {@attach focusNow}
        onkeydown={(e) => { if (e.key === 'Enter') applyLink(e); if (e.key === 'Escape') { e.preventDefault(); linkOpen = false; editor.commands.focus(); } }} />
      <button type="button" class="text-button" onclick={applyLink}>Apply</button>
      {#if is('link')}<button type="button" class="text-button" onclick={removeLink}>Remove link</button>{/if}
      <button type="button" class="text-button" onclick={() => { linkOpen = false; editor.commands.focus(); }}>Cancel</button>
      {#if linkError}<small role="alert">{linkError}</small>{/if}
    </div>
  {/if}
  {#if pickerOpen}
    <EmojiPicker onpick={pick} onclose={() => { pickerOpen = false; editor.commands.focus(); }} />
  {/if}
  <div bind:this={element}></div>
  {#if length > maxlength * 0.8}
    <p class="rich-count" aria-live="polite">{length.toLocaleString()} / {maxlength.toLocaleString()}</p>
  {/if}
  {#if suggest}
    <ul class="emoji-suggest" role="listbox" aria-label="Emoji suggestions" style:left="{suggest.rect?.left ?? 0}px" style:top="{(suggest.rect?.bottom ?? 0) + 4}px">
      {#each suggest.items as item, i (item.name)}
        <li role="option" aria-selected={i === suggest.index}>
          <button type="button" onmousedown={keep} onclick={() => choose(item)}>{item.emoji} <span>:{item.shortcodes[0]}:</span></button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
```

- [ ] **Step 3: LazyEditor**

```svelte
<!-- src/components/LazyEditor.svelte -->
<script>
  import { onMount } from 'svelte';

  // Shows a plain textarea straight away and swaps in the rich editor once
  // its code (Tiptap, emoji list) has loaded. If loading fails, the textarea
  // stays, so people can still post.
  let { markdown = $bindable(''), maxlength = 1000, placeholder = '', label = '', rows = 2, onsubmit = () => {} } = $props();
  let RichEditor = $state(null);

  onMount(() => {
    import('./RichEditor.svelte').then((m) => (RichEditor = m.default)).catch(() => {});
  });

  const keydown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onsubmit(); }
  };
</script>

{#if RichEditor}
  <RichEditor bind:markdown {maxlength} {placeholder} {label} {onsubmit} />
{:else}
  <textarea class="rich-fallback" bind:value={markdown} {maxlength} {rows} {placeholder} aria-label={label} onkeydown={keydown}></textarea>
{/if}
```

- [ ] **Step 4: Styles** — append to `src/style.css`:

```css
/* Community rich-text editor */
.rich-editor {
  position: relative;
  flex: 1;
  min-width: 0;
  background: #111415;
  border: 1px solid var(--line);
  border-radius: 10px;
}
.rich-editor:focus-within {
  border-color: var(--lime);
}
.rich-editor.over {
  border-color: var(--coral);
}
.rich-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--line);
}
.rich-toolbar button {
  min-width: 32px;
  height: 30px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.rich-toolbar button:hover,
.rich-toolbar button[aria-pressed="true"],
.rich-toolbar button[aria-expanded="true"] {
  background: var(--panel);
  color: #e6e8e4;
}
.rich-input {
  min-height: 3.2em;
  max-height: 40vh;
  overflow-y: auto;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.55;
  outline: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.rich-input p {
  margin: 0;
}
.rich-input ul,
.rich-input ol {
  margin: 0.3em 0;
  padding-left: 1.4em;
}
.rich-input a {
  color: var(--lime);
  text-decoration: underline;
}
.rich-input p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: var(--muted);
  pointer-events: none;
}
.rich-count {
  margin: 0;
  padding: 0 12px 6px;
  font-size: 11px;
  text-align: right;
  color: var(--muted);
}
.rich-editor.over .rich-count {
  color: var(--coral);
}
.rich-link {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
}
.rich-link input {
  flex: 1;
  min-width: 160px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--panel);
  color: inherit;
  font: inherit;
  font-size: 13px;
}
.rich-link small {
  width: 100%;
  color: var(--coral);
  font-size: 12px;
}
.rich-fallback {
  flex: 1;
  min-width: 0;
  resize: vertical;
  background: #111415;
  border-radius: 10px;
  padding: 10px 12px;
  font: inherit;
  font-size: 14px;
  color: inherit;
}
.emoji-picker {
  position: absolute;
  z-index: 20;
  top: 40px;
  left: 0;
  width: 336px;
  padding: 8px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 12px 32px #0008;
}
.emoji-picker input {
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  background: #111415;
  color: inherit;
  font: inherit;
  font-size: 13px;
}
.emoji-tabs {
  display: flex;
  justify-content: space-between;
  margin: 6px 0;
}
.emoji-tabs button,
.emoji-grid button {
  border: 0;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  padding: 5px;
}
.emoji-tabs button[aria-selected="true"],
.emoji-tabs button:hover,
.emoji-grid button:hover,
.emoji-grid button:focus-visible {
  background: #111415;
}
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  max-height: 232px;
  overflow-y: auto;
}
.emoji-empty {
  grid-column: 1 / -1;
  color: var(--muted);
  font-size: 13px;
}
.emoji-suggest {
  position: fixed;
  z-index: 30;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 12px 32px #0008;
}
.emoji-suggest button {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 5px 10px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.emoji-suggest li[aria-selected="true"] button {
  background: #111415;
}
.emoji-suggest span {
  color: var(--muted);
}
@media (max-width: 560px) {
  .emoji-picker {
    width: 100%;
  }
  .emoji-grid {
    grid-template-columns: repeat(7, 1fr);
  }
}
```

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: 0 errors. (Warnings about `role="dialog"` with `tabindex` / keydown are fine if svelte-check only warns; fix any errors.)

Run: `npm run build`
Expected: build succeeds. Nothing imports `LazyEditor` yet, so the Tiptap chunk isn't in the build output until Task 6.

- [ ] **Step 6: Commit**

```bash
git add src/components/RichEditor.svelte src/components/EmojiPicker.svelte src/components/LazyEditor.svelte src/style.css
git commit -m "Rich editor UI: toolbar, link box, emoji picker and suggestions"
```

---

### Task 6: Use the editor for threads and comments

**Files:**
- Modify: `src/components/Community.svelte` (thread form ~line 177, `startThread` ~line 91)
- Modify: `src/components/PostCard.svelte` (comment form ~line 197, `send` ~line 54)
- Modify: `src/style.css` (`.comment-form`, `.thread-form` label)

**Interfaces:**
- Consumes: `LazyEditor` (Task 5).

- [ ] **Step 1: Thread form**

In `Community.svelte` import:

```js
  import LazyEditor from './LazyEditor.svelte';
```

Add `let threadForm;` next to the other `let` declarations. In `startThread`, change the guard:

```js
    if (posting || message.length > 5000) return;
```

Replace the form opening tag and the message label:

```svelte
            <form class="thread-form" onsubmit={startThread} bind:this={threadForm}>
```

```svelte
              <div class="note-field"><span>Message</span><LazyEditor bind:markdown={message} maxlength={5000} rows={5} label="Message" placeholder="Write your message" onsubmit={() => threadForm.requestSubmit()} /></div>
```

And the submit button's `disabled` gains the length check:

```svelte
                <button class="primary-button" disabled={posting || title.trim().length < 3 || !message.trim() || message.length > 5000}>{posting ? 'Posting…' : 'Post thread'}</button>
```

- [ ] **Step 2: Comment form**

In `PostCard.svelte` import `LazyEditor` and add `let commentForm;`. In `send`:

```js
    if (!draft.trim() || sending || draft.length > 1000) return;
```

Replace the comment form's opening tag, textarea, and button:

```svelte
        <form class="comment-form" onsubmit={send} bind:this={commentForm}>
          <LazyEditor bind:markdown={draft} maxlength={1000} label={thread ? 'Write a reply' : 'Write a comment'} placeholder={thread ? 'Write a reply' : 'Made it? Tweaked it? Say how it went.'} onsubmit={() => commentForm.requestSubmit()} />
          <button class="primary-button" disabled={sending || !draft.trim() || draft.length > 1000}>{sending ? 'Posting…' : thread ? 'Reply' : 'Comment'}</button>
```

- [ ] **Step 3: Styles**

Delete the `.comment-form textarea { … }` block in `src/style.css` (`.rich-fallback` replaces it). The comment form stays `display: flex; align-items: flex-end`, so the button sits at the editor's bottom right.

- [ ] **Step 4: Verify**

Run: `npm run check && npm test && npm run build`
Expected: 0 errors, all tests pass, build succeeds. In the build output, Tiptap and the emoji list are in their own chunk (the one containing `RichEditor`), not in `index-*.js`. Write down its gzip size for the final report; the main `index-*.js` should grow only by `marked` and the renderer (~15 KB gzip).

- [ ] **Step 5: Commit**

```bash
git add src/components/Community.svelte src/components/PostCard.svelte src/style.css
git commit -m "Community threads and comments use the rich editor"
```

---

### Task 7: Moderation knows the text is Markdown

**Files:**
- Modify: `server/moderate.js` (`SYSTEM`, ~line 34)
- Test: `tests/community.test.js` (new test after "moderation failures are held for review…")

- [ ] **Step 1: Write the failing test**

```js
test("Haiku sees link addresses hidden behind Markdown link text", async () => {
  const api = haiku("fine");
  await moderate("comment", "Try [my recipe](https://cheap-pills.example) 😋", api);
  assert.match(api.calls[0].messages[0].content, /https:\/\/cheap-pills\.example/);
  assert.match(api.calls[0].system, /Markdown/);
  assert.match(api.calls[0].system, /\[text\]\(address\)/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/community.test.js`
Expected: FAIL on `/Markdown/` (the URL assertion already passes since raw text is sent).

- [ ] **Step 3: Update the prompt**

In `server/moderate.js`, after the line `The content is inside <content> tags. …`, add:

```
The content is Markdown: **bold**, *italic*, lists, and links written as [text](address). Judge the address as well as the text; a link counts as a link even when its text looks harmless.
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/moderate.js tests/community.test.js
git commit -m "Moderation: tell Haiku the text is Markdown and to judge link addresses"
```

---

### Task 8: Browser check, docs, TODO

**Files:**
- Modify: `README.md` (Accounts and credits section)

- [ ] **Step 1: Browser check (short, time-limited steps, narrate each)**

With `npm run dev` running and signed in locally, check, one step at a time:
1. Open a recipe's Comments: the editor appears with the toolbar (briefly a textarea first is fine).
2. Type `Loved it :) ` → 🙂 with one space; `step 8) ` stays text.
3. Type `:fi` → popup shows 🔥 first; ↓ then Enter inserts; Esc closes it. Typing `Note: ` shows no popup.
4. Type `:yum:` → 😋.
5. 😊 button → picker; search "avo" → 🥑; click it; reopen → Recently used shows 🥑.
6. Select a word → B, I, link (`example.com` → becomes `https://example.com`); `javascript:x` shows the error.
7. Ctrl+Enter posts; the comment shows bold/italic/link/emoji rendered; the link opens in a new tab.
8. Forums → Start a thread: same editor, 5000 counter appears near the limit.
9. Resize to 390 px wide: toolbar wraps, picker is full width, popup is on screen.
If any step needs a real Haiku call or can't be automated quickly, hand the user these steps as a checklist instead.

- [ ] **Step 2: README**

In `README.md`, after the "Accounts and credits" bullet list, add:

```markdown
- **Writing in the Community:** threads and comments use a rich-text editor (Tiptap, loaded only when a writing box opens) that saves Markdown: bold, italic, lists, and links. Emoji: the 😊 picker, `:shortcode:` with suggestions after two letters, and a few emoticons (`:)`, `:D`, `<3`…). Text is stored as Markdown with real emoji characters and shown through a small allow-list renderer (`src/lib/markdown.js`); anything else, including HTML, shows as plain text. Links are http(s) only, open in a new tab, and any post with a link waits for a moderator.
```

- [ ] **Step 3: Final verification**

Run: `npm run check && npm test && npm run build`
Expected: 0 errors, all pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "README: Community editor and emoji"
```

- [ ] **Step 5: TODO doc and push**

Update the "Community rich text + emojis" item in the Project TODO doc (built locally, date, not pushed). Ask the user before pushing; push once, after their OK.
