import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.tsx", "tests/**/*.test.ts"],
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Windows segfault 방지 (루트 vitest.config.ts와 동일)
    pool: "forks",
    maxWorkers: 1,
    testTimeout: 30_000,
  },
});
