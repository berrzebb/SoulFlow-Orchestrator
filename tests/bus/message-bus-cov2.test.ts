/**
 * InMemoryMessageBus — 미커버 분기 보충 (cov2):
 * - L125: publish_outbound on closed bus → early return
 * - L177: close() while outbound waiter exists → waiter(null)
 * - L178: close() while progress waiter exists → waiter(null)
 * - L212: on_done called twice (timer fires after publish resolved) → if(done) return
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { InMemoryMessageBus } from "@src/bus/service.js";
import type { OutboundMessage, InboundMessage } from "@src/bus/types.js";

afterEach(() => {
  vi.useRealTimers();
});

function make_outbound(overrides?: Partial<OutboundMessage>): OutboundMessage {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    provider: "slack",
    channel: "slack",
    sender_id: "bot",
    chat_id: "C1",
    content: "hello",
    at: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

// ── L125: publish_outbound on closed bus ─────────────────────────────────────

describe("InMemoryMessageBus — L125: publish_outbound closed bus early return", () => {
  it("close 후 publish_outbound → L125 early return, 큐 비어있음", async () => {
    const bus = new InMemoryMessageBus();
    await bus.close();
    await bus.publish_outbound(make_outbound());
    // 큐에 아무것도 없어야 함 (early return at L125)
    expect(bus.get_size("outbound")).toBe(0);
  });
});

// ── L177: close() while outbound waiter → waiter(null) ──────────────────────

describe("InMemoryMessageBus — L177: outbound waiter + close → waiter(null)", () => {
  it("outbound 소비 대기 중 close → L177 waiter(null) 호출 → null 반환", async () => {
    const bus = new InMemoryMessageBus();
    // consume_outbound 시작 (큐 비어있음 → waiter 등록)
    const consume_promise = bus.consume_outbound({ timeout_ms: 10_000 });
    // 즉시 close → outbound_waiters에 waiter 있음 → L177 waiter(null)
    await bus.close();
    const result = await consume_promise;
    expect(result).toBeNull();
  });
});

// ── L178: close() while progress waiter → waiter(null) ──────────────────────

describe("InMemoryMessageBus — L178: progress waiter + close → waiter(null)", () => {
  it("progress 소비 대기 중 close → L178 waiter(null) 호출 → null 반환", async () => {
    const bus = new InMemoryMessageBus();
    // consume_progress 시작 (큐 비어있음 → waiter 등록)
    const consume_promise = bus.consume_progress({ timeout_ms: 10_000 });
    // close → progress_waiters에 waiter 있음 → L178 waiter(null)
    await bus.close();
    const result = await consume_promise;
    expect(result).toBeNull();
  });
});

// ── L212: on_done called twice → if(done) return ────────────────────────────

describe("InMemoryMessageBus — L212: done=true → on_done 재호출 시 return", () => {
  it("publish 후 타이머 발화 → on_done 이미 done=true → L212 early return", async () => {
    vi.useFakeTimers();
    const bus = new InMemoryMessageBus();

    // 큐 비어있음 → consume 대기 시작 (timeout_ms=1000으로 짧게 설정)
    const consume_promise = bus.consume_outbound({ timeout_ms: 1000 });

    // publish → on_done(message) 호출 → done=true, promise resolved
    await bus.publish_outbound(make_outbound());

    // 타이머 발화 (1000ms 진행) → on_done(null) 재호출 → L212 if(done) return
    await vi.advanceTimersByTimeAsync(1500);

    const result = await consume_promise;
    // publish된 메시지가 반환되어야 함 (null이 아님)
    expect(result).not.toBeNull();
    expect(result?.content).toBe("hello");

    await bus.close();
  });
});
