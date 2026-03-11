import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@src": resolve(__dirname, "src"),
      "@helpers": resolve(__dirname, "tests/helpers"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "**/node_modules/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // forks: child_process 기반 — Windows segfault 방지, 메모리 격리 안정적
    // CI: maxWorkers=2 (7GB runner × 2 fork ≈ 3-4GB, OOM 방지). 병렬화는 shard로 처리.
    pool: "forks",
    maxWorkers: process.env.CI ? 2 : 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.types.ts",
        "src/**/types.ts",
        "src/i18n/locales/**",
      ],
      reporter: ["text", "html", "json-summary", "json"],
      reportsDirectory: "coverage",
      reportOnFailure: true,
    },
  },
});
