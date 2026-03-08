/**
 * ClaudeSdkAgent — mock SDK query 기반 커버리지.
 * @anthropic-ai/claude-agent-sdk의 query()를 mock하여 각 메시지 타입 경로 검증.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── SDK mock (vi.hoisted 필수) ──────────────────────────────────────

const { mock_query } = vi.hoisted(() => ({ mock_query: vi.fn() }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mock_query,
}));

import { ClaudeSdkAgent } from "@src/agent/backends/claude-sdk.agent.js";
import type { AgentRunOptions } from "@src/agent/agent.types.js";

// ── 헬퍼 ──────────────────────────────────────────────

function make_agent(config?: Record<string, unknown>) {
  return new ClaudeSdkAgent(config as any);
}

function make_opts(overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return {
    task_id: "task-1",
    task: "Do something",
    system_prompt: "You are helpful.",
    messages: [],
    cwd: "/tmp/test-cwd",
    ...overrides,
  };
}

/** async generator로 메시지 시퀀스를 생성하는 mock query 반환값. */
function make_query_instance(messages: Record<string, unknown>[], opts?: { close?: () => void }) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const msg of messages) {
        yield msg;
      }
    },
    close: opts?.close ?? vi.fn(),
    interrupt: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════
// is_available
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — is_available", () => {
  it("SDK mock 등록됨 → is_available()가 boolean 반환", () => {
    const agent = make_agent();
    const result = agent.is_available();
    expect(typeof result).toBe("boolean");
  });

  it("id 기본값 = claude_sdk", () => {
    const agent = make_agent();
    expect(agent.id).toBe("claude_sdk");
  });

  it("id 커스텀 설정", () => {
    const agent = make_agent({ id: "my-sdk" });
    expect(agent.id).toBe("my-sdk");
  });

  it("native_tool_loop=true, supports_resume=true", () => {
    const agent = make_agent();
    expect(agent.native_tool_loop).toBe(true);
    expect(agent.supports_resume).toBe(true);
  });
});

// ══════════════════════════════════════════
// run() — 기본 성공 경로
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — run() 기본 성공", () => {
  it("result 메시지 → finish_reason=stop, content 반환", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "init", session_id: "sess-abc" },
      { type: "result", subtype: "success", result: "Done!", usage: { input_tokens: 10, output_tokens: 5 } },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts());
    expect(r.finish_reason).toBe("stop");
    expect(r.content).toBe("Done!");
    expect(r.usage?.prompt_tokens).toBe(10);
  });

  it("init 메시지 → session 설정", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "init", session_id: "my-sess" },
      { type: "result", subtype: "success", result: "OK" },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts());
    expect(r.session?.session_id).toBe("my-sess");
  });

  it("assistant 메시지 + text block → content 수집", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "init", session_id: "" },
      { type: "assistant", message: { content: [{ type: "text", text: "Hello " }, { type: "text", text: "World" }] } },
      { type: "result", subtype: "success", result: "Hello World" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts({
      hooks: { on_event: (e) => { events.push(e.type); } },
    }));
    expect(r.content).toBeTruthy();
    expect(events).toContain("content_delta");
  });

  it("assistant 메시지 + tool_use block → tool_calls_count 증가", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "init", session_id: "" },
      { type: "assistant", message: { content: [
        { type: "tool_use", name: "bash", id: "tc-1", input: { command: "ls" } },
      ]} },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts({
      hooks: { on_event: (e) => { events.push(e.type); } },
    }));
    expect(r.tool_calls_count).toBe(1);
    expect(events).toContain("tool_use");
  });

  it("on_stream 훅 → 텍스트 청크 수신", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "init", session_id: "" },
      { type: "assistant", message: { content: [{ type: "text", text: "stream chunk" }] } },
      { type: "result", subtype: "success", result: "stream chunk" },
    ]));
    const chunks: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({
      hooks: { on_stream: async (chunk) => { chunks.push(chunk); } },
    }));
    expect(chunks).toContain("stream chunk");
  });
});

