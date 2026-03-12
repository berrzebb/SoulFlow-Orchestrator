/**
 * sqlite-helper — with_sqlite / with_sqlite_strict 통합 테스트.
 * - with_sqlite_strict: pragmas 옵션
 * - with_sqlite: 정상 경로, pragmas, 예외 → null, 비존재 경로 → null
 * - with_sqlite: NODE_ENV !== "test" → stderr 로깅
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { with_sqlite, with_sqlite_strict } from "@src/utils/sqlite-helper.js";

async function make_tmpdir(prefix = "sqlite-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

// ── with_sqlite_strict ──────────────────────────────────────────────

describe("with_sqlite_strict — pragmas 옵션", () => {
  it("pragmas 배열 전달 → pragma 루프 실행", async () => {
    const dir = await make_tmpdir();
    const db_path = join(dir, "test.db");
    try {
      const result = with_sqlite_strict(db_path, (db) => {
        db.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)");
        return 42;
      }, { pragmas: ["journal_mode=WAL", "synchronous=NORMAL"] });
      expect(result).toBe(42);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── with_sqlite — 정상 경로 ─────────────────────────────────────────

describe("with_sqlite — 정상 경로", () => {
  it("pragmas 없이 DB 열고 콜백 실행", async () => {
    const dir = await make_tmpdir();
    const db_path = join(dir, "test.db");
    try {
      const result = with_sqlite(db_path, (db) => {
        db.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)");
        return 99;
      });
      expect(result).toBe(99);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("pragmas 배열 전달 → for 루프 실행", async () => {
    const dir = await make_tmpdir();
    const db_path = join(dir, "test.db");
    try {
      const result = with_sqlite(
        db_path,
        (db) => {
          db.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)");
          return "ok";
        },
        { pragmas: ["journal_mode=WAL"] },
      );
      expect(result).toBe("ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── with_sqlite — 예외 → null ───────────────────────────────────────

describe("with_sqlite — 예외 → return null", () => {
  it("run() 내에서 throw → catch에서 null 반환", async () => {
    const dir = await make_tmpdir();
    const db_path = join(dir, "test.db");
    try {
      const result = with_sqlite(db_path, (_db) => {
        throw new Error("intentional error");
      });
      expect(result).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("존재하지 않는 디렉토리 → DB 열기 실패 → null 반환", () => {
    const result = with_sqlite("/nonexistent/path/test.db", (db) => {
      db.exec("SELECT 1");
      return "should not reach";
    });
    expect(result).toBeNull();
  });
});

// ── with_sqlite — NODE_ENV !== "test" stderr 로깅 ───────────────────

describe("with_sqlite — NODE_ENV≠test 시 stderr 로깅", () => {
  it("NODE_ENV=development + 에러 → process.stderr.write 호출", () => {
    const original_env = process.env.NODE_ENV;
    const write_spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      process.env.NODE_ENV = "development";
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
