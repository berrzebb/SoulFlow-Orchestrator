/**
 * OpenAiCompatibleAgent — run() 전체 경로 커버리지 (fetch mock).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAiCompatibleAgent } from "@src/agent/backends/openai-compatible.agent.js";
import type { AgentRunOptions } from "@src/agent/agent.types.js";

// ── 헬퍼 ──────────────────────────────────────────────

function make_agent(config_overrides: Record<string, unknown> = {}) {
  return new OpenAiCompatibleAgent("test-agent", {
    api_base: "https://api.example.com/v1",
    api_key: "test-key",
    model: "gpt-4o",
    ...config_overrides,
  } as any);
}

function make_run_opts(overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return {
    task_id: "task-1",
    system_prompt: "You are helpful.",
    task: "Do something",
    messages: [{ role: "user", content: "Hello" }],
    ...overrides,
  };
}

function openai_response(content = "OK", tool_calls: unknown[] = [], finish_reason = "stop") {
  return {
    choices: [{
      message: {
        role: "assistant",
        content,
        tool_calls: tool_calls.length ? tool_calls : undefined,
      },
      finish_reason,
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function make_fetch(ok: boolean, body: unknown, fail?: Error) {
  if (fail) return vi.fn().mockRejectedValue(fail);
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

// ══════════════════════════════════════════
// is_available
// ══════════════════════════════════════════

describe("OpenAiCompatibleAgent — is_available", () => {
  it("api_base 있음 → true", () => {
    expect(make_agent().is_available()).toBe(true);
  });

  it("api_base 빈 문자열 → false", () => {
    expect(make_agent({ api_base: "" }).is_available()).toBe(false);
  });
});

// ══════════════════════════════════════════
// run() — 기본 경로
// ══════════════════════════════════════════

describe("OpenAiCompatibleAgent — run() 기본 경로", () => {
  it("성공 응답 → content 반환", async () => {
    vi.stubGlobal("fetch", make_fetch(true, openai_response("Hello back")));
    const agent = make_agent();
    const r = await agent.run(make_run_opts());
    expect(r.content).toBe("Hello back");
    expect(r.finish_reason).toBe("stop");
    expect(r.tool_calls_count).toBe(0);
  });

  it("fetch 실패 → error finish_reason", async () => {
    vi.stubGlobal("fetch", make_fetch(false, null, new Error("Network failure")));
    const agent = make_agent();
    const r = await agent.run(make_run_opts());
    expect(r.finish_reason).toBe("error");
    expect(r.content).toContain("Network failure");
  });

  it("API 에러 상태코드 → 예외 발생 → error 반환", async () => {
    vi.stubGlobal("fetch", make_fetch(false, { error: "bad request" }));
    const agent = make_agent();
    const r = await agent.run(make_run_opts());
    expect(r.finish_reason).toBe("error");
  });

  it("hooks.on_event 이벤트 수신", async () => {
    vi.stubGlobal("fetch", make_fetch(true, openai_response()));
    const events: string[] = [];
    const agent = make_agent();
    await agent.run(make_run_opts({
      hooks: { on_event: (e) => { events.push(e.type); } },
    }));
    expect(events).toContain("init");
    expect(events).toContain("complete");
  });

  it("max_tokens / temperature 설정 → body에 포함", async () => {
    const mock_fetch = make_fetch(true, openai_response());
    vi.stubGlobal("fetch", mock_fetch);
    const agent = make_agent({ max_tokens: 100, temperature: 0.7 });
    await agent.run(make_run_opts());
    const body = JSON.parse(mock_fetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.7);
  });

  it("abort_signal이 이미 aborted → 루프 즉시 탈출", async () => {
    vi.stubGlobal("fetch", make_fetch(true, openai_response("OK", [
      { id: "tc1", type: "function", function: { name: "my_tool", arguments: "{}" } },
    ])));
    const ctrl = new AbortController();
    ctrl.abort();
    const agent = make_agent();
    const r = await agent.run(make_run_opts({ abort_signal: ctrl.signal }));
    // 정상 반환 (abort 후 루프 탈출)
    expect(r).toBeDefined();
  });
});

// ══════════════════════════════════════════
// run() — 도구 호출
// ══════════════════════════════════════════

describe("OpenAiCompatibleAgent — run() 도구 호출", () => {
  it("tool_calls + executor → 도구 실행 후 재호출", async () => {
    const tool_call = {
      id: "tc-1",
      type: "function",
      function: { name: "my_tool", arguments: JSON.stringify({ input: "test" }) },
    };
    const mock_fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve(openai_response("", [tool_call], "tool_calls")),
        text: () => Promise.resolve(""),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve(openai_response("Done after tool")),
        text: () => Promise.resolve(""),
      });
    vi.stubGlobal("fetch", mock_fetch);

    const executor = vi.fn().mockResolvedValue({ text: "tool result", is_error: false });
    const agent = make_agent();
    const r = await agent.run(make_run_opts({
      tool_executors: [{ name: "my_tool", execute: executor }] as any,
    }));

    expect(executor).toHaveBeenCalledOnce();
    expect(r.tool_calls_count).toBe(1);
    expect(mock_fetch).toHaveBeenCalledTimes(2);
  });

  it("tool_calls but no executors → 루프 탈출 (executor 없음)", async () => {
    const tool_call = {
      id: "tc-1", type: "function",
      function: { name: "unknown_tool", arguments: "{}" },
    };
    vi.stubGlobal("fetch", make_fetch(true, openai_response("", [tool_call], "tool_calls")));
    const agent = make_agent();
    const r = await agent.run(make_run_opts()); // tool_executors 없음
    // 루프 탈출 후 마지막 응답의 tool_calls 카운트됨
    expect(r.tool_calls_count).toBeGreaterThan(0);
  });

  it("extra_headers → fetch 헤더에 포함", async () => {
    const mock_fetch = make_fetch(true, openai_response());
    vi.stubGlobal("fetch", mock_fetch);
    const agent = make_agent({ extra_headers: { "X-Custom": "value" } });
    await agent.run(make_run_opts());
    const headers = mock_fetch.mock.calls[0][1].headers;
    expect(headers["X-Custom"]).toBe("value");
  });
});
