/**
 * DecisionStore — 미커버 분기 (cov2):
 * - L138: write_queue.then rejection handler (두 번째 lambda) — job 실패 시 호출
 * - L175-176: upsert_records ROLLBACK — INSERT 실패 시 catch → ROLLBACK
 * - L180: throw error after ROLLBACK (with_sqlite가 삼킴)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  tmp_dir = await mkdtemp(join(tmpdir(), "dec-cov2-"));
  store = new DecisionStore(tmp_dir);
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

// ── L138: write_queue rejection handler — transaction fn 예외 시 ───────────────

describe("DecisionStore — L138: transaction 실패 → write_queue rejection handler", () => {
  it("fn 예외 → run 거부 → 두 번째 lambda (rejection handler) 호출", async () => {
    // transaction이 실패하면 enqueue_write의 run이 reject됨
    // → run.then(() => undefined, () => undefined) 두 번째 lambda 호출 → L138 커버
    await expect(
      store.transaction(async () => {
        throw new Error("deliberate-failure");
      }),
    ).rejects.toThrow("deliberate-failure");

    // 다음 transaction은 정상 동작해야 함 (write_queue가 복구됨)
    const result = await store.transaction(async () => "ok");
    expect(result).toBe("ok");
  });

  it("연속 실패 → 큐가 손상되지 않음", async () => {
    await expect(
      store.transaction(async () => { throw new Error("fail1"); }),
    ).rejects.toThrow();
    await expect(
      store.transaction(async () => { throw new Error("fail2"); }),
    ).rejects.toThrow();

    // 이후에도 정상 동작
    const rec = make_record();
    await store.transaction(async ({ append }) => { append(rec); });
    const records = await store.list_records();
    expect(records.some((r) => r.id === rec.id)).toBe(true);
  });
});

// ── L175-176, L180: upsert_records ROLLBACK — id=null → NOT NULL 위반 ─────────

describe("DecisionStore — L175-176/L180: upsert_records ROLLBACK", () => {
  it("canonical_key=null 레코드 append → INSERT NOT NULL 위반 → ROLLBACK L175-176 → with_sqlite가 에러 삼킴", async () => {
    // canonical_key TEXT NOT NULL 위반 → catch (L175): ROLLBACK (L176) → throw (L180)
    // → with_sqlite 외부 catch가 삼키므로 transaction 자체는 resolve됨
    const bad_rec = make_record({ canonical_key: null as any });
    await store.transaction(async ({ append }) => {
      append(bad_rec);
    });
    // upsert 실패 → ROLLBACK → DB에 레코드 없음
    (store as any).cache = null;
    const reloaded = await store.list_records();
    expect(reloaded.every((r) => r.canonical_key !== null)).toBe(true);
  });

  it("정상 레코드 + canonical_key=null 레코드 혼합 → ROLLBACK → 정상 레코드도 미저장", async () => {
    const good_rec = make_record();
    const bad_rec = make_record({ canonical_key: null as any });

    await store.transaction(async ({ append }) => {
      append(good_rec);
      append(bad_rec); // NOT NULL 위반 → 전체 ROLLBACK (good_rec도 롤백)
    });

    // ROLLBACK으로 good_rec도 DB에 없어야 함
    (store as any).cache = null;
    const reloaded = await store.list_records();
    expect(reloaded.every((r) => r.id !== good_rec.id)).toBe(true);
  });
});
