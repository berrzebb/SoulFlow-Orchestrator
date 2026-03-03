import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4200",
      "/ws": { target: "ws://127.0.0.1:4200", ws: true },
    },
  },
});
