/**
 * DispatchService 미커버 경로 보충:
 * - L82,86: stop() with pending_retries
 * - L160-162: non-retryable error in consume_loop_leased
 * - L181: dispatch_outbound failed
 * - L216: prune recent cache
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { DispatchService } from "@src/channels/dispatch.service.js";
import { DefaultOutboundDedupePolicy } from "@src/channels/outbound-dedupe.js";
import type { ChannelRegistryLike } from "@src/channels/types.js";
import type { Logger } from "@src/logger.js";
import type { MessageBusLike, OutboundMessage } from "@src/bus/types.js";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function make_logger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

function make_msg(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    id: "msg-1",
    chat_id: "ch-1",
    provider: "slack",
    text: "hello",
    ...overrides,
  } as OutboundMessage;
}

function make_registry(send_fn?: () => Promise<{ ok: boolean; message_id?: string; error?: string }>): ChannelRegistryLike {
  return {
    send: send_fn || vi.fn().mockResolvedValue({ ok: true, message_id: "mid-1" }),
    has_provider: vi.fn().mockReturnValue(true),
  } as any;
}

function make_slow_bus(): MessageBusLike {
  return {
    consume_outbound: vi.fn().mockImplementation(
      () => new Promise((r) => setTimeout(() => r(null), 500))
    ),
    publish_outbound: vi.fn().mockResolvedValue(undefined),
    subscribe_outbound: vi.fn(),
  } as any;
}

const BASE_RETRY = { inlineRetries: 0, retryMax: 2, retryBaseMs: 10, retryMaxMs: 100, retryJitterMs: 0, dlqEnabled: false, dlqPath: "" };
const LONG_RETRY = { inlineRetries: 0, retryMax: 3, retryBaseMs: 60000, retryMaxMs: 120000, retryJitterMs: 0, dlqEnabled: false, dlqPath: "" };

function make_service(overrides: {
  bus?: MessageBusLike;
  registry?: ChannelRegistryLike;
  logger?: Logger;
  retry_config?: Record<string, unknown>;
  dedupe_max?: number;
} = {}): DispatchService {
  return new DispatchService({
    bus: overrides.bus || make_slow_bus(),
    registry: overrides.registry || make_registry(),
    retry_config: (overrides.retry_config || BASE_RETRY) as any,
    dedupe_config: { ttlMs: 5000, maxSize: overrides.dedupe_max ?? 5 },
    grouping_config: { flushIntervalMs: 50, maxGroupSize: 10, maxWaitMs: 50, debounceMs: 10 },
    dlq_store: null,
    dedupe_policy: new DefaultOutboundDedupePolicy(),
    logger: overrides.logger || make_logger(),
  });
}

describe("DispatchService — stop() pending_retries 정리 (L82, L86)", () => {
  it("pending_retries에 타이머 있을 때 stop() → 정리됨", async () => {
    const svc = make_service({ retry_config: LONG_RETRY });
    (svc as any).schedule_retry("slack", make_msg(), 1, "rate_limit_exceeded");
    expect((svc as any).pending_retries.size).toBe(1);
    await svc.stop();
    expect((svc as any).pending_retries.size).toBe(0);
  });

  it("start + pending_retries + stop → 두 번 정리됨 (L82 + L86)", async () => {
    const svc = make_service({ retry_config: LONG_RETRY });
    await svc.start();
    (svc as any).schedule_retry("slack", make_msg(), 1, "rate_limit_exceeded");
    expect((svc as any).pending_retries.size).toBe(1);
    await svc.stop();
    expect((svc as any).pending_retries.size).toBe(0);
  });
});

describe("DispatchService — dispatch_outbound 실패 로그 (L181)", () => {
  it("send → 실패 → logger.debug 'dispatch failed' (L181)", async () => {
    const logger = make_logger();
    const registry = make_registry(vi.fn().mockResolvedValue({ ok: false, error: "some_unique_error" }));
    const svc = make_service({ registry, logger, retry_config: { ...BASE_RETRY, retryMax: 0 } });
    (svc as any).dispatch_outbound(make_msg());
    await new Promise((r) => setTimeout(r, 50));
    const debug_calls = (logger.debug as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(debug_calls.some((c) => c === "dispatch failed")).toBe(true);
  });
});

describe("DispatchService — prune recent cache (L216)", () => {
  it("recent.size > maxSize + 500 → prune 실행됨", async () => {
    const registry = make_registry(vi.fn().mockResolvedValue({ ok: true, message_id: "mid" }));
    const svc = make_service({ registry, dedupe_max: 2 });
    const recent = (svc as any).recent as Map<string, { at_ms: number; message_id: string }>;
    for (let i = 0; i < 503; i++) {
      recent.set(`key-${i}`, { at_ms: Date.now() - 100_000, message_id: `m${i}` });
    }
    const size_before = recent.size;
    const result = await (svc as any).send_with_retry("slack", make_msg({ id: "unique-prune-msg" }), false);
    expect(result.ok).toBe(true);
    expect(recent.size).toBeLessThan(size_before);
  });
});

describe("DispatchService — consume_loop_leased non-retryable error (L160-162)", () => {
  it("leased bus + non-retryable error → write_dlq 호출 (L160-162)", async () => {
    const dlq_mock = { append: vi.fn().mockResolvedValue(undefined) };
    const registry = make_registry(vi.fn().mockResolvedValue({ ok: false, error: "channel_not_found" }));
    const msg = make_msg();
    let call_count = 0;
    const reliable_bus = {
      consume_outbound_lease: vi.fn().mockImplementation(() => {
        call_count++;
        if (call_count === 1) {
          return Promise.resolve({ value: msg, ack: vi.fn().mockResolvedValue(undefined) });
        }
        return new Promise<null>((r) => setTimeout(() => r(null), 500));
      }),
      publish_outbound: vi.fn().mockResolvedValue(undefined),
    };

    const svc = new DispatchService({
      bus: reliable_bus as any,
      registry,
      retry_config: BASE_RETRY as any,
      dedupe_config: { ttlMs: 5000, maxSize: 100 },
      grouping_config: { flushIntervalMs: 50, maxGroupSize: 10, maxWaitMs: 50, debounceMs: 10 },
      dlq_store: dlq_mock as any,
      dedupe_policy: new DefaultOutboundDedupePolicy(),
      logger: make_logger(),
    });

    await svc.start();
    await new Promise((r) => setTimeout(r, 100));
    await svc.stop();

    expect(dlq_mock.append).toHaveBeenCalled();
  });
});
