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
    exclude: [
      "tests/e2e/**",
      "**/node_modules/**",
      // CI에서 sqlite-vec 네이티브 확장 없는 환경은 vec DB 테스트 제외
      ...(process.env.SKIP_VEC_TESTS
        ? [
            "tests/services/vector-store-service.test.ts",
            "tests/agent/nodes/vector-store.test.ts",
            "tests/agent/nodes/vector-store-image-extended.test.ts",
            "tests/agent/tools/vector-store-image-tool.test.ts",
          ]
        : []),
      // CI에서 rechunk worker (worker_threads tsx 모듈 해석 미지원) 테스트 제외
      ...(process.env.SKIP_RECHUNK_TESTS
        ? [
            "tests/agent/memory-service-cov6.test.ts",
            "tests/agent/memory-service-cov10.test.ts",
            "tests/agent/memory-service-extended2.test.ts",
            "tests/agent/memory-store-daily-layout.test.ts",
          ]
        : []),
      // CI에서 실제 claude/codex CLI 바이너리 없음 — PTY 스폰 불가
      ...(process.env.SKIP_PTY_TESTS
        ? [
            "tests/agent/pty/container-pool.test.ts",
          ]
        : []),
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // forks: child_process 기반 — Windows segfault 방지, 메모리 격리 안정적
    // CI: maxWorkers=2 (7GB runner × 2 fork ≈ 3-4GB, OOM 방지). 병렬화는 shard로 처리.
    pool: "forks",
    maxWorkers: process.env.CI ? 2 : 1,
    // CI shard 모드: blob 리포터를 숨김 디렉토리가 아닌 vitest-reports/에 출력
    // (.vitest-reports는 @actions/glob이 숨김 디렉토리로 간주해 업로드 스킵)
    reporters: process.env.VITEST_BLOB
      ? [["blob", { outputFile: "./vitest-reports/blob.json" }]]
      : undefined,
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
