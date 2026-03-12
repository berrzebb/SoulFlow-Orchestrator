import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DispatchService, parse_retry_after_ms } from "@src/channels/dispatch.service.js";
import type { OutboundMessage } from "@src/bus/types.js";

function make_message(overrides?: Partial<OutboundMessage>): OutboundMessage {
  return {
    id: `msg-${Date.now()}`,
    provider: "slack",
    channel: "slack",
    sender_id: "bot",
    chat_id: "C123",
    content: "test message",
    at: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

function make_deps(overrides?: any) {
  const bus = {
    publish_outbound: vi.fn(async () => {}),
    consume_outbound: vi.fn(async () => null),
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
    key: vi.fn((provider: string, msg: OutboundMessage) => `${provider}:${msg.chat_id}:${msg.content}`),
  };

  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger),
  };

  return {
    bus,
    registry,
    dlq_store,
    dedupe_policy,
    logger,
    retry_config: {
      inlineRetries: 2,
      retryMax: 3,
      retryBaseMs: 10,
      retryMaxMs: 100,
      retryJitterMs: 0,
      dlqEnabled: true,
      dlqPath: ":memory:",
    },
    dedupe_config: {
      ttlMs: 5000,
      maxSize: 100,
    },
    grouping_config: {
      enabled: false,
      windowMs: 0,
      maxMessages: 0,
    },
    ...overrides,
  };
}

// ── parse_retry_after_ms ────────────────────────────────────────────────────
describe("parse_retry_after_ms", () => {
  it("Telegram 형식 — 'Too Many Requests: retry after 30' → 30000ms", () => {
    expect(parse_retry_after_ms("Too Many Requests: retry after 30")).toBe(30_000);
  });
  it("소수점 — 'retry after 1.5' → 1500ms (올림)", () => {
    expect(parse_retry_after_ms("retry after 1.5")).toBe(1500);
  });
  it("Discord 형식 — 'retry_after: 2' → 2000ms", () => {
    expect(parse_retry_after_ms("retry_after: 2")).toBe(2000);
  });
  it("retry after 없는 일반 에러 → null", () => {
    expect(parse_retry_after_ms("rate_limited")).toBeNull();
    expect(parse_retry_after_ms("channel_not_found")).toBeNull();
    expect(parse_retry_after_ms("")).toBeNull();
  });
  it("0이나 음수 → null", () => {
    expect(parse_retry_after_ms("retry after 0")).toBeNull();
  });
});

