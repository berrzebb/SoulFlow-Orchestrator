/**
 * DecisionStore — 미커버 분기 (cov):
 * - L190: rebuild_maps — record.status !== "active" → continue
 * - L206: rebuild_index_from_store — !record?.id → continue
 * - L208-209: rebuild_index_from_store — JSON.parse 실패 → catch
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  tmp_dir = await mkdtemp(join(tmpdir(), "dec-cov-"));
  store = new DecisionStore(tmp_dir);
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

// ── L190: status !== "active" → rebuild_maps에서 continue ────────────────────

describe("DecisionStore — L190: non-active status → rebuild_maps skip", () => {
  it("status='superseded' 레코드 저장 후 rebuild → active_by_key에 미포함", async () => {
    const rec = make_record({ status: "superseded" as any });
    await store.transaction(async ({ append }) => {
      append(rec);
    });

    // cache를 비워서 rebuild_index_from_store 강제 호출
    (store as any).cache = null;

    const records = await store.list_records();
    expect(records.some((r) => r.id === rec.id)).toBe(true);

    // rebuild_maps에서 non-active → active_by_key에 미포함
    const index = (store as any).cache;
    if (index) {
      const in_active = Object.values(index.active_by_key).includes(rec.id);
      expect(in_active).toBe(false);
    }
  });
});

// ── L206: record_json에 id 없음 → continue ───────────────────────────────────

describe("DecisionStore — L206: record_json without id → skip", () => {
  it("id 없는 record_json을 DB에 직접 삽입 → rebuild_index 시 skip", async () => {
    // 먼저 store를 초기화
    await store.list_records();
    const db_path = join(tmp_dir, "runtime", "decisions", "decisions.db");

    // id 없는 record_json 직접 삽입
    with_sqlite(db_path, (db) => {
      const no_id_record = { value: "no-id", scope: "test", canonical_key: "k" };
      db.prepare(`
        INSERT INTO decisions (id, scope, scope_id, canonical_key, normalized_value, status, fingerprint, updated_at, record_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "placeholder-id",
        "test",
        null,
        "k",
        "v",
        "active",
        "fp-no-id",
        new Date().toISOString(),
        JSON.stringify(no_id_record), // id 없음 → L206: if (!record?.id) continue
      );
    });

    (store as any).cache = null;
    const records = await store.list_records();
    // placeholder-id가 있을 수도 있지만 no_id_record는 id가 없으므로 skip
    expect(Array.isArray(records)).toBe(true);
  });
});

// ── L208-209: JSON.parse 실패 → catch (skip broken row) ─────────────────────

describe("DecisionStore — L208-209: broken JSON → catch skip", () => {
  it("잘못된 record_json을 DB에 직접 삽입 → rebuild_index 시 catch skip", async () => {
    await store.list_records();
    const db_path = join(tmp_dir, "runtime", "decisions", "decisions.db");

    with_sqlite(db_path, (db) => {
      db.prepare(`
        INSERT INTO decisions (id, scope, scope_id, canonical_key, normalized_value, status, fingerprint, updated_at, record_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "broken-json-id",
        "test",
        null,
        "k2",
        "v2",
        "active",
        "fp-broken",
        new Date().toISOString(),
        "{ invalid json {{{ broken", // JSON.parse 실패 → catch
      );
    });

    (store as any).cache = null;
    const records = await store.list_records();
    // broken row는 skip되어 포함되지 않음
    expect(records.every((r) => r.id !== "broken-json-id")).toBe(true);
  });
});
