import { defineConfig, loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import netlify from "@netlify/vite-plugin";
import { copyFileSync } from "node:fs";

// Local `.env` secrets (ANTHROPIC_API_KEY) for the functions under `npm run dev`.
// Netlify supplies them itself in production.
Object.assign(process.env, loadEnv("development", process.cwd(), "ANTHROPIC_"));

// Keep the manually maintained dataset at the repository root as a single source.
export default defineConfig({
  plugins: [
    svelte(),
    // Runs the /api and /mcp functions inside `npm run dev`.
    netlify({ edgeFunctions: { enabled: false } }),
    {
      name: "static-food-data",
      closeBundle() {
        copyFileSync("foods.json", "dist/foods.json");
      },
    },
  ],
});