describe("DispatchService", () => {
  it("sends successfully on first attempt", async () => {
    const deps = make_deps();
    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: deps.retry_config,
      dedupe_config: deps.dedupe_config,
      grouping_config: deps.grouping_config,
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    const result = await service.send("slack", make_message());
    expect(result.ok).toBe(true);
    expect(deps.registry.send).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error and succeeds", async () => {
    const deps = make_deps();
    let attempt = 0;
    deps.registry.send.mockImplementation(async () => {
      attempt++;
      if (attempt < 3) return { ok: false, error: "rate_limited" };
      return { ok: true, message_id: "sent-ok" };
    });

    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: deps.retry_config,
      dedupe_config: deps.dedupe_config,
      grouping_config: deps.grouping_config,
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    await service.send("slack", make_message());
    // send()는 낙관적 ok 반환 — 실제 전송은 비동기, retry 지연 대기
    await new Promise((r) => setTimeout(r, 100));
    expect(deps.registry.send).toHaveBeenCalledTimes(3);
  });

  it("fails immediately on non-retryable error", async () => {
    const deps = make_deps();
    deps.registry.send.mockImplementation(async () => ({
      ok: false,
      error: "invalid_auth",
    }));

    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: deps.retry_config,
      dedupe_config: deps.dedupe_config,
      grouping_config: deps.grouping_config,
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    await service.send("slack", make_message());
    // send()는 낙관적 ok — 실제 전송은 비동기
    await new Promise((r) => setTimeout(r, 20));
    // non-retryable: registry.send 1회만 호출
    expect(deps.registry.send).toHaveBeenCalledTimes(1);
  });

  it("fails immediately on channel_not_found", async () => {
    const deps = make_deps();
    deps.registry.send.mockImplementation(async () => ({
      ok: false,
      error: "channel_not_found",
    }));

    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: deps.retry_config,
      dedupe_config: deps.dedupe_config,
      grouping_config: deps.grouping_config,
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    await service.send("slack", make_message());
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.registry.send).toHaveBeenCalledTimes(1);
  });

  it("deduplicates identical sends within TTL", async () => {
    const deps = make_deps();
    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: deps.retry_config,
      dedupe_config: deps.dedupe_config,
      grouping_config: deps.grouping_config,
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    const msg = make_message({ content: "dedupe test" });
    const r1 = await service.send("slack", msg);
    const r2 = await service.send("slack", msg);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Registry.send should only be called once due to dedup
    expect(deps.registry.send).toHaveBeenCalledTimes(1);
  });

  it("health_check reports running state", async () => {
    const deps = make_deps();
    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: deps.retry_config,
      dedupe_config: deps.dedupe_config,
      grouping_config: deps.grouping_config,
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    // Before start
    expect(service.health_check().ok).toBe(false);

    await service.start();
    expect(service.health_check().ok).toBe(true);

    await service.stop();
    expect(service.health_check().ok).toBe(false);
  });

  it("on_direct_send 콜백이 성공 발송 후 호출됨", async () => {
    const deps = make_deps();
    const on_direct_send = vi.fn();
    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: deps.retry_config,
      dedupe_config: deps.dedupe_config,
      grouping_config: deps.grouping_config,
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
      on_direct_send,
    });

    await service.send("slack", make_message());
    expect(on_direct_send).toHaveBeenCalledOnce();
  });

  it("전체 inline 재시도 실패 (retryable) → schedule_retry 호출 (bus.publish_outbound 타이머 후 발행)", async () => {
    const deps = make_deps();
    // 모든 inline 재시도 실패
    deps.registry.send.mockResolvedValue({ ok: false, error: "rate_limited" });
    // consume_outbound: 루프 스핀 방지용 slow-null
    const slow_null = () => new Promise<null>((r) => setTimeout(() => r(null), 50));
    deps.bus.consume_outbound.mockImplementation(slow_null);

    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: { ...deps.retry_config, retryBaseMs: 5, retryJitterMs: 0 },
      dedupe_config: deps.dedupe_config,
      grouping_config: deps.grouping_config,
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    // schedule_retry가 this.running을 확인하므로 서비스 먼저 시작
    await service.start();

    // send()는 낙관적 ok — schedule_retry는 비동기로 발생
    await service.send("slack", make_message());
    // inline retry 지연(5ms × 2) + schedule_retry 타이머(5ms) 대기
    await new Promise((r) => setTimeout(r, 100));
    expect(deps.bus.publish_outbound).toHaveBeenCalled();

    await service.stop();
  });

  it("dlq.append 실패 → logger.error 호출 (write_dlq catch 경로)", async () => {
    const deps = make_deps();
    deps.dlq_store.append.mockRejectedValue(new Error("db write failed"));
    deps.registry.send.mockResolvedValue({ ok: false, error: "rate_limited" });

    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: { ...deps.retry_config, inlineRetries: 0, retryMax: 0 },
      dedupe_config: deps.dedupe_config,
      grouping_config: deps.grouping_config,
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    await service.send("slack", make_message());
    // 비동기 전송 완료 대기
    await new Promise((r) => setTimeout(r, 50));
    expect(deps.logger.error).toHaveBeenCalledWith("dlq_append_failed", expect.any(Object));
  });
});

