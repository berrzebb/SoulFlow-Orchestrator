import { describe, it, expect, vi, beforeEach } from "vitest";
import { DispatchService } from "@src/channels/dispatch.service.js";
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
    ...overrides,
  };
}

describe("DispatchService", () => {
  it("sends successfully on first attempt", async () => {
    const deps = make_deps();
    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: deps.retry_config,
      dedupe_config: deps.dedupe_config,
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
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    const result = await service.send("slack", make_message());
    expect(result.ok).toBe(true);
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
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    const result = await service.send("slack", make_message());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid_auth");
    // Should not retry: only 1 call
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
      dlq_store: deps.dlq_store as any,
      dedupe_policy: deps.dedupe_policy as any,
      logger: deps.logger as any,
    });

    const result = await service.send("slack", make_message());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("channel_not_found");
    expect(deps.registry.send).toHaveBeenCalledTimes(1);
  });

  it("deduplicates identical sends within TTL", async () => {
    const deps = make_deps();
    const service = new DispatchService({
      bus: deps.bus as any,
      registry: deps.registry as any,
      retry_config: deps.retry_config,
      dedupe_config: deps.dedupe_config,
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
});
