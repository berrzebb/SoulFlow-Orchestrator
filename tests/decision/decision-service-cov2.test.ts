/**
 * DecisionService — dedupe_decisions 내부 루프 (L201-211) 커버리지.
 *
 * 정상 API로는 동일 key_ref에 2개 이상 active 레코드가 만들어지지 않으므로,
 * DB에 직접 삽입하여 불일치 상태를 재현한 뒤 dedupe가 정리하는지 검증한다.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { DecisionService } from "@src/decision/service.js";

let tmp_dir: string;
let svc: DecisionService;

beforeEach(async () => {
  tmp_dir = await mkdtemp(join(tmpdir(), "decision-ded-"));
  svc = new DecisionService(tmp_dir);
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

function insert_raw_active(db_path: string, record: {
  id: string;
  scope: string;
  scope_id: string | null;
  canonical_key: string;
  normalized_value: string;
  fingerprint: string;
  updated_at: string;
  record_json: string;
}): void {
  const db = new Database(db_path);
  try {
    db.prepare(`
      INSERT INTO decisions (id, scope, scope_id, canonical_key, normalized_value, status, fingerprint, updated_at, record_json)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      record.id, record.scope, record.scope_id, record.canonical_key,
      record.normalized_value, record.fingerprint, record.updated_at, record.record_json,
    );
  } finally {
    db.close();
  }
}

describe("dedupe_decisions 내부 루프", () => {
  it("동일 key_ref에 active 2개 → 오래된 것 superseded, removed=1", async () => {
    // 정상 API로 1개 삽입 → DB 스키마 초기화 + 레코드 1개
    const r1 = await svc.append_decision({
      scope: "global", key: "dup_key", value: "first value content",
    });
    expect(r1.action).toBe("inserted");

    // DB에 직접 같은 key_ref의 active 레코드 삽입 (불일치 상태 조성)
    const now = new Date().toISOString();
    const fake_record = {
      id: "fake-dup-001",
      scope: "global" as const,
      scope_id: null,
      key: "dup_key",
      canonical_key: "dup_key",
      value: "second value content",
      normalized_value: "second value content",
      rationale: null,
      priority: 1 as const,
      status: "active" as const,
      source: "system" as const,
      tags: [] as string[],
      supersedes_id: null,
      fingerprint: "fake-fp-different-from-real",
      created_at: now,
      updated_at: now,
    };
    insert_raw_active(svc.store.sqlite_path, {
      id: fake_record.id,
      scope: fake_record.scope,
      scope_id: fake_record.scope_id,
      canonical_key: fake_record.canonical_key,
      normalized_value: fake_record.normalized_value,
      fingerprint: fake_record.fingerprint,
      updated_at: fake_record.updated_at,
      record_json: JSON.stringify(fake_record),
    });

    // 캐시 무효화를 위해 새 서비스 인스턴스 생성
    const svc2 = new DecisionService(tmp_dir);

    const result = await svc2.dedupe_decisions();
    expect(result.removed).toBe(1);
    expect(result.active).toBe(1);

    // superseded된 레코드 확인
    const all = await svc2.list_decisions();
    const superseded = all.filter((r) => r.status === "superseded");
    expect(superseded.length).toBeGreaterThanOrEqual(1);
  });

  it("동일 key_ref에 active 3개 → 최신 1개만 유지, removed=2", async () => {
    // 정상 API로 1개 삽입
    await svc.append_decision({
      scope: "team", scope_id: "t1", key: "style", value: "formal writing",
    });

    const base_time = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 2; i++) {
      const t = new Date(base_time.getTime() + i * 60_000).toISOString();
      const rec = {
        id: `dup-extra-${i}`,
        scope: "team" as const,
        scope_id: "t1",
        key: "style",
        canonical_key: "style",
        value: `extra style ${i}`,
        normalized_value: `extra style ${i}`,
        rationale: null,
        priority: 1 as const,
        status: "active" as const,
        source: "system" as const,
        tags: [] as string[],
        supersedes_id: null,
        fingerprint: `dup-fp-${i}`,
        created_at: t,
        updated_at: t,
      };
      insert_raw_active(svc.store.sqlite_path, {
        id: rec.id,
        scope: rec.scope,
        scope_id: rec.scope_id,
        canonical_key: rec.canonical_key,
        normalized_value: rec.normalized_value,
        fingerprint: rec.fingerprint,
        updated_at: rec.updated_at,
        record_json: JSON.stringify(rec),
      });
    }

    const svc2 = new DecisionService(tmp_dir);
    const result = await svc2.dedupe_decisions();
    expect(result.removed).toBe(2);
    expect(result.active).toBe(1);
  });
});
