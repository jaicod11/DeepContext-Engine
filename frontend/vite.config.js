// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // "@/services/api" → "src/services/api"
      "@": resolve(__dirname, "src"),
    },
  },

  server: {
    port: 5173,
    proxy: {
      // Forward /api/* to FastAPI during local development
      // Removes the need for CORS headers in dev
      "/api": {
        target:       "http://localhost:8000",
        changeOrigin: true,
      },
      "/health": {
        target:       "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir:        "dist",
    sourcemap:     true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor bundles for better caching
          react:    ["react", "react-dom"],
          markdown: ["react-markdown", "remark-gfm", "rehype-raw"],
          state:    ["zustand"],
        },
      },
    },
  },
});