describe("DispatchService — consume_loop_leased (ReliableMessageBus 경로)", () => {
  let service: DispatchService;
  const services: DispatchService[] = [];

  afterEach(async () => {
    for (const s of services) {
      try { await s.stop(); } catch { /* ignore */ }
    }
    services.length = 0;
  });

  function make_reliable_bus(lease_value: OutboundMessage | null) {
    const lease = lease_value
      ? { value: lease_value, ack: vi.fn().mockResolvedValue(undefined) }
      : null;
    // 두 번째 호출부터는 50ms 대기 후 null 반환 (루프 스핀 방지)
    const slow_null = () => new Promise<null>((r) => setTimeout(() => r(null), 50));
    return {
      publish_outbound: vi.fn(async () => {}),
      consume_outbound: vi.fn(async () => null),
      publish_inbound: vi.fn(async () => {}),
      consume_inbound: vi.fn(async () => null),
      consume_outbound_lease: vi.fn()
        .mockResolvedValueOnce(lease)
        .mockImplementation(slow_null),
      _lease: lease,
    };
  }

  function make_service(bus: any, registry_impl?: any, dlq?: any) {
    const deps = make_deps();
    const s = new DispatchService({
      bus,
      registry: registry_impl ?? (deps.registry as any),
      retry_config: { ...deps.retry_config, retryBaseMs: 5, retryJitterMs: 0 },
      dedupe_config: deps.dedupe_config,
      dlq_store: dlq ?? (deps.dlq_store as any),
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });
    services.push(s);
    return s;
  }

  it("lease = null → 즉시 반환 (no send)", async () => {
    const bus = make_reliable_bus(null);
    const registry = { send: vi.fn(async () => ({ ok: true, message_id: "x" })), get: vi.fn(), list: vi.fn(() => []) };
    service = make_service(bus, registry);

    await service.start();
    await new Promise((r) => setTimeout(r, 30));
    await service.stop();

    expect(registry.send).not.toHaveBeenCalled();
  });

  it("provider 없는 메시지 → lease.ack() 즉시 (send 미호출)", async () => {
    const msg = make_message({ provider: undefined as any, channel: undefined as any });
    const bus = make_reliable_bus(msg);
    const registry = { send: vi.fn(async () => ({ ok: true, message_id: "x" })), get: vi.fn(), list: vi.fn(() => []) };
    service = make_service(bus, registry);

    await service.start();
    await new Promise((r) => setTimeout(r, 30));
    await service.stop();

    expect(registry.send).not.toHaveBeenCalled();
    expect(bus._lease!.ack).toHaveBeenCalled();
  });

  it("성공 발송 → lease.ack() 호출", async () => {
    const msg = make_message({ provider: "slack" });
    const bus = make_reliable_bus(msg);
    const registry = { send: vi.fn(async () => ({ ok: true, message_id: "sent-ok" })), get: vi.fn(), list: vi.fn(() => []) };
    service = make_service(bus, registry);

    await service.start();
    await new Promise((r) => setTimeout(r, 50));
    await service.stop();

    expect(registry.send).toHaveBeenCalled();
    expect(bus._lease!.ack).toHaveBeenCalled();
  });

  it("메타데이터 non-retryable error → ack + DLQ 기록", async () => {
    const msg = make_message({
      provider: "slack",
      metadata: { dispatch_error: "invalid_auth", dispatch_retry: 1 },
    });
    const bus = make_reliable_bus(msg);
    const dlq = { append: vi.fn(async () => {}), list: vi.fn(async () => []), count: vi.fn(async () => 0), purge: vi.fn(async () => 0) };
    const registry = { send: vi.fn(async () => ({ ok: true })), get: vi.fn(), list: vi.fn(() => []) };
    service = make_service(bus, registry, dlq);

    await service.start();
    await new Promise((r) => setTimeout(r, 50));
    await service.stop();

    // non-retryable 에러 → 즉시 ack + DLQ (send 미호출)
    expect(registry.send).not.toHaveBeenCalled();
    expect(dlq.append).toHaveBeenCalled();
    expect(bus._lease!.ack).toHaveBeenCalled();
  });

  it("retryable 실패 + retryMax 초과 → ack + DLQ", async () => {
    const msg = make_message({
      provider: "slack",
      metadata: { dispatch_retry: 5 }, // retryMax=3 초과
    });
    const bus = make_reliable_bus(msg);
    const dlq = { append: vi.fn(async () => {}), list: vi.fn(async () => []), count: vi.fn(async () => 0), purge: vi.fn(async () => 0) };
    const registry = { send: vi.fn(async () => ({ ok: false, error: "rate_limited" })), get: vi.fn(), list: vi.fn(() => []) };
    service = make_service(bus, registry, dlq);

    await service.start();
    await new Promise((r) => setTimeout(r, 50));
    await service.stop();

    expect(dlq.append).toHaveBeenCalled();
    expect(bus._lease!.ack).toHaveBeenCalled();
  });

  it("retryable 실패 + retryMax 미달 → schedule_retry (bus.publish_outbound 호출)", async () => {
    const msg = make_message({
      provider: "slack",
      metadata: { dispatch_retry: 1 }, // retryMax=3 미달
    });
    const bus = make_reliable_bus(msg);
    const registry = { send: vi.fn(async () => ({ ok: false, error: "rate_limited" })), get: vi.fn(), list: vi.fn(() => []) };
    service = make_service(bus, registry);

    await service.start();
    await new Promise((r) => setTimeout(r, 50));
    await service.stop();

    // schedule_retry → 타이머 후 publish_outbound
    await new Promise((r) => setTimeout(r, 30));
    expect(bus.publish_outbound).toHaveBeenCalled();
  });
});

describe("DispatchService — consume_loop_basic (기본 버스 경로)", () => {
  it("기본 버스 메시지 → dispatch_outbound → registry.send 호출", async () => {
    const deps = make_deps();
    const msg = make_message({ provider: "slack" });
    const slow_null = () => new Promise<null>((r) => setTimeout(() => r(null), 50));
    deps.bus.consume_outbound
      .mockResolvedValueOnce(msg)
      .mockImplementation(slow_null);

    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: deps.retry_config,
      dedupe_config: deps.dedupe_config,
      grouping_config: deps.grouping_config,
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    await service.start();
    await new Promise((r) => setTimeout(r, 30));
    await service.stop();

    expect(deps.registry.send).toHaveBeenCalled();
  });

  it("provider 없는 메시지 → send 미호출", async () => {
    const deps = make_deps();
    const msg = make_message({ provider: undefined as any, channel: undefined as any });
    const slow_null = () => new Promise<null>((r) => setTimeout(() => r(null), 50));
    deps.bus.consume_outbound
      .mockResolvedValueOnce(msg)
      .mockImplementation(slow_null);

    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: deps.retry_config,
      dedupe_config: deps.dedupe_config,
      grouping_config: deps.grouping_config,
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    await service.start();
    await new Promise((r) => setTimeout(r, 30));
    await service.stop();

    expect(deps.registry.send).not.toHaveBeenCalled();
  });
});
