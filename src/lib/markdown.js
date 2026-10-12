import { Lexer } from "marked";

// Turns Community Markdown into HTML, allowing only what the editor can
// write: paragraphs, line breaks, bold, italic, lists, and http(s) links.
// Everything else (raw HTML, headings, code, images…) shows as plain text.
// Safe by construction: every piece of text is escaped, and only the tags
// below are ever produced.
const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
// An "&" that already starts an entity is left alone: the editor writes
// "Salt &amp; pepper", and entities are inert as text and inside quotes.
const escape = (s) =>
  String(s ?? "").replace(/&(?!#?\w+;)|[<>"']/g, (c) => ESCAPES[c]);
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
