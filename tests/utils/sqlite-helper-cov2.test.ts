/**
 * sqlite-helper — with_sqlite 함수 커버리지 (cov2):
 * - L19-25: with_sqlite 정상 경로 (pragmas 포함)
 * - L27: with_sqlite — run() 예외 → catch { return null }
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { with_sqlite } from "@src/utils/sqlite-helper.js";

async function make_tmpdir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "sqlite-cov2-"));
}

// ── L19-25: with_sqlite 정상 경로 ────────────────────────────────────────────

describe("with_sqlite — 정상 경로 (L19-25)", () => {
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

  it("pragmas 배열 전달 → for 루프 실행 (L22-24)", async () => {
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

// ── L27: with_sqlite — run() 예외 → catch { return null } ─────────────────────

describe("with_sqlite — 예외 → return null (L27)", () => {
  it("run() 내에서 throw → catch에서 null 반환", async () => {
    const dir = await make_tmpdir();
    const db_path = join(dir, "test.db");
    try {
      const result = with_sqlite(db_path, (_db) => {
        throw new Error("intentional error");
      });
      // catch { return null } → L27 실행
      expect(result).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("존재하지 않는 디렉토리 → DB 열기 실패 → null 반환", async () => {
    const result = with_sqlite("/nonexistent/path/test.db", (db) => {
      db.exec("SELECT 1");
      return "should not reach";
    });
    expect(result).toBeNull();
  });
});
