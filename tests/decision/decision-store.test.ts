/**
 * DecisionStore — transaction/list_records/upsert_records 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DecisionStore } from "../../src/decision/store.js";
import type { DecisionRecord } from "../../src/decision/types.js";
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
    key: "deploy.strategy",
    canonical_key: "deploy.strategy",
    value: "blue-green",
    normalized_value: "blue-green",
    rationale: "무중단 배포",
    priority: 1,
    status: "active",
    source: "user",
    tags: ["deploy"],
    fingerprint: `fp-${id}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("DecisionStore", () => {
  let tmp_dir: string;
  let store: DecisionStore;

  beforeEach(async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "decision-store-test-"));
    store = new DecisionStore(tmp_dir);
  });

  afterEach(async () => {
    await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
  });

  // ── 기본 CRUD ──

  it("list_records: 초기 상태 → 빈 배열", async () => {
    const records = await store.list_records();
    expect(records).toEqual([]);
  });

  it("transaction: 단일 레코드 삽입 후 list_records 조회", async () => {
    const rec = make_record();
    await store.transaction(async ({ append }) => {
      append(rec);
    });
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

  // ── index / key_ref ──

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

    // 두 번째 트랜잭션에서 이미 저장된 레코드가 index에 있어야 함
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
      const key = `global::key.x`;
      expect(index.active_by_key[key]).toBe(rec.id);
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

  // ── list_records 정렬 ──

  it("list_records: updated_at 내림차순 정렬", async () => {
    const old_time = "2024-01-01T00:00:00.000Z";
    const new_time = "2025-01-01T00:00:00.000Z";
    const r1 = make_record({ id: "id-1", updated_at: old_time, created_at: old_time });
    const r2 = make_record({ id: "id-2", updated_at: new_time, created_at: new_time });
    await store.transaction(async ({ append }) => {
      append(r1);
      append(r2);
    });
    const records = await store.list_records();
    expect(records[0].id).toBe("id-2"); // newest first
    expect(records[1].id).toBe("id-1");
  });

  // ── 반환값 ──

  it("transaction: 반환값 전달 가능", async () => {
    const result = await store.transaction(async () => "hello");
    expect(result).toBe("hello");
  });

  // ── 동시성 ──

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
