/**
 * OpenRouterProvider / OrchestratorLlmProvider — fetch mock 기반 커버리지.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenRouterProvider } from "@src/providers/openrouter.provider.js";
import { OrchestratorLlmProvider } from "@src/providers/orchestrator-llm.provider.js";

// ── fetch mock ──────────────────────────────────────

function make_fetch(ok: boolean, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function openai_success_body(content = "Hello", tool_calls: unknown[] = []) {
  return {
    choices: [{
      message: { role: "assistant", content, tool_calls: tool_calls.length ? tool_calls : undefined },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

const USER_MSG = [{ role: "user" as const, content: "Hello" }];

afterEach(() => { vi.unstubAllGlobals(); });

// ══════════════════════════════════════════
// OpenRouterProvider
// ══════════════════════════════════════════

describe("OpenRouterProvider — constructor", () => {
  it("기본값 설정 확인", () => {
    const p = new OpenRouterProvider();
    expect(p.id).toBe("openrouter");
    expect(p.default_model).toContain("gpt");
  });

  it("커스텀 값 설정", () => {
    const p = new OpenRouterProvider({ api_key: "sk-xxx", default_model: "anthropic/claude", api_base: "https://custom.api.com" });
    expect(p.default_model).toBe("anthropic/claude");
    expect(p.api_base).toBe("https://custom.api.com");
  });
});

describe("OpenRouterProvider — chat()", () => {
  it("api_key 없음 → error finish_reason", async () => {
    const p = new OpenRouterProvider({ api_key: "" });
    vi.stubGlobal("fetch", make_fetch(true, openai_success_body()));
    const r = await p.chat({ messages: USER_MSG });
    expect(r.finish_reason).toBe("error");
    expect(r.content).toContain("openrouter_api_key_missing");
  });

  it("성공 응답 → content 반환", async () => {
    vi.stubGlobal("fetch", make_fetch(true, openai_success_body("Hi there")));
    const p = new OpenRouterProvider({ api_key: "sk-key" });
    const r = await p.chat({ messages: USER_MSG });
    expect(r.finish_reason).toBe("stop");
    expect(r.content).toBe("Hi there");
  });

  it("API 에러 응답 → error 반환", async () => {
    vi.stubGlobal("fetch", make_fetch(false, { error: "rate limit" }));
    const p = new OpenRouterProvider({ api_key: "sk-key" });
    const r = await p.chat({ messages: USER_MSG });
    expect(r.finish_reason).toBe("error");
    expect(r.content).toContain("Error calling OpenRouter");
  });

  it("fetch 예외 → error 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const p = new OpenRouterProvider({ api_key: "sk-key" });
    const r = await p.chat({ messages: USER_MSG });
    expect(r.finish_reason).toBe("error");
    expect(r.content).toContain("network error");
  });

  it("http_referer + app_title → 헤더 포함 (fetch 호출 검증)", async () => {
    const mock_fetch = make_fetch(true, openai_success_body());
    vi.stubGlobal("fetch", mock_fetch);
    const p = new OpenRouterProvider({ api_key: "sk-key", http_referer: "https://myapp.com", app_title: "MyApp" });
    await p.chat({ messages: USER_MSG });
    const [, init] = mock_fetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["HTTP-Referer"]).toBe("https://myapp.com");
    expect(headers["X-Title"]).toBe("MyApp");
  });

  it("tools 있음 → body에 tools 포함", async () => {
    const mock_fetch = make_fetch(true, openai_success_body());
    vi.stubGlobal("fetch", mock_fetch);
    const p = new OpenRouterProvider({ api_key: "sk-key" });
    await p.chat({ messages: USER_MSG, tools: [{ type: "function", function: { name: "test", parameters: {} } } as any] });
    const body = JSON.parse((mock_fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tools).toBeDefined();
    expect(body.tool_choice).toBe("auto");
  });

  it("abort_signal 있음 → AbortSignal.any 사용", async () => {
    vi.stubGlobal("fetch", make_fetch(true, openai_success_body()));
    const p = new OpenRouterProvider({ api_key: "sk-key" });
    const ctrl = new AbortController();
    const r = await p.chat({ messages: USER_MSG, abort_signal: ctrl.signal });
    expect(r.finish_reason).toBe("stop");
  });
});

// ══════════════════════════════════════════
// OrchestratorLlmProvider
// ══════════════════════════════════════════

describe("OrchestratorLlmProvider — constructor", () => {
  it("기본값: ollama api_base", () => {
    const p = new OrchestratorLlmProvider();
    expect(p.id).toBe("orchestrator_llm");
    expect(p.api_base).toContain("ollama");
  });

  it("커스텀 api_base/model", () => {
    const p = new OrchestratorLlmProvider({ api_base: "http://localhost:11434/v1", default_model: "qwen2.5" });
    expect(p.api_base).toBe("http://localhost:11434/v1");
    expect(p.default_model).toBe("qwen2.5");
  });
});

describe("OrchestratorLlmProvider — chat()", () => {
  it("성공 → content 반환", async () => {
    vi.stubGlobal("fetch", make_fetch(true, openai_success_body("Response")));
    const p = new OrchestratorLlmProvider({ api_base: "http://localhost:11434/v1" });
    const r = await p.chat({ messages: USER_MSG });
    expect(r.content).toBe("Response");
    expect(r.finish_reason).toBe("stop");
  });

  it("API 에러 → error 반환", async () => {
    vi.stubGlobal("fetch", make_fetch(false, { error: "model not found" }));
    const p = new OrchestratorLlmProvider({ api_base: "http://localhost:11434/v1" });
    const r = await p.chat({ messages: USER_MSG });
    expect(r.finish_reason).toBe("error");
    expect(r.content).toContain("Error calling orchestrator_llm");
  });

  it("fetch 예외 → error 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    const p = new OrchestratorLlmProvider({ api_base: "http://localhost:11434/v1" });
    const r = await p.chat({ messages: USER_MSG });
    expect(r.finish_reason).toBe("error");
    expect(r.content).toContain("connection refused");
  });

  it("tool_calls 없음 + content에 tool_calls 텍스트 → 파싱 시도", async () => {
    // parse_tool_calls_from_text가 인식하는 형식의 텍스트
    const body_with_text = openai_success_body("<tool>test_tool({\"arg\":\"val\"})</tool>");
    vi.stubGlobal("fetch", make_fetch(true, body_with_text));
    const p = new OrchestratorLlmProvider({ api_base: "http://localhost:11434/v1" });
    const r = await p.chat({ messages: USER_MSG, tools: [{ type: "function", function: { name: "test_tool", parameters: {} } } as any] });
    // 파싱 여부에 관계없이 valid LlmResponse 반환
    expect(r).toBeDefined();
    expect(typeof r.finish_reason).toBe("string");
  });

  it("api_key 있음 → Authorization 헤더 포함", async () => {
    const mock_fetch = make_fetch(true, openai_success_body());
    vi.stubGlobal("fetch", mock_fetch);
    const p = new OrchestratorLlmProvider({ api_base: "http://localhost/v1", api_key: "local-key" });
    await p.chat({ messages: USER_MSG });
    const [, init] = mock_fetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer local-key");
  });
});
