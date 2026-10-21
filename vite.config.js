import { defineConfig, loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import netlify from "@netlify/vite-plugin";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { SHELL_PATH, fixedPageFiles, seoRedirects } from "./src/seo/pages.js";

// The Stripe events server/payments.js handles.
const STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "charge.refunded",
].join(",");

// Under npm run dev, forwards Stripe's webhooks to the local function with the
// Stripe CLI, so a test purchase or refund reaches the app without a second
// terminal. Started once per process: Vite reloads this config on changes.
function stripeListen() {
  return {
    name: "stripe-listen",
    apply: "serve",
    configureServer(server) {
      if (globalThis.stripeListener || !process.env.STRIPE_SECRET_KEY) return;
      server.httpServer?.once("listening", () => {
        const { port } = server.httpServer.address();
        const child = spawn(
          "stripe",
          ["listen", "--events", STRIPE_EVENTS, "--forward-to", `localhost:${port}/api/stripe/webhook`],
          // The CLI uses the .env key, so it needs no `stripe login` of its own.
          { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY } },
        );
        globalThis.stripeListener = child;
        const show = (data) => {
          for (const line of String(data).split("\n"))
            if (line.trim()) console.log(`[stripe] ${line}`);
        };
        child.stdout.on("data", show);
        child.stderr.on("data", show);
        child.on("error", () => {
          globalThis.stripeListener = null;
          console.log("[stripe] Stripe CLI not found; webhooks won't reach the app. See README.");
        });
        process.once("exit", () => child.kill());
      });
    },
  };
}

export default defineConfig(({ command }) => {
  if (command === "serve") {
    // Local AI calls use only the ANTHROPIC_API_KEY in .env, sent straight to
    // Anthropic (server/chef.js). Netlify's AI Gateway can't be switched off
    // in this plugin, so its credentials are ignored here; no local test ever
    // spends Netlify credits.
    const local = loadEnv("development", process.cwd(), "ANTHROPIC_");
    // Sign-in, database, Stripe and invite-email (SMTP_) settings from .env for
    // the functions under npm run dev.
    const auth = loadEnv("development", process.cwd(), [
      "GOOGLE_CLIENT_ID",
      "SESSION_SECRET",
      "ADMIN_SUBS",
      "DATABASE_URL",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STATS_TOKEN",
      "SMTP_",
    ]);
    for (const [key, value] of Object.entries(auth)) process.env[key] ??= value;
    process.env.MACRO_GENIE_LOCAL = "1";
    process.env.MACRO_GENIE_LOCAL_KEY = local.ANTHROPIC_API_KEY ?? "";
    // Lets the Money tab compare against Anthropic's real bill locally.
    if (local.ANTHROPIC_ADMIN_KEY) process.env.ANTHROPIC_ADMIN_KEY ??= local.ANTHROPIC_ADMIN_KEY;
    console.log(
      local.ANTHROPIC_API_KEY
        ? "AI calls: your ANTHROPIC_API_KEY from .env (billed to Anthropic, not Netlify credits)"
        : "AI calls: off locally. Add ANTHROPIC_API_KEY to .env to try ideas and recipes.",
    );
  }
  return {
    plugins: [
      svelte(),
      // Runs the /api and /mcp functions inside `npm run dev`.
      netlify({ edgeFunctions: { enabled: false } }),
      stripeListen(),
      // Keep the manually maintained dataset at the repository root as a single source.
      {
        name: "static-food-data",
        closeBundle() {
          copyFileSync("foods.json", "dist/foods.json");
        },
      },
      // One HTML file per fixed page, with its own title and preview tags.
      {
        name: "seo-pages",
        apply: "build",
        closeBundle() {
          const template = readFileSync("dist/index.html", "utf8");
          mkdirSync(dirname(`dist${SHELL_PATH}`), { recursive: true });
          writeFileSync(`dist${SHELL_PATH}`, template);
          for (const { file, html } of fixedPageFiles(template)) {
            mkdirSync(dirname(`dist/${file}`), { recursive: true });
            writeFileSync(`dist/${file}`, html);
          }
          writeFileSync("dist/_redirects", seoRedirects());
        },
      },
    ],
  };
});
