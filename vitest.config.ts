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
    pool: "threads",
    maxWorkers: process.env.CI ? 4 : 2,
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
