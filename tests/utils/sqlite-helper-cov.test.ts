/**
 * sqlite-helper — with_sqlite_strict L43 커버리지 보충.
 * pragmas 옵션을 전달하여 for 루프 실행.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { with_sqlite_strict } from "@src/utils/sqlite-helper.js";

describe("with_sqlite_strict — pragmas 옵션 (L43)", () => {
  it("pragmas 배열 전달 → L43 pragma 루프 실행", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sqlite-cov-"));
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
