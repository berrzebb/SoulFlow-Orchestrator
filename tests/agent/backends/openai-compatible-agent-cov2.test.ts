/**
 * OpenAiCompatibleAgent — 미커버 경로 보충 (cov2):
 * - L86: abort_signal이 tool 루프 중 aborted → break
 * - L199-204: tools 있을 때 body.tools/tool_choice/stream/stream_options
 * - L236: _parse_sse_stream 호출 (on_stream 있을 때)
 * - L250-322: _parse_sse_stream 전체 (텍스트·도구호출·usage 누적)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAiCompatibleAgent } from "@src/agent/backends/openai-compatible.agent.js";
import type { AgentRunOptions } from "@src/agent/agent.types.js";

afterEach(() => { vi.unstubAllGlobals(); });

function make_agent(overrides: Record<string, unknown> = {}) {
  return new OpenAiCompatibleAgent("test-agent", {
    api_base: "https://api.example.com/v1",
    api_key: "key",
    model: "gpt-4o",
    ...overrides,
  } as any);
}

function make_run_opts(overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return {
    task_id: "t1",
    system_prompt: "You are helpful.",
    task: "Do something",
    messages: [{ role: "user", content: "Hello" }],
    ...overrides,
  };
}

function openai_response(content = "OK", tool_calls: unknown[] = [], finish_reason = "stop") {
  return {
    choices: [{ message: { role: "assistant", content, tool_calls: tool_calls.length ? tool_calls : undefined }, finish_reason }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

// SSE 청크를 ReadableStream으로 만드는 헬퍼
function make_sse_response(lines: string[]) {
  const text = lines.join("\n") + "\n\n";
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let pos = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (pos >= bytes.length) {
        controller.close();
        return;
      }
      // 청크별로 전달
      const chunk = bytes.slice(pos, pos + 100);
      pos += 100;
      controller.enqueue(chunk);
    },
  });
  return {
    ok: true,
    status: 200,
    body: stream,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(text),
  };
}

// ══════════════════════════════════════════════════════════
// abort_signal이 tool 루프 중 이미 aborted (L86)
// ══════════════════════════════════════════════════════════

describe("OpenAiCompatibleAgent — abort_signal aborted in tool loop (L86)", () => {
  it("tool_calls + executor 있고 abort_signal 이미 aborted → 루프 탈출", async () => {
    const tool_call = {
      id: "tc1", type: "function",
      function: { name: "my_tool", arguments: "{}" },
    };
    const mock_fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(openai_response("", [tool_call], "tool_calls")),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", mock_fetch);

    // AbortController를 사전에 abort
    const ctrl = new AbortController();
    ctrl.abort();

    const executor = vi.fn().mockResolvedValue({ text: "tool result", is_error: false });
    const agent = make_agent();

    const r = await agent.run(make_run_opts({
      abort_signal: ctrl.signal,
      tool_executors: [{ name: "my_tool", execute: executor }] as any,
    }));

    // abort → 루프 즉시 탈출, executor는 호출되지 않음
    expect(r).toBeDefined();
    expect(executor).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// SSE 스트리밍: on_stream + _parse_sse_stream (L199-322)
// ══════════════════════════════════════════════════════════

describe("OpenAiCompatibleAgent — SSE 스트리밍 경로 (L199-322)", () => {
  it("on_stream 있음 → body.stream=true, _parse_sse_stream 호출, 텍스트 누적", async () => {
    const sse_lines = [
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
      "data: [DONE]",
    ];

    const mock_fetch = vi.fn().mockResolvedValue(make_sse_response(sse_lines));
    vi.stubGlobal("fetch", mock_fetch);

    const chunks: string[] = [];
    const agent = make_agent();

    const r = await agent.run(make_run_opts({
      hooks: {
        on_stream: (chunk) => { chunks.push(chunk); },
      },
    }));

    // fetch body에 stream=true가 포함됨
    const body = JSON.parse(mock_fetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });

    // on_stream 콜백이 텍스트 청크 수신
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("")).toBe("Hello world");

    // 최종 결과
    expect(r.content).toBe("Hello world");
    expect(r.finish_reason).toBe("stop");
  });

  it("SSE 스트림: tools=[] 이면 body.tools/tool_choice 없음, body.stream=true", async () => {
    const sse_lines = [
      'data: {"choices":[{"delta":{"content":"result"},"finish_reason":"stop"}]}',
      "data: [DONE]",
    ];
    const mock_fetch = vi.fn().mockResolvedValue(make_sse_response(sse_lines));
    vi.stubGlobal("fetch", mock_fetch);

    const agent = make_agent();
    await agent.run(make_run_opts({
      hooks: { on_stream: vi.fn() },
    }));

    const body = JSON.parse(mock_fetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("SSE 스트림: tools 있음 → body.tools + tool_choice='auto' + stream=true (L199-204)", async () => {
    const sse_lines = [
      'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}',
      "data: [DONE]",
    ];
    const mock_fetch = vi.fn().mockResolvedValue(make_sse_response(sse_lines));
    vi.stubGlobal("fetch", mock_fetch);

    // tools는 options.tools (ToolSchema[])에서 가져옴
    const tool_schema = [{ type: "function", function: { name: "my_tool", description: "test", parameters: { type: "object", properties: {} } } }];
    const agent = make_agent();
    await agent.run(make_run_opts({
      tools: tool_schema as any,
      hooks: { on_stream: vi.fn() },
    }));

    const body = JSON.parse(mock_fetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tool_choice).toBe("auto");
  });

  it("SSE 스트림: 도구 호출 조각 누적 (L289-300)", async () => {
    // 도구 호출이 여러 청크로 나뉘어 전달
    const sse_lines = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc1","function":{"name":"my_","arguments":""}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"tool","arguments":"{\\\"x\\\":"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
    ];
    const done_sse = [
      'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}',
      "data: [DONE]",
    ];

    // 두 번째 fetch (도구 실행 후)도 SSE 스트림으로 응답 (on_stream이 모든 호출에 적용됨)
    const mock_fetch = vi.fn()
      .mockResolvedValueOnce(make_sse_response(sse_lines))
      .mockResolvedValueOnce(make_sse_response(done_sse));
    vi.stubGlobal("fetch", mock_fetch);

    const executor = vi.fn().mockResolvedValue({ text: "tool output", is_error: false });
    const agent = make_agent();
    const r = await agent.run(make_run_opts({
      tools: [{ type: "function", function: { name: "my_tool", description: "test", parameters: {} } }] as any,
      tool_executors: [{ name: "my_tool", execute: executor }] as any,
      hooks: { on_stream: vi.fn() },
    }));

    // 도구가 실행됨
    expect(executor).toHaveBeenCalledOnce();
    expect(r.content).toBe("done");
  });

  it("SSE 스트림: 잘못된 JSON 라인 → continue (L275-276)", async () => {
    const sse_lines = [
      "data: not-valid-json",  // JSON 파싱 실패 → continue
      'data: {"choices":[{"delta":{"content":"valid"},"finish_reason":"stop"}]}',
      "data: [DONE]",
    ];
    const mock_fetch = vi.fn().mockResolvedValue(make_sse_response(sse_lines));
    vi.stubGlobal("fetch", mock_fetch);

    const agent = make_agent();
    const r = await agent.run(make_run_opts({
      hooks: { on_stream: vi.fn() },
    }));

    // 잘못된 JSON은 건너뛰고 정상 응답 반환
    expect(r.content).toBe("valid");
  });

  it("no_tool_choice=true → tool_choice 미포함 (L200 분기)", async () => {
    const sse_lines = [
      'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}',
      "data: [DONE]",
    ];
    const mock_fetch = vi.fn().mockResolvedValue(make_sse_response(sse_lines));
    vi.stubGlobal("fetch", mock_fetch);

    const agent = make_agent({ no_tool_choice: true });
    await agent.run(make_run_opts({
      tools: [{ type: "function", function: { name: "my_tool", description: "test", parameters: {} } }] as any,
      hooks: { on_stream: vi.fn() },
    }));

    const body = JSON.parse(mock_fetch.mock.calls[0][1].body);
    expect(body.tools).toBeDefined();
    expect(body.tool_choice).toBeUndefined();  // no_tool_choice=true → 미포함
  });
});
