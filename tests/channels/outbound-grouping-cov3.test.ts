/**
 * OutboundGroupingBuffer — 미커버 분기 보충 (cov3):
 * - L66: flush(key) — entry 없음 → early return
 *
 * flush_all()이 내부에서 clearTimeout을 호출하므로 타이머 발화로는 도달 불가.
 * private flush()를 직접 호출해야 entry=undefined 경로가 실행됨.
 */
import { describe, it, expect, vi } from "vitest";
import { OutboundGroupingBuffer } from "@src/channels/outbound-grouping.js";
import type { OutboundMessage } from "@src/bus/types.js";

function make_msg(): OutboundMessage {
  return {
    id: "m-1",
    provider: "slack",
    channel: "C1",
    sender_id: "bot",
    chat_id: "C1",
    content: "hello",
    at: new Date().toISOString(),
    metadata: {},
  };
}

// ── L66: flush(nonexistent-key) → entry 없음 → early return ──────────────────

describe("OutboundGroupingBuffer — L66: flush 없는 key → early return", () => {
  it("존재하지 않는 key로 flush() 직접 호출 → entry undefined → L66 early return", () => {
    const on_flush = vi.fn();
    const buf = new OutboundGroupingBuffer({ enabled: true, windowMs: 500, maxMessages: 10 }, on_flush);

    // 직접 private flush 호출 — 아무 entry도 없는 key
    (buf as any).flush("nonexistent:key");

    // on_flush 미호출 (entry 없어서 L66에서 early return)
    expect(on_flush).not.toHaveBeenCalled();
  });

  it("push 후 flush_all → 이미 제거된 key로 flush() 재호출 → L66 early return", () => {
    const on_flush = vi.fn();
    const buf = new OutboundGroupingBuffer({ enabled: true, windowMs: 500, maxMessages: 10 }, on_flush);

    buf.push("slack", make_msg());
    buf.flush_all(); // entry 제거
    expect(on_flush).toHaveBeenCalledTimes(1);

    // flush_all 후 같은 key로 flush() 재호출 → entry 없음 → L66
    (buf as any).flush("slack:C1");
    expect(on_flush).toHaveBeenCalledTimes(1); // 추가 호출 없음
  });
});
