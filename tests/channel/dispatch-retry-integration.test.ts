/**
 * DLQ Store + DispatchService DLQ 연동 통합 테스트.
 *
 * Mock이 잡지 못하는 시나리오:
 * 1. DLQ append/list가 실제 SQLite에서 동작
 * 2. 프로세스 재시작 후 DLQ 데이터 복원
 * 3. 동시 append 안전성
 * 4. prune_older_than 실동작
 * 5. DispatchService → DLQ 연동 (retryMax=0)
 * 6. dedupe 실동작
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteDispatchDlqStore, type DispatchDlqRecord } from "@src/channels/dlq-store.js";
import { DispatchService } from "@src/channels/dispatch.service.js";
import type { OutboundMessage } from "@src/bus/types.js";
import { now_iso } from "@src/utils/common.js";

let cleanup_dirs: string[] = [];

const noop_logger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
  child: () => noop_logger,
} as any;

function make_dlq_record(content = "test", provider = "slack"): DispatchDlqRecord {
  return {
    at: now_iso(),
    provider: provider as any,
    chat_id: `C-${Math.random().toString(36).slice(2, 6)}`,
    message_id: `msg-${Date.now()}`,
    sender_id: "bot",
    reply_to: "",
    thread_id: "",
    retry_count: 3,
    error: "rate_limited",
    content,
    metadata: {},
  };
}

function make_outbound(content = "test", chat_id = "C123"): OutboundMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    provider: "slack", channel: "slack",
    sender_id: "bot", chat_id, content,
    at: new Date().toISOString(), metadata: {},
  };
}

function make_bus() {
  return {
    publish_outbound: vi.fn(async () => {}),
    consume_outbound: vi.fn(async () => null),
    publish_inbound: vi.fn(async () => {}),
    consume_inbound: vi.fn(async () => null),
    close: vi.fn(async () => {}),
  };
}

afterEach(async () => {
  for (const d of cleanup_dirs) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
  cleanup_dirs = [];
});

describe("DLQ Store 통합 (실제 SQLite)", () => {
  async function make_store() {
    const dir = await mkdtemp(join(tmpdir(), "dlq-integ-"));
    cleanup_dirs.push(dir);
    return { store: new SqliteDispatchDlqStore(join(dir, "dlq.db")), dir };
  }

  it("append → list CRUD", async () => {
    const { store } = await make_store();
    const record = make_dlq_record("test-crud");
    await store.append(record);

    const items = await store.list(100);
    expect(items).toHaveLength(1);
    expect(items[0].content).toBe("test-crud");
    expect(items[0].provider).toBe("slack");
  });

  it("프로세스 재시작 후 DLQ 데이터 복원", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dlq-restart-"));
    cleanup_dirs.push(dir);
    const dlq_path = join(dir, "dlq.db");

    const store1 = new SqliteDispatchDlqStore(dlq_path);
    await store1.append(make_dlq_record("persisted"));

    const store2 = new SqliteDispatchDlqStore(dlq_path);
    const items = await store2.list(100);
    expect(items).toHaveLength(1);
    expect(items[0].content).toBe("persisted");
  });

  it("동시 append 20건 안전성", async () => {
    const { store } = await make_store();

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.append(make_dlq_record(`concurrent-${i}`)),
      ),
    );

    const items = await store.list(100);
    expect(items).toHaveLength(20);
    const contents = new Set(items.map((i) => i.content));
    for (let i = 0; i < 20; i++) {
      expect(contents.has(`concurrent-${i}`)).toBe(true);
    }
  });

  it("prune_older_than이 오래된 레코드 삭제", async () => {
    const { store } = await make_store();
    await store.append(make_dlq_record("old-record"));
    await store.append(make_dlq_record("another-old"));

    const deleted = await store.prune_older_than(0);
    expect(deleted).toBeGreaterThanOrEqual(2);

    const after = await store.list(100);
    expect(after).toHaveLength(0);
  });

  it("metadata JSON이 정확히 보존", async () => {
    const { store } = await make_store();
    const record = make_dlq_record("meta-test");
    record.metadata = { tool_calls: 5, model: "claude-3", nested: { key: "value" } };
    await store.append(record);

    const items = await store.list(100);
    expect(items[0].metadata).toEqual({ tool_calls: 5, model: "claude-3", nested: { key: "value" } });
  });

  it("특수문자/유니코드 content 보존", async () => {
    const { store } = await make_store();
    const special = "한글 🎉 <script>alert('xss')</script> \"quotes\" 'single'";
    await store.append(make_dlq_record(special));

    const items = await store.list(100);
    expect(items[0].content).toBe(special);
  });
});

describe("DispatchService → DLQ 연동", () => {
  it("retryMax=0 + 발송 실패 → 즉시 DLQ에 기록", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dispatch-dlq-"));
    cleanup_dirs.push(dir);

    const dlq_store = new SqliteDispatchDlqStore(join(dir, "dlq.db"));
    const registry = {
      send: vi.fn(async () => ({ ok: false, error: "rate_limited" })),
      get: vi.fn(() => null),
      list: vi.fn(() => []),
    };

    const service = new DispatchService({
      bus: make_bus() as any,
      registry: registry as any,
      retry_config: {
        inlineRetries: 0,
        retryMax: 0,
        retryBaseMs: 10,
        retryMaxMs: 50,
        retryJitterMs: 0,
        dlqEnabled: true,
        dlqPath: join(dir, "dlq.db"),
      },
      dedupe_config: { ttlMs: 5000, maxSize: 100 },
      grouping_config: { enabled: false, windowMs: 0, maxMessages: 0 },
      dlq_store,
      dedupe_policy: {
        key: (_provider: string, msg: OutboundMessage) => `${msg.chat_id}:${msg.id}`,
      } as any,
      logger: noop_logger,
    });

    const msg = make_outbound("dlq-target");
    await service.send("slack", msg);
    // send()는 낙관적 반환 — 비동기 전송 및 DLQ 기록 완료 대기
    await new Promise((r) => setTimeout(r, 100));

    const items = await dlq_store.list(100);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].content).toContain("dlq-target");
  });

  it("dedupe — 동일 메시지 2회 발송 시 registry.send 1회만", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dispatch-dedupe-"));
    cleanup_dirs.push(dir);

    const dlq_store = new SqliteDispatchDlqStore(join(dir, "dlq.db"));
    const registry = {
      send: vi.fn(async () => ({ ok: true, message_id: "sent-1" })),
      get: vi.fn(() => null),
      list: vi.fn(() => []),
    };

    const service = new DispatchService({
      bus: make_bus() as any,
      registry: registry as any,
      retry_config: {
        inlineRetries: 0,
        retryMax: 0,
        retryBaseMs: 10,
        retryMaxMs: 50,
        retryJitterMs: 0,
        dlqEnabled: true,
        dlqPath: join(dir, "dlq.db"),
      },
      dedupe_config: { ttlMs: 5000, maxSize: 100 },
      grouping_config: { enabled: false, windowMs: 0, maxMessages: 0 },
      dlq_store,
      dedupe_policy: {
        key: (_provider: string, msg: OutboundMessage) => `${msg.chat_id}:${msg.content}`,
      } as any,
      logger: noop_logger,
    });

    const msg = make_outbound("dedupe-test");
    await service.send("slack", msg);
    // 첫 전송 비동기 완료(dedupe 캐시 기록) 대기 후 두 번째 send
    await new Promise((r) => setTimeout(r, 50));
    await service.send("slack", msg);

    expect(registry.send).toHaveBeenCalledTimes(1);
  });
});
