/**
 * C-22: DecisionStore.transaction — fn 또는 upsert_records 실패 시 캐시 무효화 버그.
 *
 * 버그: fn이 index(= this.cache)를 직접 수정한 뒤 upsert_records가 실패하면
 *      `this.cache = null` 라인을 건너뛰어 DB와 불일치하는 캐시가 남음.
 * 수정: try/catch로 래핑하고 에러 발생 시도 `this.cache = null` 실행.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DecisionStore } from "@src/decision/store.js";
import type { DecisionRecord } from "@src/decision/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

function make_record(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    scope: "global",
    scope_id: null,
    key: "test.key",
    canonical_key: "test_key",
    value: "test value",
    normalized_value: "test value",
    rationale: null,
    priority: 1,
    status: "active",
    source: "user",
    tags: [],
    fingerprint: `fp-${id}`,
    supersedes_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

let tmp_dir: string;
let store: DecisionStore;

beforeEach(async () => {
  tmp_dir = await mkdtemp(join(tmpdir(), "decision-store-cov3-"));
  store = new DecisionStore(tmp_dir);
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true });
});

// ── C-22: fn 실패 시 캐시 무효화 ────────────────────────────────────────────

describe("DecisionStore — C-22: transaction 실패 시 cache 무효화", () => {
  it("fn이 throw하면 cache가 null로 무효화되어 다음 읽기가 DB에서 새로 로드됨", async () => {
    // 먼저 캐시를 워밍업하기 위해 정상 read를 수행
    const initial = await store.list_records();
    expect(initial).toHaveLength(0);

    // 캐시가 로드된 상태 확인 (private 필드 접근)
    expect((store as any).cache).not.toBeNull();

    // fn이 throw하는 transaction
    await expect(
      store.transaction(async ({ index }) => {
        // index(= cache)를 수정한 뒤 throw
        index.records["ghost_id"] = make_record({ id: "ghost_id" });
        throw new Error("fn_failure");
      }),
    ).rejects.toThrow("fn_failure");

    // 실패 후 cache가 null로 무효화되어야 함
    expect((store as any).cache).toBeNull();

    // 다음 list_records는 DB에서 새로 로드 → ghost_id가 없어야 함
    const records = await store.list_records();
    expect(records.find((r) => r.id === "ghost_id")).toBeUndefined();
  });

  it("upsert_records 실패 시 cache가 무효화되어 DB 상태와 일치함", async () => {
    // 캐시 워밍업
    await store.list_records();
    expect((store as any).cache).not.toBeNull();

    // upsert_records를 throw하도록 spying
    const spy = vi.spyOn(store as any, "upsert_records").mockRejectedValueOnce(
      new Error("db_write_failed"),
    );

    await expect(
      store.transaction(async ({ index, append }) => {
        const record = make_record({ id: "will_fail_id" });
        index.records[record.id] = record;
        append(record);
        return record;
      }),
    ).rejects.toThrow("db_write_failed");

    spy.mockRestore();

    // 실패 후 cache 무효화 확인
    expect((store as any).cache).toBeNull();

    // DB에 레코드가 없어야 함 (write 실패)
    const records = await store.list_records();
    expect(records.find((r) => r.id === "will_fail_id")).toBeUndefined();
  });

  it("성공적인 transaction 후에도 cache가 null로 정리됨 (다음 읽기 시 새로 로드)", async () => {
    const record = make_record({ id: "success_id" });

    await store.transaction(async ({ index, append }) => {
      index.records[record.id] = record;
      append(record);
      return true;
    });

    // 성공 후에도 cache는 null (다음 읽기에서 DB에서 새로 로드)
    expect((store as any).cache).toBeNull();

    // DB에 레코드가 있어야 함
    const records = await store.list_records();
    expect(records.find((r) => r.id === "success_id")).toBeDefined();
  });
});
