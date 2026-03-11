/**
 * DispatchService — 미커버 분기 보충 (cov3):
 * - L195-197: 레이트 리미터 2회 연속 실패 → rate_limit_exceeded 반환
 * - L216: recent 캐시 오버플로우 → prune_recent_cache(true) 강제 정리
 * - L249: schedule_retry 후 타이머 발화 시 bus.publish_outbound throw → catch 로그
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { DispatchService } from "@src/channels/dispatch.service.js";
import type { OutboundMessage } from "@src/bus/types.js";

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

function make_message(overrides?: Partial<OutboundMessage>): OutboundMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    provider: "slack",
    channel: "slack",
    sender_id: "bot",
    chat_id: "C001",
    content: "hello",
    at: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

function make_deps() {
  const bus = {
    publish_outbound: vi.fn(async () => {}),
    consume_outbound: vi.fn(() => new Promise<null>((r) => setTimeout(() => r(null), 50))),
    publish_inbound: vi.fn(async () => {}),
    consume_inbound: vi.fn(async () => null),
    close: vi.fn(async () => {}),
  };
  const registry = {
    send: vi.fn(async () => ({ ok: true, message_id: "sent-1" })),
    get: vi.fn(() => null),
    list: vi.fn(() => []),
  };
  const dlq_store = {
    append: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    purge: vi.fn(async () => 0),
  };
  const dedupe_policy = {
    key: vi.fn((_: string, msg: OutboundMessage) => msg.id),
  };
  const logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    child: vi.fn(function() { return logger; }),
  };
  return {
    bus, registry, dlq_store, dedupe_policy, logger,
    retry_config: {
      inlineRetries: 0, retryMax: 3, retryBaseMs: 5, retryMaxMs: 100,
      retryJitterMs: 0, dlqEnabled: false, dlqPath: ":memory:",
    },
    dedupe_config: { ttlMs: 5000, maxSize: 5 },
    grouping_config: { enabled: false, windowMs: 0, maxMessages: 0 },
  };
}

function make_service(deps: ReturnType<typeof make_deps>) {
  return new DispatchService({
    bus: deps.bus as any,
    registry: deps.registry as any,
    retry_config: deps.retry_config,
    dedupe_config: deps.dedupe_config as any,
    grouping_config: deps.grouping_config as any,
    dlq_store: deps.dlq_store as any,
    dedupe_policy: deps.dedupe_policy as any,
    logger: deps.logger as any,
  });
}

// ── L195-197: 레이트 리미터 2회 연속 실패 → rate_limit_exceeded ───────────────

describe("DispatchService — L195-197: double rate limit exceeded", () => {
  it("try_consume 2회 모두 false → L195-197 rate_limit_exceeded 반환", async () => {
    const deps = make_deps();
    const service = make_service(deps);

    // rate_limiter를 mock으로 교체 (always deny)
    (service as any).rate_limiter = {
      try_consume: vi.fn().mockReturnValue(false),
      wait_time_ms: vi.fn().mockReturnValue(0),  // sleep(0) → 즉시 반환
    };

    // send_with_retry 직접 호출 (private → as any)
    const result = await (service as any).send_with_retry("slack", make_message(), false);

    // L197: { ok: false, error: "rate_limit_exceeded" }
    expect(result.ok).toBe(false);
    expect(result.error).toBe("rate_limit_exceeded");
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "rate limit still exceeded after wait",
      expect.objectContaining({ provider: "slack" }),
    );
  });
});

// ── L216: recent 캐시 오버플로우 → prune_recent_cache(true) ──────────────────

describe("DispatchService — L216: 캐시 오버플로우 시 강제 prune", () => {
  it("recent.size > maxSize+500 이면 L216 prune_recent_cache(true) 실행", async () => {
    const deps = make_deps();
    deps.dedupe_config = { ttlMs: 1000, maxSize: 1 };  // threshold = 1 + 500 = 501
    deps.registry.send = vi.fn(async () => ({ ok: true, message_id: "m1" }));
    const service = make_service(deps);

    // recent 캐시를 임계값 초과로 미리 채움 (502 entries → 503 after send > 501)
    const recent: Map<string, unknown> = (service as any).recent;
    for (let i = 0; i < 502; i++) {
      recent.set(`pre_key_${i}`, { at_ms: Date.now(), message_id: `p${i}` });
    }

    // 새 고유 키로 메시지 전송 → recent.set → size = 503 > 501 → L216 prune(true)
    const msg = make_message({ id: "unique-overflow-id" });
    await (service as any).send_with_retry("slack", msg, false);

    // 강제 prune 후 recent.size가 줄어있어야 함 (maxSize 기준으로 정리)
    expect(recent.size).toBeLessThan(503);
  });
});

// ── L249: schedule_retry → 타이머 발화 → bus.publish_outbound throw → catch ──

describe("DispatchService — L249: retry timer 발화 시 publish_outbound throw → catch 로그", () => {
  it("schedule_retry 후 bus.publish_outbound 실패 → L249 logger.debug('retry publish failed')", async () => {
    vi.useFakeTimers();

    const deps = make_deps();
    // consume_outbound는 즉시 null 반환 (fake timer 무한루프 방지)
    deps.bus.consume_outbound = vi.fn(async () => null);
    deps.registry.send = vi.fn(async () => ({ ok: false, error: "server_error" }));
    deps.bus.publish_outbound = vi.fn().mockRejectedValue(new Error("bus publish failed"));
    const service = make_service(deps);

    // running=true 수동 설정 (consume_loop 없이 schedule_retry 동작)
    (service as any).running = true;

    // 전송 실패(retriable) + allow_requeue=true → schedule_retry() → setTimeout 등록
    const msg = make_message();
    await (service as any).send_with_retry("slack", msg, true);

    // 타이머 발화 → bus.publish_outbound throws → L249 catch(logger.debug)
    await vi.runAllTimersAsync();

    expect(deps.logger.debug).toHaveBeenCalledWith(
      "retry publish failed",
      expect.objectContaining({ error: expect.stringContaining("bus publish failed") }),
    );
  });
});
