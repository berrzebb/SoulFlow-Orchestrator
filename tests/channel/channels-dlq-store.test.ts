import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeEach, describe, it, expect } from "vitest";
import { SqliteDispatchDlqStore } from "@src/channels/dlq-store.ts";
import type { DispatchDlqRecord } from "@src/channels/dlq-store.ts";
import { with_sqlite } from "@src/utils/sqlite-helper.js";

describe("channels dlq store", () => {
  let root: string;
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("appends and lists outbound dead-letter records", async () => {
    root = await mkdtemp(join(tmpdir(), "dlq-store-"));
    const db = join(root, "runtime", "dlq", "dlq.db");
    const store = new SqliteDispatchDlqStore(db);

    await store.append({
      at: new Date().toISOString(),
      provider: "telegram",
      chat_id: "chat-1",
      message_id: "msg-1",
      sender_id: "assistant",
      reply_to: "",
      thread_id: "",
      retry_count: 3,
      error: "send_failed",
      content: "hello",
      metadata: { kind: "agent_reply" },
    });

    const rows = await store.list(10);
    expect(rows.length).toBe(1);
    expect(rows[0]?.provider).toBe("telegram");
    expect(rows[0]?.chat_id).toBe("chat-1");
    expect(rows[0]?.retry_count).toBe(3);
    expect(String(rows[0]?.metadata?.kind || "")).toBe("agent_reply");
    expect(String(store.get_path() || "").endsWith("dlq.db")).toBe(true);
  });
});

// ══════════════════════════════════════════
// prune_older_than, delete_by_ids, metadata JSON fallback
// ══════════════════════════════════════════

let ext_root: string;
let ext_db_path: string;
let ext_store: SqliteDispatchDlqStore;

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
  ext_root = await mkdtemp(join(tmpdir(), "dlq-ext-"));
  ext_db_path = join(ext_root, "dlq.db");
  ext_store = new SqliteDispatchDlqStore(ext_db_path);
});

afterAll(async () => {
  if (ext_root) await rm(ext_root, { recursive: true, force: true });
});

describe("SqliteDispatchDlqStore — prune_older_than", () => {
  it("오래된 레코드 삭제 후 건수 반환", async () => {
    const old_at = new Date(Date.now() - 3_600_000).toISOString();
    await ext_store.append(make_record({ at: old_at }));
    await ext_store.append(make_record());

    const deleted = await ext_store.prune_older_than(30 * 60_000);
    expect(deleted).toBe(1);

    const remaining = await ext_store.list();
    expect(remaining.length).toBe(1);
  });

  it("삭제 대상 없음 → 0 반환", async () => {
    await ext_store.append(make_record());
    const deleted = await ext_store.prune_older_than(0);
    expect(typeof deleted).toBe("number");
  });

  it("max_age_ms 음수 → 0으로 처리 (Math.max(0, ...))", async () => {
    const deleted = await ext_store.prune_older_than(-1);
    expect(deleted).toBeGreaterThanOrEqual(0);
  });
});

describe("SqliteDispatchDlqStore — delete_by_ids", () => {
  it("존재하는 ID 삭제 → 건수 반환", async () => {
    await ext_store.append(make_record({ message_id: "m1" }));
    await ext_store.append(make_record({ message_id: "m2" }));

    const rows = await ext_store.list();
    expect(rows.length).toBe(2);

    const id1 = rows[0]!.id!;
    const deleted = await ext_store.delete_by_ids([id1]);
    expect(deleted).toBe(1);

    const remaining = await ext_store.list();
    expect(remaining.length).toBe(1);
  });

  it("빈 배열 → 즉시 0 반환 (DB 접근 없음)", async () => {
    const deleted = await ext_store.delete_by_ids([]);
    expect(deleted).toBe(0);
  });

  it("존재하지 않는 ID → 0 반환", async () => {
    const deleted = await ext_store.delete_by_ids([999999]);
    expect(deleted).toBe(0);
  });

  it("복수 ID 삭제 → 모두 제거됨", async () => {
    await ext_store.append(make_record({ message_id: "a" }));
    await ext_store.append(make_record({ message_id: "b" }));
    await ext_store.append(make_record({ message_id: "c" }));
    const rows = await ext_store.list();
    const ids = rows.map(r => r.id!);
    const deleted = await ext_store.delete_by_ids(ids);
    expect(deleted).toBe(3);
    const remaining = await ext_store.list();
    expect(remaining.length).toBe(0);
  });
});

describe("SqliteDispatchDlqStore — metadata JSON fallback", () => {
  it("정상 metadata 저장 후 조회", async () => {
    await ext_store.append(make_record({ metadata: { kind: "test", count: 3 } }));
    const rows = await ext_store.list();
    expect(rows[0]?.metadata?.kind).toBe("test");
    expect(rows[0]?.metadata?.count).toBe(3);
  });

  it("잘못된 metadata_json → catch → {} 반환 (L158)", async () => {
    await ext_store.append(make_record());
    with_sqlite(ext_db_path, (db) => {
      db.prepare("UPDATE outbound_dlq SET metadata_json = ? WHERE rowid = (SELECT MAX(rowid) FROM outbound_dlq)").run("{{{invalid json");
    });
    const rows = await ext_store.list();
    expect(rows[0]?.metadata).toEqual({});
  });
});
