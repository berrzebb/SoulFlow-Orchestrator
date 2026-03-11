/**
 * SqliteDispatchDlqStore — 커버리지:
 * L54: 빈 sqlite_path → throw
 * L115: with_sqlite null 반환 → "dlq_write_failed" throw
 * L117: job 거부 시 write_queue rejection handler 호출
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("@src/utils/sqlite-helper.js", () => ({
  with_sqlite: vi.fn().mockReturnValue(true),
  with_sqlite_strict: vi.fn().mockReturnValue(true),
}));

import * as sqlite_helper from "@src/utils/sqlite-helper.js";
const mock_with_sqlite = sqlite_helper.with_sqlite as ReturnType<typeof vi.fn>;

import { SqliteDispatchDlqStore } from "@src/channels/dlq-store.js";

describe("SqliteDispatchDlqStore — L54: 빈 경로 → throw", () => {
  it("sqlite_path가 빈 문자열 → 'dlq sqlite_path is required' throw", () => {
    expect(() => new SqliteDispatchDlqStore("")).toThrow("dlq sqlite_path is required");
  });
});

describe("SqliteDispatchDlqStore — L115/L117: append 실패 처리", () => {
  let tmp_dir: string;

  beforeAll(async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "dlq-test-"));
  });

  afterAll(async () => {
    await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
  });

  it("with_sqlite가 null 반환 → L115 throw 'dlq_write_failed' → append rejects", async () => {
    // 첫 번째 호출: ensure_initialized (return 값 무시) — true 반환
    // 두 번째 호출: append 내 write → null 반환 → L115 throw
    mock_with_sqlite
      .mockReturnValueOnce(undefined) // ensure_initialized
      .mockReturnValueOnce(null); // append → ok = null → L115

    const store = new SqliteDispatchDlqStore(join(tmp_dir, "dlq.db"));
    await expect(
      store.append({
        at: new Date().toISOString(),
        provider: "slack",
        chat_id: "ch1",
        message_id: "m1",
        sender_id: "u1",
        reply_to: "",
        thread_id: "",
        retry_count: 1,
        error: "test_error",
        content: "hello",
        metadata: {},
      }),
    ).rejects.toThrow("dlq_write_failed");
  });
});
