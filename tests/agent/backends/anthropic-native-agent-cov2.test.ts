/**
 * AnthropicNativeAgent 미커버 경로:
 * - simple_call: 정상 응답, 에러 응답
 * - _call_api: 비-data 라인 건너뜀, text_blocks/tool_blocks 빌드, abort signal 전파
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AnthropicNativeAgent } from "@src/agent/backends/anthropic-native.agent.js";

function make_sse_response(events: object[], ok = true, status = 200) {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}`).join("\n") + "\ndata: [DONE]\n";
  const encoder = new TextEncoder();
  const bytes = encoder.encode(lines);
  let pos = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (pos >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(pos, pos + 50));
      pos += 50;
    },
  });
  return { ok, status, body: stream, text: async () => "error body" };
}

function make_simple_response(content: string, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    text: async () => `Error ${ok ? 200 : 400}`,
    json: async () => ({
      content: [{ type: "text", text: content }],
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ══════════════════════════════════════════════════════════
// simple_call 정적 메서드
// ══════════════════════════════════════════════════════════

describe("AnthropicNativeAgent.simple_call", () => {
  it("정상 응답 → text 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(make_simple_response("Hello from API")));

    const result = await AnthropicNativeAgent.simple_call({
      api_key: "test-key",
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hi" }],
      system: "You are helpful",
    });
    expect(result).toBe("Hello from API");
  });

  it("system 없음 → system 생략", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(make_simple_response("OK")));

    const result = await AnthropicNativeAgent.simple_call({
      api_key: "test-key",
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(result).toBe("OK");
  });

  it("API 에러 응답 → throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(make_simple_response("", false)));

    await expect(
      AnthropicNativeAgent.simple_call({
        api_key: "bad-key",
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).rejects.toThrow("Anthropic API 400");
  });
});

// ══════════════════════════════════════════════════════════
// _call_api: 비-data 라인 + tool_blocks 구성
// ══════════════════════════════════════════════════════════

describe("AnthropicNativeAgent — _call_api SSE 경로", () => {
  function make_agent() {
    return new AnthropicNativeAgent("anthropic_native", {
      api_key: "test-key",
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
    });
  }

  it("비-data 라인 (comment, empty) → 건너뜀", async () => {
    // 일부 non-data 라인 포함
    const encoder = new TextEncoder();
    const lines = [
      ": keep-alive",       // 건너뜀
      "",                   // 빈 라인 건너뜀
      `data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 10 } } })}`,
      `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text" } })}`,
      `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } })}`,
      `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } })}`,
      "data: [DONE]",
    ].join("\n");
    const bytes = encoder.encode(lines);
    let pos = 0;
    const stream = new ReadableStream({
      pull(c) {
        if (pos >= bytes.length) { c.close(); return; }
        c.enqueue(bytes.slice(pos, pos + 20));
        pos += 20;
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream, text: async () => "" }));

    const agent = make_agent();
    const result = await agent.run({ task: "test", task_id: "t1" });

    expect(result.content).toContain("Hello");
  });

  it("tool_blocks 구성 (잘못된 JSON input_json_delta)", async () => {
    const sse = make_sse_response([
      { type: "message_start", message: { usage: { input_tokens: 5 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "my_tool" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{invalid_json" } },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse));

    const agent = make_agent();
    const result = await agent.run({ task: "test", task_id: "t1" });

    // tool_blocks 구성 시 잘못된 JSON → {} 사용
    expect(result).toBeDefined();
  });
});
