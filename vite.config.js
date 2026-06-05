import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static SPA build. Output in dist/ is what Render serves.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
});
