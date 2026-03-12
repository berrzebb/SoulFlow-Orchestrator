/**
 * SqliteDispatchDlqStore — 커버리지:
 * L54: 빈 sqlite_path → throw
 * with_sqlite_strict throw → append rejects
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
const mock_with_sqlite_strict = sqlite_helper.with_sqlite_strict as ReturnType<typeof vi.fn>;

import { SqliteDispatchDlqStore } from "@src/channels/dlq-store.js";

describe("SqliteDispatchDlqStore — L54: 빈 경로 → throw", () => {
  it("sqlite_path가 빈 문자열 → 'dlq sqlite_path is required' throw", () => {
    expect(() => new SqliteDispatchDlqStore("")).toThrow("dlq sqlite_path is required");
  });
});

describe("SqliteDispatchDlqStore — append 실패 처리", () => {
  let tmp_dir: string;

  beforeAll(async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "dlq-test-"));
  });

  afterAll(async () => {
    await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
  });

  it("with_sqlite_strict throw → append rejects", async () => {
    // ensure_initialized는 성공, append 내부 with_sqlite_strict가 throw
    mock_with_sqlite_strict
      .mockReturnValueOnce(undefined)                          // ensure_initialized
      .mockImplementationOnce(() => { throw new Error("db_write_error"); }); // append

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
    ).rejects.toThrow("db_write_error");
  });
});
