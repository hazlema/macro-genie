import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { copyFileSync } from "node:fs";

// Keep the manually maintained dataset at the repository root as a single source.
export default defineConfig({
  plugins: [
    svelte(),
    {
      name: "static-food-data",
      closeBundle() {
        copyFileSync("foods.json", "dist/foods.json");
      },
    },
  ],
});
