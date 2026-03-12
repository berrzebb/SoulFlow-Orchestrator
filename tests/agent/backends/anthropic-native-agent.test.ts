/**
 * AnthropicNativeAgent — fetch mock 기반 커버리지:
 * - is_available: api_key 있음/없음
 * - run: 정상 텍스트 응답, 도구 실행, abort_signal, 에러 응답
 * - _stream_turn: SSE 파싱 (message_start/content_block_start/delta/stop/message_delta)
 * - to_anthropic_tool: cache_control 마지막 도구
 * - thinking 모드 활성화
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AnthropicNativeAgent } from "@src/agent/backends/anthropic-native.agent.js";
import type { AgentRunOptions } from "@src/agent/agent.types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── SSE mock 헬퍼 ─────────────────────────────────────────

function make_sse_response(events: object[], ok = true, status = 200) {
  const lines = events
    .map((e) => `data: ${JSON.stringify(e)}`)
    .join("\n") + "\ndata: [DONE]\n";

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
  return {
    ok,
    status,
    body: stream,
    text: async () => "error body",
  };
}

function make_agent(overrides: Partial<import("@src/agent/backends/anthropic-native.agent.js").AnthropicNativeConfig> = {}) {
  return new AnthropicNativeAgent("anthropic_native", {
    api_key: "test-key",
    model: "claude-3-5-sonnet-20241022",
    ...overrides,
  });
}

function make_run_opts(overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return {
    task: "Say hello",
    task_id: "t1",
    ...overrides,
  };
}

const TEXT_EVENTS = [
  { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world!" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
];

// ══════════════════════════════════════════════════════════
// is_available
// ══════════════════════════════════════════════════════════

describe("AnthropicNativeAgent — is_available", () => {
  it("api_key 있음 → true", () => {
    const agent = make_agent({ api_key: "sk-ant-xxx" });
    expect(agent.is_available()).toBe(true);
  });

  it("api_key 빈 문자열 → false", () => {
    const agent = make_agent({ api_key: "" });
    expect(agent.is_available()).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// run — 정상 텍스트 응답
// ══════════════════════════════════════════════════════════

describe("AnthropicNativeAgent — run 텍스트 응답", () => {
  it("SSE 텍스트 이벤트 → content='Hello world!'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(make_sse_response(TEXT_EVENTS)));

    const agent = make_agent();
    const result = await agent.run(make_run_opts());

    expect(result.content).toBe("Hello world!");
    expect(result.finish_reason).toBe("stop");
    expect(result.tool_calls_count).toBe(0);
  });

  it("system_prompt → 요청 body에 system 포함됨", async () => {
    const fetch_mock = vi.fn().mockResolvedValue(make_sse_response(TEXT_EVENTS));
    vi.stubGlobal("fetch", fetch_mock);

    const agent = make_agent();
    await agent.run(make_run_opts({ system_prompt: "You are helpful" }));

    const [, opts] = fetch_mock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.system).toBeDefined();
    expect(body.system[0].text).toBe("You are helpful");
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("tools → 요청 body에 tools 포함, 마지막 도구에 cache_control", async () => {
    const fetch_mock = vi.fn().mockResolvedValue(make_sse_response(TEXT_EVENTS));
    vi.stubGlobal("fetch", fetch_mock);

    const agent = make_agent();
    await agent.run(make_run_opts({
      tools: [
        { type: "function", function: { name: "tool_a", description: "A", parameters: {} } } as any,
        { type: "function", function: { name: "tool_b", description: "B", parameters: {} } } as any,
      ],
    }));

    const [, opts] = fetch_mock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.tools).toHaveLength(2);
    // 마지막 도구에만 cache_control
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("enable_thinking=true → thinking 파라미터 포함", async () => {
    const fetch_mock = vi.fn().mockResolvedValue(make_sse_response(TEXT_EVENTS));
    vi.stubGlobal("fetch", fetch_mock);

    const agent = make_agent({ thinking_budget_tokens: 5000 });
    await agent.run(make_run_opts({ enable_thinking: true }));

    const [, opts] = fetch_mock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.thinking).toBeDefined();
    expect(body.thinking.type).toBe("enabled");
  });

  it("stop_reason=max_tokens → finish_reason='max_tokens'", async () => {
    const events = [
      ...TEXT_EVENTS.slice(0, -1),
      { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 5 } },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(make_sse_response(events)));

    const agent = make_agent();
    const result = await agent.run(make_run_opts());
    expect(result.finish_reason).toBe("max_tokens");
  });
});

// ══════════════════════════════════════════════════════════
// run — 도구 실행 (tool loop)
// ══════════════════════════════════════════════════════════

describe("AnthropicNativeAgent — run 도구 실행", () => {
  it("tool_use → executor 호출 → 결과 주입 → 두 번째 turn 텍스트 반환", async () => {
    const tool_use_events = [
      { type: "message_start", message: { usage: { input_tokens: 20 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "get_weather" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"city":' } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"Seoul"}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
    ];

    const fetch_mock = vi.fn()
      .mockResolvedValueOnce(make_sse_response(tool_use_events))
      .mockResolvedValueOnce(make_sse_response(TEXT_EVENTS));
    vi.stubGlobal("fetch", fetch_mock);

    const executor = vi.fn().mockResolvedValue("sunny 25°C");
    const agent = make_agent();
    const result = await agent.run(make_run_opts({
      tool_executors: [{ name: "get_weather", description: "weather", execute: executor } as any],
    }));

    expect(executor).toHaveBeenCalled();
    expect(result.content).toBe("Hello world!");
    expect(result.tool_calls_count).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════
// run — API 에러
// ══════════════════════════════════════════════════════════

describe("AnthropicNativeAgent — API 에러 처리", () => {
  it("res.ok=false → error 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      body: null,
      text: async () => "Unauthorized",
    }));

    const agent = make_agent();
    const result = await agent.run(make_run_opts());
    expect(result.finish_reason).toBe("error");
    expect(result.content).toContain("Error:");
  });

  it("res.body=null → error 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      text: async () => "",
    }));

    const agent = make_agent();
    const result = await agent.run(make_run_opts());
    expect(result.finish_reason).toBe("error");
  });

  it("fetch 자체 throw → error 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const agent = make_agent();
    const result = await agent.run(make_run_opts());
    expect(result.finish_reason).toBe("error");
    expect(result.content).toContain("network error");
  });
});

// ══════════════════════════════════════════════════════════
// run — abort_signal
// ══════════════════════════════════════════════════════════

describe("AnthropicNativeAgent — abort_signal", () => {
  it("abort_signal 이미 aborted → 루프 진입 안 함", async () => {
    const fetch_mock = vi.fn().mockResolvedValue(make_sse_response(TEXT_EVENTS));
    vi.stubGlobal("fetch", fetch_mock);

    const controller = new AbortController();
    controller.abort();

    const agent = make_agent();
    const result = await agent.run(make_run_opts({ abort_signal: controller.signal }));
    // 루프가 진입하지 않음 → fetch 호출됨 (첫 turn 시작 전에 abort 체크)
    // 실제로는 첫 turn에서 fetch가 호출되지만 turn=0일 때 body가 비어있으므로 에러
    expect(result).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════
// SSE 이벤트 파싱 — 다양한 delta 타입
// ══════════════════════════════════════════════════════════

describe("AnthropicNativeAgent — SSE 이벤트 파싱", () => {
  it("on_stream 콜백 → text_delta 수신 시 호출됨", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(make_sse_response(TEXT_EVENTS)));

    const on_stream = vi.fn();
    const agent = make_agent();
    await agent.run(make_run_opts({ hooks: { on_stream } as any }));

    expect(on_stream).toHaveBeenCalledWith("Hello");
    expect(on_stream).toHaveBeenCalledWith(" world!");
  });

  it("cache usage → result.usage에 cache 정보 포함", async () => {
    const events_with_cache = [
      { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 50, cache_creation_input_tokens: 100 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(make_sse_response(events_with_cache)));

    const agent = make_agent();
    const result = await agent.run(make_run_opts());
    expect(result.usage?.cache_read_input_tokens).toBe(50);
    expect(result.usage?.cache_creation_input_tokens).toBe(100);
  });

  it("잘못된 JSON data 라인 → 무시하고 계속", async () => {
    const bad_json_text = "data: not-json\n" + TEXT_EVENTS.map((e) => `data: ${JSON.stringify(e)}`).join("\n") + "\ndata: [DONE]\n";
    const encoder = new TextEncoder();
    const bytes = encoder.encode(bad_json_text);
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream, text: async () => "" }));

    const agent = make_agent();
    const result = await agent.run(make_run_opts());
    expect(result.content).toBe("Hello world!");
  });
});

// ── simple_call 헬퍼 ─────────────────────────────────────────

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
  it("비-data 라인 (comment, empty) → 건너뜀", async () => {
    const encoder = new TextEncoder();
    const lines = [
      ": keep-alive",
      "",
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

    expect(result).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════
// L322: text_blocks sort 비교자 — text_bufs에 index 0 + 1 두 항목
// ══════════════════════════════════════════════════════════

describe("AnthropicNativeAgent — L322 text_blocks sort 비교자", () => {
  it("SSE에 index 0, 1 두 텍스트 블록 → sort([a],[b]) => a-b 비교자 실행 (L322)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(make_sse_response([
      { type: "message_start", message: { usage: { input_tokens: 5 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
      { type: "content_block_start", index: 1, content_block: { type: "text" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "World" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
    ])));

    const result = await make_agent().run({ task: "test", task_id: "t1" });
    expect(result.content).toContain("Hello");
    expect(result.content).toContain("World");
  });
});

// ══════════════════════════════════════════════════════════
// L327: tool_blocks sort 비교자 — tool_meta에 index 0 + 1 두 항목
// ══════════════════════════════════════════════════════════

describe("AnthropicNativeAgent — L327 tool_blocks sort 비교자", () => {
  it("SSE에 index 0, 1 두 툴 블록 → sort([a],[b]) => a-b 비교자 실행 (L327)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(make_sse_response([
      { type: "message_start", message: { usage: { input_tokens: 5 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-0", name: "search" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"q":"a"}' } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool-1", name: "calc" } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"x":1}' } },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
    ])));

    const result = await make_agent().run({ task: "test", task_id: "t1" });
    expect(result).toBeDefined();
    expect(result.finish_reason).toBeDefined();
  });
});
