import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend build -> dist/ (served by server/index.js in production).
// In dev, the Vite server proxies the API + WebSocket to the Node backend
// on :3000, so `npm run dev` (frontend) + `npm run dev:server` work together.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
      "/login": "http://localhost:3000",
    },
  },
});