// ══════════════════════════════════════════
// run() — 다양한 메시지 타입
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — run() 메시지 타입", () => {
  it("system/status compacting → compact_boundary 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "status", status: "compacting" },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("compact_boundary");
  });

  it("system/compact_boundary → compact_boundary 이벤트 + trigger", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 1000 } },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: { type: string; trigger?: string }[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e as any) } }));
    const cb = events.find(e => e.type === "compact_boundary");
    expect(cb).toBeDefined();
    expect((cb as any).trigger).toBe("manual");
  });

  it("auth_status 메시지 → auth_request 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "auth_status", output: ["https://claude.ai/auth"], error: undefined },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("auth_request");
  });

  it("auth_status with error → auth_request + error 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "auth_status", output: [], error: "token_expired" },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("error");
  });

  it("rate_limit_event → rate_limit 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", utilization: 0.9 } },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("rate_limit");
  });

  it("rate_limit_event rejected status → rate_limit 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "rate_limit_event", rate_limit_info: { status: "rejected" } },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: { type: string; status?: string }[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e as any) } }));
    const rl = events.find(e => e.type === "rate_limit");
    expect(rl).toBeDefined();
    expect((rl as any).status).toBe("rejected");
  });

  it("task_started → task_lifecycle 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "task_started", task_id: "t-123" },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("task_lifecycle");
  });

  it("tool_use_summary → tool_summary 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "tool_use_summary", summary: "2 tools used", preceding_tool_use_ids: ["tc1", "tc2"] },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("tool_summary");
  });

  it("result subtype=error → finish_reason=error", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "error_during_execution", result: "something failed" },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts());
    expect(r.finish_reason).toBe("error");
  });

  it("assistant.error 필드 → error 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "assistant", error: "billing_error" },
      { type: "result", subtype: "error_during_execution", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("error");
  });

  it("isReplay=true 메시지 → 건너뜀 (카운트 없음)", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "assistant", isReplay: true, message: { content: [{ type: "tool_use", name: "bash", id: "t1", input: {} }] } },
      { type: "result", subtype: "success", result: "" },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts());
    expect(r.tool_calls_count).toBe(0); // replay는 카운트 안 됨
  });

  it("tool_progress → on_stream 호출", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "tool_progress", tool_name: "bash", elapsed_time_seconds: 5 },
      { type: "result", subtype: "success", result: "" },
    ]));
    const chunks: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_stream: async (c) => { chunks.push(c); } } }));
    expect(chunks.some(c => c.includes("bash"))).toBe(true);
  });
});

// ══════════════════════════════════════════
// run() — abort / 에러
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — run() abort / 에러", () => {
  it("abort_signal 이미 aborted → cancelled 반환", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "init", session_id: "" },
    ]));
    const ctrl = new AbortController();
    ctrl.abort();
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts({ abort_signal: ctrl.signal }));
    expect(r.finish_reason).toBe("cancelled");
  });

  it("generator throw → error finish_reason", async () => {
    mock_query.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        throw new Error("SDK internal error");
      },
      close: vi.fn(),
    });
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts());
    expect(r.finish_reason).toBe("error");
    expect(r.content).toContain("SDK internal error");
  });

  it("result.total_cost_usd → metadata에 포함", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "ok", total_cost_usd: 0.005 },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts());
    expect(r.finish_reason).toBe("stop");
  });

  it("resume_session 설정 → sdk_options.resume 전달", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "" },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts({
      resume_session: { session_id: "prev-sess-id", backend: "claude_sdk", created_at: "" },
    }));
    expect(r).toBeDefined();
    expect(mock_query).toHaveBeenCalledOnce();
    const opts = mock_query.mock.calls[0][0].options;
    expect(opts.resume).toBe("prev-sess-id");
  });

  it("max_turns 설정 → sdk_options.maxTurns 전달", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "" },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ max_turns: 5 }));
    const opts = mock_query.mock.calls[0][0].options;
    expect(opts.maxTurns).toBe(5);
  });

  it("structured_output 설정 → sdk_options.outputFormat 전달", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "" },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    const schema = { type: "object", properties: { name: { type: "string" } } };
    await agent.run(make_opts({ structured_output: schema as any }));
    const opts = mock_query.mock.calls[0][0].options;
    expect(opts.outputFormat?.type).toBe("json_schema");
  });
});
