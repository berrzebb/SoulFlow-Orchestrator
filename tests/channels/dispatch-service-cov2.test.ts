/**
 * DispatchService — 미커버 분기 (cov2):
 * - L86: stop() 두 번째 pending_retries clearTimeout 루프 (loop_task 완료 중 추가된 타이머 정리)
 *
 * loop_task를 Promise.resolve().then(...)으로 설정해 await 완료 시점에
 * pending_retries에 타이머를 추가함 → L82-83 첫 번째 정리 후 L86에서 새 타이머 정리.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { DispatchService } from "@src/channels/dispatch.service.js";
import { DefaultOutboundDedupePolicy } from "@src/channels/outbound-dedupe.js";

afterEach(() => { vi.restoreAllMocks(); });

function make_service(): DispatchService {
  return new DispatchService({
    bus: {
      consume_outbound: vi.fn(() => new Promise<null>((r) => setTimeout(() => r(null), 50))),
      publish_outbound: vi.fn().mockResolvedValue(undefined),
    } as any,
    registry: {
      send: vi.fn().mockResolvedValue({ ok: true, message_id: "m1" }),
      has_provider: vi.fn().mockReturnValue(true),
    } as any,
    retry_config: { inlineRetries: 0, retryMax: 0, retryBaseMs: 10, retryMaxMs: 100, retryJitterMs: 0 } as any,
    dedupe_config: { ttlMs: 5000, maxSize: 100 },
    grouping_config: { flushIntervalMs: 50, maxGroupSize: 10, maxWaitMs: 50, debounceMs: 10 },
    dlq_store: null,
    dedupe_policy: new DefaultOutboundDedupePolicy(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
  });
}

// ── L86: loop_task 완료 중 추가된 타이머 정리 ────────────────────────────────

describe("DispatchService — L86: stop() 두 번째 pending_retries 정리", () => {
  it("loop_task 완료 시 pending_retries에 타이머 추가 → L86 clearTimeout 실행", async () => {
    const svc = make_service();
    (svc as any).running = true;

    // loop_task가 resolve될 때 pending_retries에 타이머를 삽입
    // → stop()의 L82-83 첫 번째 정리 이후, L84 await 완료 시점에 타이머가 추가됨
    // → L86 두 번째 루프에서 해당 타이머가 정리됨
    (svc as any).loop_task = Promise.resolve().then(() => {
      const t = setTimeout(() => {}, 99_999);
      (svc as any).pending_retries.add(t);
    });

    await svc.stop();

    // stop() 완료 후 pending_retries가 완전히 비워져야 함 (L87 clear)
    expect((svc as any).pending_retries.size).toBe(0);
  });

  it("loop_task=null이어도 stop() 정상 완료 → L86 빈 set 루프 (예외 없음)", async () => {
    const svc = make_service();
    (svc as any).running = true;
    (svc as any).loop_task = null;

    await svc.stop();

    expect((svc as any).pending_retries.size).toBe(0);
  });
});
