// Writes "Screenshot needed" SVGs for images only the owner can capture.
//   npm run placeholders
// A real screenshot saved under the same name (as .png) replaces it; update
// the guide's image path from .svg to .png at the same time.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const NEEDED = [
  [
    "mcp-1",
    1280,
    800,
    "Claude: Settings → Connectors → Add custom connector, with the Macro Genie URL",
  ],
  [
    "mcp-2",
    1280,
    800,
    "A chat where the AI uses search_foods (e.g. high-protein snacks)",
  ],
  [
    "mcp-3",
    1280,
    800,
    "A chat where the AI uses size_recipe to fit a dish to targets",
  ],
  [
    "cronometer-5",
    1280,
    800,
    "Cronometer diary with the imported recipe added",
  ],
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
mkdirSync("public/help", { recursive: true });
for (const [name, w, h, what] of NEEDED) {
  const file = `public/help/${name}.svg`;
  if (existsSync(file.replace(/\.svg$/, ".png"))) continue;
  writeFileSync(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#1a1e20"/>
  <rect x="12" y="12" width="${w - 24}" height="${h - 24}" fill="none" stroke="#c2db75" stroke-width="3" stroke-dasharray="14 10" rx="18"/>
  <text x="50%" y="46%" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#c2db75">Screenshot needed</text>
  <text x="50%" y="54%" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#969d98">${esc(what)}</text>
  <text x="50%" y="60%" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#969d98">public/help/${name}.png (${w}×${h})</text>
</svg>
`,
  );
  console.log(`placeholder: ${file}`);
}
