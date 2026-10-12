# Community rich text + emoji — design

Date: 2026-10-12. Status: approved in chat, awaiting spec review.

## Goal

Writing in the Community is the main way people talk to each other, so it should feel like a modern chat box: rich text you see as you type (not raw Markdown), and emoji everywhere — a full picker, `:shortcode:` autocomplete, and emoticons like `:)` turning into 🙂 inline.

Success looks like: a reply typed as `**Loved it** :yum: try *smoked* paprika :)` shows bold, italic, 😋 and 🙂 while typing and after posting; pasting `<script>` or `[x](javascript:…)` shows harmless text.

## Scope

- In: the new-thread message (`Community.svelte`, 5000 chars) and the comment/reply box (`PostCard.svelte`, 1000 chars); rendering thread bodies and comments.
- Out: recipe descriptions (written by Claude, not editable by users; stay plain text), display names, titles, reports.
- Unchanged: database schema, API, length limits (they count the stored Markdown), moderation flow.

## Decisions

- Editor: **Tiptap v3** used framework-agnostically from a Svelte 5 component (no React). Packages: `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit` (trimmed), `@tiptap/extension-link`, `@tiptap/extension-emoji`, `@tiptap/markdown`, `@tiptap/extension-placeholder`, `@tiptap/suggestion`.
- Storage: Markdown with **Unicode emoji characters** (the emoji node serializes as its character, overriding Tiptap's default `:name:`). Viewing never needs emoji data; Haiku moderates what people will see.
- Emoji look: native device glyphs, no image sets.
- Links: allowed, rendered clickable; moderation keeps sending anything with a link to "unsure" (held for a moderator), as today.
- Viewing: `marked` lexer + our own allow-list renderer. No `innerHTML` of unsanitized output, no DOMPurify.

## Units

### `src/components/RichEditor.svelte`

Props: `markdown` (bindable string), `maxlength`, `placeholder`, `label` (aria), `onsubmit` (Ctrl/⌘+Enter). Exposes `clear()` and `focus()`.

- Schema: paragraph, hard break, bold, italic, bullet list, ordered list, list item, link, emoji. Everything else in StarterKit is disabled (headings, code, code block, blockquote, strike, horizontal rule, images), so it can't be produced or pasted in.
- Toolbar: **B**, *I*, bullet list, numbered list, link (prompt for URL; http/https only, bare domains get `https://`), 😊 picker. Buttons show active state. Keyboard: Ctrl/⌘+B, +I, +K; Markdown input rules (`**x**`, `*x*`, `- `, `1. `).
- Counter: shows `n / max` once past 80% of the limit; posting disabled over the limit.
- Loaded lazily: the comment box and thread form render a lightweight placeholder that dynamically imports the editor on first focus/click, so browsing Community doesn't download Tiptap.

### Emoji (inside the editor)

- `:` suggestion via `@tiptap/extension-emoji`'s suggestion option, popup rendered by a small Svelte component `EmojiSuggest.svelte`: up to 8 matches by shortcode/tag prefix, ↑/↓/Enter/Tab to pick, Esc to close. Typing a complete `:fire:` converts on the closing colon.
- Emoticons: `enableEmoticons: true` (`:)`, `:D`, `;)`, `<3`, … convert after a space).
- `EmojiPicker.svelte`: popover from the 😊 button with search box, category tabs (from the emoji list's groups), and a "Recently used" row (last 24, `localStorage` key `mg-recent-emoji`). Inserts at the cursor. Works with touch; on narrow screens it opens full-width under the editor.
- One dataset: the emoji list shipped with `@tiptap/extension-emoji`, so shortcodes, emoticons, and the picker always agree.

### `src/lib/markdown.js` + `src/components/Markdown.svelte`

`renderMarkdown(text) → string` (HTML), pure and unit-tested.

- Lex with `marked` (GFM line breaks on). Walk tokens; emit only: paragraph, line break, strong, em, list/list item (ordered with start number, bullet), link, text. Any other token (html, heading, code, blockquote, image, table, hr…) is emitted as its escaped raw text.
- All text is HTML-escaped. Links: only `http:`/`https:` hrefs (after trimming); otherwise the link text is shown plain. Links get `target="_blank" rel="nofollow noopener noreferrer ugc"`.
- `Markdown.svelte` renders `{@html renderMarkdown(text)}` inside a wrapper with a `class` prop. Existing plain-text posts render as before (paragraphs/line breaks).
- Used for: `.thread-body` (clamped preview still works on the wrapper) and `.comment-body`.

### Server / moderation

No code path changes. Add a test that a comment containing a Markdown link is still judged with the link visible to Haiku (the raw text goes to `moderate`).

## Data flow

Editor (ProseMirror doc) → `@tiptap/markdown` serializer → Markdown string with Unicode emoji → existing POST → stored as is → Haiku moderates raw text → GET returns raw text → `renderMarkdown` → allow-listed HTML.

## Errors / edge cases

- Editor fails to load (network): fall back to the plain textarea so people can still post.
- Paste from Word/web: only allowed marks/nodes survive (schema enforces).
- Over-limit Markdown (formatting adds characters): counter turns red, submit disabled; server limits unchanged.
- Bundle: Tiptap + emoji list in a separate chunk; measure gzip size in the build output and note it in the plan's verification.

## Testing

- Unit (`tests/markdown.test.js`): escapes `<script>`/attributes; drops `javascript:`/`data:` links; allowed formatting renders; ordered list start; raw HTML/headings/code/images show as text; plain legacy text unchanged; editor-style output (escaped `\*`, emoji) round-trips.
- Unit: emoji node serializes to the Unicode character (headless Tiptap editor in Node, if the packages allow; otherwise covered in the browser check).
- Browser: short, time-limited Playwright steps or a checklist for the user — `:)` → 🙂, `:fi` popup + Enter, picker search + recent row, bold/list/link toolbar, post and see it rendered, phone width.
