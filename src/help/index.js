import start from "./start.js";
import basics from "./basics.js";
import macros from "./macros.js";
import builder from "./builder.js";
import credits from "./credits.js";
import book from "./book.js";
import community from "./community.js";
import mcp from "./mcp.js";
import cronometer from "./cronometer.js";
import faq from "./faq.js";

// Hub order.
export const GUIDES = [
  start,
  basics,
  macros,
  builder,
  credits,
  book,
  community,
  mcp,
  cronometer,
  faq,
];
export const guideBySlug = (slug) => GUIDES.find((g) => g.slug === slug);
