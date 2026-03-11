/**
 * OutboundGroupingBuffer — 미커버 분기 보충:
 * - L66: flush() — entry 없음 → early return (타이머 발화 시 이미 flush_all로 제거)
 * - L70: flush() — entry.messages.length === 0 → early return (내부 상태 직접 주입)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { OutboundGroupingBuffer } from "@src/channels/outbound-grouping.js";
import type { OutboundMessage } from "@src/bus/types.js";

afterEach(() => {
  vi.useRealTimers();
});

function make_msg(chat_id = "C1"): OutboundMessage {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    provider: "slack",
    channel: "C1",
    sender_id: "bot",
    chat_id,
    content: "hello",
    at: new Date().toISOString(),
    metadata: {},
  };
}

// ── L66: flush(key) 호출 시 entry 없음 → early return ──────────────────────

describe("OutboundGroupingBuffer — L66: flush 시 entry 없음 → early return", () => {
  it("push 후 flush_all → 타이머 발화 → flush(key) but entry 없음 → L66", () => {
    vi.useFakeTimers();
    const on_flush = vi.fn();
    const buf = new OutboundGroupingBuffer({ enabled: true, windowMs: 500, maxMessages: 10 }, on_flush);

    buf.push("slack", make_msg());
    // flush_all로 entry 제거 (on_flush 1회 호출)
    buf.flush_all();
    expect(on_flush).toHaveBeenCalledTimes(1);

    // 타이머 발화 → flush(key) 재호출 → entry 없음 → L66 early return (on_flush 추가 호출 없음)
    vi.runAllTimers();
    expect(on_flush).toHaveBeenCalledTimes(1); // 추가 호출 없음
  });
});

// ── L70: entry.messages.length === 0 → early return ────────────────────────

describe("OutboundGroupingBuffer — L70: messages 빈 배열 → early return", () => {
  it("groups에 빈 messages 직접 주입 → flush → L70 early return", () => {
    const on_flush = vi.fn();
    const buf = new OutboundGroupingBuffer({ enabled: true, windowMs: 500, maxMessages: 10 }, on_flush);

    // 내부 groups에 빈 messages 항목 직접 주입
    const groups = (buf as unknown as { groups: Map<string, { messages: OutboundMessage[]; timer: ReturnType<typeof setTimeout> }> }).groups;
    groups.set("slack:C1", { messages: [], timer: setTimeout(() => {}, 100_000) });

    // flush_all → flush("slack:C1") → messages.length === 0 → L70 early return
    buf.flush_all();
    expect(on_flush).not.toHaveBeenCalled(); // 빈 배열이므로 on_flush 미호출
  });
});
