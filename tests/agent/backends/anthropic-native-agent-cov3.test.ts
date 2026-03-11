/**
 * AnthropicNativeAgent — 미커버 분기 (cov3):
 * - L322: text_blocks sort 비교자 body (text_bufs에 2개 이상 항목 필요)
 * - L327: tool_blocks sort 비교자 body (tool_meta에 2개 이상 항목 필요)
 *
 * V8 커버리지는 sort 콜백 body를 별도 statement로 추적함.
 * sort는 배열이 2개 이상일 때만 비교자를 호출하므로, index 0 + 1 두 블록이 필요.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { AnthropicNativeAgent } from "@src/agent/backends/anthropic-native.agent.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function make_sse_stream(events: object[]) {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}`).join("\n") + "\ndata: [DONE]\n";
  const bytes = new TextEncoder().encode(lines);
  let pos = 0;
  const stream = new ReadableStream({
    pull(c) {
      if (pos >= bytes.length) { c.close(); return; }
      c.enqueue(bytes.slice(pos, pos + 50));
      pos += 50;
    },
  });
  return { ok: true, status: 200, body: stream, text: async () => "" };
}

function make_agent() {
  return new AnthropicNativeAgent("anthropic_native", {
    api_key: "test-key",
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
  });
}

// ── L322: text_blocks sort 비교자 — text_bufs에 index 0 + 1 두 항목 ────────────

describe("AnthropicNativeAgent — L322 text_blocks sort 비교자", () => {
  it("SSE에 index 0, 1 두 텍스트 블록 → sort([a],[b]) => a-b 비교자 실행 (L322)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(make_sse_stream([
      { type: "message_start", message: { usage: { input_tokens: 5 } } },
      // 텍스트 블록 index=0
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
      // 텍스트 블록 index=1 → text_bufs에 2번째 항목 → sort 비교자 호출 → L322
      { type: "content_block_start", index: 1, content_block: { type: "text" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "World" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
    ])));

    const result = await make_agent().run({ task: "test", task_id: "t1" });
    // 두 텍스트 블록이 정렬 후 합쳐짐
    expect(result.content).toContain("Hello");
    expect(result.content).toContain("World");
  });
});

// ── L327: tool_blocks sort 비교자 — tool_meta에 index 0 + 1 두 항목 ─────────────

describe("AnthropicNativeAgent — L327 tool_blocks sort 비교자", () => {
  it("SSE에 index 0, 1 두 툴 블록 → sort([a],[b]) => a-b 비교자 실행 (L327)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(make_sse_stream([
      { type: "message_start", message: { usage: { input_tokens: 5 } } },
      // 툴 블록 index=0
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-0", name: "search" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"q":"a"}' } },
      // 툴 블록 index=1 → tool_meta에 2번째 항목 → sort 비교자 호출 → L327
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool-1", name: "calc" } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"x":1}' } },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
    ])));

    const result = await make_agent().run({ task: "test", task_id: "t1" });
    // 두 툴 블록이 정렬 후 처리됨 (executors 없으므로 실행은 안 되고 결과만 반환)
    expect(result).toBeDefined();
    expect(result.finish_reason).toBeDefined();
  });
});
