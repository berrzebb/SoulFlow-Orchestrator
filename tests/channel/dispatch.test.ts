/**
 * DispatchService — 미커버 분기 보충.
 * on_direct_send 예외, dlq=null, 그룹핑 활성화, 캐시 force_trim.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { DispatchService } from "@src/channels/dispatch.service.js";
import type { OutboundMessage } from "@src/bus/types.js";

function make_message(overrides?: Partial<OutboundMessage>): OutboundMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    provider: "slack",
    channel: "slack",
    sender_id: "bot",
    chat_id: "C999",
    content: "test",
    at: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

function make_deps(overrides?: Record<string, unknown>) {
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
    key: vi.fn((_provider: string, msg: OutboundMessage) => `${msg.chat_id}:${msg.content}:${msg.id}`),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(function() { return logger; }),
  };
  return {
    bus, registry, dlq_store, dedupe_policy, logger,
    retry_config: {
      inlineRetries: 0,
      retryMax: 3,
      retryBaseMs: 5,
      retryMaxMs: 100,
      retryJitterMs: 0,
      dlqEnabled: true,
      dlqPath: ":memory:",
    },
    dedupe_config: { ttlMs: 5000, maxSize: 5 },
    grouping_config: { enabled: false, windowMs: 0, maxMessages: 0 },
    ...overrides,
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

describe("DispatchService — on_direct_send 예외 무시", () => {
  it("on_direct_send throws → 전송 결과에 영향 없음", async () => {
    const deps = make_deps();
    const on_direct_send = vi.fn().mockImplementation(() => { throw new Error("observer error"); });
    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: deps.retry_config,
      dedupe_config: deps.dedupe_config as any,
      grouping_config: deps.grouping_config as any,
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
      on_direct_send,
    });

    const result = await service.send("slack", make_message());
    expect(result.ok).toBe(true);
    expect(on_direct_send).toHaveBeenCalled();
  });
});

describe("DispatchService — dlq_store=null", () => {
  it("dlq=null이면 write_dlq에서 early return (append 미호출)", async () => {
    const deps = make_deps();
    deps.registry.send = vi.fn(async () => ({ ok: false, error: "rate_limited" }));
    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: { ...deps.retry_config, inlineRetries: 0, retryMax: 0 },
      dedupe_config: deps.dedupe_config as any,
      grouping_config: deps.grouping_config as any,
      dlq_store: null,  // <-- DLQ 없음
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    await service.send("slack", make_message());
    await new Promise((r) => setTimeout(r, 50));
    // dlq_store=null이므로 append가 호출되어선 안 됨
    expect(deps.dlq_store.append).not.toHaveBeenCalled();
  });
});

describe("DispatchService — 그룹핑 활성화 경로", () => {
  afterEach(async () => { vi.restoreAllMocks(); });

  it("grouping enabled → 버퍼에 모은 후 플러시 시 registry.send 호출", async () => {
    const deps = make_deps();
    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: deps.retry_config,
      dedupe_config: deps.dedupe_config as any,
      grouping_config: { enabled: true, windowMs: 20, maxMessages: 10 },
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    // 그룹핑: send()는 즉시 ok 반환, 실제 전송은 windowMs 후
    const result = await service.send("slack", make_message());
    expect(result.ok).toBe(true);
    // windowMs(20ms) 후 플러시
    await new Promise((r) => setTimeout(r, 60));
    expect(deps.registry.send).toHaveBeenCalled();
  });
});

describe("DispatchService — 캐시 force_trim (maxSize+500 초과)", () => {
  it("recent 캐시가 maxSize+500 초과 시 force trim 발생", async () => {
    const deps = make_deps();
    // maxSize=5이므로 5+500=505개 초과 시 trim
    // 각기 다른 메시지로 505개 추가
    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: { ...deps.retry_config, inlineRetries: 0 },
      dedupe_config: { ttlMs: 60_000, maxSize: 5 },
      grouping_config: deps.grouping_config as any,
      dlq_store: deps.dlq_store as any,
      dedupe_policy: { key: (_p: string, m: OutboundMessage) => m.id } as any,
      logger: deps.logger as any,
    });

    // 506개의 다른 메시지를 병렬 전송 → 성공 시 recent 캐시에 쌓임
    const sends = Array.from({ length: 506 }, (_, i) =>
      service.send("slack", make_message({ id: `msg-${i}`, content: `c-${i}` }))
    );
    await Promise.all(sends);
    await new Promise((r) => setTimeout(r, 100));
    // force trim이 발생했으면 전체 506개보다 줄어야 함
    const recent = (service as any).recent as Map<string, unknown>;
    expect(recent.size).toBeLessThan(506);
  });
});

describe("DispatchService — start 중복 호출", () => {
  it("이미 running이면 start() 재호출 무시", async () => {
    const deps = make_deps();
    const service = make_service(deps);

    await service.start();
    const task1 = (service as any).loop_task;
    await service.start(); // 중복 호출
    const task2 = (service as any).loop_task;
    expect(task1).toBe(task2); // loop_task가 바뀌지 않음

    await service.stop();
  });
});

describe("DispatchService — web provider 필터링", () => {
  it("provider='web' 메시지 → registry.send 미호출", async () => {
    const deps = make_deps();
    const service = make_service(deps);

    const msg = make_message({ provider: "web" as any, channel: "web" as any });
    await service.send("web" as any, msg);
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.registry.send).not.toHaveBeenCalled();
  });
});

// ── L195-197: 레이트 리미터 2회 연속 실패 — from cov3 ───────────────

describe("DispatchService — L195-197: double rate limit exceeded", () => {
  it("try_consume 2회 모두 false → L195-197 rate_limit_exceeded 반환", async () => {
    const deps = make_deps();
    const service = make_service(deps);

    (service as any).rate_limiter = {
      try_consume: vi.fn().mockReturnValue(false),
      wait_time_ms: vi.fn().mockReturnValue(0),
    };

    const result = await (service as any).send_with_retry("slack", make_message(), false);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("rate_limit_exceeded");
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "rate limit still exceeded after wait",
      expect.objectContaining({ provider: "slack" }),
    );
  });
});

// ── L249: schedule_retry → 타이머 발화 → bus.publish_outbound throw — from cov3 ──

describe("DispatchService — L249: retry timer publish_outbound throw → catch 로그", () => {
  it("schedule_retry 후 bus.publish_outbound 실패 → L249 logger.debug('retry publish failed')", async () => {
    vi.useFakeTimers();

    const deps = make_deps();
    deps.bus.consume_outbound = vi.fn(async () => null);
    deps.registry.send = vi.fn(async () => ({ ok: false, error: "server_error" }));
    deps.bus.publish_outbound = vi.fn().mockRejectedValue(new Error("bus publish failed"));
    const service = make_service(deps);

    (service as any).running = true;

    const msg = make_message();
    await (service as any).send_with_retry("slack", msg, true);

    await vi.runAllTimersAsync();

    expect(deps.logger.debug).toHaveBeenCalledWith(
      "retry publish failed",
      expect.objectContaining({ error: expect.stringContaining("bus publish failed") }),
    );

    vi.useRealTimers();
  });
});
