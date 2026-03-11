/**
 * sqlite-helper — with_sqlite L29 커버:
 * - L29: process.stderr.write → NODE_ENV !== "test" 조건부 로깅
 *
 * 테스트에서 NODE_ENV를 임시로 "development"로 변경해 L29 분기 커버.
 */
import { describe, it, expect, vi } from "vitest";
import { with_sqlite } from "@src/utils/sqlite-helper.js";

// ── L29: stderr 로깅 (NODE_ENV !== "test") ────────────────────────────────────

describe("with_sqlite — L29: NODE_ENV≠test 시 stderr 로깅", () => {
  it("NODE_ENV=development + 에러 → process.stderr.write 호출 (L29)", () => {
    const original_env = process.env.NODE_ENV;
    const write_spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      process.env.NODE_ENV = "development";
      // 존재하지 않는 경로 → DB 열기 실패 → catch → L29
      const result = with_sqlite("/nonexistent-cov3/path/db.sqlite", (db) => {
        db.exec("SELECT 1");
        return "ok";
      });
      expect(result).toBeNull();
      expect(write_spy).toHaveBeenCalled();
      const written = String(write_spy.mock.calls[0]?.[0] ?? "");
      expect(written).toContain("[sqlite]");
    } finally {
      process.env.NODE_ENV = original_env;
      write_spy.mockRestore();
    }
  });
});
