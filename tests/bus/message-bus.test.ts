/**
 * InMemoryMessageBus — publish/consume, waiter, observer, close 동작 테스트.
 */
import { describe, it, expect, vi } from "vitest";
import { InMemoryMessageBus } from "../../src/bus/service.js";
import type { InboundMessage, OutboundMessage, ProgressEvent } from "../../src/bus/types.js";

const make_inbound = (id: string, content = ""): InboundMessage => ({
  id, provider: "test", channel: "c", sender_id: "s", chat_id: "t", content, at: "",
});

const make_outbound = (id: string, content = ""): OutboundMessage => ({
  id, provider: "test", channel: "c", sender_id: "s", chat_id: "t", content, at: "",
});

describe("InMemoryMessageBus", () => {
  // ── 기본 publish/consume ──
  it("publish_inbound → consume_inbound: FIFO 순서", async () => {
    const bus = new InMemoryMessageBus();
    await bus.publish_inbound(make_inbound("1", "first"));
    await bus.publish_inbound(make_inbound("2", "second"));
    const m1 = await bus.consume_inbound();
    const m2 = await bus.consume_inbound();
    expect(m1!.content).toBe("first");
    expect(m2!.content).toBe("second");
    await bus.close();
  });

  it("publish_outbound → consume_outbound", async () => {
    const bus = new InMemoryMessageBus();
    await bus.publish_outbound(make_outbound("1", "reply"));
    const msg = await bus.consume_outbound();
    expect(msg!.content).toBe("reply");
    await bus.close();
  });

  it("publish_progress → consume_progress", async () => {
    const bus = new InMemoryMessageBus();
    const event: ProgressEvent = { type: "status", chat_id: "t", message: "working" } as unknown as ProgressEvent;
    await bus.publish_progress(event);
    const p = await bus.consume_progress();
    expect(p).toBeDefined();
    await bus.close();
  });

  // ── waiter 패턴 ──
  it("consume 먼저 호출 → publish가 waiter에 직접 전달", async () => {
    const bus = new InMemoryMessageBus();
    const promise = bus.consume_inbound({ timeout_ms: 5000 });
    await bus.publish_inbound(make_inbound("waiter-test", "delivered"));
    const msg = await promise;
    expect(msg!.content).toBe("delivered");
    await bus.close();
  });

  it("consume timeout: 메시지 없으면 null 반환", async () => {
    const bus = new InMemoryMessageBus();
    const result = await bus.consume_inbound({ timeout_ms: 50 });
    expect(result).toBeNull();
    await bus.close();
  });

  // ── observer ──
  it("on_publish: observer가 inbound/outbound 이벤트 수신", async () => {
    const bus = new InMemoryMessageBus();
    const events: Array<[string, unknown]> = [];
    bus.on_publish((direction, msg) => events.push([direction, msg]));

    await bus.publish_inbound(make_inbound("ob-1"));
    await bus.publish_outbound(make_outbound("ob-2"));
    expect(events.length).toBe(2);
    expect(events[0][0]).toBe("inbound");
    expect(events[1][0]).toBe("outbound");
    await bus.close();
  });

  it("on_publish: observer 에러가 다른 메시지에 영향 없음", async () => {
    const bus = new InMemoryMessageBus();
    bus.on_publish(() => { throw new Error("observer crash"); });
    await bus.publish_inbound(make_inbound("1"));
    const msg = await bus.consume_inbound();
    expect(msg).toBeDefined();
    await bus.close();
  });

  // ── get_size / get_sizes / get_metrics ──
  it("get_size: direction별 + 합계", async () => {
    const bus = new InMemoryMessageBus();
    await bus.publish_inbound(make_inbound("1"));
    await bus.publish_inbound(make_inbound("2"));
    await bus.publish_outbound(make_outbound("3"));
    expect(bus.get_size("inbound")).toBe(2);
    expect(bus.get_size("outbound")).toBe(1);
    expect(bus.get_size()).toBe(3);
    await bus.close();
  });

  it("get_sizes: 구조화된 사이즈 반환", async () => {
    const bus = new InMemoryMessageBus();
    await bus.publish_inbound(make_inbound("1"));
    const sizes = bus.get_sizes();
    expect(sizes.inbound).toBe(1);
    expect(sizes.outbound).toBe(0);
    expect(sizes.total).toBe(1);
    await bus.close();
  });

  // ── close 동작 ──
  it("close 후 publish는 무시됨", async () => {
    const bus = new InMemoryMessageBus();
    await bus.close();
    await bus.publish_inbound(make_inbound("ignored"));
    expect(bus.get_size("inbound")).toBe(0);
  });

  it("close 후 consume은 즉시 null", async () => {
    const bus = new InMemoryMessageBus();
    await bus.close();
    const msg = await bus.consume_inbound();
    expect(msg).toBeNull();
  });

  it("is_closed: close 전후 상태 확인", async () => {
    const bus = new InMemoryMessageBus();
    expect(bus.is_closed()).toBe(false);
    await bus.close();
    expect(bus.is_closed()).toBe(true);
  });

  // ── kind ──
  it("kind: 'memory' 반환", () => {
    const bus = new InMemoryMessageBus();
    expect(bus.kind).toBe("memory");
  });

  // ── close 상세 분기 (cov2) ──

  it("close 후 publish_outbound → early return, 큐 비어있음", async () => {
    const bus = new InMemoryMessageBus();
    await bus.close();
    await bus.publish_outbound(make_outbound("ignored", "hello"));
    expect(bus.get_size("outbound")).toBe(0);
  });

  it("outbound 소비 대기 중 close → waiter(null) → null 반환", async () => {
    const bus = new InMemoryMessageBus();
    const promise = bus.consume_outbound({ timeout_ms: 10_000 });
    await bus.close();
    const result = await promise;
    expect(result).toBeNull();
  });

  it("progress 소비 대기 중 close → waiter(null) → null 반환", async () => {
    const bus = new InMemoryMessageBus();
    const promise = bus.consume_progress({ timeout_ms: 10_000 });
    await bus.close();
    const result = await promise;
    expect(result).toBeNull();
  });

  it("publish 후 타이머 발화 → on_done 이미 done → early return", async () => {
    vi.useFakeTimers();
    const bus = new InMemoryMessageBus();
    const promise = bus.consume_outbound({ timeout_ms: 1000 });
    await bus.publish_outbound(make_outbound("timer-test", "hello"));
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result?.content).toBe("hello");
    await bus.close();
    vi.useRealTimers();
  });
});
