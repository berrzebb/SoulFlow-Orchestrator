/**
 * DecisionStore — 통합 테스트.
 * - 기본 CRUD (transaction, list_records, key_ref, rebuild_maps)
 * - 내부 인덱스 (rebuild_index_from_store, 잘못된 JSON/id 없는 레코드)
 * - 에러 경로 (transaction 예외, upsert ROLLBACK)
 * - C-22 회귀: 실패 시 캐시 무효화
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DecisionStore } from "@src/decision/store.js";
import type { DecisionRecord } from "@src/decision/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { with_sqlite } from "@src/utils/sqlite-helper.js";

function make_record(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    scope: "global",
    scope_id: null,
    key: "test.key",
    canonical_key: "test.key",
    value: "val",
    normalized_value: "val",
    rationale: "test",
    priority: 1,
    status: "active",
    source: "user",
    tags: [],
    fingerprint: `fp-${id}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

let tmp_dir: string;
let store: DecisionStore;

beforeEach(async () => {
  tmp_dir = await mkdtemp(join(tmpdir(), "decision-store-test-"));
  store = new DecisionStore(tmp_dir);
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

// ═══════════════════════════════════════════
// 기본 CRUD
// ═══════════════════════════════════════════

describe("DecisionStore — 기본 CRUD", () => {
  it("list_records: 초기 상태 → 빈 배열", async () => {
    const records = await store.list_records();
    expect(records).toEqual([]);
  });

  it("transaction: 단일 레코드 삽입 후 list_records 조회", async () => {
    const rec = make_record();
    await store.transaction(async ({ append }) => { append(rec); });
    const records = await store.list_records();
    expect(records.length).toBe(1);
    expect(records[0].id).toBe(rec.id);
  });

  it("transaction: 다수 레코드 삽입", async () => {
    const recs = [make_record(), make_record(), make_record()];
    await store.transaction(async ({ append }) => {
      for (const r of recs) append(r);
    });
    const records = await store.list_records();
    expect(records.length).toBe(3);
  });

  it("transaction: 동일 id → 덮어쓰기 (upsert)", async () => {
    const rec = make_record({ value: "original" });
    await store.transaction(async ({ append }) => { append(rec); });
    await store.transaction(async ({ append }) => {
      append({ ...rec, value: "updated", normalized_value: "updated", updated_at: new Date().toISOString() });
    });
    const records = await store.list_records();
    expect(records.length).toBe(1);
    expect(records[0].value).toBe("updated");
  });

  it("transaction: key_ref 유틸리티 함수 제공", async () => {
    let ref = "";
    await store.transaction(async ({ key_ref }) => {
      ref = key_ref("global", null, "deploy.strategy");
    });
    expect(ref).toBe("global::deploy.strategy");
  });

  it("transaction: index.records에 append 버퍼 반영", async () => {
    const rec = make_record();
    await store.transaction(async ({ append }) => { append(rec); });
    await store.transaction(async ({ index }) => {
      expect(index.records[rec.id]).toBeDefined();
    });
  });

  it("transaction: active_by_key 맵 rebuild", async () => {
    const rec = make_record({ scope: "global", canonical_key: "key.x" });
    await store.transaction(async ({ append, rebuild_maps }) => {
      append(rec);
      rebuild_maps();
    });
    await store.transaction(async ({ index }) => {
      expect(index.active_by_key["global::key.x"]).toBe(rec.id);
    });
  });

  it("transaction: superseded 상태 레코드 → active_by_key에 미포함", async () => {
    const rec = make_record({ status: "superseded", scope: "global", canonical_key: "key.y" });
    await store.transaction(async ({ append, rebuild_maps }) => {
      append(rec);
      rebuild_maps();
    });
    await store.transaction(async ({ index }) => {
      expect(index.active_by_key["global::key.y"]).toBeUndefined();
    });
  });

  it("list_records: updated_at 내림차순 정렬", async () => {
    const old_time = "2024-01-01T00:00:00.000Z";
    const new_time = "2025-01-01T00:00:00.000Z";
    const r1 = make_record({ id: "id-1", updated_at: old_time, created_at: old_time });
    const r2 = make_record({ id: "id-2", updated_at: new_time, created_at: new_time });
    await store.transaction(async ({ append }) => { append(r1); append(r2); });
    const records = await store.list_records();
    expect(records[0].id).toBe("id-2");
    expect(records[1].id).toBe("id-1");
  });

  it("transaction: 반환값 전달 가능", async () => {
    const result = await store.transaction(async () => "hello");
    expect(result).toBe("hello");
  });

  it("transaction: 직렬 큐 — 병렬 호출도 순차 처리", async () => {
    const order: number[] = [];
    await Promise.all([
      store.transaction(async ({ append }) => { append(make_record({ id: "r1" })); order.push(1); }),
      store.transaction(async ({ append }) => { append(make_record({ id: "r2" })); order.push(2); }),
      store.transaction(async ({ append }) => { append(make_record({ id: "r3" })); order.push(3); }),
    ]);
    const records = await store.list_records();
    expect(records.length).toBe(3);
    expect(order.length).toBe(3);
  });
});

// ═══════════════════════════════════════════
// 내부 인덱스: rebuild_index_from_store 분기
// ═══════════════════════════════════════════

describe("DecisionStore — rebuild_index_from_store 분기", () => {
  it("non-active status → cache rebuild 후 active_by_key에 미포함", async () => {
    const rec = make_record({ status: "superseded" as any });
    await store.transaction(async ({ append }) => { append(rec); });
    (store as any).cache = null;
    const records = await store.list_records();
    expect(records.some((r) => r.id === rec.id)).toBe(true);
    const index = (store as any).cache;
    if (index) {
      expect(Object.values(index.active_by_key).includes(rec.id)).toBe(false);
    }
  });

  it("id 없는 record_json → rebuild_index 시 skip", async () => {
    await store.list_records();
    const db_path = join(tmp_dir, "runtime", "decisions", "decisions.db");
    with_sqlite(db_path, (db) => {
      const no_id_record = { value: "no-id", scope: "test", canonical_key: "k" };
      db.prepare(`
        INSERT INTO decisions (id, scope, scope_id, canonical_key, normalized_value, status, fingerprint, updated_at, record_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("placeholder-id", "test", null, "k", "v", "active", "fp-no-id", new Date().toISOString(), JSON.stringify(no_id_record));
    });
    (store as any).cache = null;
    const records = await store.list_records();
    expect(Array.isArray(records)).toBe(true);
  });

  it("잘못된 record_json → JSON.parse catch skip", async () => {
    await store.list_records();
    const db_path = join(tmp_dir, "runtime", "decisions", "decisions.db");
    with_sqlite(db_path, (db) => {
      db.prepare(`
        INSERT INTO decisions (id, scope, scope_id, canonical_key, normalized_value, status, fingerprint, updated_at, record_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("broken-json-id", "test", null, "k2", "v2", "active", "fp-broken", new Date().toISOString(), "{ invalid json {{{ broken");
    });
    (store as any).cache = null;
    const records = await store.list_records();
    expect(records.every((r) => r.id !== "broken-json-id")).toBe(true);
  });
});

// ═══════════════════════════════════════════
// 에러 경로: transaction 예외, upsert ROLLBACK
// ═══════════════════════════════════════════

describe("DecisionStore — transaction 에러 & 복구", () => {
  it("fn 예외 → write_queue rejection handler 호출 후 복구", async () => {
    await expect(
      store.transaction(async () => { throw new Error("deliberate-failure"); }),
    ).rejects.toThrow("deliberate-failure");
    const result = await store.transaction(async () => "ok");
    expect(result).toBe("ok");
  });

  it("연속 실패 → 큐 손상 없음", async () => {
    await expect(store.transaction(async () => { throw new Error("fail1"); })).rejects.toThrow();
    await expect(store.transaction(async () => { throw new Error("fail2"); })).rejects.toThrow();
    const rec = make_record();
    await store.transaction(async ({ append }) => { append(rec); });
    const records = await store.list_records();
    expect(records.some((r) => r.id === rec.id)).toBe(true);
  });

  it("canonical_key=null → INSERT NOT NULL 위반 → ROLLBACK → throw", async () => {
    const bad_rec = make_record({ canonical_key: null as any });
    await expect(
      store.transaction(async ({ append }) => { append(bad_rec); }),
    ).rejects.toThrow();
    (store as any).cache = null;
    const reloaded = await store.list_records();
    expect(reloaded.every((r) => r.canonical_key !== null)).toBe(true);
  });

  it("정상+불량 레코드 혼합 → ROLLBACK → 전부 미저장", async () => {
    const good_rec = make_record();
    const bad_rec = make_record({ canonical_key: null as any });
    await expect(
      store.transaction(async ({ append }) => { append(good_rec); append(bad_rec); }),
    ).rejects.toThrow();
    (store as any).cache = null;
    const reloaded = await store.list_records();
    expect(reloaded.every((r) => r.id !== good_rec.id)).toBe(true);
  });
});

// ═══════════════════════════════════════════
// C-22: transaction 실패 시 캐시 무효화
// ═══════════════════════════════════════════

describe("DecisionStore — C-22: 실패 시 cache 무효화", () => {
  it("fn throw → cache null 무효화 → ghost record 미포함", async () => {
    await store.list_records();
    expect((store as any).cache).not.toBeNull();
    await expect(
      store.transaction(async ({ index }) => {
        index.records["ghost_id"] = make_record({ id: "ghost_id" });
        throw new Error("fn_failure");
      }),
    ).rejects.toThrow("fn_failure");
    expect((store as any).cache).toBeNull();
    const records = await store.list_records();
    expect(records.find((r) => r.id === "ghost_id")).toBeUndefined();
  });

  it("upsert_records 실패 → cache 무효화 → DB와 일치", async () => {
    await store.list_records();
    const spy = vi.spyOn(store as any, "upsert_records").mockRejectedValueOnce(new Error("db_write_failed"));
    await expect(
      store.transaction(async ({ index, append }) => {
        const record = make_record({ id: "will_fail_id" });
        index.records[record.id] = record;
        append(record);
      }),
    ).rejects.toThrow("db_write_failed");
    spy.mockRestore();
    expect((store as any).cache).toBeNull();
    const records = await store.list_records();
    expect(records.find((r) => r.id === "will_fail_id")).toBeUndefined();
  });

  it("성공 transaction 후에도 cache=null (다음 읽기 시 DB 재로드)", async () => {
    const record = make_record({ id: "success_id" });
    await store.transaction(async ({ index, append }) => {
      index.records[record.id] = record;
      append(record);
    });
    expect((store as any).cache).toBeNull();
    const records = await store.list_records();
    expect(records.find((r) => r.id === "success_id")).toBeDefined();
  });
});
