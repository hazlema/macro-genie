// Re-takes the help screenshots from the running dev site.
//   npm run dev            (in another terminal)
//   npm run screenshots
// /api/me is mocked as "Sam" with 10 credits and the browser starts with a
// saved Builder session (scripts/help-fixtures/prefs.json), so no real
// account, credits, or AI calls are used. Community pages show the dev
// database's public posts.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.HELP_BASE_URL ?? "http://localhost:5173";
const prefs = readFileSync(
  new URL("./help-fixtures/prefs.json", import.meta.url),
  "utf8",
);
const ME = {
  signedIn: true,
  account: {
    displayName: "Sam",
    credits: 10,
    isAdmin: false,
    isMod: false,
    suspended: false,
  },
  googleClientId: null,
};
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

// [file, viewport, path, actions(page), marker selector?]
// With a marker selector, the script prints where that control sits (as
// percentages of the screenshot) for the guide's numbered marker. Markers sit
// on the control's top-left corner so they don't cover its label.
const SHOTS = [
  ["start-1", DESKTOP, "/", async () => {}],
  [
    "macros-1",
    DESKTOP,
    "/foods",
    async (p) => {
      await p.fill('input[aria-label="Protein minimum"]', "30");
      await p.fill('input[aria-label="Calories maximum"]', "300");
    },
    'input[aria-label="Protein minimum"]',
  ],
  [
    "macros-1-phone",
    PHONE,
    "/foods",
    async (p) => {
      await p.fill('input[aria-label="Protein minimum"]', "30");
    },
    ".panel-toggle",
  ],
  [
    "builder-1",
    DESKTOP,
    "/builder",
    async () => {},
    ".brief-actions .primary-button",
  ],
  [
    "builder-2",
    DESKTOP,
    "/builder",
    async (p) => {
      await p.locator(".idea").first().scrollIntoViewIfNeeded();
    },
    ".idea button:has-text('Cook this one'), .idea .outline-button",
  ],
  [
    "builder-3",
    DESKTOP,
    "/builder",
    async (p) => {
      await p.locator(".recipe-card").first().scrollIntoViewIfNeeded();
    },
    ".copy-ingredients",
  ],
  [
    "builder-3-phone",
    PHONE,
    "/builder",
    async (p) => {
      await p
        .locator(".recipe-card .card-subhead")
        .first()
        .evaluate((el) => el.scrollIntoView({ block: "center" }));
    },
    ".copy-ingredients",
  ],
  [
    "credits-1",
    DESKTOP,
    "/builder",
    async () => {},
    ".account-area .credit-pill",
  ],
  [
    "credits-1-phone",
    PHONE,
    "/builder",
    async (p) => {
      await p.click(".account-menu .credit-pill");
    },
    ".account-menu .credit-pill",
  ],
  ["book-1", DESKTOP, "/recipes", async () => {}, ".copy-ingredients"],
  [
    "community-1",
    DESKTOP,
    "/community",
    async (p) => {
      await p.waitForSelector(".post-list li", { timeout: 20000 });
    },
  ],
  [
    "community-2",
    DESKTOP,
    "/community",
    async (p) => {
      await p.waitForSelector(".post-list li", { timeout: 20000 });
      await p
        .locator(".post-actions .text-button", { hasText: "Comments" })
        .first()
        .click();
      await p.waitForSelector(
        ".comment, .comments-empty:not(:has-text('Loading'))",
        { timeout: 20000 },
      );
    },
    ".comment-form .rich-editor, .comment-form textarea",
  ],
  [
    "community-1-phone",
    PHONE,
    "/community",
    async (p) => {
      await p.waitForSelector(".post-list li", { timeout: 20000 });
    },
  ],
];

const browser = await chromium.launch();
// ONLY=community-1,community-2 re-takes just those.
const only = process.env.ONLY?.split(",");
for (const [file, viewport, path, act, mark] of SHOTS) {
  if (only && !only.includes(file)) continue;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await context.addInitScript((value) => {
    localStorage.setItem("macro-genie:prefs:v1", value);
    localStorage.setItem("macro-genie:macro-panel-used:v1", "");
  }, prefs);
  await context.route("**/api/me", (route) => route.fulfill({ json: ME }));
  const page = await context.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(800);
  await page.evaluate((to) => {
    history.pushState({}, "", to);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await page.waitForTimeout(1500);
  await act(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `public/help/${file}.png` });
  if (mark) {
    const box = await page.locator(mark).first().boundingBox();
    if (box)
      console.log(
        `marker ${file}: x ${Math.round((box.x / viewport.width) * 100)}, y ${Math.round((box.y / viewport.height) * 100)}`,
      );
    else console.log(`marker ${file}: not on screen`);
  }
  console.log(`saved public/help/${file}.png`);
  await context.close();
}
await browser.close();
