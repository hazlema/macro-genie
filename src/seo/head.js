// Head tags for search engines and link previews. Pure string work, shared
// by the build (fixed pages) and the server (community recipe pages).

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);

// Replacers are functions so "$&" or "$1" in someone's recipe name stays text.
export function withHead(template, { title, description, canonical, image, type = "website", noindex = false, extraHead = "" }) {
  const tags = [
    `<link rel="canonical" href="${esc(canonical)}" />`,
    `<meta property="og:site_name" content="Macro Genie" />`,
    `<meta property="og:type" content="${esc(type)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(canonical)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    ...(noindex ? [`<meta name="robots" content="noindex" />`] : []),
    ...(extraHead ? [extraHead] : []),
  ].join("\n    ");
  return template
    // A template that already has these (the built home page) would double them.
    .replace(/<link\s+rel="canonical"[^>]*>\s*/g, () => "")
    .replace(/<meta\s+(?:property="og:|name="twitter:|name="robots")[^>]*>\s*/g, () => "")
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(title)}</title>`)
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, () => `<meta name="description" content="${esc(description)}" />`)
    .replace("</head>", () => `  ${tags}\n  </head>`);
}

export const withBody = (template, html) =>
  template.replace(`<div id="app"></div>`, () => `<div id="app">${html}</div>`);
