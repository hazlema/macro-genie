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
          ctx.defaultValidate(url) &&
          !/^(?!https?:)[a-z][a-z\d+.-]*:/i.test(url),
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

// Text typed into the stand-in textarea before the editor loaded, as an
// editor document: kept exactly as typed (blank lines start paragraphs, single
// line breaks stay), never parsed as Markdown, so "# " or "> " isn't lost.
export function plainTextDoc(text) {
  if (!text) return "";
  const paragraph = (block) => ({
    type: "paragraph",
    content: block
      .split("\n")
      .flatMap((line, i) => [
        ...(i ? [{ type: "hardBreak" }] : []),
        ...(line ? [{ type: "text", text: line }] : []),
      ]),
  });
  return { type: "doc", content: text.split(/\n{2,}/).map(paragraph) };
}
