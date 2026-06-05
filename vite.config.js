import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Frontend build -> dist/ (served by server/index.js in production).
// In dev, Vite proxies the API + WebSocket to the Node backend on :3000.
// VitePWA emits the manifest + service worker so the app is installable.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon-64.png", "apple-touch-icon.png"],
      manifest: {
        name: "Mission Control — Agent Office",
        short_name: "Mission Control",
        description: "Live multi-agent office: assign tasks and watch the CTO orchestrate the team.",
        theme_color: "#0a0e1a",
        background_color: "#0a0e1a",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        navigateFallback: "/index.html",
        // Never let the SW shadow auth/API/WS routes.
        navigateFallbackDenylist: [/^\/api/, /^\/ws/, /^\/login/],
        // Take over and drop stale caches immediately so new deploys apply
        // without the old bundle lingering.
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  build: { outDir: "dist" },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
      "/login": "http://localhost:3000",
    },
  },
});
