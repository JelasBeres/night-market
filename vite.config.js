import { defineConfig } from "vite";

export default defineConfig({
  // the engine (npm run bot) answers /api; without it the town shows its empty, pre-launch state
  server: { proxy: { "/api": `http://127.0.0.1:${process.env.ENGINE_PORT || 5371}`, "/ws": { target: `ws://127.0.0.1:${process.env.LIVE_PORT || 5372}`, ws: true } } },
  build: { rollupOptions: { input: { main: "index.html", memex: "memex.html" } }, chunkSizeWarningLimit: 1500 },
});
