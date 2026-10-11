import { defineConfig, loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import netlify from "@netlify/vite-plugin";
import { copyFileSync } from "node:fs";

export default defineConfig(({ command }) => {
  if (command === "serve") {
    // Local AI calls use only the ANTHROPIC_API_KEY in .env, sent straight to
    // Anthropic (server/chef.js). Netlify's AI Gateway can't be switched off
    // in this plugin, so its credentials are ignored here; no local test ever
    // spends Netlify credits.
    const local = loadEnv("development", process.cwd(), "ANTHROPIC_");
    // Sign-in and database settings from .env for the functions under npm run dev.
    const auth = loadEnv("development", process.cwd(), [
      "GOOGLE_CLIENT_ID",
      "SESSION_SECRET",
      "ADMIN_SUBS",
      "DATABASE_URL",
    ]);
    for (const [key, value] of Object.entries(auth)) process.env[key] ??= value;
    process.env.MACRO_GENIE_LOCAL = "1";
    process.env.MACRO_GENIE_LOCAL_KEY = local.ANTHROPIC_API_KEY ?? "";
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
      // Keep the manually maintained dataset at the repository root as a single source.
      {
        name: "static-food-data",
        closeBundle() {
          copyFileSync("foods.json", "dist/foods.json");
        },
      },
    ],
  };
});
