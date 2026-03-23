import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const apiOrigin = process.env.CLAUDE_DELEGATE_API_ORIGIN || "http://127.0.0.1:4174";

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: "127.0.0.1",
    port: 4173,
    proxy: {
      "/api": {
        target: apiOrigin,
      },
    },
  },
});
