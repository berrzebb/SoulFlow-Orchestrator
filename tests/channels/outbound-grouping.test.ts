/**
 * OutboundGroupingBuffer — 그룹핑 버퍼 커버리지.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OutboundGroupingBuffer } from "@src/channels/outbound-grouping.js";
import type { OutboundMessage } from "@src/bus/types.js";

vi.useFakeTimers();

function make_msg(chat_id: string, content: string, media?: unknown[]): OutboundMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    provider: "slack",
    channel: "C123",
    sender_id: "agent",
    chat_id,
    content,
    at: new Date().toISOString(),
    media: media as any,
  };
}

function make_buffer(
  enabled = true,
  windowMs = 100,
  maxMessages = 5,
) {
  const on_flush = vi.fn();
  const buf = new OutboundGroupingBuffer({ enabled, windowMs, maxMessages }, on_flush);
  return { buf, on_flush };
}

afterEach(() => { vi.clearAllTimers(); });

// ══════════════════════════════════════════
// 비활성화 모드
// ══════════════════════════════════════════

describe("OutboundGroupingBuffer — 비활성화", () => {
  it("enabled=false → 즉시 플러시", () => {
    const { buf, on_flush } = make_buffer(false);
    buf.push("slack", make_msg("C1", "hello"));
    expect(on_flush).toHaveBeenCalledOnce();
    expect(on_flush.mock.calls[0][0]).toHaveLength(1);
  });
});

// ══════════════════════════════════════════
// 단일 메시지 (타이머 플러시)
// ══════════════════════════════════════════

describe("OutboundGroupingBuffer — 타이머 플러시", () => {
  it("windowMs 후 단일 메시지 플러시", () => {
    const { buf, on_flush } = make_buffer();
    buf.push("slack", make_msg("C1", "hello"));
    expect(on_flush).not.toHaveBeenCalled(); // 아직 플러시 안 됨
    vi.runAllTimers();
    expect(on_flush).toHaveBeenCalledOnce();
    const flushed = on_flush.mock.calls[0][0] as OutboundMessage[];
    expect(flushed[0].content).toBe("hello");
  });

  it("다른 chat_id → 별도 그룹", () => {
    const { buf, on_flush } = make_buffer();
    buf.push("slack", make_msg("C1", "msg1"));
    buf.push("slack", make_msg("C2", "msg2"));
    vi.runAllTimers();
    expect(on_flush).toHaveBeenCalledTimes(2);
  });
});

// ══════════════════════════════════════════
// maxMessages 즉시 플러시
// ══════════════════════════════════════════

describe("OutboundGroupingBuffer — maxMessages 즉시 플러시", () => {
  it("maxMessages 도달 → 즉시 플러시 (병합)", () => {
    const { buf, on_flush } = make_buffer(true, 1000, 3);
    buf.push("slack", make_msg("C1", "a"));
    buf.push("slack", make_msg("C1", "b"));
    buf.push("slack", make_msg("C1", "c")); // 3번째 → 즉시 플러시
    expect(on_flush).toHaveBeenCalledOnce();
    const flushed = on_flush.mock.calls[0][0] as OutboundMessage[];
    // 3개 병합 → content는 \n\n 구분
    expect(flushed[0].content).toContain("a");
    expect(flushed[0].content).toContain("c");
  });
});

// ══════════════════════════════════════════
// 메시지 병합
// ══════════════════════════════════════════

describe("OutboundGroupingBuffer — 메시지 병합", () => {
  it("2개 메시지 병합 → content 결합", () => {
    const { buf, on_flush } = make_buffer();
    buf.push("slack", make_msg("C1", "first"));
    buf.push("slack", make_msg("C1", "second"));
    vi.runAllTimers();
    const flushed = on_flush.mock.calls[0][0] as OutboundMessage[];
    expect(flushed).toHaveLength(1);
    expect(flushed[0].content).toContain("first");
    expect(flushed[0].content).toContain("second");
  });

  it("미디어 있는 메시지 병합", () => {
    const { buf, on_flush } = make_buffer();
    buf.push("slack", make_msg("C1", "with media", [{ url: "http://img1.jpg", type: "image" }]));
    buf.push("slack", make_msg("C1", "with media2", [{ url: "http://img2.jpg", type: "image" }]));
    vi.runAllTimers();
    const flushed = on_flush.mock.calls[0][0] as OutboundMessage[];
    expect(flushed[0].media).toHaveLength(2);
  });

  it("미디어 없는 병합 → media=undefined", () => {
    const { buf, on_flush } = make_buffer();
    buf.push("slack", make_msg("C1", "a"));
    buf.push("slack", make_msg("C1", "b"));
    vi.runAllTimers();
    const flushed = on_flush.mock.calls[0][0] as OutboundMessage[];
    expect(flushed[0].media).toBeUndefined();
  });
});

// ══════════════════════════════════════════
// flush_all
// ══════════════════════════════════════════

describe("OutboundGroupingBuffer — flush_all", () => {
  it("대기 중 메시지 즉시 플러시", () => {
    const { buf, on_flush } = make_buffer();
    buf.push("slack", make_msg("C1", "pending1"));
    buf.push("slack", make_msg("C2", "pending2"));
    buf.flush_all();
    expect(on_flush).toHaveBeenCalledTimes(2);
  });

  it("빈 버퍼 flush_all → 아무것도 호출 안 됨", () => {
    const { buf, on_flush } = make_buffer();
    buf.flush_all();
    expect(on_flush).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// thread_id 구분
// ══════════════════════════════════════════

describe("OutboundGroupingBuffer — thread_id 구분", () => {
  it("같은 chat_id 다른 thread → 다른 그룹", () => {
    const { buf, on_flush } = make_buffer();
    const m1 = make_msg("C1", "thread1");
    const m2 = make_msg("C1", "thread2");
    (m1 as any).thread_id = "t1";
    (m2 as any).thread_id = "t2";
    buf.push("slack", m1);
    buf.push("slack", m2);
    vi.runAllTimers();
    expect(on_flush).toHaveBeenCalledTimes(2);
  });
});

// ══════════════════════════════════════════
// flush() — entry 없음 → early return (from cov2)
// ══════════════════════════════════════════

describe("OutboundGroupingBuffer — L66: flush 시 entry 없음 → early return", () => {
  it("push 후 flush_all → 타이머 발화 → flush(key) but entry 없음 → L66", () => {
    const on_flush = vi.fn();
    const buf = new OutboundGroupingBuffer({ enabled: true, windowMs: 500, maxMessages: 10 }, on_flush);

    buf.push("slack", make_msg("C1", "hello"));
    buf.flush_all();
    expect(on_flush).toHaveBeenCalledTimes(1);

    vi.runAllTimers();
    expect(on_flush).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════
// flush() — messages 빈 배열 → early return (from cov2)
// ══════════════════════════════════════════

describe("OutboundGroupingBuffer — L70: messages 빈 배열 → early return", () => {
  it("groups에 빈 messages 직접 주입 → flush → L70 early return", () => {
    const on_flush = vi.fn();
    const buf = new OutboundGroupingBuffer({ enabled: true, windowMs: 500, maxMessages: 10 }, on_flush);

    const groups = (buf as unknown as { groups: Map<string, { messages: OutboundMessage[]; timer: ReturnType<typeof setTimeout> }> }).groups;
    groups.set("slack:C1", { messages: [], timer: setTimeout(() => {}, 100_000) });

    buf.flush_all();
    expect(on_flush).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// flush() — 존재하지 않는 key 직접 호출 (from cov3)
// ══════════════════════════════════════════

describe("OutboundGroupingBuffer — L66: flush 없는 key → early return", () => {
  it("존재하지 않는 key로 flush() 직접 호출 → entry undefined → L66 early return", () => {
    const on_flush = vi.fn();
    const buf = new OutboundGroupingBuffer({ enabled: true, windowMs: 500, maxMessages: 10 }, on_flush);

    (buf as any).flush("nonexistent:key");

    expect(on_flush).not.toHaveBeenCalled();
  });

  it("push 후 flush_all → 이미 제거된 key로 flush() 재호출 → L66 early return", () => {
    const on_flush = vi.fn();
    const buf = new OutboundGroupingBuffer({ enabled: true, windowMs: 500, maxMessages: 10 }, on_flush);

    buf.push("slack", make_msg("C1", "hello"));
    buf.flush_all();
    expect(on_flush).toHaveBeenCalledTimes(1);

    (buf as any).flush("slack:C1");
    expect(on_flush).toHaveBeenCalledTimes(1);
  });
});
