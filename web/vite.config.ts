import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
  ],
  base: "./",
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-markdown": ["react-markdown", "remark-gfm", "rehype-highlight", "rehype-sanitize"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4200",
      "/ws": { target: "ws://127.0.0.1:4200", ws: true },
    },
  },
});
