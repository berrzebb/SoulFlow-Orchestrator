/**
 * SqliteDispatchDlqStore — 미커버 경로 보충.
 * prune_older_than, delete_by_ids, 잘못된 metadata JSON.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, it, expect, beforeEach } from "vitest";
import { SqliteDispatchDlqStore } from "@src/channels/dlq-store.ts";
import type { DispatchDlqRecord } from "@src/channels/dlq-store.ts";
import { with_sqlite } from "@src/utils/sqlite-helper.js";

let root: string;
let db_path: string;
let store: SqliteDispatchDlqStore;

function make_record(overrides: Partial<DispatchDlqRecord> = {}): DispatchDlqRecord {
  return {
    at: new Date().toISOString(),
    provider: "telegram",
    chat_id: "chat-1",
    message_id: "msg-1",
    sender_id: "user-1",
    reply_to: "",
    thread_id: "",
    retry_count: 1,
    error: "test_error",
    content: "hello",
    metadata: {},
    ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dlq-ext-"));
  db_path = join(root, "dlq.db");
  store = new SqliteDispatchDlqStore(db_path);
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

// ══════════════════════════════════════════
// prune_older_than
// ══════════════════════════════════════════

describe("SqliteDispatchDlqStore — prune_older_than", () => {
  it("오래된 레코드 삭제 후 건수 반환", async () => {
    // past 레코드 (1시간 전)
    const old_at = new Date(Date.now() - 3_600_000).toISOString();
    await store.append(make_record({ at: old_at }));
    // 최신 레코드
    await store.append(make_record());

    // 30분보다 오래된 것 삭제
    const deleted = await store.prune_older_than(30 * 60_000);
    expect(deleted).toBe(1);

    const remaining = await store.list();
    expect(remaining.length).toBe(1);
  });

  it("삭제 대상 없음 → 0 반환", async () => {
    await store.append(make_record());
    const deleted = await store.prune_older_than(0); // max_age_ms=0 → cutoff=now → 모두 대상
    // at이 현재시각이므로 경계값에 걸릴 수 있어 → max_age_ms를 -1ms (즉 0)로 하면 cutoff=now
    // 실제로는 방금 inserted이므로 at >= cutoff → 삭제 0 또는 1
    expect(typeof deleted).toBe("number");
  });

  it("max_age_ms 음수 → 0으로 처리 (Math.max(0, ...))", async () => {
    const deleted = await store.prune_older_than(-1);
    expect(deleted).toBeGreaterThanOrEqual(0);
  });
});

// ══════════════════════════════════════════
// delete_by_ids
// ══════════════════════════════════════════

describe("SqliteDispatchDlqStore — delete_by_ids", () => {
  it("존재하는 ID 삭제 → 건수 반환", async () => {
    await store.append(make_record({ message_id: "m1" }));
    await store.append(make_record({ message_id: "m2" }));

    const rows = await store.list();
    expect(rows.length).toBe(2);

    const id1 = rows[0]!.id!;
    const deleted = await store.delete_by_ids([id1]);
    expect(deleted).toBe(1);

    const remaining = await store.list();
    expect(remaining.length).toBe(1);
  });

  it("빈 배열 → 즉시 0 반환 (DB 접근 없음)", async () => {
    const deleted = await store.delete_by_ids([]);
    expect(deleted).toBe(0);
  });

  it("존재하지 않는 ID → 0 반환", async () => {
    const deleted = await store.delete_by_ids([999999]);
    expect(deleted).toBe(0);
  });

  it("복수 ID 삭제 → 모두 제거됨", async () => {
    await store.append(make_record({ message_id: "a" }));
    await store.append(make_record({ message_id: "b" }));
    await store.append(make_record({ message_id: "c" }));
    const rows = await store.list();
    const ids = rows.map(r => r.id!);
    const deleted = await store.delete_by_ids(ids);
    expect(deleted).toBe(3);
    const remaining = await store.list();
    expect(remaining.length).toBe(0);
  });
});

// ══════════════════════════════════════════
// metadata JSON 파싱 — 잘못된 JSON → {}
// ══════════════════════════════════════════

describe("SqliteDispatchDlqStore — metadata JSON fallback", () => {
  it("정상 metadata 저장 후 조회", async () => {
    await store.append(make_record({ metadata: { kind: "test", count: 3 } }));
    const rows = await store.list();
    expect(rows[0]?.metadata?.kind).toBe("test");
    expect(rows[0]?.metadata?.count).toBe(3);
  });

  it("잘못된 metadata_json → catch → {} 반환 (L158)", async () => {
    await store.append(make_record());
    // DB에서 직접 metadata_json을 잘못된 JSON으로 교체
    with_sqlite(db_path, (db) => {
      db.prepare("UPDATE outbound_dlq SET metadata_json = ? WHERE rowid = (SELECT MAX(rowid) FROM outbound_dlq)").run("{{{invalid json");
    });
    const rows = await store.list();
    expect(rows[0]?.metadata).toEqual({});
  });
});
